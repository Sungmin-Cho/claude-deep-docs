# Filter: freshness-timestamp

## Purpose and executable source

The internal Node `lastModifiedEpoch(...)` path in `scripts/runtime/scan.js` is the executable contract. `buildScanContext()` records its result as `ScanContextV1.documents[].last_modified_epoch`; scanner and audit consumers must use that field rather than invoke platform-specific metadata tools.

## Timestamp contract

For every admitted regular document:

1. Read filesystem mtime and floor it to integer epoch seconds.
2. If Git is missing, the root is non-Git, or the repository is unborn, return filesystem epoch.
3. In a repository with HEAD, request the latest commit epoch for the exact repository-relative path through argv-only Git.
4. If the document has no commit record, return filesystem epoch.
5. If the path is in the runtime's deterministic dirty projection, return `max(filesystem_epoch, git_epoch)`.
6. If the path is clean, return Git epoch even when checkout mtime is newer.

Git disappearance, nonzero unexpected status, non-decimal output, symlink/non-file transition, or metadata-read failure is an operational error. The runtime never substitutes a platform guess.

## Why dirty-only mtime matters

A clean clone gives files a checkout-time mtime newer than their last commit. Taking an unconditional max would make every clean document appear newly updated. Restricting mtime to dirty paths preserves commit chronology while still reflecting an uncommitted edit.

All comparisons use numeric epoch seconds. Locale-formatted dates and lexicographic sorting are outside the contract.

## Freshness score

The semantic scanner compares only available, runtime-grounded timestamps:

- a valid referenced target newer than the document is stale;
- missing references are dead-reference inputs and are excluded from freshness denominator;
- if target timestamp evidence is unavailable in the immutable context, do not probe with an alternate host command; omit that comparison and report the metric as unmeasurable when no valid comparison remains.

Score values remain exactly `{10, 7, 4, null}`:

| `stale_count / valid_total_refs` | Score |
|---|---|
| `< 0.30` | 10 |
| `0.30 <= ratio < 0.70` | 7 |
| `>= 0.70` | 4 |
| no measurable valid references | `null` |

## Edge matrix

| Case | Result |
|---|---|
| clean committed document | Git epoch |
| dirty committed document | numeric max of Git epoch and mtime |
| admitted untracked/unborn document | filesystem epoch |
| non-Git document | filesystem epoch |
| clean checkout with newer mtime | Git epoch, avoiding false freshness |
| no commit record | filesystem epoch |
| malformed Git timestamp | operational failure |
| missing reference | excluded from freshness denominator |
| no measurable target timestamps | `null` metric |

## Ownership

`scan-context` owns timestamp acquisition and dirty-path semantics. Scanner prose may explain the score, but must not preserve a second metadata/Git implementation or claim evidence it did not receive.
