---
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion
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

2. doc-scanner 에이전트를 spawn하여 스캔 실행:
   ```
   Agent(doc-scanner): "프로젝트의 에이전트 지침 문서를 스캔하세요.
   프로젝트 루트: {cwd}
   git 사용 가능: {is_git}
   scan-rules.md의 규칙을 따라 auto-fix와 audit-only를 분류하세요."
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

1. `.deep-docs/last-scan.json` 확인:
   - 존재하고 10분 이내 + HEAD SHA가 현재와 동일 → 재사용
   - HEAD SHA가 다르거나 10분 초과 또는 없음 → 재scan
   - non-git 환경: scanned_at만으로 10분 TTL 판단

2. auto-fix 가능 항목만 추출 (scan-rules.md 기준):
   - 죽은 참조
   - 이동/리네임된 경로
   - 오래된 예시/명령어
   - 중복 지침 블록
   - 크기 초과 (제안만)

3. 각 항목을 순서대로 처리:
   
   a. 수정 내용을 diff로 보여줌:
   ```
   ## 수정 1/N: CLAUDE.md — 죽은 참조
   
   - `src/auth/middleware.ts` → `src/auth/auth-middleware.ts` (git rename 감지)
   
   이 수정을 적용할까요?
   ```
   
   b. AskUserQuestion으로 사용자 확인 후 Edit tool로 수정

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

### /deep-docs audit

문서 품질을 정량 평가합니다.

**Steps:**

1. `.deep-docs/last-scan.json` 확인:
   - 존재하고 10분 이내 + HEAD SHA가 현재와 동일 → 재사용
   - HEAD SHA가 다르거나 10분 초과 또는 없음 → 재scan
   - non-git 환경: scanned_at만으로 10분 TTL 판단

2. audit-metrics.md 기준으로 지표 계산 (last-scan.json의 metrics 사용):

   a. **파일 크기**: last-scan.json의 각 문서 size_lines 사용
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
