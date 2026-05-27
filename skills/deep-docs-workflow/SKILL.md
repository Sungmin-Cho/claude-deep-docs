---
name: deep-docs-workflow
description: |
  deep-docs 플러그인의 코어 워크플로우. scan/garden/audit 서브커맨드의
  동작을 정의하고, 스캔 결과의 분류(auto-fix vs audit-only)를 가이드한다.
user-invocable: false
---

# Deep Docs Workflow

이 스킬은 `/deep-docs` 커맨드에서 로드되어 가드닝 프로세스를 가이드합니다.

## 참조 문서

- `references/scan-rules.md` — scan 항목 정의
- `references/audit-metrics.md` — audit 지표 정의

## 서브커맨드별 워크플로우

### scan 워크플로우

1. doc-scanner 에이전트를 spawn
2. 에이전트가 문서 발견 → 참조 추출 → 참조 검증 → 이동 추적 → 신선도 → 중복 → **Gap 탐지(Rule 9 — missing/thin doc)** 수행
3. 결과를 auto-fix / authoring / audit-only로 분류 (삼분법). issues 는 `payload.documents[]`, authoring gap 은 `payload.gaps[]`
4. 결과를 `.deep-docs/last-scan.json`에 **M3 envelope wrap 형태**로 저장 (`docs/envelope-migration.md` §1; payload `schema.version "1.1"`)
5. 리포트 출력 (`auto-fix N · authoring M · audit-only K`)

### garden 워크플로우

1. `.deep-docs/last-scan.json` 확인 (재사용 규칙, M3 envelope-aware, 5-요소 + 3 identity guards):
   - identity 가드: `envelope.producer === "deep-docs"`, `envelope.artifact_kind === "last-scan"`, `envelope.schema.name === "last-scan"`
   - `schema_version === "1.0"` (top-level) AND `envelope.schema.version === "1.1"` (불일치 시 재-scan, legacy `schema_version: 2` numeric · payload `schema.version "1.0"` 형식 포함)
   - `envelope.generated_at` 10분 이내
   - `envelope.git.head` 일치 (git 환경)
   - `payload.provenance.worktree_hash` 일치 (git 환경, `scan-filters/worktree-hash.md` 재계산)
   - 하나라도 실패 → 재-scan
   - non-git: identity 가드 + `envelope.generated_at` 10분 TTL + `payload.provenance.path_check_enabled` 비교 (config 토글 무효화는 git 환경과 무관)
2. auto-fix 가능 항목만 추출 (`payload.documents[].issues[].category === "auto-fix"`). `size-warning` 은 `audit-only` 로 분류되어 Step 4 에 표시. `payload.gaps[]`(authoring) 은 Step 3.5 sub-flow 에서 별도 처리.
3. **치환 항목** (각 issue):
   a. 수정 내용을 diff 형태로 사용자에게 보여줌
   b. AskUserQuestion 1차 prompt 4지선다 (`maxItems: 4` 준수): (A) 적용 · (B) 건너뜀 · (C) 건너뜀+기록 · (Batch) → 2차 AskUserQuestion (D) 일괄 적용 / (E) 일괄 거부. 자세한 옵션 동작 및 세션 state 는 `skills/deep-docs/SKILL.md` Step 3.b 참조.
   c. A/D 선택 → Edit tool로 수정 적용; C 선택 → `.deep-docs/garden-ignored.json` 기록; B/E 선택 → skip
3.5. **authoring 항목** (각 gap — `payload.gaps[]`): doc-author spawn(`Task(subagent_type="doc-author")`) → 구조화 result `{draft_body, preserved_blocks[], removal_candidates[]}` 수신 → **garden이 TOCTOU baseline 소유**(doc-author는 Bash 없음: restructure `git hash-object` / create `lstat`, Write 직전 재확인 fail-closed) → removal_candidates per-removal 승인(적용/수정요청/거부) → 미승인 removal anchor 재삽입 → preserved_blocks 존재 검증 → target_path 재정규화(절대/traversal/symlink/ignored 거부, root-only exact) + agents-md byte ≤32KiB 확인 → **garden만 Write**. 자세한 절차는 `skills/deep-docs/SKILL.md` Step 3.5 참조.
4. audit-only 항목은 "참고: 다음 항목은 자동 수정 대상이 아닙니다"로 표시 (`size-warning` 포함)
5. 수정 요약 출력
6. **아티팩트 무효화** (H-2 대응):
   - 1건 이상 수정 적용 시 `.deep-docs/last-scan.json` 삭제
   - 다음 audit/garden은 반드시 재-scan

### audit 워크플로우

1. `.deep-docs/last-scan.json` 확인 (재사용 규칙, M3 envelope-aware, 5-요소 + 3 identity guards — garden 과 동일):
   - identity 가드: `envelope.producer === "deep-docs"`, `envelope.artifact_kind === "last-scan"`, `envelope.schema.name === "last-scan"`
   - `schema_version === "1.0"` AND `envelope.schema.version === "1.1"` (불일치 시 재-scan)
   - `envelope.generated_at` 10분 이내
   - `envelope.git.head` 일치 (git 환경)
   - `payload.provenance.worktree_hash` 일치 (git 환경, `scan-filters/worktree-hash.md` 재계산)
   - 하나라도 실패 → 재-scan
   - non-git: identity 가드 + `envelope.generated_at` 10분 TTL + `payload.provenance.path_check_enabled` 비교 (config 토글 무효화는 git 환경과 무관)
2. audit-metrics.md의 지표 계산:
   - 파일 크기
   - 신선도 (path-scoped)
   - 참조 정확도
   - 중복도
3. 측정 가능한 지표만으로 종합 점수 산출
4. 문서별 상세 리포트 출력

## 스캔 대상 판단

프로젝트에서 에이전트 지침 문서를 찾는 우선순위:
1. CLAUDE.md (모든 위치)
2. AGENTS.md (모든 위치)
3. README.md (루트)
4. docs/ 내 마크다운
5. CONTRIBUTING.md, ARCHITECTURE.md

없는 **기존 문서**는 스캔 대상에서 제외하되, **없는 권장 문서(CLAUDE.md / AGENTS.md / ARCHITECTURE.md)는 missing-doc gap으로 기록**한다 (doc-scanner Step 11, 가드 충족 시). 따라서 기존 문서가 0개여도 scan은 종료하지 않고 authoring 백로그(`payload.gaps[]`)를 emit한다 — **빈 프로젝트도 authoring 가능**. (`.gitignore` ignored 경로는 gap 후보에서 제외.)
