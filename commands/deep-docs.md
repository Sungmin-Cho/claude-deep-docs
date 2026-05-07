---
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, AskUserQuestion
description: 에이전트 지침 문서의 신선도 검증(scan), 자동 정비(garden), 품질 리포트(audit)를 수행합니다.
argument-hint: "<scan|garden|audit>"
---

# /deep-docs — Document Gardening

에이전트 지침 문서(CLAUDE.md, AGENTS.md 등)의 건강 상태를 관리합니다.

## Prerequisites

`deep-docs-workflow` 스킬을 로드합니다.

## Auto-create .deep-docs/ (최초 실행 시)

`.deep-docs/` 디렉토리가 없으면 자동 생성:
```bash
mkdir -p .deep-docs
```
이를 통해 scan/garden/audit 모두 init 없이 즉시 동작.

## Subcommands

### /deep-docs scan

문서와 코드 간 괴리를 탐지합니다.

**Steps:**

1. git 리포지터리 여부 확인
   - git이 아니면: 신선도 측정과 이동 추적은 건너뛰고, 참조 검증만 수행

2. doc-scanner 에이전트를 Task 도구로 spawn:
   ```
   Task(subagent_type="doc-scanner", prompt="프로젝트의 에이전트 지침 문서를 스캔하세요.
   프로젝트 루트: {cwd}
   git 사용 가능: {is_git}
   scan-rules.md의 규칙을 따라 auto-fix와 audit-only를 분류하세요.")
   ```

   **문서가 하나도 발견되지 않은 경우:**
   "에이전트 지침 문서(CLAUDE.md, AGENTS.md, README.md 등)를 찾을 수 없습니다. 스캔할 대상이 없습니다."
   → 종료 (garden, audit도 동일)

3. 결과를 사용자에게 출력:

   ```markdown
   # Document Health Report

   ## CLAUDE.md
   - 🔴 죽은 참조 N건 [auto-fix 가능]
   - 🟡 경로 이동 N건 [auto-fix 가능]
   - ℹ️ 규칙 모순 의심 [audit-only]

   ## Score: N/10
   ## Auto-fixable: N건 | Audit-only: N건
   ```

4. auto-fix 항목이 있으면 제안:
   "자동 수정 가능한 항목이 {N}건 있습니다. `/deep-docs garden`으로 수정하시겠습니까?"

### /deep-docs garden

scan 결과를 기반으로 자동 수정합니다.

**Steps:**

1. `.deep-docs/last-scan.json` 확인 (재사용 규칙, M3 envelope-aware, 5-요소 + 3 identity guards):
   - **identity 가드** (deep-docs/last-scan envelope 인지 확인 — defense-in-depth):
     - `envelope.producer === "deep-docs"`
     - `envelope.artifact_kind === "last-scan"`
     - `envelope.schema.name === "last-scan"`
   - `schema_version === "1.0"` (top-level) AND `envelope.schema.version === "1.0"`
   - `envelope.generated_at` 10분 이내
   - `envelope.git.head` 일치 (git)
   - `payload.provenance.worktree_hash` 일치 (git, `scan-filters/worktree-hash.md` 재계산)
   - 하나라도 실패 → 재-scan (legacy `schema_version: 2` numeric 형식 포함)
   - non-git 환경: identity 가드 + `envelope.generated_at` TTL + `payload.provenance.path_check_enabled` 비교 (git 환경과 무관하게 config 토글 무효화)

2. auto-fix 가능 항목만 추출 — `payload.documents[].issues[]` 기준 (scan-rules.md):
   - 죽은 참조
   - 이동/리네임된 경로
   - 오래된 예시/명령어
   - 중복 지침 블록
   - 크기 초과 (제안만)

3. 각 항목을 순서대로 처리:

   a. 수정 내용을 diff로 보여줌:
   ```
   ## 수정 1/N: {파일} — {한국어 type 레이블}
   
   - `{current_value}` → `{suggested_value}` ({evidence})
   ```
   
   b. AskUserQuestion으로 5지선다:
   - **(A) 적용**
   - **(B) 건너뜀 (이번만)**
   - **(C) 건너뜀 + 기록** (`.deep-docs/garden-ignored.json`에 signature 저장)
   - **(D) 이하 모두 적용 — "{한국어 레이블}" 일괄 수락** (현재 세션 + 동일 type)
   - **(E) 이하 모두 건너뜀 — "{한국어 레이블}" 일괄 거부** (현재 세션 + 동일 type)
   
   c. A/D 선택 → Edit tool로 수정 적용  
      C 선택 → `.deep-docs/garden-ignored.json` append + skip  
      B/E 선택 → skip
   
   **세션 정의**: 단일 `/deep-docs garden` 호출 (시작 ~ 종료) 내에서만 (D)/(E) 선택 유지. 호출 종료 시 in-memory state 소실 (단, C만 영구 기록).

   **세션 state 로직**:
   ```python
   # garden 진입 시 초기화
   session_batch_accept: set[str] = set()   # (D)로 수락된 type 집합
   session_batch_reject: set[str] = set()   # (E)로 거부된 type 집합

   for issue in auto_fix_items:
       # ignored 이력 체크 (영구 기록)
       if signature(issue) in garden_ignored_json.ignored:
           continue

       t = issue.type
       if t in session_batch_accept:
           apply_edit(issue); continue
       if t in session_batch_reject:
           continue

       choice = ask_user_question(5_options)
       if choice == "A":
           apply_edit(issue)
       elif choice == "B":
           pass
       elif choice == "C":
           append_to_garden_ignored(issue)
       elif choice == "D":
           session_batch_accept.add(t)
           apply_edit(issue)
       elif choice == "E":
           session_batch_reject.add(t)
   ```

   **플랫폼 제약**: `AskUserQuestion`이 5 옵션 미지원이면 fallback — (A)/(B)/(C)/(Batch) 4지선다로 축소 후 Batch 선택 시 별도 질문으로 (D)/(E) 구분.

4. audit-only 항목은 마지막에 참고로 표시:
   ```
   ## 참고 (자동 수정 대상 아님)
   - ℹ️ 규칙-코드 모순: snake_case 규칙이나 코드 72%가 camelCase
   - ℹ️ 미문서화 모듈: src/payments/
   ```

5. 수정 요약:
   ```
   ## Garden 완료
   - 수정됨: N건
   - 건너뜀: N건
   - 참고: N건
   ```

6. **아티팩트 무효화** (리뷰 H-2 대응):
   - 1건 이상 수정 적용 시 `.deep-docs/last-scan.json` 삭제
   - 다음 audit/garden은 반드시 재-scan

### .deep-docs/garden-ignored.json 스키마 (M-8)

```json
{
  "schema_version": 1,
  "ignored": [
    {
      "signature": "sha256:...",
      "type": "dead-reference",
      "path": "CLAUDE.md",
      "content_preview": "src/auth/middleware.ts",
      "ignored_at": "2026-04-17T10:05:00Z"
    }
  ]
}
```

- **signature**: `sha256(type + "|" + path + "|" + content_preview[:200])`
- garden 실행 시 각 auto-fix 항목의 signature 계산 → `ignored`에 있으면 prompt skip
- 사용자가 재검토 원하면 `.deep-docs/garden-ignored.json` 수동 삭제

**⚠️ Signature 알고리즘 변경 시 주의**: 위 signature 공식 변경 시 기존 기록과 비호환. 변경 시 `garden-ignored.json`의 `schema_version`을 bump하고, garden 진입 시 version 불일치 감지 → 사용자에게 "기록 리셋됨" 안내 후 파일 삭제/백업 로직 필요.

### /deep-docs audit

문서 품질을 정량 평가합니다.

**Steps:**

1. `.deep-docs/last-scan.json` 확인 (재사용 규칙, M3 envelope-aware, 5-요소 + 3 identity guards — garden 과 동일):
   - **identity 가드**: `envelope.producer === "deep-docs"`, `envelope.artifact_kind === "last-scan"`, `envelope.schema.name === "last-scan"`
   - `schema_version === "1.0"` AND `envelope.schema.version === "1.0"`
   - `envelope.generated_at` 10분 이내
   - `envelope.git.head` 일치 (git)
   - `payload.provenance.worktree_hash` 일치 (git, `scan-filters/worktree-hash.md` 재계산)
   - 하나라도 실패 → 재-scan
   - non-git 환경: identity 가드 + `envelope.generated_at` TTL + `payload.provenance.path_check_enabled` 비교 (git 환경과 무관하게 config 토글 무효화)

2. audit-metrics.md 기준으로 지표 계산 (`payload.documents[].metrics` 사용):

   a. **파일 크기**: `payload.documents[].metrics.size_lines` 사용
      (참고: 직접 측정 시 Bash로 `wc -l` — 존재하는 파일만 대상, glob 미매치 안전 처리)
      ```bash
      for f in CLAUDE.md AGENTS.md README.md; do [ -f "$f" ] && wc -l "$f"; done
      find docs -name '*.md' -exec wc -l {} + 2>/dev/null || true
      ```

   b. **신선도** (path-scoped, git 환경에서만):
      - 문서에서 참조하는 경로 추출
      - 각 경로의 마지막 코드 변경 확인:
        ```bash
        git log -1 --format=%aI -- {path}
        ```
      - 문서의 마지막 수정 확인:
        ```bash
        git log -1 --format=%aI -- {doc_path}
        ```
      - 코드 변경이 문서 수정보다 최신 → stale

   c. **참조 정확도**: scan 결과에서 유효/무효 참조 비율 계산

   d. **중복도**: scan 결과에서 중복 블록 수

3. 종합 점수 산출 (측정 가능한 지표만으로 평균)

4. 리포트 출력:
   ```markdown
   # Document Audit Report

   ## 종합: 7.5/10 🟡 Good

   | 문서 | 크기 | 신선도 | 참조 정확도 | 중복도 | 평균 |
   |------|------|--------|-------------|--------|------|
   | CLAUDE.md | 8 | 6 | 10 | 10 | 8.5 |
   | README.md | 10 | 4 | 8 | 7 | 7.3 |

   ## 개선 권장 사항
   - README.md 신선도가 낮습니다. `src/api/` 변경 후 미업데이트.
   - README.md에 docs/setup.md와 중복 블록 1건.

   ## 참고 (audit-only)
   - ℹ️ 직접 지침 68%, 외부 포인터 32%
   ```

## 인수 없이 실행한 경우

`/deep-docs`를 인수 없이 실행하면:
AskUserQuestion으로 질문: "scan, garden, audit 중 어떤 작업을 수행할까요?"
- (A) scan — 문서 건강 스캔
- (B) garden — 자동 정비
- (C) audit — 품질 리포트
