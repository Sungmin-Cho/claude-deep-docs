import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  readFile,
  readdir,
  readlink,
  stat,
} from 'node:fs/promises';
import path from 'node:path';

import { runGit, SOURCE_PROJECTION_PATHS } from './git.js';
import {
  contextRootFromRealPath,
  resolveAndValidateRealTargetRoot,
  RuntimeError,
} from './state.js';

export const SCAN_CONTEXT_VERSION = 1;
export const EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', 'vendor', 'dist', 'build', '__pycache__',
]);
export const PATH_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs',
  '.java', '.kt', '.scala', '.clj', '.c', '.h', '.cpp', '.hpp', '.cs', '.swift',
  '.dart', '.md', '.rst', '.txt', '.json', '.yml', '.yaml', '.toml', '.xml',
  '.ini', '.conf', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.css', '.scss',
  '.less', '.html', '.htm', '.vue', '.svelte', '.astro', '.sql', '.graphql', '.proto',
]);

const NPM_BUILTINS = new Set([
  'install', 'i', 'ci', 'uninstall', 'un', 'remove', 'rm', 'rb', 'add', 'a',
  'update', 'up', 'outdated', 'dedupe', 'prune', 'link', 'ln', 'unlink', 'test',
  't', 'start', 'stop', 'restart', 'exec', 'x', 'pack', 'publish', 'unpublish',
  'version', 'login', 'logout', 'whoami', 'adduser', 'token', 'search', 's', 'se',
  'view', 'info', 'show', 'ls', 'list', 'll', 'la', 'fund', 'explain', 'why',
  'diff', 'dist-tag', 'ping', 'bugs', 'docs', 'home', 'edit', 'owner', 'repo',
  'root', 'prefix', 'bin', 'completion', 'help-search', 'help', 'init', 'create',
  'cache', 'config', 'c', 'get', 'set', 'doctor', 'team', 'org', 'profile', 'hook',
  'access', 'deprecate', 'audit', 'shrinkwrap', 'rebuild',
]);

const union = (base, values) => new Set([...base, ...values]);

export const BUILTINS_MAP = Object.freeze({
  npm: NPM_BUILTINS,
  pnpm: union(NPM_BUILTINS, [
    'dlx', 'store', 'env', 'import', 'fetch', 'patch', 'patch-commit', 'deploy',
    'licenses', 'setup', 'recursive', 'm', 'multi',
  ]),
  yarn: union(NPM_BUILTINS, [
    'workspaces', 'workspace', 'dlx', 'policies', 'upgrade', 'upgrade-interactive',
    'autoclean', 'check', 'generate-lock-entry', 'global',
  ]),
  bun: union(NPM_BUILTINS, ['dlx', 'upgrade', 'pm', 'create', 'build', 'x']),
  uv: new Set([
    'sync', 'add', 'remove', 'lock', 'tool', 'python', 'pip', 'venv', 'tree',
    'export', 'init', 'build', 'publish', 'cache', 'self', 'version', 'help',
  ]),
  poetry: new Set([
    'install', 'add', 'remove', 'update', 'lock', 'shell', 'build', 'publish',
    'init', 'new', 'version', 'env', 'config', 'cache', 'search', 'show', 'check',
    'about', 'self', 'source', 'export', 'sync',
  ]),
  make: new Set(),
  just: new Set(['--list', '--help', '--version', '--init']),
});

export const SYSTEM_COMMAND_WHITELIST = new Set([
  'git', 'hg', 'svn', 'cargo', 'rustc', 'go', 'javac', 'mvn', 'gradle', 'dotnet',
  'pip', 'pipx', 'pipenv', 'conda', 'brew', 'apt', 'apt-get', 'yum', 'dnf',
  'pacman', 'pytest', 'tox', 'nox', 'jest', 'vitest', 'mocha', 'cypress', 'cmake',
  'ninja', 'meson', 'ls', 'find', 'grep', 'rg', 'ag', 'sed', 'awk', 'cat', 'wc',
  'head', 'tail', 'sort', 'uniq', 'cut', 'tr', 'xargs', 'tee', 'cp', 'mv', 'rm',
  'mkdir', 'rmdir', 'touch', 'chmod', 'chown', 'ln', 'readlink', 'realpath',
  'basename', 'dirname', 'curl', 'wget', 'ssh', 'scp', 'rsync', 'nc', 'docker',
  'podman', 'kubectl', 'helm', 'kustomize', 'gh', 'glab', 'terraform', 'tofu',
  'ansible', 'aws', 'gcloud', 'az', 'heroku', 'fly', 'vercel', 'bash', 'sh', 'zsh',
  'fish', 'dash', 'node', 'deno', 'python', 'python3', 'ruby', 'perl', 'php', 'jq',
  'yq', 'tar', 'gzip', 'zip', 'unzip', 'diff', 'patch', 'shasum', 'sha1sum',
  'sha256sum', 'md5sum', 'openssl', 'date', 'watch', 'time', 'env', 'printenv',
]);

export const CLI_BINARIES = new Set([
  ...Object.keys(BUILTINS_MAP),
  ...SYSTEM_COMMAND_WHITELIST,
]);

const byteSort = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

function runtimeError(code, message, cause) {
  return new RuntimeError(code, message, cause ? { cause } : undefined);
}

function portablePath(value) {
  return value.replaceAll('\\', '/');
}

function isSafeRepositoryPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return false;
  const portable = portablePath(value);
  if (path.posix.isAbsolute(portable) || path.win32.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(portable);
  return normalized !== '..'
    && !normalized.startsWith('../')
    && normalized !== '.deep-docs'
    && !normalized.startsWith('.deep-docs/');
}

function parseNulRecords(buffer, label) {
  if (!Buffer.isBuffer(buffer)) throw runtimeError(label, `${label} output was not a Buffer`);
  if (buffer.length === 0) return [];
  if (buffer[buffer.length - 1] !== 0) throw runtimeError(label, `${label} output was not NUL terminated`);
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, -1));
  } catch (error) {
    throw runtimeError(label, `${label} output was not valid UTF-8`, error);
  }
  const records = decoded.split('\0');
  if (records.some((record) => record.length === 0)) {
    throw runtimeError(label, `${label} output contained an empty record`);
  }
  return records.map(portablePath);
}

function assertProjectedRecords(records, code) {
  for (const record of records) {
    if (!isSafeRepositoryPath(record)) {
      throw runtimeError(code, `unsafe projected path: ${JSON.stringify(record)}`);
    }
  }
}

async function identifyRepository(root, runGitImpl = runGit) {
  const probe = runGitImpl(root, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  if (probe.missing) {
    return {
      isGit: false,
      repository_state: 'missing',
      available: false,
      head: '0000000',
      branch: 'HEAD',
    };
  }
  if (!probe.ok) {
    if (probe.status !== 128) {
      throw runtimeError('git', `cannot probe Git repository: ${probe.stderr.trim()}`);
    }
    return {
      isGit: false,
      repository_state: 'non-git',
      available: true,
      head: '0000000',
      branch: 'HEAD',
    };
  }
  const insideWorkTree = probe.stdout.toString('utf8').trim();
  if (insideWorkTree !== 'true') {
    if (insideWorkTree !== 'false') throw runtimeError('git', 'Git returned a malformed repository probe');
    return {
      isGit: false,
      repository_state: 'non-git',
      available: true,
      head: '0000000',
      branch: 'HEAD',
    };
  }

  const headProbe = runGitImpl(root, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
  if (headProbe.missing) throw runtimeError('git', 'Git disappeared after repository probe');
  let repositoryState;
  let head;
  if (headProbe.ok) {
    repositoryState = 'head';
    head = headProbe.stdout.toString('utf8').trim();
    if (!/^[a-f0-9]{40}$/i.test(head)) throw runtimeError('git', 'Git returned a malformed HEAD');
  } else if ([1, 128].includes(headProbe.status)) {
    repositoryState = 'unborn';
    head = '0000000';
  } else {
    throw runtimeError('git', `cannot determine repository HEAD: ${headProbe.stderr.trim()}`);
  }

  const branchProbe = runGitImpl(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    acceptedStatuses: [0, 1],
    allowFailure: true,
  });
  if (branchProbe.missing) throw runtimeError('git', 'Git disappeared while reading branch');
  const branch = branchProbe.ok && branchProbe.status === 0
    ? branchProbe.stdout.toString('utf8').trim() || 'HEAD'
    : 'HEAD';

  return {
    isGit: true,
    repository_state: repositoryState,
    available: true,
    head,
    branch,
  };
}

function updateLengthPrefixed(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  hash.update(Buffer.from(`${bytes.length}:`, 'ascii'));
  hash.update(bytes);
  hash.update(Buffer.from([0]));
}

async function gitBlobHash(root, relativePath) {
  const portable = portablePath(relativePath);
  if (!isSafeRepositoryPath(portable)) throw runtimeError('worktree-hash', 'unsafe source path');
  const native = path.resolve(root, ...portable.split('/'));
  const lexical = path.relative(root, native);
  if (lexical === '..' || lexical.startsWith(`..${path.sep}`) || path.isAbsolute(lexical)) {
    throw runtimeError('worktree-hash', 'source path escapes target root');
  }

  let metadata;
  try {
    metadata = await lstat(native);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return createHash('sha1').update('missing\0', 'utf8').digest('hex');
    }
    throw runtimeError('worktree-hash', `cannot inspect ${portable}: ${error.message}`, error);
  }
  if (metadata.isDirectory()) throw runtimeError('worktree-hash', `projected path is a directory: ${portable}`);

  let size = metadata.size;
  let linkBytes;
  if (metadata.isSymbolicLink()) {
    linkBytes = Buffer.from(await readlink(native), 'utf8');
    size = linkBytes.length;
  } else if (!metadata.isFile()) {
    throw runtimeError('worktree-hash', `projected path is not a regular file: ${portable}`);
  }

  const hash = createHash('sha1');
  hash.update(Buffer.from(`blob ${size}\0`, 'utf8'));
  if (linkBytes) {
    hash.update(linkBytes);
  } else {
    let read = 0;
    for await (const chunk of createReadStream(native, { highWaterMark: 64 * 1024 })) {
      read += chunk.length;
      hash.update(chunk);
    }
    if (read !== size) throw runtimeError('worktree-hash', `source changed while hashing: ${portable}`);
  }
  return hash.digest('hex');
}

async function hashRepositoryProjection(root, gitState, runGitImpl = runGit) {
  const hash = createHash('sha1');
  let projectedPaths;

  if (gitState.repository_state === 'head') {
    const diff = runGitImpl(root, ['diff', '--binary', 'HEAD', '--', ...SOURCE_PROJECTION_PATHS], {
      allowFailure: true,
    });
    if (!diff.ok) {
      if (diff.missing) throw runtimeError('git', 'Git disappeared while hashing tracked sources');
      throw runtimeError('worktree-hash', `cannot hash tracked sources: ${diff.stderr.trim()}`);
    }
    hash.update(Buffer.from(`TRACKED_DIFF:${diff.stdout.length}\n`, 'ascii'));
    hash.update(diff.stdout);

    const untracked = runGitImpl(root, [
      'ls-files', '--others', '--exclude-standard', '-z', '--', ...SOURCE_PROJECTION_PATHS,
    ], { allowFailure: true });
    if (!untracked.ok) {
      if (untracked.missing) throw runtimeError('git', 'Git disappeared while listing untracked sources');
      throw runtimeError('worktree-hash', `cannot list untracked sources: ${untracked.stderr.trim()}`);
    }
    projectedPaths = parseNulRecords(untracked.stdout, 'worktree-hash');
  } else {
    const snapshot = runGitImpl(root, [
      'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--',
      ...SOURCE_PROJECTION_PATHS,
    ], { allowFailure: true });
    if (!snapshot.ok) {
      if (snapshot.missing) throw runtimeError('git', 'Git disappeared while hashing unborn sources');
      throw runtimeError('worktree-hash', `cannot list unborn sources: ${snapshot.stderr.trim()}`);
    }
    projectedPaths = parseNulRecords(snapshot.stdout, 'worktree-hash');
    hash.update('UNBORN_SNAPSHOT\n', 'utf8');
  }

  assertProjectedRecords(projectedPaths, 'worktree-hash');
  for (const relativePath of [...new Set(projectedPaths)].sort(byteSort)) {
    updateLengthPrefixed(hash, relativePath);
    updateLengthPrefixed(hash, await gitBlobHash(root, relativePath));
  }
  return hash.digest('hex');
}

export async function computeWorktreeHash(root, { runGitImpl = runGit } = {}) {
  const canonicalRoot = await resolveAndValidateRealTargetRoot(root);
  const gitState = await identifyRepository(canonicalRoot, runGitImpl);
  if (!gitState.isGit) {
    return {
      isGit: false,
      repository_state: gitState.repository_state,
      hash: 'no-git',
    };
  }
  return {
    isGit: true,
    repository_state: gitState.repository_state,
    hash: await hashRepositoryProjection(canonicalRoot, gitState, runGitImpl),
  };
}

export function translationGroup(relativePath) {
  const portable = portablePath(relativePath);
  return portable.replace(/(?:\.(?:ko|en|ja|zh))?(\.md)$/i, '').replace(/\.md$/i, '');
}

export function splitNonFencedSegments(text) {
  const segments = [];
  let fence = null;
  const lines = String(text).split(/\r?\n/);

  lines.forEach((lineText, index) => {
    const marker = lineText.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
    if (!fence) {
      if (marker) {
        const char = marker[2][0];
        const info = marker[3];
        if (!(char === '`' && info.includes('`'))) {
          fence = {
            char,
            count: marker[2].length,
            indent: marker[1].length,
            info: info.trim(),
          };
          return;
        }
      }
      segments.push({ text: lineText, line: index + 1 });
      return;
    }

    if (marker
        && marker[2][0] === fence.char
        && marker[2].length >= fence.count
        && /^\s*$/.test(marker[3])) {
      fence = null;
    }
  });
  return segments;
}

export function isRelativePathCandidate(
  value,
  extensions = PATH_EXTENSIONS,
  { allowSpaces = false } = {},
) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (allowSpaces ? /[\r\n\t]/.test(value) : /\s/.test(value)) return false;
  if (/^(?:https?:|mailto:|#)/i.test(value)) return false;
  if (value.startsWith('/') || path.win32.isAbsolute(value)) return false;
  if (/[*?\[\]]/.test(value)) return false;
  const portable = portablePath(value);
  const withoutSuffix = portable.split(/[?#]/, 1)[0];
  const extension = path.posix.extname(withoutSuffix).toLowerCase();
  return portable.includes('/') || extensions.has(extension);
}

export function extractReferences(text) {
  const refs = [];
  for (const segment of splitNonFencedSegments(text)) {
    const { text: line, line: lineNumber } = segment;
    if (/^(?: {4}|\t)/.test(line)) continue;

    for (const match of line.matchAll(/`([^`\r\n]+)`/g)) {
      const value = match[1].trim();
      const first = value.split(/\s+/)[0];
      if (CLI_BINARIES.has(first)) {
        refs.push({ kind: 'cli', value, line: lineNumber });
      } else if (/\s/.test(value)) {
        continue;
      } else if (/^\$\{?[A-Z_][A-Z0-9_]*\}?$/.test(value)) {
        refs.push({
          kind: 'env',
          value: value.replace(/^\$\{?/, '').replace(/\}$/, ''),
          line: lineNumber,
        });
      } else if (isRelativePathCandidate(value)) {
        refs.push({ kind: 'path', value: portablePath(value), line: lineNumber });
      } else if (/^(?:[A-Z][A-Za-z0-9_]*|[a-z][A-Za-z0-9_]*\(\))$/.test(value)) {
        refs.push({ kind: 'symbol', value, line: lineNumber });
      }
    }

    const inlineRanges = [...line.matchAll(/`[^`\r\n]+`/g)]
      .map((match) => [match.index, match.index + match[0].length]);
    for (const match of line.matchAll(/(?:^|[^A-Za-z0-9_])(\$\{?[A-Z_][A-Z0-9_]*\}?)/g)) {
      const start = match.index + match[0].length - match[1].length;
      if (inlineRanges.some(([from, to]) => start >= from && start < to)) continue;
      refs.push({
        kind: 'env',
        value: match[1].replace(/^\$\{?/, '').replace(/\}$/, ''),
        line: lineNumber,
      });
    }

    for (const match of line.matchAll(/\[[^\]]+\]\((?!https?:|mailto:|#)([^)]+)\)/gi)) {
      const value = match[1].trim();
      if (isRelativePathCandidate(value, PATH_EXTENSIONS, { allowSpaces: true })) {
        refs.push({ kind: 'path', value: portablePath(value), line: lineNumber });
      }
    }
  }
  return refs;
}

function isDocument(relativePath) {
  const portable = portablePath(relativePath);
  const name = path.posix.basename(portable);
  if (name === 'CLAUDE.md' || name === 'AGENTS.md') return true;
  if (!portable.includes('/')
      && ['README.md', 'CONTRIBUTING.md', 'ARCHITECTURE.md'].includes(name)) return true;
  return portable.startsWith('docs/') && portable.toLowerCase().endsWith('.md');
}

async function discoverDocumentCandidates(root) {
  const candidates = [];
  async function walk(nativeDirectory, relativeDirectory = '') {
    let entries;
    try {
      entries = await readdir(nativeDirectory, { withFileTypes: true });
    } catch (error) {
      throw runtimeError('scan', `cannot read directory ${relativeDirectory || '.'}: ${error.message}`, error);
    }
    entries.sort((a, b) => byteSort(a.name, b.name));
    for (const entry of entries) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name) || relative === '.deep-docs') continue;
        await walk(path.join(nativeDirectory, entry.name), relative);
      } else if (entry.isFile() && isDocument(relative)) {
        candidates.push(relative);
      }
    }
  }
  await walk(root);
  return candidates.sort(byteSort);
}

export async function filterDocumentCandidatesByGitIgnore(
  root,
  candidates,
  gitState,
  { runGitImpl = runGit } = {},
) {
  if (!['head', 'unborn'].includes(gitState)) return [...candidates];
  try {
    const trackedResult = await runGitImpl(root, ['ls-files', '--cached', '-z', '--'], {
      allowFailure: true,
    });
    if (!trackedResult.ok) {
      throw runtimeError('git-ignore', trackedResult.missing
        ? 'Git disappeared while loading tracked documents'
        : `cannot load tracked documents: ${trackedResult.stderr.trim()}`);
    }
    const trackedRecords = parseNulRecords(trackedResult.stdout, 'git-ignore');
    const tracked = new Set(trackedRecords.map(portablePath));
    const untracked = candidates.filter((candidate) => !tracked.has(candidate));
    if (untracked.length === 0) return [...candidates];

    const input = Buffer.concat(untracked.map((candidate) => Buffer.concat([
      Buffer.from(candidate, 'utf8'),
      Buffer.from([0]),
    ])));
    const ignoredResult = await runGitImpl(root, ['check-ignore', '--stdin', '-z'], {
      input,
      acceptedStatuses: [0, 1],
      allowFailure: true,
    });
    if (!ignoredResult.ok || ![0, 1].includes(ignoredResult.status)) {
      throw runtimeError('git-ignore', ignoredResult.missing
        ? 'Git disappeared while filtering ignored documents'
        : `cannot filter ignored documents: ${ignoredResult.stderr.trim()}`);
    }
    const ignoredRecords = parseNulRecords(ignoredResult.stdout, 'git-ignore');
    const permitted = new Set(untracked);
    if (ignoredRecords.some((record) => !permitted.has(record))) {
      throw runtimeError('git-ignore', 'Git returned an unknown ignored document');
    }
    if (ignoredResult.status === 0 && ignoredRecords.length === 0) {
      throw runtimeError('git-ignore', 'Git returned status 0 without an ignored document');
    }
    if (ignoredResult.status === 1 && ignoredRecords.length !== 0) {
      throw runtimeError('git-ignore', 'Git returned ignored documents with status 1');
    }
    const ignored = new Set(ignoredRecords);
    return candidates.filter((candidate) => tracked.has(candidate) || !ignored.has(candidate));
  } catch (error) {
    if (error instanceof RuntimeError && error.code === 'git-ignore') throw error;
    throw runtimeError('git-ignore', `Git ignore filtering failed: ${error.message}`, error);
  }
}

async function projectedPaths(root, gitState) {
  if (!gitState.isGit) return [];
  let tracked;
  if (gitState.repository_state === 'head') {
    tracked = runGit(root, [
      'diff', '--name-only', '-z', 'HEAD', '--', ...SOURCE_PROJECTION_PATHS,
    ], { allowFailure: true });
  } else {
    tracked = runGit(root, [
      'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--',
      ...SOURCE_PROJECTION_PATHS,
    ], { allowFailure: true });
  }
  if (!tracked.ok) {
    if (tracked.missing) throw runtimeError('git', 'Git disappeared while listing dirty sources');
    throw runtimeError('git', `cannot list dirty sources: ${tracked.stderr.trim()}`);
  }
  const records = parseNulRecords(tracked.stdout, 'git');
  assertProjectedRecords(records, 'git');

  if (gitState.repository_state === 'head') {
    const untracked = runGit(root, [
      'ls-files', '--others', '--exclude-standard', '-z', '--', ...SOURCE_PROJECTION_PATHS,
    ], { allowFailure: true });
    if (!untracked.ok) {
      if (untracked.missing) throw runtimeError('git', 'Git disappeared while listing dirty sources');
      throw runtimeError('git', `cannot list dirty sources: ${untracked.stderr.trim()}`);
    }
    const extra = parseNulRecords(untracked.stdout, 'git');
    assertProjectedRecords(extra, 'git');
    records.push(...extra);
  }
  return [...new Set(records)].sort(byteSort);
}

async function lastModifiedEpoch(root, relativePath, dirty, gitState) {
  const native = path.join(root, ...relativePath.split('/'));
  const metadata = await stat(native);
  const filesystemEpoch = Math.floor(metadata.mtimeMs / 1000);
  if (!gitState.isGit || gitState.repository_state !== 'head') return filesystemEpoch;

  const log = runGit(root, ['log', '-1', '--format=%ct', '--', relativePath], {
    acceptedStatuses: [0],
    allowFailure: true,
  });
  if (log.missing) throw runtimeError('git', 'Git disappeared while reading document timestamp');
  if (!log.ok) throw runtimeError('git', `cannot read document timestamp: ${log.stderr.trim()}`);
  const raw = log.stdout.toString('utf8').trim();
  if (raw === '') return filesystemEpoch;
  if (!/^\d+$/.test(raw)) throw runtimeError('git', 'Git returned a malformed document timestamp');
  const gitEpoch = Number(raw);
  return dirty ? Math.max(filesystemEpoch, gitEpoch) : gitEpoch;
}

function normalizeReference(documentPath, reference) {
  if (reference.kind !== 'path') return reference;
  const raw = portablePath(reference.value);
  if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(reference.value)) return null;
  const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(documentPath), raw));
  if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return null;
  return { ...reference, value: normalized };
}

async function packageScripts(root) {
  const packagePath = path.join(root, 'package.json');
  let metadata;
  try {
    metadata = await lstat(packagePath);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw runtimeError('scan', `cannot inspect package.json: ${error.message}`, error);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw runtimeError('scan', 'package.json must be a regular non-symlink file');
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(packagePath, 'utf8'));
  } catch (error) {
    throw runtimeError('scan', `cannot parse package.json: ${error.message}`, error);
  }
  if (!parsed?.scripts || typeof parsed.scripts !== 'object' || Array.isArray(parsed.scripts)) return [];
  return Object.keys(parsed.scripts).sort(byteSort);
}

export async function buildScanContext(root, { pathCheckEnabled = false } = {}) {
  if (typeof pathCheckEnabled !== 'boolean') {
    throw runtimeError('operation', 'pathCheckEnabled must be boolean');
  }
  const canonicalRoot = await resolveAndValidateRealTargetRoot(root);
  const serializedRoot = contextRootFromRealPath(canonicalRoot);
  const gitState = await identifyRepository(canonicalRoot);
  const candidates = await discoverDocumentCandidates(canonicalRoot);
  const filtered = await filterDocumentCandidatesByGitIgnore(
    canonicalRoot,
    candidates,
    gitState.repository_state,
  );
  const dirtyPaths = await projectedPaths(canonicalRoot, gitState);
  const dirty = new Set(dirtyPaths);
  const documents = [];

  for (const relativePath of filtered) {
    const native = path.join(canonicalRoot, ...relativePath.split('/'));
    const metadata = await lstat(native);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw runtimeError('scan', `document changed during scan: ${relativePath}`);
    }
    const body = await readFile(native, 'utf8');
    const references = extractReferences(body)
      .map((reference) => normalizeReference(relativePath, reference))
      .filter(Boolean);
    documents.push({
      path: relativePath,
      translation_group: translationGroup(relativePath),
      last_modified_epoch: await lastModifiedEpoch(
        canonicalRoot,
        relativePath,
        dirty.has(relativePath),
        gitState,
      ),
      references,
      size_lines: body === '' ? 0 : body.split(/\r?\n/).length - (body.endsWith('\n') ? 1 : 0),
    });
  }

  const worktreeHash = gitState.isGit
    ? await hashRepositoryProjection(canonicalRoot, gitState)
    : 'no-git';
  const git = gitState.isGit
    ? {
      available: true,
      repository_state: gitState.repository_state,
      head: gitState.head,
      branch: gitState.branch,
      dirty: dirtyPaths.length > 0,
    }
    : {
      available: gitState.available,
      repository_state: gitState.repository_state,
      head: '0000000',
      branch: 'HEAD',
      dirty: 'unknown',
    };

  return {
    contract_version: SCAN_CONTEXT_VERSION,
    root: serializedRoot,
    is_git: gitState.isGit,
    git,
    worktree_hash: worktreeHash,
    path_check_enabled: pathCheckEnabled,
    documents,
    package_scripts: await packageScripts(canonicalRoot),
    dirty_paths: dirtyPaths,
  };
}
