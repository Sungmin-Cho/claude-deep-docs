import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import path from 'node:path';

import { runGit } from './git.js';
import {
  guardRegularTarget,
  revalidatePhysicalParent,
  renameWithRetry,
  resolveAndValidateRealTargetRoot,
  RuntimeError,
  safeCleanupOwnedFile,
  stateDependencies,
} from './state.js';

export const AUTHORING_TARGETS = Object.freeze({
  'claude-md': 'CLAUDE.md',
  'agents-md': 'AGENTS.md',
  'architecture-md': 'ARCHITECTURE.md',
});

const BASELINE_KEYS = [
  'content_digest', 'contract_version', 'doc_kind', 'exists', 'mode', 'target_path',
];
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;

function authoringError(message, cause) {
  return new RuntimeError('authoring', message, cause ? { cause } : undefined);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function validateAuthoringTarget(docKind, targetPath) {
  if (AUTHORING_TARGETS[docKind] !== targetPath
      || typeof targetPath !== 'string'
      || targetPath.includes('\\')
      || targetPath.includes('/')
      || /^[A-Za-z]:/.test(targetPath)) {
    throw authoringError('target_path must be the root-only path for doc_kind');
  }
  return targetPath;
}

export async function contentDigest(readable) {
  const hash = createHash('sha256');
  for await (const chunk of readable) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
}

export function gardenSignature({ type, path: targetPath, contentPreview }) {
  const canonical = JSON.stringify({
    type,
    path: targetPath,
    content_preview: Array.from(contentPreview).slice(0, 200).join(''),
  });
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

async function currentBaselineState(canonicalRoot, baseline, expectedParent) {
  const target = path.join(canonicalRoot, baseline.target_path);
  const guarded = await guardRegularTarget(canonicalRoot, target, {
    expectedPhysicalParent: expectedParent,
    allowMissing: baseline.mode === 'create',
    code: 'authoring',
  });
  if (baseline.mode === 'create') {
    if (guarded.exists) throw authoringError('baseline changed: create target already exists');
    return;
  }
  if (!guarded.exists) throw authoringError('baseline changed: restructure target is absent');
  const digest = await contentDigest(createReadStream(target));
  if (digest !== baseline.content_digest) throw authoringError('baseline changed: target bytes differ');
}

function validateBaseline(baseline, docKind) {
  if (!isPlainObject(baseline)) throw authoringError('baseline must be a plain object');
  const keys = Object.keys(baseline).sort();
  if (keys.length !== BASELINE_KEYS.length || keys.some((key, index) => key !== BASELINE_KEYS[index])) {
    throw authoringError('baseline keys must exactly match BaselineV1');
  }
  if (baseline.contract_version !== 1) throw authoringError('baseline contract_version must be 1');
  if (baseline.doc_kind !== docKind) throw authoringError('baseline doc_kind does not match request');
  validateAuthoringTarget(baseline.doc_kind, baseline.target_path);
  if (!['create', 'restructure'].includes(baseline.mode)) throw authoringError('baseline mode is invalid');
  if (baseline.mode === 'create') {
    if (baseline.exists !== false || baseline.content_digest !== null) {
      throw authoringError('baseline create mode requires exists:false and null digest');
    }
  } else if (baseline.exists !== true || !SHA256_RE.test(baseline.content_digest)) {
    throw authoringError('baseline restructure mode requires exists:true and a SHA-256 digest');
  }
  return baseline;
}

async function rejectIgnoredDestination(root, targetPath) {
  const probe = runGit(root, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  if (probe.missing || (!probe.ok && probe.status === 128)
      || (probe.ok && probe.stdout.toString('utf8').trim() === 'false')) return;
  if (!probe.ok || probe.stdout.toString('utf8').trim() !== 'true') {
    throw authoringError(`cannot probe Git ignore policy: ${probe.stderr.trim()}`);
  }
  const ignored = runGit(root, ['check-ignore', '-q', '--', targetPath], {
    acceptedStatuses: [0, 1],
    allowFailure: true,
  });
  if (ignored.missing || !ignored.ok || ![0, 1].includes(ignored.status)) {
    throw authoringError(`cannot evaluate Git ignore policy: ${ignored.stderr.trim()}`);
  }
  if (ignored.status === 0) throw authoringError('authoring target is ignored by Git');
}

export async function captureBaseline({ root, targetPath, mode, docKind }) {
  validateAuthoringTarget(docKind, targetPath);
  if (!['create', 'restructure'].includes(mode)) throw authoringError('authoring mode is invalid');
  const canonicalRoot = await resolveAndValidateRealTargetRoot(root);
  const expectedParent = await revalidatePhysicalParent(canonicalRoot, canonicalRoot);
  const target = path.join(canonicalRoot, targetPath);
  let metadata;
  try {
    metadata = await lstat(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw authoringError(`cannot inspect authoring target: ${error.message}`, error);
  }
  if (metadata?.isSymbolicLink()) throw authoringError('authoring target must not be a symlink or junction');
  if (mode === 'create') {
    if (metadata) throw authoringError('create target already exists');
    return {
      contract_version: 1,
      doc_kind: docKind,
      mode,
      target_path: targetPath,
      exists: false,
      content_digest: null,
    };
  }
  if (!metadata?.isFile()) throw authoringError('restructure target must be a regular file');
  await revalidatePhysicalParent(canonicalRoot, canonicalRoot, expectedParent);
  await guardRegularTarget(canonicalRoot, target, {
    expectedPhysicalParent: expectedParent,
    allowMissing: false,
    code: 'authoring',
  });
  return {
    contract_version: 1,
    doc_kind: docKind,
    mode,
    target_path: targetPath,
    exists: true,
    content_digest: await contentDigest(createReadStream(target)),
  };
}

export async function commitAuthoring({
  root,
  baseline,
  draftBody,
  preservedBlocks,
  docKind,
  deps: overrides = {},
}) {
  validateBaseline(baseline, docKind);
  if (typeof draftBody !== 'string') throw authoringError('draft_body must be a string');
  if (!Array.isArray(preservedBlocks) || preservedBlocks.some((value) => typeof value !== 'string')) {
    throw authoringError('preserved_blocks must be an array of strings');
  }
  for (const block of preservedBlocks) {
    if (!draftBody.includes(block)) throw authoringError('preserved block missing from draft');
  }
  if (docKind === 'agents-md' && Buffer.byteLength(draftBody, 'utf8') > 32 * 1024) {
    throw authoringError('AGENTS.md exceeds the 32 KiB limit');
  }

  const deps = stateDependencies(overrides);
  const canonicalRoot = await resolveAndValidateRealTargetRoot(root);
  const expectedParent = await revalidatePhysicalParent(canonicalRoot, canonicalRoot);
  const target = path.join(canonicalRoot, baseline.target_path);
  await currentBaselineState(canonicalRoot, baseline, expectedParent);
  await rejectIgnoredDestination(canonicalRoot, baseline.target_path);
  if (typeof deps.beforeTempOpen === 'function') await deps.beforeTempOpen({ target });
  await currentBaselineState(canonicalRoot, baseline, expectedParent);

  const temporary = `${target}.${process.pid}.${deps.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await deps.open(temporary, 'wx');
    await handle.writeFile(Buffer.from(draftBody, 'utf8'));
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (typeof deps.beforeRename === 'function') await deps.beforeRename({ temporary, target });
    await renameWithRetry(temporary, target, {
      ...deps,
      revalidate: async () => {
        await revalidatePhysicalParent(canonicalRoot, canonicalRoot, expectedParent);
        await currentBaselineState(canonicalRoot, baseline, expectedParent);
      },
    });
  } catch (error) {
    try { await handle?.close(); } catch {}
    await safeCleanupOwnedFile(canonicalRoot, temporary, expectedParent, deps);
    throw error;
  }
  return { ok: true };
}
