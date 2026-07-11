import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const markdownTree = async (root) => {
  const paths = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...await markdownTree(path));
    else if (entry.isFile() && path.endsWith('.md')) paths.push(path);
  }
  return paths;
};

test('Claude, Codex, and package versions are valid and equal', async () => {
  const [claude, codex, pkg] = await Promise.all([
    json('.claude-plugin/plugin.json'), json('.codex-plugin/plugin.json'), json('package.json'),
  ]);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(claude.version, pkg.version);
  assert.equal(codex.version, pkg.version);
  assert.equal(pkg.engines.node, '>=22');
  assert.equal(claude.name, 'deep-docs');
  assert.equal(codex.name, 'deep-docs');
});

test('both plugin manifests intentionally expose no hook or MCP surface', async () => {
  const [claude, codex] = await Promise.all([
    json('.claude-plugin/plugin.json'), json('.codex-plugin/plugin.json'),
  ]);
  assert.equal(codex.skills, './skills/');
  for (const manifest of [claude, codex]) {
    assert.equal(Object.hasOwn(manifest, 'hooks'), false);
    assert.equal(Object.hasOwn(manifest, 'mcpServers'), false);
  }
  await access(resolve(codex.skills, 'deep-docs', 'SKILL.md'));
  await assert.rejects(access('hooks/hooks.json'));
  await assert.rejects(access('.mcp.json'));
});

test('package scripts are the exact Node argv allowlist', async () => {
  const pkg = await json('package.json');
  assert.deepEqual(pkg.scripts, {
    test: 'node --test',
    'validate:envelope': 'node scripts/validate-envelope-emit.js',
    'validate:codex': 'node --test tests/plugin-contract.test.js',
    'verify:fixes': 'node scripts/verify-fixes.js',
  });
});

test('tracked public instructions use the Node version command, not the local jq allowance', async () => {
  const paths = [
    'README.md', 'README.ko.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md',
    ...await markdownTree('agents'),
    ...await markdownTree('skills'),
  ];
  const texts = new Map(await Promise.all(paths.map(async (path) => [path, await readFile(path, 'utf8')])));
  const publicOperationalText = [...texts.values()].join('\n');
  assert.doesNotMatch(publicOperationalText, /\bjq\s+-r\b/);
  const nodeVersionCommand = `node -p "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')).version"`;
  for (const guide of ['AGENTS.md', 'CLAUDE.md']) {
    assert.match(texts.get(guide), new RegExp(nodeVersionCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(texts.get(guide), /docs\/DOCS_RULE\.md/);
  }
});
