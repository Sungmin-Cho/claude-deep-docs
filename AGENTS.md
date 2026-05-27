# deep-docs - Codex Project Guide

Document gardening agent for agent instruction files and project docs. The repo
keeps Claude Code compatibility and exposes Codex-native manifest metadata.

To check the current version: `jq -r .version .claude-plugin/plugin.json`

> 📄 Documentation in this repo follows `docs/DOCS_RULE.md` (local maintainer guide — single-source-of-truth rules for README / CHANGELOG / this file).

## Runtime Surfaces

- Codex manifest: `.codex-plugin/plugin.json`
- Claude Code manifest: `.claude-plugin/plugin.json`
- User-invocable skill: `skills/deep-docs/SKILL.md`
- Workflow reference skill: `skills/deep-docs-workflow/`
- Scanner agent: `agents/doc-scanner.md`
- Author agent: `agents/doc-author.md` (authoring drafts; Read/Glob/Grep only — no Write/Bash)
- Authoring rules: `skills/deep-docs-workflow/references/authoring-rules/` (CLAUDE/AGENTS/ARCHITECTURE skeletons + cross-doc)
- Scripts: `scripts/validate-envelope-emit.js`, `scripts/verify-fixes.sh`

Scan artifacts such as `.deep-docs/last-scan.json` belong to target projects,
not this plugin repo, unless they are committed test fixtures.

## Verification

```bash
node -e "JSON.parse(require('fs').readFileSync('.codex-plugin/plugin.json','utf8'))"
npm run validate:envelope
npm run verify:fixes
```

After a release, update both suite marketplace manifests in
`/Users/sungmin/Dev/claude-plugins/deep-suite/`.
