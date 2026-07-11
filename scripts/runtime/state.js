import {
  lstat,
  mkdir,
  readFile,
  realpath,
} from 'node:fs/promises';
import path from 'node:path';

export class RuntimeError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'RuntimeError';
    this.code = code;
  }
}

function comparable(value, pathApi = path) {
  const normalized = pathApi.normalize(value);
  return pathApi === path.win32 || process.platform === 'win32'
    ? normalized.toLowerCase()
    : normalized;
}

function containedBy(root, candidate, pathApi = path) {
  const relative = pathApi.relative(comparable(root, pathApi), comparable(candidate, pathApi));
  return relative === '' || (!relative.startsWith(`..${pathApi.sep}`)
    && relative !== '..'
    && !pathApi.isAbsolute(relative));
}

function stateError(code, message, cause) {
  return new RuntimeError(code, message, cause ? { cause } : undefined);
}

export function contextRootFromRealPath(realRoot, pathApi = path) {
  if (typeof realRoot !== 'string' || !pathApi.isAbsolute(realRoot)) {
    throw stateError('root', 'canonical root must be an absolute physical path');
  }
  return realRoot;
}

export async function resolveAndValidateRealTargetRoot(root) {
  if (typeof root !== 'string' || root.length === 0) {
    throw stateError('root', 'target root must be a non-empty path');
  }

  const requested = path.resolve(root);
  let requestedStat;
  try {
    requestedStat = await lstat(requested);
  } catch (error) {
    throw stateError('root', `cannot inspect target root: ${error.message}`, error);
  }
  if (requestedStat.isSymbolicLink()) {
    throw stateError('root', 'target root must not be a symlink or junction');
  }
  if (!requestedStat.isDirectory()) {
    throw stateError('root', 'target root must be a directory');
  }

  let physical;
  try {
    physical = await realpath(requested);
  } catch (error) {
    throw stateError('root', `cannot resolve target root: ${error.message}`, error);
  }
  const physicalStat = await lstat(physical);
  if (physicalStat.isSymbolicLink() || !physicalStat.isDirectory()) {
    throw stateError('root', 'physical target root must be a non-symlink directory');
  }
  return contextRootFromRealPath(physical);
}

/**
 * Resolve and validate an existing directory below root. Every logical path
 * component is checked with lstat so a junction cannot redirect a later I/O.
 */
export async function revalidatePhysicalParent(root, requestedParent, expectedPhysicalParent) {
  const canonicalRoot = await resolveAndValidateRealTargetRoot(root);
  const candidate = path.isAbsolute(requestedParent)
    ? path.resolve(requestedParent)
    : path.resolve(canonicalRoot, requestedParent);
  if (!containedBy(canonicalRoot, candidate)) {
    throw stateError('state', 'requested parent escapes target root');
  }

  const relative = path.relative(canonicalRoot, candidate);
  let cursor = canonicalRoot;
  if (relative !== '') {
    for (const component of relative.split(path.sep)) {
      cursor = path.join(cursor, component);
      let metadata;
      try {
        metadata = await lstat(cursor);
      } catch (error) {
        throw stateError('state', `cannot inspect state parent ${component}: ${error.message}`, error);
      }
      if (metadata.isSymbolicLink()) {
        throw stateError('state', `state parent must not contain a symlink or junction: ${component}`);
      }
      if (!metadata.isDirectory()) {
        throw stateError('state', `state parent component is not a directory: ${component}`);
      }
    }
  }

  const physical = await realpath(cursor);
  if (!containedBy(canonicalRoot, physical)) {
    throw stateError('state', 'physical state parent escapes target root');
  }
  if (expectedPhysicalParent !== undefined
      && comparable(physical) !== comparable(expectedPhysicalParent)) {
    throw stateError('state', 'physical state parent changed during operation');
  }
  return physical;
}

export async function ensureRealStateDirectory(root) {
  const canonicalRoot = await resolveAndValidateRealTargetRoot(root);
  const expectedRoot = await revalidatePhysicalParent(canonicalRoot, canonicalRoot);
  const stateDirectory = path.join(canonicalRoot, '.deep-docs');

  try {
    await mkdir(stateDirectory);
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw stateError('state', `cannot create .deep-docs: ${error.message}`, error);
    }
  }
  await revalidatePhysicalParent(canonicalRoot, expectedRoot, expectedRoot);

  let metadata;
  try {
    metadata = await lstat(stateDirectory);
  } catch (error) {
    throw stateError('state', `cannot inspect .deep-docs: ${error.message}`, error);
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw stateError('state', '.deep-docs must be a non-symlink directory');
  }
  const physical = await revalidatePhysicalParent(canonicalRoot, stateDirectory);
  if (comparable(physical) !== comparable(stateDirectory)) {
    throw stateError('state', '.deep-docs physical directory changed');
  }
  return physical;
}

/**
 * Read a regular, non-symlink JSON request below a previously validated root.
 * The parent is checked both before and immediately before the read.
 */
export async function readStateRequest(root, requestPath) {
  const canonicalRoot = await resolveAndValidateRealTargetRoot(root);
  const target = path.isAbsolute(requestPath)
    ? path.resolve(requestPath)
    : path.resolve(canonicalRoot, requestPath);
  if (!containedBy(canonicalRoot, target)) {
    throw stateError('request', 'request path escapes target root');
  }
  const parent = path.dirname(target);
  const expectedParent = await revalidatePhysicalParent(canonicalRoot, parent);
  await revalidatePhysicalParent(canonicalRoot, parent, expectedParent);

  let metadata;
  try {
    metadata = await lstat(target);
  } catch (error) {
    throw stateError('request', `cannot inspect request: ${error.message}`, error);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw stateError('request', 'request must be a regular non-symlink file');
  }
  await revalidatePhysicalParent(canonicalRoot, parent, expectedParent);
  try {
    return await readFile(target);
  } catch (error) {
    throw stateError('request', `cannot read request: ${error.message}`, error);
  }
}

