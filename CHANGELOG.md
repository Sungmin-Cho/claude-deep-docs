# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.4.0] — 2026-05-28

### Added

- **Document authoring** — deep-docs now creates or restructures missing/thin agent-instruction documents. `scan` detects gaps (a missing `CLAUDE.md`/`AGENTS.md`/`ARCHITECTURE.md`, or one that falls short of its official skeleton); `garden` spawns a new `doc-author` agent that drafts the document from a code analysis, then applies it after a per-removal approval flow.
- `payload.gaps[]` in the scan artifact — records authoring specs (`doc_kind`, `target_path`, `mode`) separately from existing-document metrics, so empty/new repositories surface an authoring backlog.

### Changed

- `scan` now works on empty projects — instead of exiting when no documents are found, it records absent recommended documents as `missing-doc` gaps (subject to a build-manifest / size guard; ignored paths are excluded).
- `garden` gained an authoring sub-flow: it drafts via `doc-author` (read-only), keeps user-written content by default (unapproved removals are re-inserted), and writes only after a fail-closed safety check.
- `envelope.schema.version` for the scan payload bumped `1.0` → `1.1` (the top-level envelope `schema_version` stays `1.0`).

## [1.3.1] — 2026-05-18 (Codex-native plugin manifest and AGENTS guide)

### Added

- `.codex-plugin/plugin.json` — Codex-native plugin manifest pointing at the same skill and hook surfaces as the Claude Code manifest.
- `AGENTS.md` — Codex project guide covering runtime surfaces, verification commands, and the suite marketplace update requirement.

### Changed

- README now documents Codex compatibility alongside the existing Claude Code surface.

## [1.3.0] — 2026-05-18

### Changed

- `/deep-docs` is now a `user-invocable` skill instead of a slash command. Claude Code users keep typing `/deep-docs scan|garden|audit`; Codex, Copilot CLI, and Gemini CLI users invoke `Skill({ skill: "deep-docs:deep-docs", args: "scan|garden|audit" })` for the same workflow.

### Removed

- `commands/deep-docs.md` (replaced by `skills/deep-docs/SKILL.md`).

## [1.2.1] — 2026-05-13

### Changed

- Reclassified `size-warning` as `audit-only` — it has no `current → suggested` replacement pair, so it is reported, never auto-fixed.
- Garden prompt redesigned to a 4-option first prompt plus a 2-option batch follow-up, within the `AskUserQuestion` 4-item limit.

### Fixed

- The CLI `$PATH`-check toggle now invalidates the scan-artifact reuse guard instead of silently corrupting it.

## [1.2.0] — 2026-05-07

### Changed

- `.deep-docs/last-scan.json` is now wrapped in the claude-deep-suite M3 cross-plugin envelope (top-level `schema_version`, `envelope`, and `payload` blocks). This is a breaking change to the artifact shape; the 10-minute TTL absorbs the migration, so no upgrade tooling is needed.
- The `garden` / `audit` reuse guard is now envelope-aware: it matches `schema_version`, `envelope.schema.version`, the 10-minute window, `envelope.git.head`, and `payload.provenance.worktree_hash`.

### Added

- Non-git environments emit a sentinel `envelope.git` (`head: "0000000"`, `branch: "HEAD"`, `dirty: "unknown"`).

## [1.1.0] — 2026-04-17

### Added

- Heuristic scan filters: translation-pair grouping, CommonMark code-fence detection, reference extraction, CLI whitelist, worktree hashing, and freshness timestamps.
- `.deep-docs/garden-ignored.json` — permanent signature-based skip list for rejected fixes.
- Garden batch approval / rejection prompt.

### Changed

- `.deep-docs/last-scan.json` `schema_version` 1 → 2, with issue fields renamed (`reference` → `current_value`, `suggestion` → `suggested_value`); v1.0 artifacts auto-regenerate.
- Audit scoring switched from integer bands to one-decimal scores with strict inequalities (`≥ 9.0`, `7.0 ≤ score < 9.0`, `5.0 ≤ score < 7.0`, `< 5.0`).
- Scan-artifact reuse now also checks the uncommitted worktree, not just HEAD SHA + TTL.

### Removed

- `hooks/hooks.json` — no active hook at this version.

### Fixed

- Translation-pair JSON examples (e.g. `README.md` ↔ `README.ko.md`) are no longer misflagged as duplicates and proposed for deletion.
- System commands such as `git log -1`, `find`, and `wc` are no longer misflagged as stale CLI examples.
- Audit scores after a garden fix are recomputed instead of reusing the stale artifact.
- macOS compatibility for hashing and `stat` (`shasum -a 1`; `stat -c` / `stat -f` fallback).

### Security

- Removed `xargs -I{} sh -c` from worktree-hash computation, closing a remote-code-execution vector through malicious filenames.

## [1.0.0] — 2026-04-08

### Added

- `/deep-docs scan` — detect dead references, moved paths, stale examples, and duplicates.
- `/deep-docs garden` — apply auto-fixable issues after user confirmation.
- `/deep-docs audit` — quantitative document-quality report with path-scoped freshness.
- doc-scanner agent.

### Changed

- Stale Examples and Duplicated Instructions are conditional auto-fixes (CLI/env vars and 100%-identical blocks only; code examples and near-duplicates are audit-only).
- Scan artifact records provenance (HEAD SHA, branch) for safe reuse.

### Fixed

- Excluded `node_modules/`, `vendor/`, `dist/`, `build/`, and `__pycache__/` from scan scope.
- Added a non-git environment path and a clear zero-document fallback message.
