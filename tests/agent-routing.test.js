import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');

test('entry skill has explicit Claude and Codex routes for both agents', async () => {
  const skill = await read('skills/deep-docs/SKILL.md');
  assert.match(skill, /Claude Code[\s\S]+deep-docs:doc-scanner/);
  assert.match(skill, /Codex[\s\S]+agents\/doc-scanner\.md[\s\S]+generic subagent/i);
  assert.match(skill, /Claude Code[\s\S]+deep-docs:doc-author/);
  assert.match(skill, /Codex[\s\S]+agents\/doc-author\.md[\s\S]+generic subagent/i);
});

test('Codex author route is explicitly read-only and scanner writes only state artifacts', async () => {
  const skill = await read('skills/deep-docs/SKILL.md');
  assert.match(skill, /doc-author[\s\S]+no terminal[\s\S]+no write/i);
  assert.match(skill, /doc-scanner[\s\S]+\.deep-docs\/[\s\S]+only/i);
});

test('supported runtime instructions use Node and do not require POSIX helpers', async () => {
  const files = await Promise.all([
    read('agents/doc-scanner.md'),
    read('skills/deep-docs/SKILL.md'),
    read('skills/deep-docs-workflow/SKILL.md'),
  ]);
  const runtimeText = files.join('\n');
  assert.match(runtimeText, /scripts\/deep-docs-runtime\.js/);
  for (const forbidden of ['```bash', 'mkdir -p', 'python3', 'shasum -a 1', 'stat -f', 'stat -c', 'find docs', 'wc -l', 'xargs ', 'bash scripts/']) {
    assert.equal(runtimeText.includes(forbidden), false, `supported path contains ${forbidden}`);
  }
});

test('garden state mutations use only the guarded runtime commands', async () => {
  for (const path of ['skills/deep-docs/SKILL.md', 'skills/deep-docs-workflow/SKILL.md']) {
    const text = await read(path);
    assert.match(text, /garden-ignore/);
    assert.match(text, /scan-invalidate/);
    assert.match(text, /host must not directly write garden-ignored\.json or delete last-scan\.json/i);
  }
});
