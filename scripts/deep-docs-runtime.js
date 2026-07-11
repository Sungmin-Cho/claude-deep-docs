#!/usr/bin/env node
import { unlink } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  appendGardenIgnore,
  artifactRevision,
  emitScanArtifact,
  evaluateReuse,
  invalidateScanArtifact,
} from './runtime/artifact.js';
import {
  captureBaseline,
  commitAuthoring,
  gardenSignature,
} from './runtime/authoring.js';
import { runGit } from './runtime/git.js';
import { buildScanContext } from './runtime/scan.js';
import {
  ensureRealStateDirectory,
  guardRegularTarget,
  readStateRequest,
  resolveAndValidateRealTargetRoot,
  RuntimeError,
  validateRealStateDirectory,
} from './runtime/state.js';

const modulePath = fileURLToPath(import.meta.url);
export const PLUGIN_ROOT = resolve(dirname(modulePath), '..');
const REQUEST_COMMANDS = new Set([
  'rename-history',
  'reuse',
  'emit',
  'authoring-baseline',
  'authoring-commit',
  'signature',
  'garden-ignore',
  'scan-invalidate',
]);

function runtimeError(code, message, cause) {
  return new RuntimeError(code, message, cause ? { cause } : undefined);
}

function argvError(message) {
  return runtimeError('argv', message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requestObject(value, required, optional = [], label = 'request') {
  if (!isPlainObject(value)) throw runtimeError('request', `${label} must be a plain object`);
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.has(key)) || required.some((key) => !keys.includes(key))) {
    throw runtimeError('request', `${label} has unknown or missing keys`);
  }
  return value;
}

function validateRequestBasename(value) {
  if (typeof value !== 'string'
      || value.length === 0
      || !value.endsWith('.json')
      || value.includes('/')
      || value.includes('\\')
      || value.includes('\0')
      || /^[A-Za-z]:/.test(value)
      || value === '.json') {
    throw argvError('--request must be a direct state JSON basename');
  }
  return value;
}

function validateRepositoryPath(value, label) {
  if (typeof value !== 'string'
      || value.length === 0
      || value.includes('\\')
      || value.includes('\0')
      || value === '.'
      || value.endsWith('/')
      || /^[A-Za-z]:/.test(value)
      || posix.isAbsolute(value)
      || value.split('/').includes('..')
      || posix.normalize(value) !== value) {
    throw runtimeError('request', `${label} must be a normalized repository-relative path`);
  }
  return value;
}

function optionalTrue(value, key) {
  if (key in value && value[key] !== true) {
    throw runtimeError('request', `${key} must be literal true when present`);
  }
  return value[key] === true;
}

function parseArgv(argv) {
  const [command, ...args] = argv;
  if (command !== 'scan-context' && !REQUEST_COMMANDS.has(command)) {
    throw argvError(`unknown command: ${command ?? '<empty>'}`);
  }
  let root;
  let request;
  let pathCheckEnabled = false;
  let sawPathCheck = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--root') {
      if (root !== undefined) throw argvError('repeated --root');
      const value = args[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith('--')) {
        throw argvError('missing --root value');
      }
      root = value;
      index += 1;
    } else if (token === '--request') {
      if (request !== undefined) throw argvError('repeated --request');
      const value = args[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith('--')) {
        throw argvError('missing --request value');
      }
      request = validateRequestBasename(value);
      index += 1;
    } else if (token === '--path-check-enabled') {
      if (sawPathCheck) throw argvError('repeated --path-check-enabled');
      sawPathCheck = true;
      pathCheckEnabled = true;
    } else if (token.startsWith('--')) {
      throw argvError(`unknown option: ${token}`);
    } else {
      throw argvError(`unexpected positional: ${token}`);
    }
  }
  if (root === undefined) throw argvError('missing --root');
  if (command === 'scan-context') {
    if (request !== undefined) throw argvError('scan-context does not accept --request');
  } else {
    if (request === undefined) throw argvError(`${command} requires --request`);
    if (sawPathCheck) throw argvError(`${command} does not accept --path-check-enabled`);
  }
  return { command, root, request, pathCheckEnabled };
}

async function readRequest(root, basename) {
  const stateDirectory = await validateRealStateDirectory(root);
  const bytes = await readStateRequest(root, join(stateDirectory, basename));
  try {
    return { value: JSON.parse(bytes.toString('utf8')), bytes, stateDirectory };
  } catch (error) {
    throw runtimeError('request', `invalid request JSON: ${error.message}`, error);
  }
}

async function renameHistory(root, oldPath) {
  validateRepositoryPath(oldPath, 'old_path');
  const probe = runGit(root, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  if (probe.missing || (!probe.ok && probe.status === 128)
      || (probe.ok && probe.stdout.toString('utf8').trim() === 'false')) {
    return { history: [] };
  }
  if (!probe.ok || probe.stdout.toString('utf8').trim() !== 'true') {
    throw runtimeError('git', `cannot probe rename history: ${probe.stderr.trim()}`);
  }
  const head = runGit(root, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
  if (head.missing) throw runtimeError('git', 'Git disappeared while reading rename history');
  if (!head.ok && [1, 128].includes(head.status)) return { history: [] };
  if (!head.ok) throw runtimeError('git', `cannot inspect rename history HEAD: ${head.stderr.trim()}`);
  const history = runGit(root, [
    'log', '--all', '--follow', '--diff-filter=R', '--name-status', '--', oldPath,
  ], { allowFailure: true });
  if (!history.ok) {
    throw runtimeError('git', history.missing
      ? 'Git disappeared while reading rename history'
      : `cannot read rename history: ${history.stderr.trim()}`);
  }
  const scopedOutput = history.stdout.toString('utf8').split(/\r?\n/).filter((line) => line.length > 0);
  const scopedLines = scopedOutput.filter((line) => /^R\d{1,3}\t/.test(line));
  if (scopedLines.length > 0) return { history: scopedLines };

  // A deleted pre-rename path is not always selected by Git's path-limited
  // history walk. Ask Git for its rename records (still argv-only), then
  // filter exact from-path records instead of guessing a successor.
  const allRenames = runGit(root, [
    'log', '--all', '--diff-filter=R', '--name-status', '-z', '--format=',
  ], { allowFailure: true });
  if (!allRenames.ok) {
    throw runtimeError('git', allRenames.missing
      ? 'Git disappeared while reading rename records'
      : `cannot read rename records: ${allRenames.stderr.trim()}`);
  }
  if (allRenames.stdout.length === 0) return { history: [] };
  if (allRenames.stdout.at(-1) !== 0) throw runtimeError('git', 'rename records were not NUL terminated');
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(allRenames.stdout.subarray(0, -1));
  } catch (error) {
    throw runtimeError('git', 'rename records were not valid UTF-8', error);
  }
  const fields = decoded.split('\0');
  if (fields.length % 3 !== 0) throw runtimeError('git', 'rename records were malformed');
  const records = [];
  for (let index = 0; index < fields.length; index += 3) {
    const [status, from, to] = fields.slice(index, index + 3);
    if (!/^R\d{1,3}$/.test(status) || !from || !to) {
      throw runtimeError('git', 'rename records were malformed');
    }
    records.push({ status, from, to });
  }
  const reachable = new Set([oldPath]);
  const selected = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (reachable.has(record.from) && !reachable.has(record.to)) {
        reachable.add(record.to);
        selected.push(`${record.status}\t${record.from}\t${record.to}`);
        changed = true;
      }
    }
  }
  return { history: selected };
}

async function dispatch(parsed) {
  const root = await resolveAndValidateRealTargetRoot(parsed.root);
  if (parsed.command === 'scan-context') {
    await ensureRealStateDirectory(root);
    return buildScanContext(root, { pathCheckEnabled: parsed.pathCheckEnabled });
  }

  const request = await readRequest(root, parsed.request);
  switch (parsed.command) {
    case 'rename-history': {
      requestObject(request.value, ['old_path']);
      return renameHistory(root, request.value.old_path);
    }
    case 'reuse': {
      requestObject(request.value, ['artifact_path'], ['path_check_enabled']);
      if (request.value.artifact_path !== '.deep-docs/last-scan.json') {
        throw runtimeError('request', 'artifact_path must be .deep-docs/last-scan.json');
      }
      const pathCheckEnabled = optionalTrue(request.value, 'path_check_enabled');
      const artifactBytes = await readStateRequest(root, request.value.artifact_path);
      let artifact;
      try {
        artifact = JSON.parse(artifactBytes.toString('utf8'));
      } catch (error) {
        throw runtimeError('artifact', `invalid artifact JSON: ${error.message}`, error);
      }
      const result = await evaluateReuse({
        artifact,
        artifactBytes,
        root,
        pluginRoot: PLUGIN_ROOT,
        pathCheckEnabled,
      });
      return result.reusable ? { ...result, artifact } : result;
    }
    case 'emit': {
      requestObject(request.value, ['payload'], ['path_check_enabled', 'cleanup_request']);
      if (parsed.request !== 'scan-payload-request.json') {
        throw runtimeError('request', 'emit request must be scan-payload-request.json');
      }
      const pathCheckEnabled = optionalTrue(request.value, 'path_check_enabled');
      const cleanupRequest = optionalTrue(request.value, 'cleanup_request');
      const artifact = await emitScanArtifact({
        root,
        payload: request.value.payload,
        pluginRoot: PLUGIN_ROOT,
        pathCheckEnabled,
      });
      if (cleanupRequest) {
        const currentRequestBytes = await readStateRequest(
          root,
          join(request.stateDirectory, parsed.request),
        );
        if (!currentRequestBytes.equals(request.bytes)) {
          throw runtimeError('request', 'emit request changed before cleanup');
        }
        const requestTarget = join(request.stateDirectory, parsed.request);
        const guarded = await guardRegularTarget(root, requestTarget, {
          expectedPhysicalParent: request.stateDirectory,
          allowMissing: false,
          code: 'request',
        });
        await unlink(guarded.target);
      }
      return { artifact, artifact_revision: artifactRevision(artifact) };
    }
    case 'authoring-baseline': {
      requestObject(request.value, ['target_path', 'mode', 'doc_kind']);
      return captureBaseline({
        root,
        targetPath: request.value.target_path,
        mode: request.value.mode,
        docKind: request.value.doc_kind,
      });
    }
    case 'authoring-commit': {
      requestObject(request.value, ['baseline', 'draft_body', 'preserved_blocks', 'doc_kind']);
      return commitAuthoring({
        root,
        baseline: request.value.baseline,
        draftBody: request.value.draft_body,
        preservedBlocks: request.value.preserved_blocks,
        docKind: request.value.doc_kind,
      });
    }
    case 'signature': {
      requestObject(request.value, ['type', 'path', 'content_preview']);
      if (typeof request.value.type !== 'string' || request.value.type.length === 0
          || typeof request.value.content_preview !== 'string') {
        throw runtimeError('request', 'signature fields must be non-empty strings');
      }
      validateRepositoryPath(request.value.path, 'path');
      return {
        signature: gardenSignature({
          type: request.value.type,
          path: request.value.path,
          contentPreview: request.value.content_preview,
        }),
      };
    }
    case 'garden-ignore': {
      requestObject(request.value, ['entry']);
      return appendGardenIgnore({ root, entry: request.value.entry });
    }
    case 'scan-invalidate': {
      requestObject(request.value, ['expected_revision']);
      return invalidateScanArtifact({ root, expectedRevision: request.value.expected_revision });
    }
    default:
      throw argvError(`unknown command: ${parsed.command}`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const result = await dispatch(parseArgv(argv));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    const code = typeof error?.code === 'string' ? error.code : 'operation';
    const message = String(error?.message ?? error).replace(/[\r\n]+/g, ' ').trim();
    process.stderr.write(`deep-docs-runtime: ${code}: ${message || 'operation failed'}\n`);
    process.exitCode = 1;
  });
}
