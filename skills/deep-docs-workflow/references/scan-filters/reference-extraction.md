# Filter: reference-extraction

## Purpose and executable source

`extractReferences(text)` in `scripts/runtime/scan.js` is the executable contract. `buildScanContext()` stores its normalized output in `ScanContextV1.documents[].references`; the scanner consumes those records rather than re-parsing documents.

Each record is `{ kind, value, line }`, where `kind` is `path`, `cli`, `env`, or `symbol` and `line` is the original one-based document line.

## Ordered extraction contract

1. Call `splitNonFencedSegments()`. Fenced lines never reach later rules.
2. Ignore a returned line beginning with a tab or at least four spaces (indented code).
3. For every inline-code span, trim the contents and inspect the first whitespace-delimited token first:
   - if the first token is in `CLI_BINARIES`, emit the entire inline value as `cli`, including spaces;
   - otherwise a value containing whitespace is not a path/symbol/env candidate;
   - a shell-style uppercase variable emits `env` without its marker/braces;
   - a safe relative-path candidate emits `path` with `/` separators;
   - a single identifier or call-like identifier emits `symbol`.
4. Extract bare environment-variable references outside inline-code spans without duplicating inline matches.
5. Extract relative Markdown-link destinations. HTTP, mail, and anchor targets are excluded; spaces are allowed in a link destination when the normalized relative path remains safe.
6. `buildScanContext()` resolves path references relative to the containing document and drops any result that escapes the repository.

The CLI-first branch is mandatory. It ensures a value such as an executable plus arguments reaches CLI classification instead of being discarded merely because it contains spaces.

## Relative-path contract

A path candidate must:

- be non-empty and contain no forbidden whitespace for inline code;
- not be HTTP, mail, or anchor syntax;
- not be POSIX absolute, Windows drive/UNC absolute, or traversal outside the root;
- not contain glob metacharacters;
- either contain a path separator or end in a recognized source/document/config extension;
- retain query/fragment text in its displayed value while extension classification examines the suffix-free portion.

Path normalization uses repository-relative `/` separators. Absolute and escaping references are not converted into host paths.

## Edge matrix

| Source | Result |
|---|---|
| inline relative source path | `path` |
| inline command plus arguments whose first token is known | one `cli` record with full value |
| inline unknown text containing spaces | excluded |
| inline uppercase environment variable | `env` |
| bare uppercase environment variable outside inline code | `env` |
| inline `ClassName` or `functionName()` | `symbol` |
| relative Markdown link with a space | normalized `path` when safe |
| URL, mail link, or anchor | excluded |
| fenced example | excluded by `splitNonFencedSegments()` |
| four-space/tab indented example | excluded |
| Windows absolute or root-escaping link | excluded |

## Safety and failure behavior

- Extraction is pure; no path is opened and no command is executed here.
- Inline spans are tracked by source ranges so a variable is not emitted twice.
- UTF-8 document reads and symlink/regular-file guards are owned by `buildScanContext()`.
- Semantic validation uses Read/Glob/Grep after extraction. A missing reference is not automatically a safe edit; exact replacement evidence is still required.

## Integration

- `cli` records use `cli-whitelist.md` and `ScanContextV1.package_scripts`.
- `path` records feed existence, freshness, and optional `rename-history` evidence.
- The scanner must not weaken these rules or restore a second parser.
