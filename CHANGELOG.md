# Changelog

## [1.2.1] - 2026-05-13

### Fixed
Plugin-dev validator round-1 followup — 8 fixes addressing 4 MEDIUM + 4 LOW findings on v1.2.0. No schema change; v1.2.0 envelope contract preserved (cross-plugin consumers unaffected).

- **M-1**: `size-warning` 을 `audit-only` 로 재분류 — garden `current_value → suggested_value` diff template 과 부합하지 않는 UX 모순 제거. `payload.documents[].issues[].category: "audit-only"` 로 emit. 5개 파일(commands · agent · scan-rules · README · README.ko) 동기화.
- **M-2**: `agents/doc-scanner.md` Step 12-A bash recipe 가 `path_check_enabled` 를 조건부로 emit — `PATH_CHECK_EMIT` 변수 추가. cli-whitelist `$PATH` 토글 ON 일 때 envelope reuse-guard silent corruption 차단.
- **M-3**: `doc-scanner` agent description 에 `<example>` 블록 2개 (initial scan + envelope-guard-failed re-scan) 추가. `whenToUse` internal-spawn-only 정책 보존.
- **M-4**: Garden 의 5지선다 prompt 을 **canonical 4+sub-prompt** 구조로 재설계 — `AskUserQuestion` schema 의 `options.maxItems: 4` 한계 준수. 1차 `(A)/(B)/(C)/(Batch)` + Batch 선택 시 2차 `(D)/(E)`.
- **L-1**: `plugin.json` 에 `repository` 필드 추가.
- **L-3**: `tests/fixtures/sample-last-scan.json` `envelope.git.head` 를 7-hex `abc1234` 로 통일 (README + agent 예시와 일치).
- **L-4**: `SKILL.md` garden Step 3.b 를 4+sub-prompt 구조로 동기화 (M-4 와 짝).
- **L-5**: `commands/deep-docs.md` Prerequisites 문구 정정 — 스킬은 Claude Code 가 자동 로드.

L-2 (README docs/ gitignore note) 의도적 생략 — `.gitignore` 인라인 주석이 이미 동일 정보 제공.

### Verification
- `bash scripts/verify-fixes.sh` — Passed: 45, Failed: 0
- `node scripts/validate-envelope-emit.js` — envelope contract pass

## [1.2.0] - 2026-05-07

### Changed
- **`.deep-docs/last-scan.json` 이제 claude-deep-suite M3 cross-plugin envelope 으로 wrap** (`docs/envelope-migration.md`). top-level `schema_version: "1.0"` + `envelope` 블록 (`producer`, `producer_version`, `artifact_kind`, `run_id` ULID, `generated_at` RFC3339, `schema { name, version }`, `git { head, branch, dirty }`, `provenance { source_artifacts, tool_versions }`) + `payload` (기존 emit 의 documents/summary/provenance 일부).
- 1.1.0 시점 root-level `scanned_at`, `schema_version: 2` (numeric), `provenance.head_sha`, `provenance.branch` 는 envelope 으로 흡수되어 payload 에서 제거. `payload.provenance` 는 plugin-specific 필드 (`is_git`, `worktree_hash`) 만 보존.
- `garden`/`audit` 재사용 4-요소 규칙 envelope-aware 로 갱신: `schema_version === "1.0"` AND `envelope.schema.version === "1.0"` / `envelope.generated_at` 10분 / `envelope.git.head` / `payload.provenance.worktree_hash`. legacy `schema_version: 2` numeric 은 1번 검사에서 자동 fail → 재-scan (10분 TTL 자연 invalidation).
- `package.json` 에 `"type": "module"` + `npm run validate:envelope` 스크립트 추가.

### Added
- `tests/fixtures/sample-last-scan.json` — envelope-wrapped sample emit
- `scripts/validate-envelope-emit.js` — envelope contract self-test (zero-dep node)
- `agents/doc-scanner.md` Step 12-A: ULID + git/tool 메타데이터 계산 Bash recipe
- non-git 환경 sentinel: `envelope.git = { "head": "0000000", "branch": "HEAD", "dirty": "unknown" }`

### Migration notes
- 본 릴리스는 plugin-internal **breaking change** (artifact JSON shape). 외부 consumer 가 옛 root-level 필드를 읽고 있다면 envelope-aware 로 마이그레이션 필요. 10분 TTL 보유 자연 invalidation 으로 사용자 측 도구 불필요.
- 알려진 cross-plugin consumer (각각 자기 Phase 2 PR 에서 envelope-aware read 로 갱신):
  - `deep-dashboard` collector — `harnessability-report.json` 생성 시 deep-docs `last-scan.json` 입력 (Phase 2 priority #2).
  - `deep-work` `gather-signals.sh` — `jq '.scanned_at'` / `'.documents[]'` 로 root-level 읽음. envelope 후 `jq '.envelope.generated_at'` / `'.payload.documents[]'` 로 path 갱신 필요 (Phase 2 priority #3 의 deep-work session-receipt envelope adoption 과 동시 처리).
- handoff §1 정책에 따라 본 PR 은 plugin repo 만 변경. consumer 측 갱신은 각 plugin 의 Phase 2 PR 책임 (병렬 자율).
- claude-deep-suite Phase 2 Adoption ledger 의 1순위 항목 (`docs/envelope-migration.md` §6.1).

## [1.1.0] - 2026-04-17

### Breaking Changes
- **`.deep-docs/last-scan.json` `schema_version` 1 → 2**. issue 필드 rename: `reference` → `current_value`, `suggestion` → `suggested_value`. v1.0 아티팩트는 자동 재생성(10분 TTL + schema 체크).
- Audit 점수 표기 변경: 정수 구간(`9–10, 7–8, 5–6, 1–4`) → 소수점 1자리 + strict 부등호(`≥9.0, 7.0≤<9.0, 5.0≤<7.0, <5.0`).

### Added
- `skills/deep-docs-workflow/references/scan-filters/` 디렉토리 — Python primary heuristic 필터 6개:
  - `translation-pair.md`: 번역 쌍 그룹핑 (ISO 639-1 allowlist + 디렉토리 경로 포함 그룹 키 + script subtag 지원)
  - `code-fence.md`: CommonMark 0.31 fence 인식 (3 space 들여쓰기까지) + per-segment hashing
  - `reference-extraction.md`: Rule 0 분기(CLI → path → env → symbol) — fenced block 내부 제외
  - `cli-whitelist.md`: 2단계 lookup (project scripts → system whitelist) + 각 매니저 built-in 집합
  - `worktree-hash.md`: NUL-safe + per-file `git hash-object` + streaming 64KB chunk
  - `freshness-timestamp.md`: epoch 비교 + dirty-only mtime fallback
- `.deep-docs/garden-ignored.json` 아티팩트 — garden 거부 항목 signature 기반 영구 skip
- Garden 5지선다 prompt — batch approval/rejection
- `scripts/verify-fixes.sh` — grep 기반 spec 준수 체크
- `.gitignore` — `.deep-docs/` 제외

### Changed
- `doc-scanner` agent tools에 `Write` 추가 — artifact 저장 가능
- `commands/deep-docs.md` allowed-tools: `Agent` → `Task` (Claude Code 표준)
- Artifact 재사용 조건 3-요소 → 4-요소 (`schema_version` 추가)
- Size 임계값 strict `>` 부등호로 scan 경고와 audit 만점 경계 정렬
- Freshness 점수 스케일 `{10, 7, 4, null}` 정규화, stale 비율 구간 `<30% / 30-70% / ≥70%` 명시
- issue `type` enum 허용값 확정 + 한국어 레이블 매핑

### Removed
- `hooks/hooks.json` — v1.1 시점 active hook 없음

### Fixed
- **Self-corruption bug (C-1)**: `README.md` ↔ `README.ko.md` 번역 쌍의 JSON 예시가 중복으로 오판되어 garden이 삭제 제안하던 이슈
- **CLI false-positive (M-7)**: `git log -1`, `find`, `wc` 등 시스템 명령이 stale로 오판
- **워크트리 변경 미감지 (H-1)**: HEAD SHA + TTL만으로는 uncommitted 변경 감지 못함 — `worktree_hash`로 해결
- **Garden 후 stale audit (H-2)**: 수정 적용 후 재사용 아티팩트로 점수 계산하던 이슈
- **macOS 비호환**: `sha1sum` → `shasum -a 1`, `stat -c` / `stat -f` fallback chain

### Security
- `worktree_hash` 계산에서 `xargs -I{} sh -c` 제거 — 악성 파일명(`$(…)`, backtick 포함) RCE 차단

## [1.0.0] - 2026-04-08

### Added
- `/deep-docs scan` — 죽은 참조, 경로 이동, 오래된 예시, 중복 탐지
- `/deep-docs garden` — auto-fix 가능 항목 수정 (사용자 확인 후)
- `/deep-docs audit` — 문서 품질 정량 리포트 (path-scoped 신선도)
- doc-scanner 에이전트

### Changed
- Rule 3 (Stale Examples): Changed to conditional auto-fix — CLI/env vars only, code examples are audit-only
- Rule 4 (Duplicated Instructions): Changed to conditional auto-fix — 100% identical blocks only
- Scan artifact (.deep-docs/last-scan.json) now includes provenance (HEAD SHA, branch) for safe reuse

### Fixed
- Added explicit scan steps for Rules 5-8 (size, rule-code contradiction, coverage gap, map-vs-manual) in doc-scanner agent
- Added non-git environment branch in doc-scanner (skip git-dependent steps)
- Added full path to scan-rules.md reference in agent
- Excluded node_modules/, vendor/, dist/, build/, __pycache__/ from scan scope
- Added zero-document fallback with clear message
