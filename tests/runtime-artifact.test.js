import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildScanContext } from '../scripts/runtime/scan.js';
import {
  appendGardenIgnore,
  artifactRevision,
  emitScanArtifact,
  evaluateReuse,
  invalidateScanArtifact,
  serializeStateJson,
} from '../scripts/runtime/artifact.js';
import {
  AUTHORING_TARGETS,
  captureBaseline,
  commitAuthoring,
  contentDigest,
  gardenSignature,
} from '../scripts/runtime/authoring.js';
import {
  validateEnvelopeFile,
  validateEnvelopeObject,
} from '../scripts/validate-envelope-emit.js';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = JSON.parse(await readFile(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
const validatorCli = join(pluginRoot, 'scripts', 'validate-envelope-emit.js');
const now = new Date('2026-07-10T12:00:00Z');
const roots = new Set();

test.after(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(name = 'deep docs artifact path with spaces ') {
  const root = await mkdtemp(join(tmpdir(), name));
  roots.add(root);
  return root;
}

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function gitProject() {
  const root = await temporaryRoot();
  await writeFile(join(root, 'README.md'), '# fixture\n');
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'tests@example.invalid');
  git(root, 'config', 'user.name', 'Deep Docs Tests');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture');
  return root;
}

async function validPayload(root, pathCheckEnabled = false) {
  const context = await buildScanContext(root, { pathCheckEnabled });
  return {
    provenance: { is_git: context.is_git, worktree_hash: context.worktree_hash },
    documents: [],
    summary: { total_issues: 0, auto_fixable: 0, authoring: 0, audit_only: 0 },
    gaps: [],
  };
}

async function fixture(root, options = {}) {
  return emitScanArtifact({
    root,
    payload: await validPayload(root, options.pathCheckEnabled),
    pluginRoot,
    now: options.now ?? now,
    randomBytes: options.randomBytes ?? Buffer.alloc(10, 7),
    pathCheckEnabled: options.pathCheckEnabled ?? false,
    deps: options.deps,
  });
}

test('pure envelope validator is bounded, repeatable, and preserves negative fixtures', async () => {
  for (const value of [null, 'x', 1, true, []]) {
    assert.deepEqual(validateEnvelopeObject(value, plugin.version), ['root must be a plain object']);
  }
  for (const value of [{}, Object.create(null)]) {
    const errors = validateEnvelopeObject(value, plugin.version);
    assert.ok(errors.length > 0 && errors.length <= 4, errors.join('\n'));
  }
  assert.deepEqual(validateEnvelopeObject(null, plugin.version), ['root must be a plain object']);
  assert.deepEqual(validateEnvelopeObject(null, plugin.version), ['root must be a plain object']);

  for (const name of [
    'sample-last-scan-invalid-gap.json',
    'sample-last-scan-invalid-summary.json',
    'sample-last-scan-bad-summary-counts.json',
  ]) {
    const value = JSON.parse(await readFile(join(pluginRoot, 'tests', 'fixtures', name), 'utf8'));
    assert.ok(validateEnvelopeObject(value, plugin.version).length > 0, name);
  }

  const missing = join(await temporaryRoot('deep docs validator missing '), 'missing.json');
  const corrupt = join(await temporaryRoot('deep docs validator corrupt '), 'corrupt.json');
  await writeFile(corrupt, '{broken');
  for (const target of [missing, corrupt]) {
    assert.ok(validateEnvelopeFile(target).length > 0);
    const result = spawnSync(process.execPath, [validatorCli, target], { encoding: 'utf8', shell: false });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^validate-envelope-emit: [^\n]+\n$/);
  }
});

test('reuse validates envelope first, then TTL, path-check, HEAD, and worktree', async () => {
  const root = await gitProject();
  const artifact = await fixture(root);
  assert.deepEqual(await evaluateReuse({ artifact, root, pluginRoot, now, pathCheckEnabled: false }), {
    reusable: true,
    reason: 'ok',
    artifact_revision: artifactRevision(artifact),
  });

  for (const mutate of [
    (value) => { value.envelope.producer_version = '0.0.0'; },
    (value) => { value.envelope.unexpected = true; },
    (value) => { value.envelope.producer = 'other-plugin'; },
    (value) => { value.payload.provenance.path_check_enabled = 'false'; },
    (value) => { value.payload.provenance.path_check_enabled = false; },
  ]) {
    const invalid = structuredClone(artifact);
    mutate(invalid);
    assert.deepEqual(
      await evaluateReuse({ artifact: invalid, root: join(root, 'does-not-exist'), pluginRoot, now }),
      { reusable: false, reason: 'envelope' },
    );
  }
  assert.equal((await evaluateReuse({
    artifact, root, pluginRoot, now: new Date(now.getTime() + 601_000), pathCheckEnabled: false,
  })).reason, 'ttl');
  assert.equal((await evaluateReuse({ artifact, root, pluginRoot, now, pathCheckEnabled: true })).reason, 'path-check');
  await writeFile(join(root, 'untracked.md'), 'changed\n');
  assert.equal((await evaluateReuse({ artifact, root, pluginRoot, now, pathCheckEnabled: false })).reason, 'worktree');
});

test('non-Git artifact emission succeeds but reuse always fails closed', async () => {
  const root = await temporaryRoot('deep docs non git artifact ');
  await writeFile(join(root, 'README.md'), '# non-git\n');
  const artifact = await fixture(root);
  assert.deepEqual(await evaluateReuse({ artifact, root, pluginRoot, now, pathCheckEnabled: false }), {
    reusable: false,
    reason: 'no-git',
  });
  await writeFile(join(root, 'README.md'), '# changed\n');
  assert.deepEqual(await evaluateReuse({ artifact, root, pluginRoot, now, pathCheckEnabled: false }), {
    reusable: false,
    reason: 'no-git',
  });
});

test('emit uses runtime-owned identity, canonical bytes, and an exact-byte revision', async () => {
  const root = await gitProject();
  const payload = await validPayload(root);
  payload.provenance = { attacker: true };
  const artifact = await emitScanArtifact({
    root, payload, pluginRoot, now, randomBytes: Buffer.alloc(10, 7),
  });
  const bytes = await readFile(join(root, '.deep-docs', 'last-scan.json'));
  assert.deepEqual(bytes, serializeStateJson(artifact));
  assert.equal(artifactRevision(bytes), artifactRevision(artifact));
  assert.equal(artifact.envelope.producer_version, plugin.version);
  assert.deepEqual(Object.keys(artifact.envelope.git).sort(), ['branch', 'dirty', 'head']);
  assert.deepEqual(artifact.payload.provenance, {
    is_git: true,
    worktree_hash: (await buildScanContext(root, { pathCheckEnabled: false })).worktree_hash,
  });
  assert.deepEqual(validateEnvelopeObject(artifact, plugin.version), []);
  assert.match(artifact.envelope.run_id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(artifact.envelope.generated_at, '2026-07-10T12:00:00Z');
  assert.deepEqual((await readdir(join(root, '.deep-docs'))).filter((name) => name.endsWith('.tmp')), []);

  await assert.rejects(emitScanArtifact({
    root,
    payload: {
      ...await validPayload(root),
      documents: [{ path: '../escape.md', issues: [], metrics: {} }],
    },
    pluginRoot,
    now,
    randomBytes: Buffer.alloc(10, 9),
  }), /repository-relative|normalized/);
});

test('tracked and staged artifact replacement never invalidates reuse; source edits do', async () => {
  const root = await gitProject();
  await mkdir(join(root, '.deep-docs'), { recursive: true });
  await writeFile(join(root, '.deep-docs', 'last-scan.json'), '{}\n');
  git(root, 'add', '-f', '--', '.deep-docs/last-scan.json');
  git(root, 'commit', '-qm', 'track state');
  const artifact = await fixture(root);
  const before = await evaluateReuse({ artifact, root, pluginRoot, now, pathCheckEnabled: false });
  assert.equal(before.reason, 'ok');
  git(root, 'add', '-f', '--', '.deep-docs/last-scan.json');
  const staged = await evaluateReuse({ artifact, root, pluginRoot, now, pathCheckEnabled: false });
  assert.deepEqual(staged, before);
  await writeFile(join(root, 'README.md'), '# source edit\n');
  assert.equal((await evaluateReuse({ artifact, root, pluginRoot, now, pathCheckEnabled: false })).reason, 'worktree');
});

test('authoring target matrix uses raw-byte SHA-256 and fails on intervening changes', async () => {
  for (const [docKind, targetPath] of Object.entries(AUTHORING_TARGETS)) {
    const createRoot = await temporaryRoot(`deep docs create ${docKind} `);
    const create = await captureBaseline({ root: createRoot, targetPath, mode: 'create', docKind });
    assert.deepEqual(create, {
      contract_version: 1,
      doc_kind: docKind,
      mode: 'create',
      target_path: targetPath,
      exists: false,
      content_digest: null,
    });
    assert.deepEqual(await commitAuthoring({
      root: createRoot, baseline: create, draftBody: '# Draft\n', preservedBlocks: [], docKind,
    }), { ok: true });

    const raceRoot = await temporaryRoot(`deep docs create race ${docKind} `);
    const raced = await captureBaseline({ root: raceRoot, targetPath, mode: 'create', docKind });
    await writeFile(join(raceRoot, targetPath), 'user created\n');
    await assert.rejects(commitAuthoring({
      root: raceRoot, baseline: raced, draftBody: 'draft\n', preservedBlocks: [], docKind,
    }), /baseline changed/);
    assert.equal(await readFile(join(raceRoot, targetPath), 'utf8'), 'user created\n');

    const restructureRoot = await temporaryRoot(`deep docs restructure ${docKind} `);
    const raw = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('한글\r\nno-final', 'utf8')]);
    await writeFile(join(restructureRoot, targetPath), raw);
    const restructure = await captureBaseline({ root: restructureRoot, targetPath, mode: 'restructure', docKind });
    const oracle = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
    assert.equal(restructure.content_digest, oracle);
    assert.equal(await contentDigest(createReadStream(join(restructureRoot, targetPath))), oracle);
    assert.deepEqual(await commitAuthoring({
      root: restructureRoot,
      baseline: restructure,
      draftBody: '# replacement\n',
      preservedBlocks: [],
      docKind,
    }), { ok: true });
    assert.equal(await readFile(join(restructureRoot, targetPath), 'utf8'), '# replacement\n');

    const changedRoot = await temporaryRoot(`deep docs restructure race ${docKind} `);
    await writeFile(join(changedRoot, targetPath), raw);
    const changedBaseline = await captureBaseline({
      root: changedRoot, targetPath, mode: 'restructure', docKind,
    });
    await writeFile(join(changedRoot, targetPath), Buffer.concat([raw, Buffer.from('!')]));
    await assert.rejects(commitAuthoring({
      root: changedRoot,
      baseline: changedBaseline,
      draftBody: '# replacement\n',
      preservedBlocks: [],
      docKind,
    }), /baseline changed/);
    assert.deepEqual(await readFile(join(changedRoot, targetPath)), Buffer.concat([raw, Buffer.from('!')]));
  }
});

test('non-Git authoring remains byte-based when Git is absent from PATH', async () => {
  const hiddenPath = await temporaryRoot('deep docs hidden git bin ');
  const original = process.env.PATH;
  try {
    process.env.PATH = hiddenPath;
    for (const [docKind, targetPath] of Object.entries(AUTHORING_TARGETS)) {
      const createRoot = await temporaryRoot(`deep docs hidden git create ${docKind} `);
      const create = await captureBaseline({ root: createRoot, targetPath, mode: 'create', docKind });
      assert.deepEqual(await commitAuthoring({
        root: createRoot,
        baseline: create,
        draftBody: '# Created\n',
        preservedBlocks: [],
        docKind,
      }), { ok: true });

      const restructureRoot = await temporaryRoot(`deep docs hidden git restructure ${docKind} `);
      const originalBytes = Buffer.from(`\ufeff${docKind}\r\nraw`, 'utf8');
      await writeFile(join(restructureRoot, targetPath), originalBytes);
      const restructure = await captureBaseline({
        root: restructureRoot, targetPath, mode: 'restructure', docKind,
      });
      assert.equal(restructure.content_digest,
        `sha256:${createHash('sha256').update(originalBytes).digest('hex')}`);
      assert.deepEqual(await commitAuthoring({
        root: restructureRoot,
        baseline: restructure,
        draftBody: '# Restructured\n',
        preservedBlocks: [],
        docKind,
      }), { ok: true });
    }
  } finally {
    process.env.PATH = original;
  }
});

test('authoring validates exact BaselineV1, preservation, bytes, ignores, and symlinks', async (t) => {
  const root = await gitProject();
  const baseline = await captureBaseline({ root, targetPath: 'AGENTS.md', mode: 'create', docKind: 'agents-md' });
  const invalid = [
    { ...baseline, git_blob_sha1: 'abc' },
    { ...baseline, unknown: true },
    { ...baseline, doc_kind: 'claude-md' },
    { ...baseline, target_path: '../AGENTS.md' },
    { ...baseline, mode: 'restructure' },
    { ...baseline, exists: true },
    { ...baseline, content_digest: 'sha256:ABC' },
  ];
  for (const value of invalid) {
    await assert.rejects(commitAuthoring({
      root, baseline: value, draftBody: 'draft\n', preservedBlocks: [], docKind: 'agents-md',
    }), /baseline|target_path|digest|keys|mode|doc_kind/);
  }
  await assert.rejects(commitAuthoring({
    root, baseline, draftBody: 'x'.repeat(32769), preservedBlocks: [], docKind: 'agents-md',
  }), /32 KiB/);
  await assert.rejects(commitAuthoring({
    root, baseline, draftBody: '# draft\n', preservedBlocks: ['user rule'], docKind: 'agents-md',
  }), /preserved block missing/);
  await writeFile(join(root, '.gitignore'), 'AGENTS.md\n');
  await assert.rejects(commitAuthoring({
    root, baseline, draftBody: '# draft\n', preservedBlocks: [], docKind: 'agents-md',
  }), /ignored/);

  const outside = await temporaryRoot('deep docs author outside ');
  await writeFile(join(outside, 'sentinel'), 'sentinel');
  try {
    await symlink(outside, join(root, 'AGENTS.md'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.diagnostic('symlink assertion skipped because this Windows account lacks privilege');
      return;
    }
    throw error;
  }
  await assert.rejects(captureBaseline({
    root, targetPath: 'AGENTS.md', mode: 'create', docKind: 'agents-md',
  }), /symlink|already exists|regular/);
  assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'sentinel');
});

test('garden signature truncates at 200 Unicode code points', () => {
  const prefix = '😀'.repeat(200);
  const canonical = (contentPreview) => JSON.stringify({
    type: 'thin-doc', path: 'AGENTS.md', content_preview: Array.from(contentPreview).slice(0, 200).join(''),
  });
  const oracle = (contentPreview) => `sha256:${createHash('sha256').update(canonical(contentPreview), 'utf8').digest('hex')}`;
  assert.equal(gardenSignature({ type: 'thin-doc', path: 'AGENTS.md', contentPreview: prefix }), oracle(prefix));
  assert.equal(
    gardenSignature({ type: 'thin-doc', path: 'AGENTS.md', contentPreview: `${prefix}😀` }),
    oracle(prefix),
  );
});

test('garden-ignore validates, merges, truncates, deduplicates, and preserves prior bytes on rejection', async () => {
  const root = await gitProject();
  const contentPreview = `${'😀'.repeat(200)}tail`;
  const first = {
    type: 'thin-doc',
    path: 'AGENTS.md',
    content_preview: contentPreview,
  };
  first.signature = gardenSignature({ type: first.type, path: first.path, contentPreview });
  const added = await appendGardenIgnore({ root, entry: first, now });
  assert.equal(added.added, true);
  assert.equal(added.total, 1);
  const target = join(root, '.deep-docs', 'garden-ignored.json');
  const initial = await readFile(target);
  const persisted = JSON.parse(initial);
  assert.deepEqual(Object.keys(persisted).sort(), ['ignored', 'schema_version']);
  assert.equal(Array.from(persisted.ignored[0].content_preview).length, 200);
  assert.equal(persisted.ignored[0].ignored_at, '2026-07-10T12:00:00Z');
  assert.equal(added.revision, artifactRevision(initial));

  const replay = await appendGardenIgnore({ root, entry: first, now: new Date(now.getTime() + 1000) });
  assert.deepEqual(replay, { added: false, total: 1, revision: added.revision });
  assert.deepEqual(await readFile(target), initial);

  const second = { type: 'dead-reference', path: 'README.md', content_preview: 'x' };
  second.signature = gardenSignature({ type: second.type, path: second.path, contentPreview: 'x' });
  assert.equal((await appendGardenIgnore({ root, entry: second, now })).total, 2);

  const prior = await readFile(target);
  for (const pathValue of ['', '.', '/abs', '../escape', 'a\\b', 'a\0b', 'directory/']) {
    const entry = { type: 'x', path: pathValue, content_preview: 'x', signature: 'sha256:' + '0'.repeat(64) };
    await assert.rejects(appendGardenIgnore({ root, entry, now }), /path|signature/);
    assert.deepEqual(await readFile(target), prior);
  }
  await assert.rejects(appendGardenIgnore({
    root,
    entry: { ...second, signature: 'sha256:' + '0'.repeat(64) },
    now,
  }), /signature/);
  assert.deepEqual(await readFile(target), prior);

  for (const invalidBytes of [
    Buffer.from('{broken'),
    serializeStateJson({ schema_version: 2, ignored: [] }),
    serializeStateJson({ schema_version: 1, ignored: [], unknown: true }),
    serializeStateJson({
      schema_version: 1,
      ignored: [persisted.ignored[0], persisted.ignored[0]],
    }),
  ]) {
    await writeFile(target, invalidBytes);
    await assert.rejects(appendGardenIgnore({ root, entry: second, now }), /garden|schema|keys|unique|JSON/);
    assert.deepEqual(await readFile(target), invalidBytes);
  }
  await writeFile(target, prior);

  const third = { type: 'missing-doc', path: 'CLAUDE.md', content_preview: 'third' };
  third.signature = gardenSignature({ type: third.type, path: third.path, contentPreview: 'third' });
  const externalEdit = Buffer.concat([prior, Buffer.from('external edit')]);
  await assert.rejects(appendGardenIgnore({
    root,
    entry: third,
    now,
    deps: { beforeRename: async () => writeFile(target, externalEdit) },
  }), /changed/);
  assert.deepEqual(await readFile(target), externalEdit);
  await writeFile(target, prior);
});

test('scan invalidation is revision-checked, idempotent, and preserves newer bytes', async () => {
  const emptyRoot = await temporaryRoot('deep docs invalidate absent state ');
  assert.deepEqual(await invalidateScanArtifact({
    root: emptyRoot, expectedRevision: `sha256:${'0'.repeat(64)}`,
  }), { invalidated: false, reason: 'absent', revision: null });
  assert.equal(await lstat(join(emptyRoot, '.deep-docs')).catch((error) => error.code), 'ENOENT');

  const root = await gitProject();
  const first = await fixture(root);
  const firstBytes = await readFile(join(root, '.deep-docs', 'last-scan.json'));
  const expectedRevision = artifactRevision(firstBytes);
  assert.equal((await evaluateReuse({
    artifact: first, artifactBytes: firstBytes, root, pluginRoot, now, pathCheckEnabled: false,
  })).artifact_revision, expectedRevision);
  assert.deepEqual(await invalidateScanArtifact({ root, expectedRevision }), {
    invalidated: true,
    reason: 'matched',
    revision: expectedRevision,
  });
  assert.deepEqual(await invalidateScanArtifact({ root, expectedRevision }), {
    invalidated: false,
    reason: 'absent',
    revision: null,
  });

  await fixture(root, { now: new Date(now.getTime() + 1000), randomBytes: Buffer.alloc(10, 8) });
  const newer = await readFile(join(root, '.deep-docs', 'last-scan.json'));
  const newerRevision = artifactRevision(newer);
  assert.deepEqual(await invalidateScanArtifact({ root, expectedRevision }), {
    invalidated: false,
    reason: 'changed',
    revision: newerRevision,
  });
  assert.deepEqual(await readFile(join(root, '.deep-docs', 'last-scan.json')), newer);
  await assert.rejects(invalidateScanArtifact({ root, expectedRevision: 'SHA256:bad' }), /revision/);
});

test('garden-ignore and scan-invalidate reject symlink targets and observed regular-file swaps', async (t) => {
  const root = await gitProject();
  await fixture(root);
  const state = join(root, '.deep-docs');
  const artifactTarget = join(state, 'last-scan.json');
  const artifactBytes = await readFile(artifactTarget);
  const artifactRevisionValue = artifactRevision(artifactBytes);
  const outside = await temporaryRoot('deep docs mutation outside ');
  const outsideSentinel = join(outside, 'sentinel');
  await writeFile(outsideSentinel, 'outside');

  const ignoreTarget = join(state, 'garden-ignored.json');
  const entry = { type: 'thin-doc', path: 'AGENTS.md', content_preview: 'x' };
  entry.signature = gardenSignature({ type: entry.type, path: entry.path, contentPreview: 'x' });
  try {
    await symlink(outsideSentinel, ignoreTarget, 'file');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.diagnostic('symlink assertion skipped because this Windows account lacks privilege');
      return;
    }
    throw error;
  }
  await assert.rejects(appendGardenIgnore({ root, entry, now }), /symlink|regular/);
  assert.equal(await readFile(outsideSentinel, 'utf8'), 'outside');
  await unlink(ignoreTarget);

  await rename(artifactTarget, `${artifactTarget}.approved`);
  await symlink(outsideSentinel, artifactTarget, 'file');
  await assert.rejects(invalidateScanArtifact({
    root, expectedRevision: artifactRevisionValue,
  }), /symlink|regular/);
  assert.equal(await readFile(outsideSentinel, 'utf8'), 'outside');
  await unlink(artifactTarget);
  await rename(`${artifactTarget}.approved`, artifactTarget);

  await assert.rejects(invalidateScanArtifact({
    root,
    expectedRevision: artifactRevisionValue,
    deps: {
      rename: async () => { throw Object.assign(new Error('busy'), { code: 'EACCES' }); },
      renameRetryDelays: [0, 1],
      sleep: async () => {},
    },
  }), /busy|rename/);
  assert.deepEqual(await readFile(artifactTarget), artifactBytes);

  const newer = Buffer.from('newer artifact bytes\n');
  await assert.rejects(invalidateScanArtifact({
    root,
    expectedRevision: artifactRevisionValue,
    deps: {
      beforeRename: async () => writeFile(artifactTarget, newer),
    },
  }), /changed/);
  assert.deepEqual(await readFile(artifactTarget), newer);
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), '# fixture\n');
});

test('state directory symlink and pre-rename swaps fail without touching outside sentinels', async (t) => {
  const root = await gitProject();
  const outside = await temporaryRoot('deep docs artifact outside ');
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
  await assert.rejects(fixture(root), /symlink|junction/);
  assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'outside');

  await unlink(join(root, '.deep-docs'));
  const artifact = await fixture(root);
  const target = join(root, '.deep-docs', 'last-scan.json');
  const prior = await readFile(target);
  let injected = false;
  await assert.rejects(emitScanArtifact({
    root,
    payload: await validPayload(root),
    pluginRoot,
    now: new Date(now.getTime() + 1000),
    randomBytes: Buffer.alloc(10, 8),
    deps: {
      beforeRename: async () => {
        if (injected) return;
        injected = true;
        await rename(target, `${target}.approved`);
        await symlink(join(outside, 'sentinel'), target, 'file');
      },
    },
  }), /symlink|changed/);
  assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'outside');
  assert.deepEqual(await readFile(`${target}.approved`), prior);
  assert.equal(artifact.envelope.producer, 'deep-docs');
});

test('bounded rename retries transient Windows errors and preserves old state on persistent failure', async () => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    const retryRoot = await gitProject();
    await fixture(retryRoot);
    let attempts = 0;
    await fixture(retryRoot, {
      now: new Date(now.getTime() + 1000),
      randomBytes: Buffer.alloc(10, 8),
      deps: {
        rename: async (...args) => {
          attempts += 1;
          if (attempts < 3) throw Object.assign(new Error('busy'), { code });
          return rename(...args);
        },
        renameRetryDelays: [0, 1, 1, 1],
        sleep: async () => {},
      },
    });
    assert.equal(attempts, 3, code);

    const authorRoot = await temporaryRoot(`deep docs author retry ${code} `);
    const baseline = await captureBaseline({
      root: authorRoot, targetPath: 'CLAUDE.md', mode: 'create', docKind: 'claude-md',
    });
    let authorAttempts = 0;
    assert.deepEqual(await commitAuthoring({
      root: authorRoot,
      baseline,
      draftBody: '# Claude\n',
      preservedBlocks: [],
      docKind: 'claude-md',
      deps: {
        rename: async (...args) => {
          authorAttempts += 1;
          if (authorAttempts === 1) throw Object.assign(new Error('busy'), { code });
          return rename(...args);
        },
        renameRetryDelays: [0, 1, 1],
        sleep: async () => {},
      },
    }), { ok: true });
    assert.equal(authorAttempts, 2, `authoring ${code}`);
  }

  const root = await gitProject();
  await fixture(root);
  const target = join(root, '.deep-docs', 'last-scan.json');
  const stable = await readFile(target);
  await assert.rejects(fixture(root, {
    now: new Date(now.getTime() + 2000),
    randomBytes: Buffer.alloc(10, 9),
    deps: {
      rename: async () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); },
      renameRetryDelays: [0, 1],
      sleep: async () => {},
    },
  }), /busy|rename/);
  assert.deepEqual(await readFile(target), stable);
  assert.deepEqual((await readdir(join(root, '.deep-docs'))).filter((name) => name.endsWith('.tmp')), []);
});

test('pre-open destination swaps and parent-component swaps fail closed with safe cleanup refusal', async (t) => {
  const outside = await temporaryRoot('deep docs injected swap outside ');
  const sentinel = join(outside, 'sentinel');
  await writeFile(sentinel, 'outside');

  const root = await gitProject();
  await fixture(root);
  const target = join(root, '.deep-docs', 'last-scan.json');
  const prior = await readFile(target);
  let privilegeUnavailable = false;
  await assert.rejects(fixture(root, {
    now: new Date(now.getTime() + 1000),
    randomBytes: Buffer.alloc(10, 8),
    deps: {
      beforeTempOpen: async () => {
        await rename(target, `${target}.approved`);
        await symlink(sentinel, target, 'file');
      },
    },
  }), (error) => {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      privilegeUnavailable = true;
      return true;
    }
    return /symlink|regular/.test(error.message);
  });
  if (privilegeUnavailable) {
    t.diagnostic('pre-open swap assertion skipped because this Windows account lacks privilege');
    return;
  }
  assert.equal(await readFile(sentinel, 'utf8'), 'outside');
  assert.deepEqual(await readFile(`${target}.approved`), prior);

  const parentRoot = await gitProject();
  await fixture(parentRoot);
  const state = join(parentRoot, '.deep-docs');
  const movedState = join(parentRoot, '.deep-docs-approved');
  let parentPrivilegeUnavailable = false;
  await assert.rejects(fixture(parentRoot, {
    now: new Date(now.getTime() + 1000),
    randomBytes: Buffer.alloc(10, 9),
    deps: {
      beforeRename: async () => {
        await rename(state, movedState);
        try {
          await symlink(outside, state, process.platform === 'win32' ? 'junction' : 'dir');
        } catch (error) {
          if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
            parentPrivilegeUnavailable = true;
          }
          throw error;
        }
      },
    },
  }), (error) => parentPrivilegeUnavailable || /symlink|junction|changed|root/.test(error.message));
  if (parentPrivilegeUnavailable) {
    t.diagnostic('parent-swap assertion skipped because this Windows account lacks privilege');
    return;
  }
  assert.equal(await readFile(sentinel, 'utf8'), 'outside');
  const leftovers = await readdir(movedState);
  assert.equal(leftovers.some((name) => name.endsWith('.tmp')), true);
  assert.equal(leftovers.includes('.mutation-lock'), true);
});

test('state lock never steals a held owner and succeeds after release', async () => {
  const root = await gitProject();
  const state = join(root, '.deep-docs');
  const lock = join(state, '.mutation-lock');
  await mkdir(lock, { recursive: true });
  await writeFile(join(lock, 'owner'), 'held\n');
  const entry = { type: 'thin-doc', path: 'AGENTS.md', content_preview: 'x' };
  entry.signature = gardenSignature({ type: entry.type, path: entry.path, contentPreview: 'x' });
  await assert.rejects(appendGardenIgnore({
    root,
    entry,
    now,
    deps: { lockRetryDelays: [0, 1], sleep: async () => {} },
  }), (error) => error?.code === 'state-busy');
  assert.equal(await readFile(join(lock, 'owner'), 'utf8'), 'held\n');
  await unlink(join(lock, 'owner'));
  await rmdir(lock);
  assert.equal((await appendGardenIgnore({ root, entry, now })).added, true);
});

test('authoring refuses an observed root-parent swap and never follows the replacement', async (t) => {
  const root = await temporaryRoot('deep docs author parent swap ');
  await writeFile(join(root, 'AGENTS.md'), 'approved user bytes\n');
  const baseline = await captureBaseline({
    root, targetPath: 'AGENTS.md', mode: 'restructure', docKind: 'agents-md',
  });
  const outside = await temporaryRoot('deep docs author replacement ');
  await writeFile(join(outside, 'sentinel'), 'outside');
  const movedRoot = `${root}-approved`;
  roots.add(movedRoot);
  let unavailable = false;
  await assert.rejects(commitAuthoring({
    root,
    baseline,
    draftBody: 'new draft\n',
    preservedBlocks: [],
    docKind: 'agents-md',
    deps: {
      beforeRename: async () => {
        await rename(root, movedRoot);
        try {
          await symlink(outside, root, process.platform === 'win32' ? 'junction' : 'dir');
        } catch (error) {
          if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
            unavailable = true;
          }
          throw error;
        }
      },
    },
  }), (error) => unavailable || /symlink|junction|root|changed/.test(error.message));
  if (unavailable) {
    t.diagnostic('authoring parent-swap assertion skipped because this Windows account lacks privilege');
    return;
  }
  assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'outside');
  assert.equal(await readFile(join(movedRoot, 'AGENTS.md'), 'utf8'), 'approved user bytes\n');
  assert.equal((await readdir(movedRoot)).some((name) => name.endsWith('.tmp')), true);
});
