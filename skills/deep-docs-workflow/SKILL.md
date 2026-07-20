---
name: deep-docs-workflow
description: |
  deep-docs 플러그인의 코어 워크플로우. scan/garden/audit 서브커맨드의
  동작을 정의하고, 스캔 결과의 분류(auto-fix vs audit-only)를 가이드한다.
user-invocable: false
---

# Deep Docs Workflow

`/deep-docs`가 이 계약을 로드한다. 결정적 discovery, Git, timestamp, hash, envelope, baseline, atomic mutation의 단일 진실원본은 `scripts/deep-docs-runtime.js`와 `scripts/runtime/`이다.

## Mandatory host routing

Resolve `<plugin-root>` from the loaded skill, not from the target cwd or an environment variable. Runtime invocations use `node "<plugin-root>/scripts/deep-docs-runtime.js" ...`.

| Work | Claude Code | Codex |
|---|---|---|
| scan / re-scan | `Task(subagent_type="deep-docs:doc-scanner", ...)` | A generic subagent first reads `<plugin-root>/agents/doc-scanner.md`; grant read/search, terminal limited to the quoted Node command, and writes to `<target-root>/.deep-docs/` only. |
| draft authoring | `Task(subagent_type="deep-docs:doc-author", ...)` | A generic subagent first reads `<plugin-root>/agents/doc-author.md`; grant read/search only, no terminal and no write/edit/patch capability. |

If generic subagents are unavailable, run the loaded definition inline with identical limits and disclose degraded dispatch. The author never owns a mutation.

## Runtime boundary

`scan-context --root "<target-root>"` creates an absent state directory through the shared guarded Node path and returns `ScanContextV1`. Request commands use a direct JSON basename under `.deep-docs/`: `rename-history`, `reuse`, `emit`, `authoring-baseline`, `authoring-commit`, `signature`, `garden-ignore`, and `scan-invalidate`.

The host must not directly write garden-ignored.json or delete last-scan.json. There is no direct-write fallback after a runtime error.

## References

- `references/scan-rules.md`: fixed classification, root-only authoring guards, and scanner mapping.
- `references/audit-metrics.md`: score definitions over Node-produced fields.
- `references/scan-filters/`: executable Node source/field mappings and edge contracts.

## Scan

1. Run `scan-context`; do not duplicate its filesystem or Git work.
2. Dispatch the scanner route with the immutable context and quoted runtime command.
3. The scanner performs semantic classification with Read/Glob/Grep, may use `rename-history` for a dead path, writes only `.deep-docs/scan-payload-request.json`, and calls `emit`.
4. Consume the returned artifact plus `artifact_revision`. Report auto-fix issues, authoring gaps, and audit-only issues separately. An empty document set still runs missing-doc guards.

## Garden

1. Call `reuse`. It validates `envelope.producer === "deep-docs"`, `envelope.artifact_kind === "last-scan"`, `envelope.schema.name === "last-scan"`, `schema_version === "1.0"`, and `envelope.schema.version === "1.1"` before TTL, path-check, HEAD, and worktree facts. Freeze the exact reusable artifact/revision; a false result dispatches scanner and freezes its newly emitted pair. Non-Git sessions intentionally re-scan before freezing their pair.
2. Issue decisions use the canonical 4+2 flow: A apply, B skip, C skip-and-record, and Batch followed by D apply-same-type or E skip-same-type. C calls `signature`, then `garden-ignore`; it never writes state directly.
3. A/D ordinary project-document edits are applied only by the main garden session after showing the diff.
4. For each authoring gap, call `authoring-baseline` before dispatching `doc-author`. Process an `AGENTS.md` gap before a `CLAUDE.md` gap (AGENTS-first single source, authoring-rules D13); the `@AGENTS.md` import is inserted only when `AGENTS.md` exists or was committed this session. Preserve unapproved removals, verify `preserved_blocks`, show the whole draft, and call `authoring-commit` only after approval. The host performs no second write or patch.
5. If an A/D edit or authoring commit succeeded, call `scan-invalidate` exactly once with the frozen revision. `matched`, `changed`, and `absent` are all reported according to the runtime result. B/C/E-only sessions do not invalidate.
6. Show audit-only items after the actionable flow; do not silently promote them to edits.

## Audit

1. Use the same reuse/re-scan route and immutable snapshot rule.
2. Score only `documents[].size_lines`, `last_modified_epoch`, `references`, and scanner-classified counts according to `references/audit-metrics.md`.
3. Average measurable scored metrics, round to one decimal place, and include audit-only observations. Audit does not mutate state or documents.

## Invariants

- Scanner writes are bounded to `.deep-docs/`; discovered project documents are read-only to it.
- Author is read/search-only on every host and returns `{ draft_body, preserved_blocks, removal_candidates }`.
- Baseline capture precedes author dispatch; whole-draft approval precedes `authoring-commit`.
- Envelope `schema_version` remains `"1.0"`; last-scan payload schema remains `"1.1"`.
- Do not change size/freshness thresholds, root-only missing/thin guards, or the auto-fix/authoring/audit-only trichotomy.
