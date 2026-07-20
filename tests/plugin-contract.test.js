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

const assertNode22ThreeOsWorkflow = (workflow) => {
  assert.equal(
    workflow.split('        os: [ubuntu-latest, macos-latest, windows-latest]').length - 1,
    1,
    'CI must use the exact three-OS matrix',
  );
  assert.equal(
    workflow.split('    runs-on: ${{ matrix.os }}').length - 1,
    1,
    'CI must run each job on the selected matrix OS',
  );
  assert.equal(
    workflow.split('      - uses: actions/setup-node@v4').length - 1,
    1,
    'CI must pin actions/setup-node@v4',
  );
  assert.equal(
    workflow.split('          node-version: 22').length - 1,
    1,
    'CI must pin Node.js 22',
  );
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

test('release train is 1.6.0', async () => {
  const [claude, codex, pkg, ...fixtures] = await Promise.all([
    json('.claude-plugin/plugin.json'),
    json('.codex-plugin/plugin.json'),
    json('package.json'),
    json('tests/fixtures/sample-last-scan.json'),
    json('tests/fixtures/sample-last-scan-invalid-gap.json'),
    json('tests/fixtures/sample-last-scan-invalid-summary.json'),
    json('tests/fixtures/sample-last-scan-bad-summary-counts.json'),
  ]);
  assert.equal(claude.version, '1.6.0');
  assert.equal(codex.version, '1.6.0');
  assert.equal(pkg.version, '1.6.0');
  assert.deepEqual(fixtures.map((fixture) => fixture.envelope.producer_version), Array(4).fill('1.6.0'));
  for (const fixture of fixtures) {
    assert.deepEqual(fixture.envelope.provenance.tool_versions, { node: 'v22.0.0' });
  }
});

test('security contract states the enforceable containment boundary', async () => {
  const security = await readFile('SECURITY.md', 'utf8');
  assert.match(security, /lstat[\s\S]+realpath[\s\S]+symlink[\s\S]+junction/i);
  assert.match(security, /same-user[\s\S]+dirfd[\s\S]+openat[\s\S]+residual/i);
  assert.doesNotMatch(security, /race[- ]proof|can never escape|absolute safety/i);
  // SECURITY.md is a tracked public operator instruction (Global Constraints supported surface),
  // so on the jq-free / native-Windows release it must not instruct a jq version check and must
  // use the same Node manifest read as the maintainer guides.
  assert.doesNotMatch(security, /\bjq\s+-r\b/);
  assert.match(security, /JSON\.parse\(require\('fs'\)\.readFileSync\('\.claude-plugin\/plugin\.json','utf8'\)\)\.version/);
});

test('public support claims name native Windows without an unverified release', async () => {
  const paths = [
    'README.md', 'README.ko.md', 'AGENTS.md', 'CLAUDE.md',
    'SECURITY.md', 'CHANGELOG.md', 'CHANGELOG.ko.md',
  ];
  const texts = new Map(await Promise.all(
    paths.map(async (path) => [path, await readFile(path, 'utf8')]),
  ));
  for (const [path, text] of texts) {
    assert.doesNotMatch(text, /Windows\s*11/i, `${path} must not claim an unverified Windows release`);
  }
  for (const path of ['README.md', 'README.ko.md', 'AGENTS.md', 'CLAUDE.md']) {
    assert.match(texts.get(path), /native Windows/i, `${path} must state native Windows support`);
  }
});

test('bilingual install docs use supported marketplace and runtime commands', async () => {
  const readmes = new Map(await Promise.all(
    ['README.md', 'README.ko.md'].map(async (path) => [path, await readFile(path, 'utf8')]),
  ));
  const installCommands = [
    'claude plugin marketplace add Sungmin-Cho/claude-deep-suite',
    'claude plugin install deep-docs@claude-deep-suite',
    'codex plugin marketplace add Sungmin-Cho/claude-deep-suite',
    'codex plugin add deep-docs@claude-deep-suite',
  ];
  const runtimeCommands = [
    '/deep-docs scan',
    '/deep-docs garden',
    '/deep-docs audit',
    '$deep-docs:deep-docs scan',
    '$deep-docs:deep-docs garden',
    '$deep-docs:deep-docs audit',
  ];

  for (const [path, readme] of readmes) {
    assert.doesNotMatch(readme, /\bcodex plugin install\b/, `${path} must not advertise a nonexistent Codex command`);
    assert.doesNotMatch(readme, /\bclaude plugin add\b/, `${path} must not advertise a nonexistent Claude command`);
    for (const command of installCommands) {
      assert.equal(readme.split(command).length - 1, 1, `${path} must document ${command} exactly once`);
    }
    for (const command of runtimeCommands) {
      assert.match(readme, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  }
});

test('CI blocks on three OSes and explicit pwsh and cmd acceptance', async () => {
  const workflow = (await readFile('.github/workflows/ci.yml', 'utf8')).replace(/\r\n?/g, '\n');
  assertNode22ThreeOsWorkflow(workflow);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/i);

  for (const command of [
    'npm test',
    'npm run validate:envelope',
    'npm run validate:codex',
    'npm run verify:fixes',
  ]) {
    assert.equal(workflow.split(`      - run: ${command}`).length - 1, 1, `${command} must be blocking once`);
  }

  const focused = 'node --test tests/runtime-scan.test.js tests/runtime-cli.test.js tests/runtime-artifact.test.js';
  for (const shell of ['pwsh', 'cmd']) {
    const block = [
      `      - name: Windows focused acceptance (${shell})`,
      "        if: runner.os == 'Windows'",
      `        shell: ${shell}`,
      `        run: ${focused}`,
    ].join('\n');
    assert.equal(workflow.split(block).length - 1, 1, `${shell} acceptance must be explicit and unique`);
  }
});

test('CI platform contract rejects version, action, runner, and matrix drift', async () => {
  const workflow = (await readFile('.github/workflows/ci.yml', 'utf8')).replace(/\r\n?/g, '\n');
  for (const [from, to] of [
    ['          node-version: 22', '          node-version: 20'],
    ['      - uses: actions/setup-node@v4', '      - uses: actions/setup-node@v3'],
    ['    runs-on: ${{ matrix.os }}', '    runs-on: ubuntu-latest'],
    ['        os: [ubuntu-latest, macos-latest, windows-latest]', '        os: [ubuntu-latest, macos-latest]'],
  ]) {
    const mutated = workflow.replace(from, to);
    assert.notEqual(mutated, workflow, `mutation precondition missing: ${from}`);
    assert.throws(() => assertNode22ThreeOsWorkflow(mutated));
  }
});
