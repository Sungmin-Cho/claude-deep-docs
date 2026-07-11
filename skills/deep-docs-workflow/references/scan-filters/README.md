# Scan Filters

이 디렉터리는 scanner가 사용하는 heuristic의 설명과 안전 불변식을 보존한다. 실행 가능한 단일 진실원본은 Node `scripts/runtime/scan.js`와 그 호출자 `scripts/deep-docs-runtime.js`다. Reference 문서는 대체 구현이 아니며 agent가 별도 스크립트로 실행해서는 안 된다.

## 설계 원칙

1. **One executable contract**: discovery, CommonMark segmentation, reference extraction, translation grouping, Git ignore filtering, timestamps, package scripts, and worktree hashing은 `scan-context`가 한 번 계산한다.
2. **No shell interpolation**: Git은 argv 배열과 `shell: false`로 호출하고 path lists는 NUL-delimited bytes로 처리한다.
3. **Fail closed**: malformed Git output, unsafe paths, symlink transitions, ambiguous ignore results, and mid-scan mutations are operational errors rather than partial facts.
4. **Portable bytes and paths**: UTF-8 decoding is fatal, Windows/UNC roots are serialized by the runtime, and repository-relative paths use `/` in the contract.
5. **Semantic separation**: scanner Read/Glob/Grep classification consumes `ScanContextV1`; it does not re-run deterministic filesystem or Git algorithms.

## Source mapping

| Reference | Executable Node source |
|---|---|
| `translation-pair.md` | `translationGroup(relativePath)` |
| `code-fence.md` | `splitNonFencedSegments(text)` |
| `reference-extraction.md` | `extractReferences(text)` and `ScanContextV1.documents[].references` |
| `cli-whitelist.md` | `ScanContextV1.package_scripts`, `BUILTINS_MAP`, `SYSTEM_COMMAND_WHITELIST`, optional explicit path-check flag |
| `worktree-hash.md` | `computeWorktreeHash(root)` and its length-prefixed/NUL-safe stream |
| `freshness-timestamp.md` | runtime `lastModifiedEpoch(...)` and `documents[].last_modified_epoch` |

## Scan order

1. `scan-context` validates the physical root and guarded state directory.
2. Runtime discovers static document candidates and applies `filterDocumentCandidatesByGitIgnore()`.
3. Runtime reads each regular non-symlink document, calls `translationGroup()`, `extractReferences()`, and timestamp/line-count logic.
4. Runtime records package scripts, dirty source projection, Git facts, and worktree hash.
5. Scanner applies semantic scan rules to that immutable result and calls `emit` through the shared runtime.

## Change policy

- Behavior changes start in Node tests and executable source, then update these references.
- A reference must not retain an executable alternative whose semantics can drift.
- Schema or category changes require the governing migration, plan gate, and all consumers; none are implied by a prose cleanup.
