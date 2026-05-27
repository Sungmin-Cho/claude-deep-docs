# Contributing to deep-docs

Thanks for your interest in improving **deep-docs**, the document gardening agent in the
[claude-deep-suite](https://github.com/Sungmin-Cho/claude-deep-suite).

## Development setup

```bash
git clone https://github.com/Sungmin-Cho/claude-deep-docs.git
cd claude-deep-docs
```

Node 20+ is required (ESM project). There are no runtime dependencies — the verification
scripts run on `node` and `bash` with standard utilities, so no `npm install` is needed.

## Tests

```bash
npm run validate:envelope   # node — self-test the M3 last-scan envelope contract
npm run verify:fixes        # bash — grep-based release-lint (spec conformance)
```

Both must be green before you open a pull request. There is no `npm test` aggregate
runner; run the two scripts above.

## Conventions

- **Documentation** follows [`docs/DOCS_RULE.md`](docs/DOCS_RULE.md) (local maintainer
  guide). README is evergreen and bilingual (EN + KO); the CHANGELOG is the single source
  of truth for release notes.
- **CHANGELOG** uses [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) +
  [Semantic Versioning](https://semver.org/spec/v2.0.0.html); add entries to both
  `CHANGELOG.md` and `CHANGELOG.ko.md`.
- **Version triple-sync** — `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, and
  `package.json` must always carry the same version (`verify:fixes` enforces this). When
  the `last-scan` schema changes, bump the envelope `producer_version` to match.

## Pull requests

1. Branch from `main`.
2. Add your change under the `[Unreleased]` heading in both CHANGELOG files.
3. Keep changes focused, and make sure `npm run validate:envelope` and
   `npm run verify:fixes` both pass.
4. Explain what changed and why.

## Reporting issues

Open a GitHub issue. For security reports, see [`SECURITY.md`](SECURITY.md).
