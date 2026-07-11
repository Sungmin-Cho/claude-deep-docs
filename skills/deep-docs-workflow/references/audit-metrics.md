# Audit Metrics

The metric inputs are `ScanContextV1.documents[].size_lines`, `last_modified_epoch`, `references`, and scanner-classified issue counts. Deterministic values come from `scripts/runtime/scan.js`; audit must not remeasure them with a host-specific alternative.

## 1. Size

`size_lines` is the runtime's logical line count, including a final unterminated line and not adding an extra line for a trailing newline. Strict `>` boundaries align scan warnings with audit scores.

| File | Audit score | Scan warning |
|---|---|---|
| CLAUDE.md / AGENTS.md | `<=100: 10`, `100 < x <= 200: 7`, `>200: 4` | `>100` |
| README.md | `<=300: 10`, `300 < x <= 500: 7`, `>500: 4` | `>300` |
| Other docs | `<=200: 10`, `200 < x <= 400: 7`, `>400: 4` | `>200` |

## 2. Freshness (path-scoped)

Use `references` and runtime-grounded epoch evidence according to `scan-filters/freshness-timestamp.md`. A reference is stale only when a valid target epoch is newer than the containing document's `last_modified_epoch`. Missing paths are excluded from this denominator and remain reference-accuracy findings.

| Stale ratio | Score |
|---|---|
| `<30%` | 10 |
| `30% <= ratio < 70%` | 7 |
| `>=70%` | 4 |
| no measurable valid reference | `null` (exclude from average) |

## 3. Reference accuracy

Measure valid extracted references divided by all extracted references.

- 100%: 10
- 90–99%: 8
- 70–89%: 5
- below 70%: 2

Fenced/indented examples are absent from the runtime reference set and therefore absent from this denominator.

## 4. Duplication

Measure exact duplicate prose blocks outside an intentional translation family.

- 0: 10
- 1–2: 7
- 3 or more: 4

Segment-crossing and merely similar blocks are not counted as exact duplicates.

## 5. Map/manual ratio (audit-only)

An external-pointer line contains a Markdown link, a relative/remote pointer, or an explicit “see/refer” lead. A direct-instruction line is non-empty prose that is not a heading, fence marker, or external pointer.

`external_pointer_lines / (external_pointer_lines + direct_instruction_lines)` is displayed but never scored because the optimum is project-specific.

## Overall score

Average only measurable scored metrics and round to one decimal place with `Math.round(score * 10) / 10`.

| Range | Band |
|---|---|
| `score >= 9.0` | Excellent |
| `7.0 <= score < 9.0` | Good |
| `5.0 <= score < 7.0` | Fair |
| `score < 5.0` | Poor |

Do not replace a missing metric with zero and do not change category thresholds or schema versions while editing metric prose.
