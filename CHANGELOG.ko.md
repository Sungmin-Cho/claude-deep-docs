# 변경 이력

이 프로젝트의 모든 주요 변경 사항은 이 파일에 기록됩니다.

형식은 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)를 따르며,
이 프로젝트는 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)을 준수합니다.

---

## [1.6.0] — 2026-07-20

### 변경됨

- **AGENTS-first 단일 소스 문서 정책 (D13)** — 대상 프로젝트의 기본 관리 정책: 공용 에이전트 지침은 `AGENTS.md`(기본 관리 문서)에 두고, `CLAUDE.md`는 `@AGENTS.md` import + Claude Code 특화 내용만 담는 thin wrapper로 유지합니다.
  - `scan`: root `CLAUDE.md`가 존재하면 `AGENTS.md` 부재도 gap으로 잡습니다(공용 콘텐츠가 이관 소스). `@AGENTS.md` import 없이 공용 지침을 담은 `CLAUDE.md`는 `thin-doc` 재구성 후보(D13 wrapper deficit)입니다.
  - `garden`: 같은 세션에서 `AGENTS.md` gap을 `CLAUDE.md` gap보다 먼저 처리합니다. `@AGENTS.md` import는 `AGENTS.md`가 존재하거나 같은 세션에서 커밋된 경우에만 삽입합니다(dead import 금지). 공용 콘텐츠는 기존 per-removal 승인 흐름으로 `CLAUDE.md`에서 `AGENTS.md`로 이관되며, 미승인 이관은 재삽입됩니다(default-keep 유지). `AGENTS.md` draft를 거부하면 `CLAUDE.md`는 단독 full 문서로 유지됩니다.
  - `doc-author`: `CLAUDE.md` thin wrapper 골격 신설(목표 ≤30줄) + 단독 full 골격 fallback. 심볼릭 링크 공존 제안은 제거했습니다.
- 스키마 변경 없음: envelope `1.0` / last-scan payload `1.1`, gap 필드, category trichotomy 는 그대로입니다.

## [1.5.0] — 2026-07-10

### 추가됨

- Windows, macOS, Linux에서 scan, reuse, envelope, authoring 안전 작업을 위한 native Node.js 22 지원.
- Claude Code와 동일한 scanner 및 읽기 전용 author 정의를 로드하는 Codex generic-subagent 라우팅.

### 변경됨

- 릴리스 검증이 세 운영체제 모두에서 shell-free Node 테스트/lint suite를 사용하도록 변경.

## [1.4.1] — 2026-07-07

### 수정됨

- `reuse-cache` — `can_reuse_scan` 재사용 가드가 v1.4.0 에서 scan payload 가 `1.1` 로 이동한 뒤에도 payload `schema.version` 을 낡은 `1.0` 과 비교하여, 유효한 캐시 scan 이 항상 버전 불일치로 거부됐습니다. 검사를 `1.1` 로 재정렬했습니다.
- Step 12-B(scan 아티팩트 emit)가 이제 쓰기 전에 envelope 를 자가검증하여, malformed payload 가 저장된 뒤 나중에 손상된 캐시로 드러나는 대신 emit 시점에 fail-closed 됩니다.
- Step 12-B 쓰기를 atomic write(temp + rename)로 경화하여, emit 이 중단돼도 반쯤 쓰인 `last-scan.json` 을 남기지 않습니다.

## [1.4.0] — 2026-05-28

### 추가됨

- **문서 작성(authoring)** — deep-docs가 없거나 빈약한 에이전트 지침 문서를 생성/재구성합니다. `scan`이 갭(부재한 `CLAUDE.md`/`AGENTS.md`/`ARCHITECTURE.md`, 또는 공식 골격에 미달하는 문서)을 탐지하고, `garden`이 새 `doc-author` 에이전트를 spawn해 코드 분석으로 문서 draft를 작성한 뒤 per-removal 승인 흐름을 거쳐 적용합니다.
- 스캔 아티팩트의 `payload.gaps[]` — authoring 명세(`doc_kind`, `target_path`, `mode`)를 기존 문서 메트릭과 분리해 기록하여, 빈/신규 레포에서도 authoring 백로그가 드러납니다.

### 변경됨

- `scan`이 빈 프로젝트에서도 동작 — 문서가 하나도 없으면 종료하던 동작을 없애고, 없는 권장 문서를 `missing-doc` 갭으로 기록합니다 (빌드 매니페스트/규모 가드 충족 시; ignored 경로는 제외).
- `garden`에 authoring sub-flow 추가: `doc-author`(읽기 전용)로 draft를 만들고, 사용자가 작성한 콘텐츠를 기본 보존(미승인 제거는 재삽입)하며, fail-closed 안전 검사를 통과한 뒤에만 씁니다.
- 스캔 payload의 `envelope.schema.version`을 `1.0` → `1.1`로 bump (최상위 envelope `schema_version`은 `1.0` 유지).

## [1.3.1] — 2026-05-18 (Codex 네이티브 플러그인 매니페스트 및 AGENTS 가이드)

### 추가됨

- `.codex-plugin/plugin.json` — Claude Code 매니페스트와 동일한 skill 및 hook 표면을 가리키는 Codex 네이티브 플러그인 매니페스트.
- `AGENTS.md` — 런타임 표면, 검증 명령어, suite 마켓플레이스 갱신 요구사항을 다루는 Codex 프로젝트 가이드.

### 변경됨

- README가 기존 Claude Code 표면과 함께 Codex 호환성을 문서화.

## [1.3.0] — 2026-05-18

### 변경됨

- `/deep-docs`가 slash command 대신 `user-invocable` skill이 되었습니다. Claude Code 사용자는 그대로 `/deep-docs scan|garden|audit`를 입력하고, Codex·Copilot CLI·Gemini CLI 사용자는 `Skill({ skill: "deep-docs:deep-docs", args: "scan|garden|audit" })`로 동일 워크플로를 호출합니다.

### 제거됨

- `commands/deep-docs.md` (`skills/deep-docs/SKILL.md`로 대체).

## [1.2.1] — 2026-05-13

### 변경됨

- `size-warning`을 `audit-only`로 재분류 — `current → suggested` 대체 쌍이 없으므로 리포트만 하고 자동 수정하지 않습니다.
- Garden 프롬프트를 `AskUserQuestion`의 4항목 한계에 맞춰 4지선다 1차 프롬프트 + 2지선다 batch 후속 프롬프트로 재설계.

### 수정됨

- CLI `$PATH` 검사 토글이 스캔 아티팩트 재사용 가드를 조용히 손상시키는 대신 무효화하도록 수정.

## [1.2.0] — 2026-05-07

### 변경됨

- `.deep-docs/last-scan.json`이 claude-deep-suite M3 cross-plugin envelope으로 wrap됩니다 (최상위 `schema_version`, `envelope`, `payload` 블록). 아티팩트 형태의 breaking change이며, 10분 TTL이 마이그레이션을 흡수하므로 별도 업그레이드 도구가 필요 없습니다.
- `garden` / `audit` 재사용 가드가 envelope-aware로 갱신 — `schema_version`, `envelope.schema.version`, 10분 윈도우, `envelope.git.head`, `payload.provenance.worktree_hash`를 함께 확인합니다.

### 추가됨

- git을 사용하지 않는 환경에서는 sentinel `envelope.git`을 emit합니다 (`head: "0000000"`, `branch: "HEAD"`, `dirty: "unknown"`).

## [1.1.0] — 2026-04-17

### 추가됨

- 휴리스틱 스캔 필터: 번역 쌍 그룹핑, CommonMark 코드 펜스 인식, 참조 추출, CLI 화이트리스트, 워크트리 해싱, 신선도 타임스탬프.
- `.deep-docs/garden-ignored.json` — 거부된 수정 항목에 대한 signature 기반 영구 skip 목록.
- Garden batch 승인 / 거부 프롬프트.

### 변경됨

- `.deep-docs/last-scan.json` `schema_version` 1 → 2, issue 필드 rename (`reference` → `current_value`, `suggestion` → `suggested_value`); v1.0 아티팩트는 자동 재생성됩니다.
- Audit 점수를 정수 구간에서 소수점 1자리 + strict 부등호(`≥ 9.0`, `7.0 ≤ score < 9.0`, `5.0 ≤ score < 7.0`, `< 5.0`)로 전환.
- 스캔 아티팩트 재사용 시 HEAD SHA + TTL뿐 아니라 미커밋 워크트리도 함께 확인.

### 제거됨

- `hooks/hooks.json` — 이 버전 시점에 active hook 없음.

### 수정됨

- 번역 쌍의 JSON 예시(예: `README.md` ↔ `README.ko.md`)가 중복으로 오판되어 삭제 제안되던 문제 해결.
- `git log -1`, `find`, `wc` 등 시스템 명령이 오래된 CLI 예시로 오판되던 문제 해결.
- Garden 수정 후 audit 점수를 오래된 아티팩트로 재사용하지 않고 재계산하도록 수정.
- 해싱 및 `stat`의 macOS 호환성 확보 (`shasum -a 1`; `stat -c` / `stat -f` fallback).

### 보안

- 워크트리 해시 계산에서 `xargs -I{} sh -c`를 제거하여 악성 파일명을 통한 원격 코드 실행 경로를 차단.

## [1.0.0] — 2026-04-08

### 추가됨

- `/deep-docs scan` — 죽은 참조, 이동된 경로, 오래된 예시, 중복 탐지.
- `/deep-docs garden` — 사용자 확인 후 auto-fix 가능 항목 수정.
- `/deep-docs audit` — path-scoped 신선도를 포함한 정량적 문서 품질 리포트.
- doc-scanner 에이전트.

### 변경됨

- 오래된 예시와 중복 지침은 조건부 auto-fix입니다 (CLI/env 변수 및 100% 동일 블록만; 코드 예시와 유사 중복은 audit-only).
- 스캔 아티팩트가 안전한 재사용을 위해 provenance(HEAD SHA, branch)를 기록.

### 수정됨

- 스캔 범위에서 `node_modules/`, `vendor/`, `dist/`, `build/`, `__pycache__/` 제외.
- non-git 환경 분기 및 명확한 zero-document fallback 메시지 추가.
