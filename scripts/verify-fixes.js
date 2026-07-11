#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { validateEnvelopeFile, validateEnvelopeObject } from './validate-envelope-emit.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => resolve(REPO_ROOT, ...parts);
const read = (...parts) => readFileSync(at(...parts), 'utf8');
const json = (...parts) => JSON.parse(read(...parts));

function markdownTreeText(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return markdownTreeText(path);
    return entry.isFile() && path.endsWith('.md') ? [readFileSync(path, 'utf8')] : [];
  });
}

function frontmatter(text) {
  return text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)?.[1] ?? '';
}

const claude = json('.claude-plugin', 'plugin.json');
const codex = json('.codex-plugin', 'plugin.json');
const pkg = json('package.json');
const scanner = read('agents', 'doc-scanner.md');
const scannerFrontmatter = frontmatter(scanner);
const author = read('agents', 'doc-author.md');
const authorFrontmatter = frontmatter(author);
const skill = read('skills', 'deep-docs', 'SKILL.md');
const workflow = read('skills', 'deep-docs-workflow', 'SKILL.md');
const runtimeSource = read('scripts', 'deep-docs-runtime.js');
const scanSource = read('scripts', 'runtime', 'scan.js');
const stateSource = read('scripts', 'runtime', 'state.js');
const authoringSource = read('scripts', 'runtime', 'authoring.js');
const validatorSource = read('scripts', 'validate-envelope-emit.js');
const scanRules = read('skills', 'deep-docs-workflow', 'references', 'scan-rules.md');
const auditMetrics = read('skills', 'deep-docs-workflow', 'references', 'audit-metrics.md');
const scanTests = read('tests', 'runtime-scan.test.js');
const artifactTests = read('tests', 'runtime-artifact.test.js');
const changelog = read('CHANGELOG.md');
const agentsGuide = read('AGENTS.md');
const claudeGuide = read('CLAUDE.md');
const contributing = read('CONTRIBUTING.md');
const nodeVersionCommand = `node -p "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')).version"`;
const publicOperationalText = [
  read('README.md'),
  read('README.ko.md'),
  agentsGuide,
  claudeGuide,
  contributing,
  ...markdownTreeText(at('agents')),
  ...markdownTreeText(at('skills')),
].join('\n');

const expectedScripts = {
  test: 'node --test',
  'validate:envelope': 'node scripts/validate-envelope-emit.js',
  'validate:codex': 'node --test tests/plugin-contract.test.js',
  'verify:fixes': 'node scripts/verify-fixes.js',
};

const checks = [];
const check = (name, predicate) => checks.push({ name, predicate });

check('version sync', () => /^\d+\.\d+\.\d+$/.test(pkg.version)
  && claude.version === codex.version
  && codex.version === pkg.version);
check('matching CHANGELOG version heading', () => changelog.includes(`## [${pkg.version}]`));
check('private Node 22 ESM package', () => pkg.private === true
  && pkg.type === 'module'
  && pkg.engines?.node === '>=22');
check('package script allowlist', () => isDeepStrictEqual(pkg.scripts, expectedScripts));
check('legacy shell verifier removed', () => !existsSync(at('scripts', 'verify-fixes.sh')));
check('.deep-docs remains ignored', () => /^\.deep-docs\/$/m.test(read('.gitignore')));

check('no hook or MCP declaration', () => !Object.hasOwn(claude, 'hooks')
  && !Object.hasOwn(claude, 'mcpServers')
  && !Object.hasOwn(codex, 'hooks')
  && !Object.hasOwn(codex, 'mcpServers')
  && !existsSync(at('hooks', 'hooks.json'))
  && !existsSync(at('.mcp.json')));
check('Codex skills entry resolves', () => codex.skills === './skills/'
  && existsSync(at(codex.skills, 'deep-docs', 'SKILL.md')));

check('doc-scanner bounded write contract', () => /^\s*-\s*Write\s*$/m.test(scannerFrontmatter)
  && scanner.includes('.deep-docs/scan-payload-request.json')
  && scanner.includes('.deep-docs/last-scan.json')
  && scanner.includes('only')
  && /project documents[^\n]+(?:never|절대)[^\n]+edit|발견한 project documents를 절대 편집/i.test(scanner));
check('Codex generic scanner route', () => skill.includes('agents/doc-scanner.md')
  && /generic subagent/i.test(skill));
check('Codex generic author route', () => skill.includes('agents/doc-author.md')
  && /no terminal/i.test(skill));
check('guarded garden state routes', () => [skill, workflow].every((text) => text.includes('garden-ignore')
  && text.includes('scan-invalidate')
  && /host must not directly write garden-ignored\.json or delete last-scan\.json/i.test(text)));
check('nine-command runtime allowlist', () => [
  'scan-context', 'rename-history', 'reuse', 'emit', 'authoring-baseline',
  'authoring-commit', 'signature', 'garden-ignore', 'scan-invalidate',
].every((name) => runtimeSource.includes(`'${name}'`) || runtimeSource.includes(`"${name}"`)));

const filterRoot = at('skills', 'deep-docs-workflow', 'references', 'scan-filters');
const filterNames = [
  'translation-pair', 'code-fence', 'reference-extraction',
  'cli-whitelist', 'worktree-hash', 'freshness-timestamp',
];
check('six Node scan-filter references exist', () => filterNames.every((name) =>
  existsSync(resolve(filterRoot, `${name}.md`))));
const filterText = Object.fromEntries(filterNames.map((name) => [
  name, read('skills', 'deep-docs-workflow', 'references', 'scan-filters', `${name}.md`),
]));
check('scanner and rules name Node source of truth', () => scanner.includes('scripts/runtime/scan.js')
  && scanRules.includes('scripts/runtime/scan.js')
  && filterText['code-fence'].includes('splitNonFencedSegments')
  && filterText['reference-extraction'].includes('extractReferences')
  && filterText['translation-pair'].includes('translationGroup')
  && filterText['cli-whitelist'].includes('ScanContextV1.package_scripts')
  && filterText['worktree-hash'].includes('computeWorktreeHash')
  && filterText['freshness-timestamp'].includes('lastModifiedEpoch'));
check('standard Git document-ignore projection', () => scanSource.includes('filterDocumentCandidatesByGitIgnore')
  && scanSource.includes('check-ignore')
  && scanRules.includes('tracked')
  && scanRules.includes('NUL-delimited')
  && scanRules.includes('check-ignore --stdin -z')
  && scanRules.includes('non-git'));
check('canonical physical ScanContext root', () => scanSource.includes('contextRootFromRealPath')
  && stateSource.includes('realpath')
  && stateSource.includes('isAbsolute')
  && !/root\s*:\s*['"]\.['"]/.test(scanSource));
check('runtime root/path tests cover physical and Windows forms', () =>
  scanTests.includes('assert.equal(result.root, await realpath(root))')
  && scanTests.includes('assert.equal(isAbsolute(result.root), true)')
  && scanTests.includes('context root representation preserves injected Windows drive and UNC physical paths')
  && scanTests.includes("const drive = 'C:\\\\Temp\\\\Deep Docs\\\\프로젝트'")
  && scanTests.includes("const unc = '\\\\\\\\server\\\\share\\\\Deep Docs\\\\프로젝트'")
  && scanTests.includes("'docs/guide/README.ko.md'")
  && scanTests.includes("'docs/한글 문서.md'"));

check('portable authoring baseline digest', () => authoringSource.includes('content_digest')
  && authoringSource.includes("createHash('sha256')")
  && authoringSource.includes('const SHA256_RE = /^sha256:[a-f0-9]{64}$/')
  && authoringSource.includes("'content_digest', 'contract_version', 'doc_kind', 'exists', 'mode', 'target_path'")
  && authoringSource.includes("'claude-md': 'CLAUDE.md'")
  && authoringSource.includes("'agents-md': 'AGENTS.md'")
  && authoringSource.includes("'architecture-md': 'ARCHITECTURE.md'")
  && !authoringSource.includes('git_blob_sha1')
  && !authoringSource.includes('git hash-object'));
check('authoring matrix covers Git, non-Git, and missing Git', () =>
  artifactTests.includes('authoring target matrix uses raw-byte SHA-256')
  && artifactTests.includes("createHash('sha256').update(raw).digest('hex')")
  && artifactTests.includes('non-Git authoring remains byte-based when Git is absent from PATH')
  && artifactTests.includes('const root = await gitProject()')
  && artifactTests.includes('authoring validates exact BaselineV1')
  && artifactTests.includes("content_digest: 'sha256:ABC'")
  && artifactTests.includes('git_blob_sha1'));
const authoringRulesRoot = at('skills', 'deep-docs-workflow', 'references', 'authoring-rules');
check('authoring rules retain hard contracts', () =>
  ['README.md', 'claude-md.md', 'agents-md.md', 'architecture-md.md'].every((name) =>
    existsSync(resolve(authoringRulesRoot, name)))
  && readFileSync(resolve(authoringRulesRoot, 'claude-md.md'), 'utf8').includes('200')
  && /32 ?KiB/.test(readFileSync(resolve(authoringRulesRoot, 'agents-md.md'), 'utf8'))
  && readFileSync(resolve(authoringRulesRoot, 'architecture-md.md'), 'utf8').includes('Codemap'));

check('doc-author read/search-only frontmatter', () => ['Read', 'Glob', 'Grep'].every((tool) =>
  new RegExp(`^\\s*-\\s*${tool}\\s*$`, 'm').test(authorFrontmatter))
  && !/^\s*-\s*(?:Write|Bash)\s*$/m.test(authorFrontmatter));
check('both agents document Codex capability equivalence', () => /Codex[\s\S]+generic/i.test(scanner)
  && /Codex[\s\S]+generic subagent/i.test(author));
check('no producer-version literal remains in agents', () =>
  !/"?producer_version"?\s*[:=]\s*["']?\d/.test(`${scanner}\n${author}`));

check('freshness scale and bands preserved', () => !/"freshness_score"\s*:\s*6/.test(publicOperationalText)
  && ((scanner.includes('0.30') && scanner.includes('0.70'))
    || (auditMetrics.includes('30%') && auditMetrics.includes('70%'))));
check('audit excellent band remains >= 9.0', () => auditMetrics.includes('score >= 9.0'));
check('size warnings retain strict greater-than thresholds', () => scanRules.includes('>100')
  && scanRules.includes('>300')
  && scanRules.includes('>200'));
check('current issue fields replace legacy example fields', () => scanner.includes('current_value')
  && scanner.includes('suggested_value')
  && !/"reference"\s*:\s*"src\//.test(scanner)
  && !/"suggestion"\s*:/.test(scanner));

check('garden ignored-signature and choice contract', () => skill.includes('Garden-ignore schema contract')
  && skill.includes('sha256:<64 lowercase hex>')
  && ['A: apply', 'B: skip', 'C: skip', 'Batch:', 'D apply', 'E skip'].every((label) =>
    skill.includes(label))
  && skill.includes('signature')
  && skill.includes('garden-ignore'));
check('garden approval and preservation contract', () => skill.includes('4+2')
  && skill.includes('preserved_blocks')
  && skill.includes('removal_candidates')
  && /whole final draft/i.test(skill)
  && /Before dispatching `doc-author`, call `authoring-baseline`/.test(skill)
  && /Only after approval call `authoring-commit`/.test(skill));
check('garden mutations use revision guards', () => skill.includes('garden-ignore')
  && skill.includes('scan-invalidate')
  && skill.includes('artifact_revision')
  && /exactly once with the frozen snapshot's `artifact_revision`/.test(skill)
  && /B\/C\/E/.test(skill)
  && [skill, workflow].every((text) =>
    /host must not directly write garden-ignored\.json or delete last-scan\.json/i.test(text)));

check('payload schema copies stay 1.1', () => scanner.includes('"version": "1.1"')
  && skill.includes('envelope.schema.version === "1.1"')
  && workflow.includes('envelope.schema.version === "1.1"'));
check('wrapper schema stays 1.0', () => scanner.includes('"schema_version": "1.0"'));
check('validator keeps wrapper and payload schema guards', () =>
  validatorSource.includes("data.schema_version !== '1.0'")
  && validatorSource.includes("env.schema?.version !== '1.1'"));

check('tracked public instructions are Node-only', () => !/\bjq\s+-r\b/.test(publicOperationalText)
  && [agentsGuide, claudeGuide].every((text) => text.includes(nodeVersionCommand)
    && text.includes('docs/DOCS_RULE.md')));
check('official Codex validator remains advisory', () => [agentsGuide, claudeGuide, contributing].every((text) =>
  /validate_plugin\.py/.test(text)
  && /advisory/i.test(text)
  && /may be absent/i.test(text)
  && /not\s+(?:part\s+of|a)\s+(?:the\s+)?plugin\s+runtime/i.test(text)));

const pluginVersion = claude.version;
const fixture = json('tests', 'fixtures', 'sample-last-scan.json');
const cloneFixture = () => JSON.parse(JSON.stringify(fixture));
const rejectedAfter = (mutate) => {
  const value = cloneFixture();
  mutate(value);
  return validateEnvelopeObject(value, pluginVersion).length > 0;
};
check('positive envelope validates directly', () =>
  validateEnvelopeFile(at('tests', 'fixtures', 'sample-last-scan.json')).length === 0);
check('three negative envelopes fail directly', () => [
  'sample-last-scan-invalid-gap.json',
  'sample-last-scan-invalid-summary.json',
  'sample-last-scan-bad-summary-counts.json',
].every((name) => validateEnvelopeFile(at('tests', 'fixtures', name)).length > 0));
check('envelope rejects non-object root matrix without throwing', () =>
  [null, 'text', 1, true, []].every((value) => isDeepStrictEqual(
    validateEnvelopeObject(value, pluginVersion),
    ['root must be a plain object'],
  )));
check('envelope identity and strict scalar contracts reject drift', () =>
  rejectedAfter((value) => { value.envelope.producer = 'other'; })
  && rejectedAfter((value) => { value.envelope.artifact_kind = 'other'; })
  && rejectedAfter((value) => { value.envelope.schema.name = 'other'; })
  && rejectedAfter((value) => { value.envelope.producer_version = '01.2.3'; })
  && rejectedAfter((value) => { value.envelope.run_id = 'INVALID'; })
  && rejectedAfter((value) => { value.envelope.generated_at = 'not-a-time'; })
  && rejectedAfter((value) => { value.envelope.git.head = 'not-a-head'; })
  && rejectedAfter((value) => { value.envelope.git.branch = ''; })
  && rejectedAfter((value) => { value.envelope.git.dirty = 'yes'; })
  && rejectedAfter((value) => { value.unknown = true; })
  && rejectedAfter((value) => { value.envelope.git.unknown = true; })
  && rejectedAfter((value) => { value.envelope.provenance.unknown = true; })
  && rejectedAfter((value) => { value.envelope.provenance.source_artifacts[0].unknown = true; })
  && rejectedAfter((value) => { value.envelope.provenance.tool_versions = []; }));
check('envelope summary and authoring invariants reject drift', () =>
  rejectedAfter((value) => { value.payload.summary.total_issues += 1; })
  && rejectedAfter((value) => { value.payload.gaps[0].unknown = true; })
  && rejectedAfter((value) => { value.payload.gaps[0].type = 'other'; })
  && rejectedAfter((value) => { value.payload.gaps[0].target_path = 'docs/ARCHITECTURE.md'; })
  && rejectedAfter((value) => { value.payload.gaps[0].authoring_spec.mode = 'restructure'; })
  && rejectedAfter((value) => { value.payload.gaps[0].exists = true; }));

const envelopeCli = spawnSync(process.execPath, [at('scripts', 'validate-envelope-emit.js')], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
  shell: false,
  windowsHide: true,
});
check('envelope fixture CLI passes with current Node', () => envelopeCli.status === 0
  && /matches deep-docs M3 envelope contract/.test(envelopeCli.stdout));

let passed = 0;
let failed = 0;
for (const { name, predicate } of checks) {
  try {
    if (predicate()) {
      process.stdout.write(`✓ ${name}\n`);
      passed += 1;
    } else {
      process.stdout.write(`✗ ${name}\n`);
      failed += 1;
    }
  } catch (error) {
    const message = String(error?.message ?? error).replace(/[\r\n]+/g, ' ').trim();
    process.stdout.write(`✗ ${name}${message ? `: ${message}` : ''}\n`);
    failed += 1;
  }
}

process.stdout.write(`---\nPassed: ${passed}  Failed: ${failed}\n`);
if (failed > 0) process.exitCode = 1;
