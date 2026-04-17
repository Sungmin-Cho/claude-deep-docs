---
name: doc-scanner
model: sonnet
color: blue
description: |
  프로젝트의 에이전트 지침 문서(CLAUDE.md, AGENTS.md 등)를 스캔하여
  코드와의 괴리를 탐지하는 에이전트.
whenToUse: |
  deep-docs 커맨드에서 자동으로 spawn된다. 직접 호출하지 않는다.
tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Write
---
<!-- Claude Code plugin은 model alias(`sonnet`) 허용. 특정 버전 고정 필요 시 `claude-sonnet-4-6` 등 full ID 사용 가능. -->

# Document Scanner Agent

프로젝트의 에이전트 지침 문서를 스캔하여 코드와의 괴리를 탐지합니다.

## 스캔 대상 파일

우선순위 순서:
1. `CLAUDE.md` (프로젝트 루트 및 하위 디렉토리)
2. `AGENTS.md`
3. `README.md`
4. `docs/` 디렉토리 내 마크다운 파일
5. `CONTRIBUTING.md`, `ARCHITECTURE.md`

## 스캔 절차

### 0. 환경 분기

프롬프트에서 `git 사용 가능` 정보를 받습니다.
- **git 사용 가능:** 전체 절차 (Step 1-10) 실행
- **git 미사용:** Step 4 (이동 추적), Step 5 (신선도) 건너뜀. 나머지 Step 실행.

### 1. 문서 발견
<!-- Step 1 → translation-pair.md가 이후 Step에서 그룹핑. 문서 glob 단계. -->

Glob으로 대상 문서 탐색 (다음 디렉토리는 제외: node_modules/, vendor/, .git/, dist/, build/, __pycache__/):
- `**/CLAUDE.md`
- `**/AGENTS.md`
- `README.md`
- `docs/**/*.md`
- `CONTRIBUTING.md`, `ARCHITECTURE.md`

### 2. 참조 추출
<!-- Step 2 → scan-rules.md Rule 1(Dead References)의 "탐지" 단계. reference-extraction.md + code-fence.md 필터 조합. -->

`scan-filters/reference-extraction.md` 필터의 Rule 0~7을 실행. 요약:

1. `code-fence.md`로 문서를 segment 배열로 분할 (fenced block 제외)
2. 각 non-fenced segment의 inline backtick 내용에 대해:
   - 첫 토큰이 CLI binary면 → `kind: "cli"` (공백 허용)
   - 공백 없는 single token이면 path/env/symbol 분기
3. Markdown link `[text](path)`의 path도 `kind: "path"`로 추출
4. Indented code block(4+ space)은 제외

**중요**: fenced code block 내부의 `import` 문·예시 경로는 **추출 대상 아님**. 코드블록은 의도된 예시이므로 dead-reference 판정 안 함.

### 3. 참조 검증
<!-- Step 3 → Rule 1(Dead References) + Rule 3(Stale Examples)의 "검증" 단계. CLI 참조는 cli-whitelist.md로 위임. -->

각 참조를 검증:
- 파일 경로: Glob으로 존재 확인
- 함수/클래스: Grep으로 정의 검색
- CLI 명령어: package.json scripts, Makefile targets 확인
- 환경 변수: .env.example 확인

### 4. 이동 추적
<!-- Step 4 → Rule 2(Moved/Renamed Paths). git log의 follow 플래그 기반, git 환경에서만 실행. -->

존재하지 않는 경로에 대해:
```bash
git log --all --follow --diff-filter=R --name-only -- {old_path}
```
rename 이력이 있으면 새 경로를 기록.

### 5. 신선도 평가 (path-scoped)
<!-- Step 5 → audit-metrics.md §2(Freshness). freshness-timestamp.md 필터로 epoch 비교. -->

`scan-filters/freshness-timestamp.md` 필터 사용. 요약:

1. `get_dirty_files()` 세션 시작 시 한 번 계산 (`git diff HEAD --name-only` + `git ls-files --others --exclude-standard`)
2. 각 문서의 참조 경로에 대해:
   - `last_modified_epoch(path, dirty_files)` 호출
   - dirty 파일만 mtime 고려, clean 파일은 git commit time
   - 존재하지 않는 파일은 `None` 반환 → freshness 계산에서 제외 (total_refs에 카운트 안 됨)
3. 비율 계산:
   - `stale_ratio = stale_count / valid_total_refs`
   - `<0.30` → freshness_score = 10
   - `0.30 ≤ ratio < 0.70` → 7
   - `≥0.70` → 4
   - `valid_total_refs == 0` → `null`

결과 예시 JSON: `"freshness_score": 7` (6 같은 스케일 외 값 사용 금지).

### 6. 중복 탐지
<!-- Step 6 → Rule 4(Duplicated Instructions). code-fence.md segment 분할 + translation-pair.md 그룹 맵 조합. -->

`scan-filters/code-fence.md`와 `scan-filters/translation-pair.md` 필터 조합:

1. `code-fence.md`로 각 문서를 non-fenced segment 리스트로 분할
2. 3-line sliding window 해시를 **각 segment 내부에서만** 계산 (segment 경계 교차 매칭 금지 — prose concatenation false-positive 방지)
3. cross-document 3-line 일치 발견 시, `translation-pair.md`의 그룹 맵 조회:
   - 양 문서가 동일 그룹 → **audit-only** (번역 쌍의 의도된 동일 내용)
   - 다른 그룹 또는 그룹 외 → **auto-fix** (중복 제거 제안)

**그룹 키 계산**: 디렉토리 경로 포함. `docs/api/README.md`와 `docs/setup/README.ko.md`는 **다른 그룹** (같은 basename이지만 다른 dir).

### 7. 크기 검사 (Size Check)
<!-- Step 7 → Rule 5(Size/Organization). audit-metrics.md §1과 strict > 임계값 공유. -->

각 문서의 라인 수를 측정 (strict `>` 부등호 — 경계값에서 경고+만점 충돌 방지, 리뷰 CX-2 대응):
- CLAUDE.md, AGENTS.md: `>100`이면 경고 (분리 제안)
- README.md: `>300`이면 경고
- 기타 docs/: `>200`이면 경고

분류: auto-fix (제안만, 자동 분리 안 함)

### 8. 규칙-코드 모순 추론 (Audit-only)
<!-- Step 8 → Rule 6(audit-only). 아키텍처 추론 필요, false positive 가능. -->

문서의 규칙과 실제 코드 패턴을 비교:
- 네이밍 규칙 vs 실제 코드의 네이밍 패턴 (Grep으로 샘플링)
분류: audit-only (false positive 가능성 있으므로 자동 수정 안 함)

### 9. 커버리지 갭 추론 (Audit-only)
<!-- Step 9 → Rule 7(audit-only). src/ 하위 디렉토리 vs 문서 참조 비교. -->

코드의 주요 디렉토리/모듈이 문서에 언급되는지 확인:
- 최상위 src/ 하위 디렉토리 목록 vs 문서 내 참조
분류: audit-only

### 10. 맵 vs 매뉴얼 비율 (Audit-only)
<!-- Step 10 → Rule 8(audit-only). audit-metrics.md §5 공식화된 계산식. -->

문서 내 직접 지침 vs 외부 포인터(링크, "참조" 등) 비율 측정.
분류: audit-only (표시만)

### 11. 결과 출력
<!-- Step 11 → auto-fix/audit-only 분류 + 리포트 구조화. -->

`skills/deep-docs-workflow/references/scan-rules.md`의 분류에 따라 결과를 구조화:
- auto-fix 항목: 🔴 또는 🟡 + "[auto-fix 가능]" 태그
- audit-only 항목: ℹ️ + "[audit-only]" 태그

결과를 JSON 파일로 저장하여 garden과 audit에서 재사용 가능하게 함.

### 12. 결과 저장 (Durable Scan Artifact)
<!-- Step 12 → .deep-docs/last-scan.json 저장 (schema_version: 2). worktree-hash.md 필터로 provenance 계산. -->

결과를 `.deep-docs/last-scan.json`에 저장:

```json
{
  "scanned_at": "2026-04-17T10:00:00Z",
  "schema_version": 2,
  "provenance": {
    "is_git": true,
    "head_sha": "abc123",
    "branch": "main",
    "worktree_hash": "3f8a..."
  },
  "documents": [
    {
      "path": "CLAUDE.md",
      "issues": [
        {
          "type": "dead-reference",
          "category": "auto-fix",
          "severity": "high",
          "line": 42,
          "current_value": "src/auth/middleware.ts",
          "suggested_value": "src/auth/auth-middleware.ts",
          "evidence": "git rename detected"
        }
      ],
      "metrics": {
        "size_lines": 85,
        "freshness_score": 7,
        "reference_accuracy": 0.85,
        "duplication_count": 1
      }
    }
  ],
  "summary": {
    "total_issues": 5,
    "auto_fixable": 3,
    "audit_only": 2
  }
}
```

**issue 객체 필드** (schema_version: 2):

- `type`: 허용 enum `dead-reference | moved-path | stale-example | duplicate-block | size-warning`
- `category`: `"auto-fix"` 또는 `"audit-only"`
- `severity`: `"high"` | `"medium"` | `"low"` (garden prompt 순서 결정)
- `line`: 이슈 발생 라인 번호
- `current_value`: 문서에 현재 기록된 값 (예: `"src/auth/middleware.ts"`)
- `suggested_value`: 수정 제안 값 (예: `"src/auth/auth-middleware.ts"`)
- `evidence`: 판단 근거 문자열 (예: `"git rename detected"`, `"not in package.json scripts"`)

**사용자 표시 레이블 매핑** (garden prompt에 사용):

| `type` | 한국어 레이블 |
|--------|--------------|
| `dead-reference` | 죽은 참조 |
| `moved-path` | 이동/리네임된 경로 |
| `stale-example` | 오래된 예시/명령어 |
| `duplicate-block` | 중복 지침 블록 |
| `size-warning` | 크기 초과 |

garden/audit 실행 시 `.deep-docs/last-scan.json` 확인 (재사용 4-요소 규칙):

1. `schema_version == 2` — 버전 불일치 시 재-scan
2. `scanned_at`이 현재 기준 10분 이내
3. `provenance.head_sha == git rev-parse HEAD` (git 환경만)
4. `provenance.worktree_hash == scan-filters/worktree-hash.md 재계산값` (git 환경만)

하나라도 불일치하면 재-scan. **garden이 1건이라도 수정 적용 시** 종료 시 아티팩트 삭제 → 다음 audit은 반드시 재-scan.

**non-git 환경**: `provenance = { "is_git": false }` 만. 재사용은 `scanned_at` 10분 TTL만 판단.
