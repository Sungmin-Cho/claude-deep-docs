# deep-docs - Codex Project Guide

Document gardening agent for agent instruction files and project docs. The repo
keeps Claude Code compatibility and exposes Codex-native manifest metadata.

To check the current version: `node -p "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')).version"`

> 📄 Documentation in this repo follows `docs/DOCS_RULE.md` (local maintainer guide — single-source-of-truth rules for README / CHANGELOG / this file).

## Runtime Surfaces

- Codex manifest: `.codex-plugin/plugin.json`
- Claude Code manifest: `.claude-plugin/plugin.json`
- User-invocable skill: `skills/deep-docs/SKILL.md`
- Workflow reference skill: `skills/deep-docs-workflow/`
- Scanner agent: `agents/doc-scanner.md`
- Author agent: `agents/doc-author.md` (authoring drafts; Read/Glob/Grep only — no Write/Bash)
- Authoring rules: `skills/deep-docs-workflow/references/authoring-rules/` (CLAUDE/AGENTS/ARCHITECTURE skeletons + cross-doc)
- Runtime entry: `scripts/deep-docs-runtime.js`
- Runtime modules: `scripts/runtime/`
- Validation scripts: `scripts/validate-envelope-emit.js`, `scripts/verify-fixes.js`

Scan artifacts such as `.deep-docs/last-scan.json` belong to target projects,
not this plugin repo, unless they are committed test fixtures.

## Verification

```bash
npm test
npm run validate:envelope
npm run validate:codex
npm run verify:fixes
```

`npm run validate:codex` is the enforceable Codex manifest contract. The
upstream official Codex `validate_plugin.py`, when installed, is an advisory
maintainer-only check; it may be absent and is not part of the plugin runtime or
the cross-platform test suite.

After a release, update both suite marketplace manifests in
`/Users/sungmin/Dev/claude-plugins/deep-suite/`.
