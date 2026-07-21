import { createHash, randomBytes as cryptoRandomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateEnvelopeObject } from '../validate-envelope-emit.js';
import { gardenSignature } from './authoring.js';
import { buildScanContext } from './scan.js';
import {
  captureOpenedFileIdentity,
  guardRegularTarget,
  revalidatePhysicalParent,
  revalidateOwnedFileIdentity,
  renameWithRetry,
  resolveAndValidateRealTargetRoot,
  RuntimeError,
  safeCleanupOwnedFile,
  stateDependencies,
  withStateMutationLock,
} from './state.js';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ROOT_SCHEMA = 'https://raw.githubusercontent.com/Sungmin-Cho/claude-deep-suite/main/schemas/artifact-envelope.schema.json';

function artifactError(code, message, cause) {
  return new RuntimeError(code, message, cause ? { cause } : undefined);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, label) {
  if (!isPlainObject(value)) throw artifactError('request', `${label} must be a plain object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw artifactError('request', `${label} has unknown or missing keys`);
  }
}

function timestamp(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw artifactError('artifact', 'now must be a valid Date');
  }
  return value.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function encodeCrockford(value, length) {
  let remaining = BigInt(value);
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output = CROCKFORD[Number(remaining & 31n)] + output;
    remaining >>= 5n;
  }
  if (remaining !== 0n) throw artifactError('artifact', 'ULID input exceeds allocated width');
  return output;
}

function ulid(now, randomBytes) {
  const milliseconds = now.getTime();
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 0xffffffffffff) {
    throw artifactError('artifact', 'ULID timestamp must fit in 48 bits');
  }
  const bytes = Buffer.from(randomBytes ?? cryptoRandomBytes(10));
  if (bytes.length !== 10) throw artifactError('artifact', 'ULID randomness must be exactly 10 bytes');
  let random = 0n;
  for (const byte of bytes) random = (random << 8n) | BigInt(byte);
  return `${encodeCrockford(BigInt(milliseconds), 10)}${encodeCrockford(random, 16)}`;
}

export function serializeStateJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function artifactRevision(bytesOrObject) {
  const bytes = Buffer.isBuffer(bytesOrObject)
    ? bytesOrObject
    : typeof bytesOrObject === 'string'
      ? Buffer.from(bytesOrObject, 'utf8')
      : serializeStateJson(bytesOrObject);
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function pluginVersion(pluginRoot) {
  let value;
  try {
    value = JSON.parse(await readFile(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
  } catch (error) {
    throw artifactError('artifact', `cannot read plugin version: ${error.message}`, error);
  }
  if (!isPlainObject(value) || typeof value.version !== 'string') {
    throw artifactError('artifact', 'plugin manifest has no version');
  }
  return value.version;
}

function validatePayloadInput(payload) {
  if (!isPlainObject(payload)) throw artifactError('request', 'payload must be a plain object');
  const allowed = new Set(['documents', 'summary', 'gaps', 'provenance']);
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    throw artifactError('request', 'payload has unknown keys');
  }
  if (!Array.isArray(payload.documents)) throw artifactError('request', 'payload.documents must be an array');
  payload.documents.forEach((document, index) => {
    if (!isPlainObject(document)) {
      throw artifactError('request', `payload.documents[${index}] must be an object`);
    }
    validateRepositoryPath(document.path, `payload.documents[${index}].path`);
  });
  if (!isPlainObject(payload.summary)) throw artifactError('request', 'payload.summary must be an object');
  if ('gaps' in payload && !Array.isArray(payload.gaps)) throw artifactError('request', 'payload.gaps must be an array');
}

async function atomicStateReplace({
  canonicalRoot,
  target,
  bytes,
  expectedStateDirectory,
  expectedTargetBytes,
  deps,
}) {
  const runtimeDeps = stateDependencies(deps);
  const revalidateTarget = async () => {
    const guard = await guardRegularTarget(canonicalRoot, target, {
      expectedPhysicalParent: expectedStateDirectory,
      allowMissing: true,
      code: 'state',
    });
    if (expectedTargetBytes === undefined) return;
    if (expectedTargetBytes === null) {
      if (guard.exists) throw artifactError('state', 'state target changed before replacement');
      return;
    }
    if (!guard.exists) throw artifactError('state', 'state target disappeared before replacement');
    const observed = await runtimeDeps.readFile(target);
    if (!observed.equals(expectedTargetBytes)) {
      throw artifactError('state', 'state target bytes changed before replacement');
    }
  };
  await revalidateTarget();
  if (typeof runtimeDeps.beforeTempOpen === 'function') {
    await runtimeDeps.beforeTempOpen({ target });
  }
  await revalidateTarget();

  const temporary = `${target}.${process.pid}.${runtimeDeps.randomUUID()}.tmp`;
  let handle;
  let temporaryIdentity;
  try {
    handle = await runtimeDeps.open(temporary, 'wx');
    temporaryIdentity = await captureOpenedFileIdentity(handle, 'state');
    await handle.writeFile(bytes);
    await handle.sync();
    // Re-capture on the same fd: a write can change a synthesized birthtime
    // (zero-device filesystems derive it from ctime), so the proof used by
    // later revalidation must reflect the post-write state, not the
    // open-time snapshot.
    temporaryIdentity = await captureOpenedFileIdentity(handle, 'state');
    await handle.close();
    handle = undefined;
    if (typeof runtimeDeps.beforeRename === 'function') {
      await runtimeDeps.beforeRename({ temporary, target });
    }
    await renameWithRetry(temporary, target, {
      ...runtimeDeps,
      revalidate: async () => {
        await revalidatePhysicalParent(canonicalRoot, expectedStateDirectory, expectedStateDirectory);
        await revalidateTarget();
        await revalidateOwnedFileIdentity(
          canonicalRoot,
          temporary,
          expectedStateDirectory,
          temporaryIdentity,
          { code: 'state', deps: runtimeDeps },
        );
      },
    });
  } catch (error) {
    try { await handle?.close(); } catch {}
    if (temporaryIdentity) {
      await safeCleanupOwnedFile(
        canonicalRoot,
        temporary,
        expectedStateDirectory,
        temporaryIdentity,
        runtimeDeps,
      );
    }
    throw error;
  }
}

export async function evaluateReuse({
  artifact,
  artifactBytes,
  root,
  pluginRoot = PLUGIN_ROOT,
  now = new Date(),
  pathCheckEnabled = false,
}) {
  const version = await pluginVersion(pluginRoot);
  const envelopeErrors = validateEnvelopeObject(artifact, version);
  if (envelopeErrors.length) return { reusable: false, reason: 'envelope' };
  const env = artifact.envelope;
  const provenance = artifact.payload.provenance;
  const context = await buildScanContext(root, { pathCheckEnabled });
  if (!context.is_git) return { reusable: false, reason: 'no-git' };
  const generated = Date.parse(env.generated_at);
  if (!Number.isFinite(generated)
      || generated > now.getTime()
      || now.getTime() - generated > 600_000) {
    return { reusable: false, reason: 'ttl' };
  }
  if (!provenance || typeof provenance.is_git !== 'boolean') {
    return { reusable: false, reason: 'provenance' };
  }
  if ((provenance.path_check_enabled === true) !== Boolean(pathCheckEnabled)) {
    return { reusable: false, reason: 'path-check' };
  }
  if (!provenance.is_git) return { reusable: false, reason: 'provenance' };
  if (env.git?.head !== context.git.head) return { reusable: false, reason: 'head' };
  if (provenance.worktree_hash !== context.worktree_hash) {
    return { reusable: false, reason: 'worktree' };
  }
  return {
    reusable: true,
    reason: 'ok',
    artifact_revision: artifactRevision(artifactBytes ?? artifact),
  };
}

export async function emitScanArtifact({
  root,
  payload,
  pluginRoot = PLUGIN_ROOT,
  now = new Date(),
  randomBytes,
  pathCheckEnabled = false,
  deps = {},
}) {
  validatePayloadInput(payload);
  if (typeof pathCheckEnabled !== 'boolean') throw artifactError('request', 'path_check_enabled must be boolean');
  const canonicalRoot = await resolveAndValidateRealTargetRoot(root);
  const context = await buildScanContext(canonicalRoot, { pathCheckEnabled });
  const version = await pluginVersion(pluginRoot);
  const generatedAt = timestamp(now);
  const normalizedPayload = {
    documents: structuredClone(payload.documents),
    summary: structuredClone(payload.summary),
    ...('gaps' in payload ? { gaps: structuredClone(payload.gaps) } : {}),
    provenance: {
      is_git: context.is_git,
      worktree_hash: context.worktree_hash,
      ...(pathCheckEnabled ? { path_check_enabled: true } : {}),
    },
  };
  const artifact = {
    $schema: ROOT_SCHEMA,
    schema_version: '1.0',
    envelope: {
      producer: 'deep-docs',
      producer_version: version,
      artifact_kind: 'last-scan',
      run_id: ulid(now, randomBytes),
      generated_at: generatedAt,
      schema: { name: 'last-scan', version: '1.1' },
      git: {
        head: context.git.head,
        branch: context.git.branch,
        dirty: context.git.dirty,
      },
      provenance: {
        source_artifacts: normalizedPayload.documents.map(({ path: documentPath }) => ({
          path: documentPath,
        })),
        tool_versions: { node: process.version },
      },
    },
    payload: normalizedPayload,
  };
  const errors = validateEnvelopeObject(artifact, version);
  if (errors.length) throw artifactError('envelope', errors.join('; '));
  const bytes = serializeStateJson(artifact);

  await withStateMutationLock(canonicalRoot, async ({ stateDirectory, expectedStateDirectory, deps: lockDeps }) => {
    await atomicStateReplace({
      canonicalRoot,
      target: join(stateDirectory, 'last-scan.json'),
      bytes,
      expectedStateDirectory,
      deps: lockDeps,
    });
  }, deps);
  return artifact;
}

function validateRepositoryPath(value, label = 'path') {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.includes('\0')) {
    throw artifactError('request', `${label} must be a non-empty forward-slash repository path`);
  }
  if (value === '.' || value.endsWith('/') || /^[A-Za-z]:/.test(value) || posix.isAbsolute(value)
      || value.split('/').includes('..') || posix.normalize(value) !== value) {
    throw artifactError('request', `${label} must be normalized and repository-relative`);
  }
  return value;
}

function validateIgnoreEntry(entry) {
  exactKeys(entry, ['signature', 'type', 'path', 'content_preview'], 'entry');
  if (typeof entry.type !== 'string' || entry.type.length === 0) {
    throw artifactError('request', 'entry.type must be a non-empty string');
  }
  validateRepositoryPath(entry.path, 'entry.path');
  if (typeof entry.content_preview !== 'string') {
    throw artifactError('request', 'entry.content_preview must be a string');
  }
  if (!SHA256_RE.test(entry.signature)) throw artifactError('request', 'entry.signature is malformed');
  const expected = gardenSignature({
    type: entry.type,
    path: entry.path,
    contentPreview: entry.content_preview,
  });
  if (entry.signature !== expected) throw artifactError('request', 'entry.signature does not match content');
  return entry;
}

function validateIgnoreDocument(value) {
  exactKeys(value, ['schema_version', 'ignored'], 'garden ignore document');
  if (value.schema_version !== 1 || !Array.isArray(value.ignored)) {
    throw artifactError('state', 'garden ignore document has wrong schema version');
  }
  const signatures = new Set();
  for (const record of value.ignored) {
    exactKeys(record, ['signature', 'type', 'path', 'content_preview', 'ignored_at'], 'garden ignore record');
    validateIgnoreEntry({
      signature: record.signature,
      type: record.type,
      path: record.path,
      content_preview: record.content_preview,
    });
    if (!RFC3339_RE.test(record.ignored_at) || !Number.isFinite(Date.parse(record.ignored_at))) {
      throw artifactError('state', 'garden ignore record has invalid ignored_at');
    }
    if (Array.from(record.content_preview).length > 200) {
      throw artifactError('state', 'garden ignore preview exceeds 200 code points');
    }
    if (signatures.has(record.signature)) throw artifactError('state', 'garden ignore signatures must be unique');
    signatures.add(record.signature);
  }
  return value;
}

async function guardedRead(canonicalRoot, target, expectedParent, deps, { allowMissing = false } = {}) {
  const guard = await guardRegularTarget(canonicalRoot, target, {
    expectedPhysicalParent: expectedParent,
    allowMissing,
    code: 'state',
  });
  if (!guard.exists) return null;
  await revalidatePhysicalParent(canonicalRoot, expectedParent, expectedParent);
  await guardRegularTarget(canonicalRoot, target, {
    expectedPhysicalParent: expectedParent,
    allowMissing: false,
    code: 'state',
  });
  return deps.readFile(target);
}

export async function appendGardenIgnore({ root, entry, now = new Date(), deps = {} }) {
  validateIgnoreEntry(entry);
  const ignoredAt = timestamp(now);
  const canonicalRoot = await resolveAndValidateRealTargetRoot(root);
  return withStateMutationLock(canonicalRoot, async ({
    stateDirectory,
    expectedStateDirectory,
    deps: lockDeps,
  }) => {
    const target = join(stateDirectory, 'garden-ignored.json');
    const currentBytes = await guardedRead(
      canonicalRoot,
      target,
      expectedStateDirectory,
      lockDeps,
      { allowMissing: true },
    );
    let current;
    if (currentBytes === null) {
      current = { schema_version: 1, ignored: [] };
    } else {
      try {
        current = JSON.parse(currentBytes.toString('utf8'));
      } catch (error) {
        throw artifactError('state', `garden ignore JSON is invalid: ${error.message}`, error);
      }
      validateIgnoreDocument(current);
      if (current.ignored.some(({ signature }) => signature === entry.signature)) {
        return {
          added: false,
          total: current.ignored.length,
          revision: artifactRevision(currentBytes),
        };
      }
    }
    current.ignored.push({
      signature: entry.signature,
      type: entry.type,
      path: entry.path,
      content_preview: Array.from(entry.content_preview).slice(0, 200).join(''),
      ignored_at: ignoredAt,
    });
    const bytes = serializeStateJson(current);
    await atomicStateReplace({
      canonicalRoot,
      target,
      bytes,
      expectedStateDirectory,
      expectedTargetBytes: currentBytes,
      deps: lockDeps,
    });
    return { added: true, total: current.ignored.length, revision: artifactRevision(bytes) };
  }, deps);
}

export async function invalidateScanArtifact({ root, expectedRevision, deps = {} }) {
  if (!SHA256_RE.test(expectedRevision)) throw artifactError('request', 'expected revision is malformed');
  const canonicalRoot = await resolveAndValidateRealTargetRoot(root);
  try {
    return await withStateMutationLock(canonicalRoot, async ({
      stateDirectory,
      expectedStateDirectory,
      deps: lockDeps,
    }) => {
      const target = join(stateDirectory, 'last-scan.json');
      const currentBytes = await guardedRead(
        canonicalRoot,
        target,
        expectedStateDirectory,
        lockDeps,
        { allowMissing: true },
      );
      if (currentBytes === null) return { invalidated: false, reason: 'absent', revision: null };
      const currentRevision = artifactRevision(currentBytes);
      if (currentRevision !== expectedRevision) {
        return { invalidated: false, reason: 'changed', revision: currentRevision };
      }
      const tombstone = `${target}.${process.pid}.${lockDeps.randomUUID()}.tombstone`;
      if (typeof lockDeps.beforeRename === 'function') {
        await lockDeps.beforeRename({ target, tombstone });
      }
      await renameWithRetry(target, tombstone, {
        ...lockDeps,
        revalidate: async () => {
          const bytes = await guardedRead(
            canonicalRoot,
            target,
            expectedStateDirectory,
            lockDeps,
          );
          if (artifactRevision(bytes) !== expectedRevision) {
            throw artifactError('state', 'scan artifact changed before invalidation');
          }
        },
      });
      const tombstoneGuard = await guardRegularTarget(canonicalRoot, tombstone, {
        expectedPhysicalParent: expectedStateDirectory,
        allowMissing: false,
        code: 'state',
      });
      await lockDeps.unlink(tombstoneGuard.target);
      return { invalidated: true, reason: 'matched', revision: expectedRevision };
    }, { ...deps, createState: false });
  } catch (error) {
    if (error?.code === 'state' && error?.cause?.code === 'ENOENT') {
      return { invalidated: false, reason: 'absent', revision: null };
    }
    throw error;
  }
}
