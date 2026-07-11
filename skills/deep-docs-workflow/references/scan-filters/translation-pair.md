# Filter: translation-pair

## Purpose and executable source

`translationGroup(relativePath)` in `scripts/runtime/scan.js` is the executable contract. `buildScanContext()` stores the result in `ScanContextV1.documents[].translation_group`.

The group prevents exact prose shared by an intentional translation family from being proposed as an auto-fix duplicate.

## Contract

1. Convert path separators to `/` while preserving the full directory.
2. Match the Markdown suffix case-insensitively.
3. Immediately before `.md`, remove at most one locale suffix from the exact allowlist `ko`, `en`, `ja`, `zh`.
4. Remove the final `.md` suffix.
5. Preserve every other filename segment verbatim.

Only documents whose computed group keys are equal are a translation family. Directory identity is part of the key, so same-basename documents in different directories do not merge.

## Edge matrix

| Relative path | Group |
|---|---|
| `README.md` | `README` |
| `README.ko.md` | `README` |
| `README.EN.md` | `README` |
| `docs/api/README.md` | `docs/api/README` |
| `docs/setup/README.ko.md` | `docs/setup/README` |
| `config.go.md` | `config.go` |
| `install.sh.md` | `install.sh` |
| `README.en-US.md` | `README.en-US` |
| `guide.fr.md` | `guide.fr` |
| Windows-spelled `docs\\guide.ko.md` | `docs/guide` |

The `config.go.md` and `install.sh.md` examples demonstrate that arbitrary two-letter or extension-like segments are not locale suffixes. The two directory examples demonstrate why basename-only grouping is forbidden.

## Duplicate classification

- Equal group plus exact repeated prose: audit-only with translation-family evidence.
- Different groups: apply the ordinary exact-duplicate rule.
- Similar but non-identical content: audit-only regardless of grouping.
- A group key does not imply files exist; it only labels documents already admitted by `scan-context`.

## Safety and integration

The function is pure and performs no filesystem or command work. Scanner code must consume the recorded field and must not introduce a second locale parser or expand the locale allowlist in prose.
