# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.6.1] — 2026-07-21

### Fixed

- **Windows dev-field identity false-positive** (same root cause as [claude-deep-wiki#30](https://github.com/Sungmin-Cho/claude-deep-wiki/issues/30) Issue 1) — on native Windows + Node 22, path-based `lstat` can report `dev: 0n` while fd-based `fstat` reports the real device id for the same file, so the strict `dev` equality in `revalidateOwnedFileIdentity` rejected every owned file and broke all atomic writes (scan artifact saves, authoring commits, and the mutation lock) on that platform.
  - File identity is now `{dev, ino, birthtimeNs}` with an adaptive rule: `ino` always compares strictly; `dev` is the sole strict proof when both sides are nonzero (`birthtimeNs` is never consulted there — some filesystems synthesize it from `ctime`, which the temp-file write changes); when `dev` is not comparable, `birthtimeNs` must be nonzero on both sides and equal, otherwise the check fails closed — an inode alone never proves identity.
  - All three write paths (artifact atomic replace, authoring commit, lock-owner creation) re-capture the identity on the same open fd after the final write + sync, so filesystems that synthesize `birthtime` from `ctime` can no longer self-reject the just-written file or strand `.mutation.lock` in a permanently busy state.
  - Identity tests now build stat values from synthetic bigints instead of host filesystem readings, keeping the suite deterministic on volumes that report a zero device id or no birth time. Two red/green-verified regression tests cover the zero-device birthtime-shift scenario.
- Verified by a 4-round 3-way cross-model review loop (Claude Opus + Codex review + Codex adversarial) converging on unanimous APPROVE; all four gates green (`npm test` 84/84, `validate:envelope`, `validate:codex`, `verify:fixes` Failed: 0).
- No schema change: envelope `1.0` / last-scan payload `1.1` unchanged.

## [1.6.0] — 2026-07-20

### Changed

- **AGENTS-first single-source document policy (D13)** — the default management policy for target projects: shared agent instructions live in `AGENTS.md` (the primary managed document), while `CLAUDE.md` is kept as a thin wrapper — an `@AGENTS.md` import plus Claude Code-specific content only.
  - `scan`: a missing `AGENTS.md` is now also gapped when a root `CLAUDE.md` exists (its shared content is the migration source); a `CLAUDE.md` carrying shared instructions without the `@AGENTS.md` import is a `thin-doc` restructure candidate (D13 wrapper deficit).
  - `garden`: `AGENTS.md` gaps are processed before `CLAUDE.md` gaps in the same session; the `@AGENTS.md` import is inserted only when `AGENTS.md` exists or was committed in that session (no dead imports). Shared content migrates from `CLAUDE.md` to `AGENTS.md` through the existing per-removal approval flow — unapproved migrations are re-inserted (default-keep unchanged). If the `AGENTS.md` draft is rejected, `CLAUDE.md` stays a standalone full document.
  - `doc-author`: new thin-wrapper skeleton for `CLAUDE.md` (target ≤30 lines) with the standalone full-skeleton fallback; symlink coexistence is no longer proposed.
- No schema change: envelope `1.0` / last-scan payload `1.1`, gap fields, and the category trichotomy are unchanged.

## [1.5.0] — 2026-07-10

### Added

- Native Node.js 22 support for scan, reuse, envelope, and authoring safety operations on Windows, macOS, and Linux.
- Codex generic-subagent routing that loads the same scanner and read-only author definitions used by Claude Code.

### Changed

- Release verification now uses a shell-free Node test/lint suite across all three operating systems.

## [1.4.1] — 2026-07-07

### Fixed

- `reuse-cache` — the `can_reuse_scan` reuse guard checked the payload `schema.version` against the stale `1.0` value after the v1.4.0 scan payload moved to `1.1`, so a valid cached scan was always rejected as version-mismatched. The check is re-aligned to `1.1`.
- Step 12-B (scan artifact emit) now self-validates the envelope before writing, so a malformed payload fails closed at emit time instead of being persisted and surfacing later as a corrupt cache.
- Step 12-B write is hardened to an atomic write (temp + rename), so an interrupted emit can no longer leave a half-written `last-scan.json`.

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
