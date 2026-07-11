import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { artifactRevision } from '../scripts/runtime/artifact.js';
import { gardenSignature } from '../scripts/runtime/authoring.js';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(pluginRoot, 'scripts', 'deep-docs-runtime.js');
const roots = new Set();

test.after(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(name = 'deep docs cli path with spaces ') {
  const root = await mkdtemp(join(tmpdir(), name));
  roots.add(root);
  return root;
}

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function project({ committed = true } = {}) {
  const root = await temporaryRoot();
  await writeFile(join(root, 'README.md'), '# fixture\n');
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'tests@example.invalid');
  git(root, 'config', 'user.name', 'Deep Docs Tests');
  if (committed) {
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'fixture');
  }
  return root;
}

function run(root, command, request, options = {}) {
  const args = [cli, command, '--root', root];
  if (request !== undefined) args.push('--request', request);
  return spawnSync(process.execPath, args, {
    encoding: 'utf8',
    shell: false,
    ...options,
  });
}

function success(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim().split('\n').length, 1);
  return JSON.parse(result.stdout);
}

function failure(result, code = '[a-z-]+') {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, new RegExp(`^deep-docs-runtime: ${code}: [^\\n]+\\n$`));
}

async function request(root, name, value) {
  await mkdir(join(root, '.deep-docs'), { recursive: true });
  await writeFile(join(root, '.deep-docs', name), `${JSON.stringify(value)}\n`);
  return name;
}

function emptyPayload() {
  return {
    provenance: { attacker: true },
    documents: [],
    summary: { total_issues: 0, auto_fixable: 0, authoring: 0, audit_only: 0 },
    gaps: [],
  };
}

test('all nine commands emit exactly one JSON line and obey fixed request schemas', async () => {
  const root = await project();
  const scan = success(run(root, 'scan-context'));
  assert.equal(scan.contract_version, 1);

  await request(root, 'rename.json', { old_path: 'old.md' });
  assert.deepEqual(success(run(root, 'rename-history', 'rename.json')), { history: [] });

  await request(root, 'scan-payload-request.json', { payload: emptyPayload() });
  const emitted = success(run(root, 'emit', 'scan-payload-request.json'));
  assert.equal(emitted.artifact_revision, artifactRevision(await readFile(join(root, '.deep-docs', 'last-scan.json'))));

  await request(root, 'reuse.json', {
    artifact_path: '.deep-docs/last-scan.json',
  });
  const reused = success(run(root, 'reuse', 'reuse.json'));
  assert.equal(reused.reusable, true);
  assert.equal(reused.reason, 'ok');
  assert.deepEqual(reused.artifact, emitted.artifact);
  assert.equal(reused.artifact_revision, emitted.artifact_revision);

  await request(root, 'baseline.json', {
    target_path: 'ARCHITECTURE.md', mode: 'create', doc_kind: 'architecture-md',
  });
  const baseline = success(run(root, 'authoring-baseline', 'baseline.json'));
  await request(root, 'commit.json', {
    baseline, draft_body: '# Architecture\n', preserved_blocks: [], doc_kind: 'architecture-md',
  });
  assert.deepEqual(success(run(root, 'authoring-commit', 'commit.json')), { ok: true });

  const signatureRequest = { type: 'thin-doc', path: 'AGENTS.md', content_preview: 'x' };
  await request(root, 'signature.json', signatureRequest);
  const signature = success(run(root, 'signature', 'signature.json')).signature;
  assert.equal(signature, gardenSignature({
    type: signatureRequest.type, path: signatureRequest.path, contentPreview: signatureRequest.content_preview,
  }));

  await request(root, 'ignore.json', { entry: { ...signatureRequest, signature } });
  assert.equal(success(run(root, 'garden-ignore', 'ignore.json')).added, true);

  await request(root, 'invalidate.json', { expected_revision: emitted.artifact_revision });
  assert.deepEqual(success(run(root, 'scan-invalidate', 'invalidate.json')), {
    invalidated: true, reason: 'matched', revision: emitted.artifact_revision,
  });
});

test('emit cleanup removes only the exact successful request and retains every failure', async () => {
  const root = await project();
  await success(run(root, 'scan-context'));
  await request(root, 'scan-payload-request.json', { payload: emptyPayload(), cleanup_request: true });
  success(run(root, 'emit', 'scan-payload-request.json'));
  assert.equal(spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' }).status, 0);
  assert.equal(await readFile(join(root, '.deep-docs', 'scan-payload-request.json')).catch((e) => e.code), 'ENOENT');

  await request(root, 'other.json', { payload: emptyPayload(), cleanup_request: true });
  failure(run(root, 'emit', 'other.json'), 'request');
  assert.equal((await readFile(join(root, '.deep-docs', 'other.json'), 'utf8')).length > 0, true);

  await request(root, 'scan-payload-request.json', { payload: {}, cleanup_request: true });
  failure(run(root, 'emit', 'scan-payload-request.json'));
  assert.equal((await readFile(join(root, '.deep-docs', 'scan-payload-request.json'), 'utf8')).length > 0, true);
});

test('reuse treats invalid parsed envelopes as semantic rejection and malformed JSON as operational', async () => {
  const root = await project();
  success(run(root, 'scan-context'));
  for (const [index, value] of [null, 'x', 1, true, [], {}].entries()) {
    await writeFile(join(root, '.deep-docs', 'last-scan.json'), `${JSON.stringify(value)}\n`);
    await request(root, `reuse-${index}.json`, { artifact_path: '.deep-docs/last-scan.json' });
    assert.deepEqual(success(run(root, 'reuse', `reuse-${index}.json`)), {
      reusable: false, reason: 'envelope',
    });
  }
  await writeFile(join(root, '.deep-docs', 'last-scan.json'), '{broken');
  await request(root, 'reuse-broken.json', { artifact_path: '.deep-docs/last-scan.json' });
  failure(run(root, 'reuse', 'reuse-broken.json'), 'artifact');
});

test('reuse CLI ignores tracked and staged plugin state but rejects a real source edit', async () => {
  const root = await project();
  await mkdir(join(root, '.deep-docs'), { recursive: true });
  await writeFile(join(root, '.deep-docs', 'last-scan.json'), '{}\n');
  git(root, 'add', '-f', '--', '.deep-docs/last-scan.json');
  git(root, 'commit', '-qm', 'track initial state');
  await request(root, 'scan-payload-request.json', { payload: emptyPayload() });
  const emitted = success(run(root, 'emit', 'scan-payload-request.json'));
  await request(root, 'reuse.json', { artifact_path: '.deep-docs/last-scan.json' });
  const before = success(run(root, 'reuse', 'reuse.json'));
  assert.equal(before.reason, 'ok');
  assert.equal(before.artifact_revision, emitted.artifact_revision);
  git(root, 'add', '-f', '--', '.deep-docs/last-scan.json');
  const staged = success(run(root, 'reuse', 'reuse.json'));
  assert.equal(staged.reason, 'ok');
  assert.equal(staged.artifact.payload.provenance.worktree_hash,
    before.artifact.payload.provenance.worktree_hash);
  await writeFile(join(root, 'README.md'), '# real source edit\n');
  assert.deepEqual(success(run(root, 'reuse', 'reuse.json')), {
    reusable: false, reason: 'worktree',
  });
});

test('parser rejects duplicate, unknown, positional, non-state, and schema-invalid requests', async () => {
  const root = await project();
  const parserCases = [
    [cli, 'scan-context', '--root', root, '--root', root],
    [cli, 'scan-context', '--root', root, '--unknown'],
    [cli, 'scan-context', '--root', root, 'positional'],
    [cli, 'reuse', '--root', root, '--request', '../x.json'],
    [cli, 'reuse', '--root', root, '--request', 'nested/x.json'],
  ];
  for (const args of parserCases) {
    failure(spawnSync(process.execPath, args, { encoding: 'utf8', shell: false }), 'argv');
  }

  success(run(root, 'scan-context'));
  const invalidByCommand = {
    'rename-history': { old_path: '../escape' },
    reuse: { artifact_path: '/absolute' },
    emit: { payload: {}, unknown: true },
    'authoring-baseline': { target_path: '../x', mode: 'create', doc_kind: 'agents-md' },
    'authoring-commit': { baseline: {}, draft_body: 1, preserved_blocks: [], doc_kind: 'agents-md' },
    signature: { type: '', path: 'x', content_preview: 'x' },
    'garden-ignore': { entry: {} },
    'scan-invalidate': { expected_revision: 'bad' },
  };
  for (const [command, value] of Object.entries(invalidByCommand)) {
    const name = `${command}.json`;
    await request(root, name, value);
    failure(run(root, command, name));
  }
});

test('rename-history is empty without usable HEAD and returns Git argv history for a rename', async () => {
  const nonGit = await temporaryRoot('deep docs rename non git ');
  await request(nonGit, 'rename.json', { old_path: 'old.md' });
  assert.deepEqual(success(run(nonGit, 'rename-history', 'rename.json')), { history: [] });

  const unborn = await project({ committed: false });
  await request(unborn, 'rename.json', { old_path: 'old.md' });
  assert.deepEqual(success(run(unborn, 'rename-history', 'rename.json')), { history: [] });

  const missingGit = await temporaryRoot('deep docs rename missing git ');
  await request(missingGit, 'rename.json', { old_path: 'old.md' });
  const hiddenPath = await temporaryRoot('deep docs rename hidden path ');
  assert.deepEqual(success(run(missingGit, 'rename-history', 'rename.json', {
    env: { ...process.env, PATH: hiddenPath },
  })), { history: [] });

  const committed = await project();
  await writeFile(join(committed, 'old.md'), 'old\n');
  git(committed, 'add', 'old.md');
  git(committed, 'commit', '-qm', 'old');
  git(committed, 'mv', 'old.md', 'new.md');
  git(committed, 'commit', '-qm', 'rename');
  await request(committed, 'rename.json', { old_path: 'old.md' });
  const history = success(run(committed, 'rename-history', 'rename.json')).history;
  assert.ok(history.some((line) => line.includes('new.md')));
});

test('two independent garden-ignore processes serialize through one mutation lock', async () => {
  const root = await project();
  success(run(root, 'scan-context'));
  const entries = ['AGENTS.md', 'CLAUDE.md'].map((path) => {
    const value = { type: 'thin-doc', path, content_preview: path };
    return {
      ...value,
      signature: gardenSignature({ type: value.type, path, contentPreview: value.content_preview }),
    };
  });
  await request(root, 'one.json', { entry: entries[0] });
  await request(root, 'two.json', { entry: entries[1] });
  const launch = (name) => new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, 'garden-ignore', '--root', root, '--request', name], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolvePromise({ status, stdout, stderr }));
  });
  const results = await Promise.all([launch('one.json'), launch('two.json')]);
  for (const result of results) success(result);
  const persisted = JSON.parse(await readFile(join(root, '.deep-docs', 'garden-ignored.json'), 'utf8'));
  assert.deepEqual(persisted.ignored.map(({ path }) => path).sort(), ['AGENTS.md', 'CLAUDE.md']);
});

test('scan-context and emit reject a symlinked state directory and retain the outside request', async (t) => {
  const root = await project();
  const outside = await temporaryRoot('deep docs cli state outside ');
  const requestBytes = `${JSON.stringify({
    payload: emptyPayload(), cleanup_request: true,
  })}\n`;
  await writeFile(join(outside, 'scan-payload-request.json'), requestBytes);
  await writeFile(join(outside, 'sentinel'), 'outside');
  try {
    await symlink(outside, join(root, '.deep-docs'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.diagnostic('symlink assertion skipped because this Windows account lacks privilege');
      return;
    }
    throw error;
  }
  failure(run(root, 'scan-context'), 'state');
  failure(run(root, 'emit', 'scan-payload-request.json'), 'state');
  assert.equal(await readFile(join(outside, 'scan-payload-request.json'), 'utf8'), requestBytes);
  assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'outside');
});
