import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function copyPlugin() {
  const sandbox = await mkdtemp(join(tmpdir(), 'deep docs verifier path with spaces '));
  const destination = join(sandbox, 'plugin under test');
  await cp(source, destination, {
    recursive: true,
    filter(path) {
      const first = relative(source, path).split(sep)[0];
      return !new Set(['.git', '.deep-review', 'docs']).has(first);
    },
  });
  return realpath(destination);
}

const verify = (cwd) => spawnSync(process.execPath, ['scripts/verify-fixes.js'], {
  cwd,
  encoding: 'utf8',
  shell: false,
  windowsHide: true,
});

test('portable verifier passes from a copied path containing spaces', async () => {
  const cwd = await copyPlugin();
  const result = verify(cwd);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Failed: 0/);
});

test('runtime executes when both plugin root and target root contain spaces', async () => {
  const cwd = await copyPlugin();
  const target = await mkdtemp(join(tmpdir(), 'deep docs target root with spaces '));
  await writeFile(join(target, 'README.md'), '# target\n');
  const result = spawnSync(process.execPath, [
    join(cwd, 'scripts', 'deep-docs-runtime.js'),
    'scan-context', '--root', target,
  ], { cwd: target, encoding: 'utf8', shell: false, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).documents[0].path, 'README.md');
});

test('portable verifier fails closed on version drift', async () => {
  const cwd = await copyPlugin();
  const path = join(cwd, 'package.json');
  const pkg = JSON.parse(await readFile(path, 'utf8'));
  pkg.version = '0.0.0';
  await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`);
  const result = verify(cwd);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /version sync/);
});

for (const mutation of [
  'powershell -NoProfile -Command "Write-Output mutation"',
  'cmd /d /s /c "echo mutation"',
]) {
  test(`portable verifier rejects a ${mutation.split(' ')[0]} package-script mutation`, async () => {
    const cwd = await copyPlugin();
    const path = join(cwd, 'package.json');
    const pkg = JSON.parse(await readFile(path, 'utf8'));
    pkg.scripts.test = mutation;
    await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`);
    const result = verify(cwd);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /package script allowlist/);
  });
}

test('portable verifier rejects a re-added producer_version literal in an agent', async () => {
  const cwd = await copyPlugin();
  const path = join(cwd, 'agents', 'doc-scanner.md');
  const original = await readFile(path, 'utf8');
  await writeFile(path, `${original}\n  "producer_version": "1.4.1",\n`);
  const result = verify(cwd);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /no producer-version literal/);
});
