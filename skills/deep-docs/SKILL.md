---
name: deep-docs
description: Use when the user wants to scan, garden, or audit project agent-instruction documents (CLAUDE.md / AGENTS.md / README.md). Triggers on `/deep-docs`, "scan documents", "garden CLAUDE.md", "audit docs", "document health", "stale docs", "문서 정비", "문서 스캔", "문서 감사", "문서 가드닝". Detects dead refs, moved paths, duplicate blocks, stale examples; auto-fixes via 4-option AskUserQuestion (apply / skip / skip+record / batch); reports audit-only items separately.
user-invocable: true
---

# deep-docs — Document Gardening

에이전트 지침 문서의 건강 상태를 scan, garden, audit 합니다. 결정적 파일시스템·Git·envelope 작업의 단일 진실원본은 `scripts/deep-docs-runtime.js`와 `scripts/runtime/`입니다.

## Host routing (mandatory)

Resolve `<plugin-root>` from this loaded skill's location; do not derive it from the target project's cwd and do not require an environment variable. Invoke runtime commands as `node "<plugin-root>/scripts/deep-docs-runtime.js" ...`.

| Work | Claude Code | Codex |
|---|---|---|
| scan / automatic re-scan | `Task(subagent_type="deep-docs:doc-scanner", ...)` | Spawn a generic subagent whose first action is to read `<plugin-root>/agents/doc-scanner.md`, then treat it as the execution contract. Give read/search, bounded state-file write, and terminal capabilities; writes are permitted to `<target-root>/.deep-docs/` only and terminal use is limited to the quoted Node runtime command. |
| authoring draft | `Task(subagent_type="deep-docs:doc-author", ...)` | Spawn a generic subagent whose first action is to read `<plugin-root>/agents/doc-author.md`, then treat it as the execution contract. Give read/search only, no terminal, no write, edit, or apply-patch capability, and require the same structured result. |

If generic subagents are unavailable, execute the loaded definition inline with the same capability limits and disclose the degraded dispatch. Never silently grant `doc-author` terminal or mutation capability. Preserve baseline-before-author ordering and whole-draft approval in every host.

## Runtime ownership (mandatory)

- `scan-context --root "<target-root>"` performs physical-root validation, creates an absent `.deep-docs/` only through the shared Node mkdir-then-lstat guard, and returns deterministic discovery, reference, timestamp, Git, package-script, dirty-path, and worktree facts.
- All other commands consume an exact JSON request basename under `<target-root>/.deep-docs/` via `--request <basename>`.
- `emit` owns version lookup, envelope construction and validation, atomic replacement of `last-scan.json`, and the returned `artifact_revision`.
- `reuse`, `authoring-baseline`, `authoring-commit`, `signature`, `garden-ignore`, and `scan-invalidate` are the only supported operations for their corresponding state transitions.
- The host must not directly write garden-ignored.json or delete last-scan.json.
- Runtime errors are visible failures. Do not replace them with a direct filesystem fallback.

## Inputs

- `scan`, `garden`, or `audit` as the single subcommand.
- An empty or unknown argument requires the user to choose one of those three operations.
- `<target-root>` is the target project's requested root, never the plugin installation root.

## `/deep-docs scan`

1. Run the quoted Node runtime command with `scan-context --root "<target-root>"`. Add `--path-check-enabled` only when the user explicitly opts into host-dependent executable lookup.
2. Dispatch `doc-scanner` through the mandatory host-routing table. Pass the immutable `ScanContextV1`, `<target-root>`, `<plugin-root>`, and the exact quoted runtime command. The scanner uses Read/Glob/Grep for semantic classification and follows `references/scan-rules.md`.
3. The scanner may call `rename-history` for a dead-path candidate. Git-missing, non-Git, and unborn repositories yield an empty history; no agent guesses a successor.
4. The scanner writes only `.deep-docs/scan-payload-request.json`, then invokes `emit --root "<target-root>" --request scan-payload-request.json`. Consume the returned artifact and `artifact_revision`; never synthesize envelope fields in prose.
5. Report the three categories without conflation:
   - `payload.documents[].issues[]` with `category: "auto-fix"`;
   - `payload.gaps[]` with `category: "authoring"`;
   - issues with `category: "audit-only"`.

An empty document set is not an early exit. The scanner still evaluates root-only missing-doc guards for `CLAUDE.md`, `AGENTS.md`, and `ARCHITECTURE.md`; if no guard is met, report that no recommended document qualifies.

## Shared reuse contract for garden and audit

1. Write a bounded request containing `artifact_path: ".deep-docs/last-scan.json"` and the literal `path_check_enabled` flag only when enabled, then call `reuse` through the quoted Node runtime. The runtime validates `envelope.producer === "deep-docs"`, `envelope.artifact_kind === "last-scan"`, `envelope.schema.name === "last-scan"`, `schema_version === "1.0"`, and `envelope.schema.version === "1.1"` before TTL, path-check, HEAD, and worktree facts.
2. A reusable result supplies both an immutable artifact snapshot and its `artifact_revision`. Freeze that exact payload/revision pair for the entire session.
3. Any `{ "reusable": false }` response dispatches the scanner route. Consume the newly emitted artifact and revision rather than retaining the rejected artifact.
4. Non-Git reuse intentionally returns false; after re-scan, garden still freezes the new payload/revision pair for the current session.

## `/deep-docs garden`

### Issue decisions

Process only auto-fix issues as edits. `size-warning`, rule/code contradictions, coverage gaps, and map/manual observations remain audit-only.

For each issue, show the proposed diff and use the canonical 4+2 choice flow:

- A: apply this issue;
- B: skip once;
- C: skip and record;
- Batch: ask a second two-option question, D apply the remaining same-type issues or E skip them.

D/E state is in-memory for this invocation only. A/D project-document edits remain owned by the main garden session. C is never a direct state write: call `signature` with the exact issue fields, then pass that exact result plus source fields to `garden-ignore`. A mutation failure must remain visible.

### Authoring decisions

For every frozen `payload.gaps[]` item, keep the following order:

1. Before dispatching `doc-author`, call `authoring-baseline` with the exact root-only `{ target_path, mode, doc_kind }`. This captures create absence or restructure bytes through the runtime.
2. Dispatch `doc-author` through the mandatory host-routing table. It returns `{ draft_body, preserved_blocks, removal_candidates }` and cannot mutate anything.
3. Ask separately about every removal candidate. Reinsert every unapproved removal at its anchor, defaulting to preservation.
4. Verify every `preserved_blocks` value occurs in the final draft. Show the whole final draft for approval in both create and restructure modes. A rejection performs no mutation.
5. Only after approval call `authoring-commit` with the original baseline, final draft, preserved blocks, and doc kind. The runtime immediately revalidates the baseline, target allowlist, symlink/ignore boundary, and the AGENTS.md UTF-8 32 KiB ceiling before atomic replacement.
6. The host session must not perform a second Write or patch of that document.
7. For an optional authoring-gap C decision, obtain `signature` and call `garden-ignore` exactly as for an issue.

Cross-document pointers are added only when their target already exists or was approved and committed in this same session. Coexistence through a symlink or import is a proposal requiring separate approval, never an implicit mutation.

### Completion and invalidation

If at least one A/D project-document edit or one `authoring-commit` succeeded, call `scan-invalidate` exactly once with the frozen snapshot's `artifact_revision`:

- `matched`: that exact snapshot was invalidated;
- `changed`: preserve the newer artifact and report that it superseded the session snapshot;
- `absent`: idempotent success.

A session containing only B/C/E decisions does not invalidate the scan. The host never unlinks the artifact directly.

## Garden-ignore schema contract

The runtime owns schema version 1 and computes records with these fields:

```json
{
  "schema_version": 1,
  "ignored": [
    {
      "signature": "sha256:<64 lowercase hex>",
      "type": "dead-reference",
      "path": "CLAUDE.md",
      "content_preview": "src/auth/middleware.ts",
      "ignored_at": "2026-04-17T10:05:00Z"
    }
  ]
}
```

The `signature` command computes SHA-256 from `type`, `path`, and the first 200 Unicode code points of `content_preview`. For missing-doc, use the doc kind as preview; for thin-doc, use the existing document's first 200 code points. Do not hand-compute or hand-merge this file.

## `/deep-docs audit`

1. Obtain and freeze a snapshot through the shared reuse contract; automatic re-scan uses the scanner host route.
2. Use `documents[].size_lines`, `last_modified_epoch`, and `references` from the Node-produced context plus scanner-classified issue counts. Do not reimplement filesystem or Git measurements in the host.
3. Apply `references/audit-metrics.md` exactly: size, freshness, reference accuracy, duplication, and map/manual ratio. Average only measurable scored metrics and round to one decimal place.
4. Report per-document values, the overall band, recommendations, and audit-only observations. Audit never mutates project documents or state artifacts.

## Stable classification and schema invariants

- Auto-fix: dead reference, moved path with exact Git evidence, stale command with a known replacement, and exact duplicate block outside a translation family.
- Audit-only: size/organization, inferred contradiction, coverage gap, map/manual ratio, and uncertain command replacement.
- Authoring: root-only missing/thin `CLAUDE.md`, `AGENTS.md`, or `ARCHITECTURE.md` after the documented manifest/source, size, coverage, and ignore guards.
- Top-level envelope `schema_version` remains `"1.0"`; last-scan payload schema remains `"1.1"`. Do not change scoring thresholds, gap guards, the category trichotomy, or schema versions in this workflow.

## No-argument behavior

Ask which operation to perform: scan, garden, or audit. Do not infer a mutating garden operation from an empty argument.
