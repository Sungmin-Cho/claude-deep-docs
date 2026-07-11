# Filter: worktree-hash

## Purpose and executable source

`computeWorktreeHash(root)` and its internal streaming implementation in `scripts/runtime/scan.js` are the executable contract. `scan-context` records the result as `ScanContextV1.worktree_hash`; `emit` copies it into payload provenance and `reuse` recomputes it.

The hash detects tracked, staged, and untracked source-projection changes that a HEAD-plus-TTL check would miss. `.deep-docs` state is deliberately excluded so artifact creation does not invalidate itself.

## Repository states

- Missing Git or non-Git root: return `hash: "no-git"` with explicit repository state. Reuse remains intentionally false for non-Git sessions.
- Repository with HEAD: hash the raw binary diff against HEAD plus every non-ignored untracked projected file.
- Unborn repository: hash the sorted cached-and-untracked source snapshot with an explicit unborn domain marker.
- Unexpected Git failure or malformed output: fail closed; do not return a partial hash.

## Source projection

Every Git invocation receives the literal pathspec projection `.` excluding `.deep-docs` and `.deep-docs/**`. Git is spawned with argv elements, `shell: false`, binary output, and a bounded buffer.

Path lists use NUL-terminated bytes. The decoder requires:

- a final NUL when output is non-empty;
- fatal UTF-8 decoding;
- no empty record;
- repository-relative, non-escaping paths;
- no state-tree path.

No filename is interpolated into a command string. Newlines, spaces, quotes, semicolons, dollar signs, and Unicode are data rather than executable syntax.

## Canonical stream

The SHA-1 stream is domain-separated and unambiguous:

1. HEAD mode prefixes the exact tracked binary diff with its byte length.
2. Unborn mode prefixes an explicit unborn marker.
3. Projected paths are de-duplicated and sorted by UTF-8 byte order.
4. Each path is appended as ASCII byte-length, separator, UTF-8 bytes, then NUL.
5. Each file contribution is a Git-compatible blob SHA-1 appended with the same length-prefixed/NUL-safe framing.

Regular files are streamed in bounded chunks and their observed byte count must equal the pre-read size. Symlink contributions hash the link bytes rather than following the target. Missing paths have an explicit missing-domain hash. Directories, special files, root escapes, and mid-read changes fail closed.

The final value is a lowercase 40-hex SHA-1 because it is a compatibility identity, not a password or signature.

## Reuse contract

For a Git artifact, `reuse` requires all of these facts to match:

- valid deep-docs envelope identity and schema;
- TTL within 600 seconds;
- path-check setting;
- current HEAD;
- freshly computed source-projection worktree hash.

Tracked or staged changes to `.deep-docs` do not alter the projection. Any real source edit, deletion, symlink-byte change, or admitted untracked source does.

## Edge matrix

| Case | Result |
|---|---|
| clean HEAD repository | stable 40-hex hash |
| staged source edit | changed hash |
| unstaged source edit | changed hash |
| admitted untracked source | changed hash |
| ignored untracked file | excluded by Git |
| artifact/request update under `.deep-docs` | unchanged hash |
| newline or shell metacharacter in filename | encoded as NUL-delimited data |
| symlink source | link bytes hashed, target not followed |
| source changes during streaming | operational failure |
| malformed/non-NUL Git list | operational failure |
| missing Git/non-Git | `no-git` |
| unborn repository | deterministic unborn snapshot |

## Ownership

Scanner and host instructions must consume the recorded value and must not retain an alternative command pipeline. All changes to this contract require Node tests covering byte framing, filenames, Git states, projection exclusions, and reuse behavior.
