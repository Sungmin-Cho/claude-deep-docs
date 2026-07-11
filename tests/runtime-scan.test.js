import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, win32 } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { runGit, SOURCE_PROJECTION_PATHS } from '../scripts/runtime/git.js';
import {
  buildScanContext,
  computeWorktreeHash,
  extractReferences,
  filterDocumentCandidatesByGitIgnore,
  splitNonFencedSegments,
  translationGroup,
} from '../scripts/runtime/scan.js';
import {
  contextRootFromRealPath,
  ensureRealStateDirectory,
  readStateRequest,
  revalidatePhysicalParent,
  resolveAndValidateRealTargetRoot,
} from '../scripts/runtime/state.js';

const repoRoot = resolve(import.meta.dirname, '..');
const cli = join(repoRoot, 'scripts', 'deep-docs-runtime.js');
const roots = new Set();

test.after(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(name = 'deep docs path with spaces ') {
  const root = await mkdtemp(join(tmpdir(), name));
  roots.add(root);
  return root;
}

async function project(name = 'deep docs path with spaces ') {
  const root = await temporaryRoot(name);
  await mkdir(join(root, 'docs', 'guide'), { recursive: true });
  await writeFile(join(root, 'README.md'), '# Root\n`src/live.js`\n');
  await writeFile(join(root, 'docs', 'guide', 'README.ko.md'), '# 번역\n');
  await writeFile(join(root, 'docs', 'guide', 'notes.md'), '# Notes\n');
  await writeFile(join(root, 'docs', '한글 문서.md'), '# 유니코드 경로\n');
  await mkdir(join(root, 'node_modules', 'hidden'), { recursive: true });
  await writeFile(join(root, 'node_modules', 'hidden', 'AGENTS.md'), 'ignored\n');
  return root;
}

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function initialize(root, { commit = true } = {}) {
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'tests@example.invalid');
  git(root, 'config', 'user.name', 'Deep Docs Tests');
  if (commit) {
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'fixture');
  }
}

function cliRun(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    ...options,
  });
}

test('scan context discovers supported docs under a non-Git root containing spaces', async () => {
  const root = await project();
  const result = await buildScanContext(root, { pathCheckEnabled: false });
  const expected = [
    'README.md',
    'docs/guide/README.ko.md',
    'docs/guide/notes.md',
    'docs/한글 문서.md',
  ].sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));

  assert.deepEqual(result.documents.map((document) => document.path), expected);
  assert.equal(result.contract_version, 1);
  assert.equal(result.root, await realpath(root));
  assert.equal(isAbsolute(result.root), true);
  assert.equal(result.is_git, false);
  assert.deepEqual(result.git, {
    available: true,
    repository_state: 'non-git',
    head: '0000000',
    branch: 'HEAD',
    dirty: 'unknown',
  });
  assert.equal(result.worktree_hash, 'no-git');
  assert.deepEqual(result.dirty_paths, []);
});

test('reference extraction excludes indented/CommonMark fenced code and preserves line numbers', () => {
  const text = [
    '`src/live.js`',
    '`npm run build`',
    '`$HOME`',
    '`MyComponent` and `handleAuth()`',
    '```js',
    '`src/fenced.js`',
    '```',
    '    `src/indented.js`',
    '[guide](docs/setup.md)',
    'Use $PLAIN_ENV outside inline code.',
    '[space](docs/My Guide.md)',
    '~~~ js',
    '`src/tilde.js`',
    '~~~',
  ].join('\n');

  assert.deepEqual(extractReferences(text), [
    { kind: 'path', value: 'src/live.js', line: 1 },
    { kind: 'cli', value: 'npm run build', line: 2 },
    { kind: 'env', value: 'HOME', line: 3 },
    { kind: 'symbol', value: 'MyComponent', line: 4 },
    { kind: 'symbol', value: 'handleAuth()', line: 4 },
    { kind: 'path', value: 'docs/setup.md', line: 9 },
    { kind: 'env', value: 'PLAIN_ENV', line: 10 },
    { kind: 'path', value: 'docs/My Guide.md', line: 11 },
  ]);
});

test('CommonMark splitter handles indentation, marker length, invalid info, suffixes, and EOF', () => {
  const text = [
    '`src/before.md`',           // 1 survives
    '   ````js',                 // 2 opens four-backtick fence
    '`hidden/a.md`',             // 3 fenced
    '```',                       // 4 too short
    '```` not-a-close',          // 5 suffix prevents close
    '  ````',                    // 6 closes despite different indent
    '`src/after-four.md`',       // 7 survives
    '    `src/indented.md`',     // 8 four-space non-fence survives splitter
    '`src/after-indented.md`',   // 9 survives
    '```bad`info',               // 10 invalid backtick opener survives
    '`src/after-invalid.md`',    // 11 survives
    ' ~~~ valid info',           // 12 opens tilde fence
    '`hidden/b.md`',             // 13 fenced
    '~~~suffix',                 // 14 invalid close
    '~~~   ',                    // 15 closes
    '`src/after-tilde.md`',      // 16 survives
    '```',                       // 17 opens to EOF
    '`hidden/c.md`',             // 18 fenced
  ].join('\n');

  assert.deepEqual(splitNonFencedSegments(text).map(({ line }) => line), [1, 7, 8, 9, 10, 11, 16]);
  assert.deepEqual(extractReferences(text), [
    { kind: 'path', value: 'src/before.md', line: 1 },
    { kind: 'path', value: 'src/after-four.md', line: 7 },
    { kind: 'path', value: 'src/after-indented.md', line: 9 },
    { kind: 'path', value: 'src/after-invalid.md', line: 11 },
    { kind: 'path', value: 'src/after-tilde.md', line: 16 },
  ]);
});

test('translation groups retain their directory', () => {
  assert.equal(translationGroup('docs/api/README.ko.md'), 'docs/api/README');
  assert.equal(translationGroup('docs/api/README.md'), 'docs/api/README');
  assert.notEqual(
    translationGroup('docs/api/README.md'),
    translationGroup('docs/setup/README.ko.md'),
  );
});

test('context root representation preserves injected Windows drive and UNC physical paths', () => {
  const drive = 'C:\\Temp\\Deep Docs\\프로젝트';
  const unc = '\\\\server\\share\\Deep Docs\\프로젝트';
  assert.equal(contextRootFromRealPath(drive, win32), drive);
  assert.equal(contextRootFromRealPath(unc, win32), unc);
  assert.equal(win32.isAbsolute(contextRootFromRealPath(drive, win32)), true);
  assert.equal(win32.isAbsolute(contextRootFromRealPath(unc, win32)), true);
  assert.throws(() => contextRootFromRealPath('relative\\path', win32), /absolute/);
});

test('worktree hash changes for source content and excludes every deep-docs state projection', async () => {
  const root = await project('deep docs committed git path ');
  initialize(root);
  await mkdir(join(root, '.deep-docs'), { recursive: true });
  await writeFile(join(root, '.deep-docs', 'last-scan.json'), '{"state":1}\n');
  git(root, 'add', '-f', '--', '.deep-docs/last-scan.json');
  git(root, 'commit', '-qm', 'track plugin state');

  const clean = await computeWorktreeHash(root);
  await writeFile(join(root, '.deep-docs', 'last-scan.json'), '{"state":2}\n');
  const stateDirty = await computeWorktreeHash(root);
  git(root, 'add', '-f', '--', '.deep-docs/last-scan.json');
  const stateStaged = await computeWorktreeHash(root);
  assert.equal(stateDirty.hash, clean.hash);
  assert.equal(stateStaged.hash, clean.hash);

  await writeFile(join(root, 'README.md'), '# changed\n');
  const tracked = await computeWorktreeHash(root);
  await writeFile(join(root, 'README.md'), '# changed again before staging\n');
  git(root, 'add', '--', 'README.md');
  const staged = await computeWorktreeHash(root);
  await writeFile(join(root, '$(touch SHOULD_NOT_EXIST).md'), 'hostile\n');
  const untracked = await computeWorktreeHash(root);

  for (const result of [clean, tracked, staged, untracked]) {
    assert.equal(result.isGit, true);
    assert.equal(result.repository_state, 'head');
    assert.match(result.hash, /^[a-f0-9]{40}$/);
  }
  assert.notEqual(clean.hash, tracked.hash);
  assert.notEqual(tracked.hash, staged.hash);
  assert.notEqual(staged.hash, untracked.hash);
  await assert.rejects(readFile(join(root, 'SHOULD_NOT_EXIST')));
  assert.deepEqual(SOURCE_PROJECTION_PATHS, ['.', ':(exclude).deep-docs', ':(exclude).deep-docs/**']);
});

test('worktree hashing passes the literal source projection as argv elements', async () => {
  const root = await project('deep docs literal projection ');
  initialize(root);
  await writeFile(join(root, 'untracked source.md'), 'source\n');
  const calls = [];
  const result = await computeWorktreeHash(root, {
    runGitImpl: (gitRoot, args, options) => {
      calls.push([...args]);
      return runGit(gitRoot, args, options);
    },
  });
  assert.match(result.hash, /^[a-f0-9]{40}$/);
  assert.equal(calls.some((args) => args.join('\0') === [
    'diff', '--binary', 'HEAD', '--', ...SOURCE_PROJECTION_PATHS,
  ].join('\0')), true);
  assert.equal(calls.some((args) => args.join('\0') === [
    'ls-files', '--others', '--exclude-standard', '-z', '--', ...SOURCE_PROJECTION_PATHS,
  ].join('\0')), true);
  assert.equal(calls.some((args) => args.some((arg) => arg.includes('$(touch'))), false);
});

test('unborn repository hashes source without asking for HEAD and excludes staged state', async () => {
  const root = await project('deep docs unborn git path ');
  initialize(root, { commit: false });
  await mkdir(join(root, '.deep-docs'), { recursive: true });
  await writeFile(join(root, '.deep-docs', 'last-scan.json'), '{"state":1}\n');
  git(root, 'add', '-f', '--', '.deep-docs/last-scan.json');

  const first = await computeWorktreeHash(root);
  await writeFile(join(root, '.deep-docs', 'last-scan.json'), '{"state":2}\n');
  git(root, 'add', '-f', '--', '.deep-docs/last-scan.json');
  const stateOnly = await computeWorktreeHash(root);
  await writeFile(join(root, 'README.md'), '# changed before first commit\n');
  const source = await computeWorktreeHash(root);

  assert.equal(first.repository_state, 'unborn');
  assert.match(first.hash, /^[a-f0-9]{40}$/);
  assert.equal(stateOnly.hash, first.hash);
  assert.notEqual(source.hash, first.hash);

  const context = await buildScanContext(root, { pathCheckEnabled: false });
  assert.equal(context.is_git, true);
  assert.equal(context.git.repository_state, 'unborn');
  assert.equal(context.git.head, '0000000');
  assert.equal(typeof context.git.branch, 'string');
  assert.notEqual(context.git.branch, '');
});

async function makeIgnoredFixture({ unborn }) {
  const root = await project(`deep docs ignored ${unborn ? 'unborn ' : 'head '}`);
  await mkdir(join(root, 'docs', 'nested', 'ignored-dir'), { recursive: true });
  await mkdir(join(root, 'docs', 'info'), { recursive: true });
  await mkdir(join(root, 'docs', 'global'), { recursive: true });
  await writeFile(join(root, '.gitignore'), [
    'docs/root ignored.md',
    'docs/negated*.md',
    '!docs/negated-keep.md',
    'docs/nested/ignored-dir/',
    'docs/tracked-exception.md',
  ].join('\n'));
  await writeFile(join(root, 'docs', 'nested', '.gitignore'), 'nested ignored.md\n');
  await writeFile(join(root, 'docs', 'root ignored.md'), 'ignored\n');
  await writeFile(join(root, 'docs', 'negated-drop.md'), 'ignored\n');
  await writeFile(join(root, 'docs', 'negated-keep.md'), 'kept\n');
  await writeFile(join(root, 'docs', 'nested', 'nested ignored.md'), 'ignored\n');
  await writeFile(join(root, 'docs', 'nested', 'ignored-dir', '한글.md'), 'ignored\n');
  await writeFile(join(root, 'docs', 'info', 'excluded.md'), 'ignored\n');
  await writeFile(join(root, 'docs', 'global', 'excluded.md'), 'ignored\n');
  await writeFile(join(root, 'docs', 'tracked-exception.md'), 'tracked\n');
  if (process.platform !== 'win32') {
    await mkdir(join(root, 'docs', 'newline-ignored'), { recursive: true });
    await writeFile(join(root, 'docs', 'newline-ignored', 'line\nbreak.md'), 'ignored\n');
    await writeFile(
      join(root, '.gitignore'),
      `${await readFile(join(root, '.gitignore'), 'utf8')}\ndocs/newline-ignored/\n`,
    );
  }

  initialize(root, { commit: false });
  await mkdir(join(root, '.git', 'info'), { recursive: true });
  await writeFile(join(root, '.git', 'info', 'exclude'), 'docs/info/excluded.md\n');
  const globalExclude = join(root, 'global excludes');
  await writeFile(globalExclude, 'docs/global/excluded.md\n');
  git(root, 'config', 'core.excludesFile', globalExclude);
  git(root, 'add', '-f', '--', 'docs/tracked-exception.md');
  if (!unborn) {
    git(root, 'add', '.gitignore', 'docs/nested/.gitignore', 'README.md', 'docs/guide', 'docs/한글 문서.md', 'docs/negated-keep.md');
    git(root, 'commit', '-qm', 'fixture');
  }
  return root;
}

for (const unborn of [false, true]) {
  test(`Git ignore filtering delegates standard-ignore semantics (${unborn ? 'unborn' : 'head'})`, async () => {
    const root = await makeIgnoredFixture({ unborn });
    if (process.platform !== 'win32') {
      const newlinePath = 'docs/newline-ignored/line\nbreak.md';
      const trackedProbe = spawnSync('git', ['ls-files', '--cached', '-z', '--'], {
        cwd: root, encoding: null, shell: false,
      });
      assert.equal(trackedProbe.status, 0, trackedProbe.stderr?.toString('utf8'));
      assert.equal(trackedProbe.stdout.includes(Buffer.from(`${newlinePath}\0`)), false);
      const ignoreProbe = spawnSync('git', ['check-ignore', '--stdin', '-z'], {
        cwd: root, input: Buffer.from(`${newlinePath}\0`), encoding: null, shell: false,
      });
      assert.equal(ignoreProbe.status, 0, ignoreProbe.stderr?.toString('utf8'));
      assert.equal(ignoreProbe.stdout.equals(Buffer.from(`${newlinePath}\0`)), true);
    }
    const context = await buildScanContext(root, { pathCheckEnabled: false });
    const paths = context.documents.map(({ path }) => path);

    assert.equal(paths.includes('docs/root ignored.md'), false);
    assert.equal(paths.includes('docs/negated-drop.md'), false);
    assert.equal(paths.includes('docs/negated-keep.md'), true);
    assert.equal(paths.includes('docs/nested/nested ignored.md'), false);
    assert.equal(paths.includes('docs/nested/ignored-dir/한글.md'), false);
    assert.equal(paths.includes('docs/info/excluded.md'), false);
    assert.equal(paths.includes('docs/global/excluded.md'), false);
    assert.equal(paths.includes('docs/tracked-exception.md'), true);
    if (process.platform !== 'win32') {
      assert.equal(paths.includes('docs/newline-ignored/line\nbreak.md'), false);
    }
  });
}

test('ignore projection uses literal argv and NUL Buffer and fails closed when indeterminate', async () => {
  const calls = [];
  const runner = (_root, args, options = {}) => {
    calls.push({ args, input: options.input });
    if (args[0] === 'ls-files') {
      return { ok: true, status: 0, missing: false, stdout: Buffer.from('docs/tracked.md\0'), stderr: '' };
    }
    return { ok: true, status: 1, missing: false, stdout: Buffer.alloc(0), stderr: '' };
  };
  const candidates = ['docs/a b.md', 'docs/tracked.md', 'docs/한글.md'];
  assert.deepEqual(
    await filterDocumentCandidatesByGitIgnore('/root', candidates, 'head', { runGitImpl: runner }),
    candidates,
  );
  assert.deepEqual(calls[0].args, ['ls-files', '--cached', '-z', '--']);
  assert.deepEqual(calls[1].args, ['check-ignore', '--stdin', '-z']);
  assert.equal(Buffer.isBuffer(calls[1].input), true);
  assert.equal(calls[1].input.toString('utf8'), 'docs/a b.md\0docs/한글.md\0');

  await assert.rejects(
    filterDocumentCandidatesByGitIgnore('/root', ['docs/a.md'], 'head', {
      runGitImpl: (_root, args) => args[0] === 'ls-files'
        ? { ok: true, status: 0, missing: false, stdout: Buffer.alloc(0), stderr: '' }
        : { ok: false, status: 128, missing: false, stdout: Buffer.alloc(0), stderr: 'fatal' },
    }),
    (error) => error?.code === 'git-ignore',
  );
  await assert.rejects(
    filterDocumentCandidatesByGitIgnore('/root', ['docs/a.md'], 'head', {
      runGitImpl: (_root, args) => args[0] === 'ls-files'
        ? { ok: true, status: 0, missing: false, stdout: Buffer.alloc(0), stderr: '' }
        : { ok: false, status: 127, missing: true, stdout: Buffer.alloc(0), stderr: 'ENOENT' },
    }),
    (error) => error?.code === 'git-ignore',
  );
  await assert.rejects(
    filterDocumentCandidatesByGitIgnore('/root', ['docs/a.md'], 'head', {
      runGitImpl: () => ({
        ok: true,
        status: 0,
        missing: false,
        stdout: Buffer.from('docs/a.md'),
        stderr: '',
      }),
    }),
    (error) => error?.code === 'git-ignore',
  );
  await assert.rejects(
    filterDocumentCandidatesByGitIgnore('/root', ['docs/a.md'], 'head', {
      runGitImpl: (_root, args) => args[0] === 'ls-files'
        ? { ok: true, status: 0, missing: false, stdout: Buffer.alloc(0), stderr: '' }
        : {
          ok: true,
          status: 0,
          missing: false,
          stdout: Buffer.from('docs/not-a-candidate.md\0'),
          stderr: '',
        },
    }),
    (error) => error?.code === 'git-ignore',
  );
  await assert.rejects(
    filterDocumentCandidatesByGitIgnore('/root', ['docs/a.md'], 'head', {
      runGitImpl: (_root, args) => args[0] === 'ls-files'
        ? { ok: true, status: 0, missing: false, stdout: Buffer.alloc(0), stderr: '' }
        : { ok: true, status: 0, missing: false, stdout: Buffer.alloc(0), stderr: '' },
    }),
    (error) => error?.code === 'git-ignore',
  );
});

test('non-Git and missing-Git scans do not partially interpret gitignore', async () => {
  const root = await project('deep docs fallback ignore ');
  await writeFile(join(root, '.gitignore'), 'docs/guide/notes.md\n');
  const nonGit = await buildScanContext(root, { pathCheckEnabled: false });
  assert.equal(nonGit.documents.some(({ path }) => path === 'docs/guide/notes.md'), true);

  const hiddenBin = await temporaryRoot('deep docs hidden path ');
  const result = cliRun(['scan-context', '--root', root], {
    env: { ...process.env, PATH: hiddenBin },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim().split('\n').length, 1);
  const missing = JSON.parse(result.stdout);
  assert.equal(missing.is_git, false);
  assert.deepEqual(missing.git, {
    available: false,
    repository_state: 'missing',
    head: '0000000',
    branch: 'HEAD',
    dirty: 'unknown',
  });
  assert.equal(missing.worktree_hash, 'no-git');
  assert.equal(missing.documents.some(({ path }) => path === 'docs/guide/notes.md'), true);
});

test('canonical physical root survives redundant spelling while root and child symlinks fail closed', async (t) => {
  const parent = await temporaryRoot('deep docs unicode e\u0301 ');
  const root = join(parent, 'é and e\u0301 segment');
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, 'README.md'), '# root\n');
  await writeFile(join(root, 'docs', 'safe.md'), '# safe\n');
  const redundant = join(root, '..', 'é and e\u0301 segment');
  const expected = await realpath(root);
  assert.equal(await resolveAndValidateRealTargetRoot(redundant), expected);
  assert.equal((await buildScanContext(redundant, { pathCheckEnabled: false })).root, expected);
  const directCli = cliRun(['scan-context', '--root', redundant]);
  assert.equal(directCli.status, 0, directCli.stderr);
  assert.equal(JSON.parse(directCli.stdout).root, expected);

  const outside = await temporaryRoot('deep docs symlink target ');
  await writeFile(join(outside, 'AGENTS.md'), 'outside\n');
  const rootAlias = join(parent, 'root-alias');
  const childAlias = join(root, 'docs', 'alias');
  try {
    await symlink(root, rootAlias, process.platform === 'win32' ? 'junction' : 'dir');
    await symlink(outside, childAlias, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.diagnostic('symlink assertions skipped because this Windows account lacks symlink privilege');
      return;
    }
    throw error;
  }
  await assert.rejects(buildScanContext(rootAlias, { pathCheckEnabled: false }), /symlink|junction/);
  const context = await buildScanContext(root, { pathCheckEnabled: false });
  assert.equal(context.documents.some(({ path }) => path.includes('alias')), false);
});

test('scan-context rejects a symlinked state directory instead of writing through it', async (t) => {
  const root = await project('deep docs state symlink root ');
  const outside = await temporaryRoot('deep docs state symlink outside ');
  try {
    await symlink(outside, join(root, '.deep-docs'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.diagnostic('state symlink assertion skipped because this Windows account lacks symlink privilege');
      return;
    }
    throw error;
  }
  const result = cliRun(['scan-context', '--root', root]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^deep-docs-runtime: state: .*symlink.*\n$/);
  assert.deepEqual(await lstat(join(root, '.deep-docs')).then((value) => value.isSymbolicLink()), true);
});

test('state request helpers enforce containment, exact parent identity, and regular files', async (t) => {
  const root = await project('deep docs state request root ');
  const stateDirectory = await ensureRealStateDirectory(root);
  const request = join(stateDirectory, 'request.json');
  await writeFile(request, '{"ok":true}\n');
  assert.equal(
    (await readStateRequest(root, '.deep-docs/request.json')).toString('utf8'),
    '{"ok":true}\n',
  );
  assert.equal(await revalidatePhysicalParent(root, stateDirectory, stateDirectory), stateDirectory);
  await assert.rejects(
    revalidatePhysicalParent(root, stateDirectory, await realpath(root)),
    (error) => error?.code === 'state' && /changed/.test(error.message),
  );
  await assert.rejects(
    readStateRequest(root, '../outside.json'),
    (error) => error?.code === 'request' && /escapes/.test(error.message),
  );

  const target = join(stateDirectory, 'target.json');
  const alias = join(stateDirectory, 'alias.json');
  await writeFile(target, '{}\n');
  try {
    await symlink(target, alias, 'file');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.diagnostic('request symlink assertion skipped because this Windows account lacks symlink privilege');
      return;
    }
    throw error;
  }
  await assert.rejects(
    readStateRequest(root, '.deep-docs/alias.json'),
    (error) => error?.code === 'request' && /non-symlink/.test(error.message),
  );
});

test('scan context normalizes logical paths, package scripts, references, and dirty paths', async () => {
  const root = await temporaryRoot('deep docs logical fields ');
  await mkdir(join(root, 'docs', 'guide'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'live.js'), 'export {};\n');
  await writeFile(join(root, 'README.md'), '`src/live.js`\n[setup](docs/guide/setup.md)\n[out](../escape.md)\n');
  await writeFile(join(root, 'docs', 'guide', 'setup.md'), '[root](../../README.md)\n');
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { zebra: 'z', alpha: 'a' } }));
  initialize(root);
  await writeFile(
    join(root, 'README.md'),
    '`src/live.js` changed\n[setup](docs/guide/setup.md)\n[out](../escape.md)\n',
  );
  await writeFile(join(root, 'docs', 'untracked.md'), '# new\n');

  const context = await buildScanContext(root, { pathCheckEnabled: true });
  assert.deepEqual(context.package_scripts, ['alpha', 'zebra']);
  assert.deepEqual(context.dirty_paths, ['README.md', 'docs/untracked.md']);
  assert.equal(context.path_check_enabled, true);
  const values = context.documents.flatMap(({ references }) => references
    .filter(({ kind }) => kind === 'path')
    .map(({ value }) => value));
  assert.equal(values.includes('src/live.js'), true);
  assert.equal(values.includes('docs/guide/setup.md'), true);
  assert.equal(values.includes('README.md'), true);
  assert.equal(values.includes('../escape.md'), false);
  for (const value of [...context.dirty_paths, ...values]) {
    assert.equal(value.includes('\\'), false);
    assert.equal(value.startsWith('../'), false);
    assert.equal(isAbsolute(value), false);
  }
});

test('runGit returns a structured missing executable result instead of throwing', async () => {
  const root = await temporaryRoot('deep docs missing git direct ');
  const original = process.env.PATH;
  process.env.PATH = root;
  try {
    const result = runGit(root, ['status'], { allowFailure: true });
    assert.equal(result.ok, false);
    assert.equal(result.status, 127);
    assert.equal(result.missing, true);
    assert.equal(Buffer.isBuffer(result.stdout), true);
    assert.equal(typeof result.stderr, 'string');
  } finally {
    process.env.PATH = original;
  }
});

test('a present but non-executable Git probe is an operational failure, not a non-Git fallback', async (t) => {
  if (process.platform === 'win32') {
    t.diagnostic('POSIX executable-bit assertion is not applicable on Windows');
    return;
  }
  const root = await project('deep docs broken git probe root ');
  const bin = await temporaryRoot('deep docs broken git probe bin ');
  const fakeGit = join(bin, 'git');
  await writeFile(fakeGit, '#!/bin/sh\nexit 0\n');
  await chmod(fakeGit, 0o644);
  const original = process.env.PATH;
  process.env.PATH = bin;
  try {
    await assert.rejects(
      buildScanContext(root, { pathCheckEnabled: false }),
      (error) => error?.code === 'git' && /probe/.test(error.message),
    );
  } finally {
    process.env.PATH = original;
  }
});

test('scan-context CLI grammar rejects repeats, values, unknowns, positionals, and missing root', async () => {
  const root = await project('deep docs cli grammar ');
  const cases = [
    ['scan-context'],
    ['scan-context', '--root'],
    ['scan-context', '--root', ''],
    ['scan-context', '--root', root, '--root', root],
    ['scan-context', '--root', root, '--path-check-enabled', 'true'],
    ['scan-context', '--root', root, '--unknown'],
    ['scan-context', '--root', root, 'positional'],
    ['unknown', '--root', root],
  ];
  for (const args of cases) {
    const result = cliRun(args);
    assert.equal(result.status, 1, `${args.join(' ')}\n${result.stderr}`);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^deep-docs-runtime: argv: [^\n]+\n$/);
    assert.equal(result.stderr.includes(' at '), false);
  }

  const ok = cliRun(['scan-context', '--path-check-enabled', '--root', root]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stderr, '');
  assert.equal(JSON.parse(ok.stdout).path_check_enabled, true);
  const state = await lstat(join(root, '.deep-docs'));
  assert.equal(state.isDirectory(), true);
  assert.equal(state.isSymbolicLink(), false);
});

test('runtime modules expose stable ESM entrypoints', async () => {
  const module = await import(pathToFileURL(cli));
  assert.equal(typeof module.main, 'function');
  assert.equal(module.PLUGIN_ROOT, repoRoot);
});
