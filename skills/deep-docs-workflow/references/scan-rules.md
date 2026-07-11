# Scan Rules — Auto-fix, Authoring, Audit-only

This file fixes classification semantics. Executable discovery and reference facts come from `scripts/runtime/scan.js`; semantic evidence is gathered with scanner Read/Glob/Grep only.

## Executable candidate scope

`buildScanContext()` statically discovers:

1. every non-symlink `CLAUDE.md` and `AGENTS.md` outside excluded/state trees;
2. root `README.md`, `CONTRIBUTING.md`, and `ARCHITECTURE.md`;
3. Markdown under `docs/`.

It then calls `filterDocumentCandidatesByGitIgnore()`:

- in HEAD/unborn Git repositories, tracked candidates are retained even if later ignore rules match;
- untracked candidates are sent as NUL-delimited bytes to `git check-ignore --stdin -z`, which applies repository, nested, exclude, and global Git rules;
- unexpected status, unknown returned path, inconsistent records, malformed bytes, or Git disappearance fails closed;
- in the explicit `non-git` or missing-Git fallback, static candidates remain admitted and the runtime does not partially interpret ignore syntax itself.

Every admitted document is rechecked as a regular non-symlink file before reading. Scanner never broadens this set with a second discovery implementation.

## Rule-to-agent mapping

| Rule | Scanner phase | Category |
|---|---|---|
| 1 dead reference | reference validation | auto-fix only with exact evidence |
| 2 moved path | runtime `rename-history` | auto-fix only with exact Git rename record |
| 3 stale example/command | CLI/env semantic validation | conditional auto-fix |
| 4 duplicate instruction | segment-local exact match + translation group | conditional auto-fix |
| 5 size/organization | `documents[].size_lines` | audit-only |
| 6 rule/code contradiction | semantic inference | audit-only |
| 7 coverage gap | semantic inference | audit-only and Rule 9 input |
| 8 map/manual ratio | semantic inference | audit-only |
| 9 missing/thin document | root-only authoring guards | authoring |

## Auto-fix rules

### 1. Dead reference

A runtime-extracted path, symbol, environment variable, or command is absent from the actual repository facts. Fenced/indented examples were already excluded. Current issue fields are `current_value` and `suggested_value`; emit an auto-fix only when `suggested_value` is exact, otherwise emit audit-only evidence.

### 2. Moved path

For a normalized dead path, call `rename-history` through the shared runtime. It uses argv-only Git rename records and returns an empty history for Git-missing, non-Git, and unborn roots. An exact returned successor permits auto-fix. Empty or ambiguous history never permits a guessed replacement.

### 3. Stale example/command

Use `scan-filters/cli-whitelist.md`, `ScanContextV1.package_scripts`, and repository configuration evidence. A missing exact project script with a known replacement can be auto-fixed. Unknown future/system commands, code examples without an exact replacement, and ambiguous environment variables are audit-only.

### 4. Duplicate instruction

Use `splitNonFencedSegments()` output and exact 3-line-or-longer windows that stay within one prose segment. An exact block outside a common `translation_group` can be auto-fixed. Translation-family repetition and merely similar blocks are audit-only.

## Audit-only rules

### 5. Size/organization

Strict warning boundaries are CLAUDE/AGENTS `>100`, README `>300`, other docs `>200`. Organization requires structural judgment and is never an automatic split.

### 6. Rule/code contradiction

Report sampled contradictory patterns with evidence. Inference and false-positive risk forbid automatic mutation.

### 7. Coverage gap

Report important modules not represented in documentation. Retain `uncovered_modules[]` for Rule 9; do not scan twice or convert the report itself into an edit.

### 8. Map/manual ratio

Report direct-instruction versus external-pointer proportions without a target score.

## Authoring rule

### 9. Missing/thin root document

Only root `CLAUDE.md`, `AGENTS.md`, and `ARCHITECTURE.md` qualify.

- Missing CLAUDE/AGENTS requires both a recognized build manifest and a source directory; severity medium.
- Missing ARCHITECTURE requires approximately 10k or more source lines; severity high.
- Thin documents are conservative: required-section deficit meets the authoring-rule threshold or Rule 7's `uncovered_modules[] / total_modules` meets its threshold; severity low to medium.
- A Git-ignored target is excluded. Monorepo package-local targets are deferred to v2.
- `missing-doc` requires `exists: false` and `mode: "create"`.
- `thin-doc` requires `exists: true` and `mode: "restructure"`.
- `doc_kind` must map exactly to the root target allowlist.

Scanner emits only a `payload.gaps[]` authoring specification. Drafting is read-only `doc-author` work; approved replacement is guarded by `authoring-baseline` then `authoring-commit`.

## Stable output contract

- Document issues remain in `payload.documents[].issues[]`.
- Authoring gaps remain in `payload.gaps[]` and do not increment `summary.total_issues`.
- Categories remain the auto-fix / authoring / audit-only trichotomy.
- Envelope schema `"1.0"` and last-scan payload schema `"1.1"` remain unchanged.
