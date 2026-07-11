import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename as fsRename,
  rmdir,
  unlink,
} from 'node:fs/promises';
import { randomUUID as cryptoRandomUUID } from 'node:crypto';
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

export async function validateRealStateDirectory(root) {
  const canonicalRoot = await resolveAndValidateRealTargetRoot(root);
  const stateDirectory = path.join(canonicalRoot, '.deep-docs');
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

export async function guardRegularTarget(
  root,
  target,
  {
    expectedPhysicalParent,
    allowMissing = true,
    code = 'state',
  } = {},
) {
  const canonicalRoot = await resolveAndValidateRealTargetRoot(root);
  const absoluteTarget = path.isAbsolute(target) ? path.resolve(target) : path.resolve(canonicalRoot, target);
  const parent = path.dirname(absoluteTarget);
  const physicalParent = await revalidatePhysicalParent(
    canonicalRoot,
    parent,
    expectedPhysicalParent,
  );
  let metadata;
  try {
    metadata = await lstat(absoluteTarget);
  } catch (error) {
    if (error.code === 'ENOENT' && allowMissing) {
      return { exists: false, target: absoluteTarget, physicalParent };
    }
    throw stateError(code, `cannot inspect target: ${error.message}`, error);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw stateError(code, 'target must be a regular non-symlink file');
  }
  return { exists: true, target: absoluteTarget, physicalParent, metadata };
}

function sleepFor(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

export function stateDependencies(overrides = {}) {
  return {
    mkdir,
    open,
    readFile,
    rename: fsRename,
    rmdir,
    unlink,
    lstat,
    randomUUID: cryptoRandomUUID,
    sleep: sleepFor,
    lockRetryDelays: [0, 25, 50, 100, 200],
    renameRetryDelays: [0, 10, 25, 50],
    ...overrides,
  };
}

export async function renameWithRetry(source, destination, overrides = {}) {
  // Node 22 has no portable dirfd/openat/renameat no-follow API. Each retry
  // therefore revalidates immediately before the path-based syscall; a
  // same-user swap in the remaining validation-to-syscall micro-window is the
  // documented residual and is not claimed to be closed by these guards.
  const deps = stateDependencies(overrides);
  const delays = deps.renameRetryDelays;
  let lastError;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (attempt > 0 && delays[attempt] > 0) await deps.sleep(delays[attempt]);
    if (typeof deps.revalidate === 'function') await deps.revalidate(attempt);
    try {
      await deps.rename(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === delays.length - 1) {
        throw stateError('rename', `atomic rename failed: ${error.message}`, error);
      }
    }
  }
  throw stateError('rename', `atomic rename failed: ${lastError?.message ?? 'unknown error'}`, lastError);
}

export async function safeCleanupOwnedFile(root, target, expectedPhysicalParent, overrides = {}) {
  const deps = stateDependencies(overrides);
  let guard;
  try {
    guard = await guardRegularTarget(root, target, {
      expectedPhysicalParent,
      allowMissing: true,
      code: 'cleanup',
    });
  } catch {
    return false;
  }
  if (!guard.exists) return true;
  try {
    await deps.unlink(guard.target);
    return true;
  } catch {
    return false;
  }
}

export async function withStateMutationLock(root, operation, overrides = {}) {
  const deps = stateDependencies(overrides);
  const canonicalRoot = await resolveAndValidateRealTargetRoot(root);
  const stateDirectory = overrides.createState === false
    ? await validateRealStateDirectory(canonicalRoot)
    : await ensureRealStateDirectory(canonicalRoot);
  const expectedStateDirectory = await revalidatePhysicalParent(
    canonicalRoot,
    stateDirectory,
    stateDirectory,
  );
  const lockDirectory = path.join(stateDirectory, '.mutation-lock');
  const ownerPath = path.join(lockDirectory, 'owner');
  const owner = deps.randomUUID();
  const delays = deps.lockRetryDelays;
  let acquired = false;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (attempt > 0 && delays[attempt] > 0) await deps.sleep(delays[attempt]);
    await revalidatePhysicalParent(canonicalRoot, stateDirectory, expectedStateDirectory);
    try {
      await deps.mkdir(lockDirectory);
      acquired = true;
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw stateError('state-lock', `cannot acquire mutation lock: ${error.message}`, error);
      }
    }
  }
  if (!acquired) throw stateError('state-busy', 'state mutation lock is busy');

  let ownerHandle;
  let expectedLockDirectory;
  let ownerCreated = false;
  try {
    const physicalLock = await revalidatePhysicalParent(canonicalRoot, lockDirectory);
    if (comparable(physicalLock) !== comparable(lockDirectory)) {
      throw stateError('state-lock', 'mutation lock physical directory changed');
    }
    expectedLockDirectory = physicalLock;
    await guardRegularTarget(canonicalRoot, ownerPath, {
      expectedPhysicalParent: physicalLock,
      allowMissing: true,
      code: 'state-lock',
    });
    ownerHandle = await deps.open(ownerPath, 'wx');
    ownerCreated = true;
    await ownerHandle.writeFile(`${owner}\n`, 'utf8');
    await ownerHandle.sync();
    await ownerHandle.close();
    ownerHandle = undefined;
  } catch (error) {
    try { await ownerHandle?.close(); } catch {}
    if (expectedLockDirectory && ownerCreated) {
      await safeCleanupOwnedFile(canonicalRoot, ownerPath, expectedLockDirectory, deps);
    }
    if (expectedLockDirectory) {
      try {
        await revalidatePhysicalParent(canonicalRoot, lockDirectory, expectedLockDirectory);
        await deps.rmdir(lockDirectory);
      } catch {}
    }
    throw stateError('state-lock', `cannot initialize mutation lock: ${error.message}`, error);
  }

  let operationError;
  try {
    return await operation({
      canonicalRoot,
      stateDirectory,
      expectedStateDirectory,
      deps,
    });
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await revalidatePhysicalParent(canonicalRoot, stateDirectory, expectedStateDirectory);
      const lockMetadata = await deps.lstat(lockDirectory);
      if (lockMetadata.isSymbolicLink() || !lockMetadata.isDirectory()) {
        throw stateError('state-lock', 'mutation lock identity changed');
      }
      const physicalLock = await revalidatePhysicalParent(canonicalRoot, lockDirectory);
      const ownerMetadata = await deps.lstat(ownerPath);
      if (ownerMetadata.isSymbolicLink() || !ownerMetadata.isFile()) {
        throw stateError('state-lock', 'mutation lock owner identity changed');
      }
      await guardRegularTarget(canonicalRoot, ownerPath, {
        expectedPhysicalParent: physicalLock,
        allowMissing: false,
        code: 'state-lock',
      });
      const observed = await deps.readFile(ownerPath, 'utf8');
      if (observed !== `${owner}\n`) throw stateError('state-lock', 'mutation lock owner changed');
      await deps.unlink(ownerPath);
      await deps.rmdir(lockDirectory);
    } catch (releaseError) {
      if (!operationError) throw releaseError;
    }
  }
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
    metadata = await lstat(target);
  } catch (error) {
    throw stateError('request', `cannot re-inspect request: ${error.message}`, error);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw stateError('request', 'request must remain a regular non-symlink file');
  }
  try {
    return await readFile(target);
  } catch (error) {
    throw stateError('request', `cannot read request: ${error.message}`, error);
  }
}
