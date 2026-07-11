# Contributing to deep-docs

Thanks for your interest in improving **deep-docs**, the document gardening agent in the
[claude-deep-suite](https://github.com/Sungmin-Cho/claude-deep-suite).

## Development setup

```bash
git clone https://github.com/Sungmin-Cho/claude-deep-docs.git
cd claude-deep-docs
```

Node 22+ is required (ESM project). There are no runtime dependencies; runtime and
verification scripts use Node-only entry points, so no `npm install` is needed.

## Tests

```bash
npm test                    # Node's built-in discovery of every test
npm run validate:envelope   # self-test the M3 last-scan envelope contract
npm run validate:codex      # enforce the Codex plugin manifest contract
npm run verify:fixes        # portable Node release-lint matrix
```

All four commands must be green before you open a pull request. The upstream official
Codex `validate_plugin.py` is an advisory maintainer-only check that may be absent; it is
not a plugin runtime dependency or a cross-platform CI gate.

## Conventions

- **Documentation** follows [`docs/DOCS_RULE.md`](docs/DOCS_RULE.md) (local maintainer
  guide). README is evergreen and bilingual (EN + KO); the CHANGELOG is the single source
  of truth for release notes.
- **CHANGELOG** uses [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) +
  [Semantic Versioning](https://semver.org/spec/v2.0.0.html); add entries to both
  `CHANGELOG.md` and `CHANGELOG.ko.md`.
- **Version triple-sync** — `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, and
  `package.json` must always carry the same version (`verify:fixes` enforces this). Read
  the current manifest version dynamically; the runtime also loads it at emission time.

## Pull requests

1. Branch from `main`.
2. Add your change under the `[Unreleased]` heading in both CHANGELOG files.
3. Keep changes focused, and make sure all four verification commands above pass.
4. Explain what changed and why.

## Reporting issues

Open a GitHub issue. For security reports, see [`SECURITY.md`](SECURITY.md).
