---
name: deep-docs
description: Use when the user wants to scan, garden, or audit project agent-instruction documents (CLAUDE.md / AGENTS.md / README.md). Triggers on `/deep-docs`, "scan documents", "garden CLAUDE.md", "audit docs", "document health", "stale docs", "문서 정비", "문서 스캔", "문서 감사", "문서 가드닝". Detects dead refs, moved paths, duplicate blocks, stale examples; auto-fixes via 4-option AskUserQuestion (apply / skip / skip+record / batch); reports audit-only items separately.
user-invocable: true
---

# deep-docs — Document Gardening

에이전트 지침 문서(CLAUDE.md, AGENTS.md 등)의 건강 상태를 관리합니다.

## Invocation

이 스킬은 두 가지 경로로 호출됩니다 — 어느 쪽이든 본 SKILL §"Subcommands" 절차를 그대로 실행합니다:

1. **Claude Code 슬래시** — 사용자가 `/deep-docs [scan|garden|audit]` 입력 (skill 의 `user-invocable: true` 가 슬래시 진입을 허용).
2. **타 에이전트 / Codex / SDK** — `Skill({ skill: "deep-docs:deep-docs", args: "scan|garden|audit" })` 형태로 명시 invoke (Codex / Copilot CLI / Gemini CLI cross-platform 표준 경로).

두 경로 모두 args 는 동일한 토큰 문자열로 전달됩니다.

## Inputs (skill args)

- `scan` / `garden` / `audit` 중 하나 — 서브커맨드 토큰.
- args 가 비어 있거나 토큰이 인식되지 않으면 본 SKILL §"인수 없이 실행한 경우" 의 AskUserQuestion 분기로 진입.

## Prerequisites

이 스킬은 `deep-docs-workflow` 스킬과 함께 동작합니다 (Claude Code 가 description 매칭으로 자동 로드). workflow skill 의 `references/scan-rules.md` (scan 항목 정의) 와 `references/audit-metrics.md` (audit 지표 정의) 가 본 스킬의 검증/지표 정의를 담고 있습니다.

**Cross-platform self-containment**: Claude Code 에서는 workflow skill 의 references 가 description 매칭으로 자동 로드됩니다. 다만 Codex / Copilot CLI / Gemini CLI 등 타 플랫폼에서 `Skill()` 호출 시 sibling skill 의 auto-load 보장이 약할 수 있으므로, 본 SKILL §"Subcommands" 본문은 **의도적으로 self-contained** — 5-요소 envelope 가드, garden 4+2-option session state, `garden-ignored.json` 스키마 등을 인라인으로 보존합니다. 이는 `deep-docs-workflow` 와의 **의도적 duplication** 이며, 변경 시 양쪽 (본 SKILL + workflow skill) 동기화가 필요합니다.

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

   **문서가 하나도 발견되지 않은 경우 (빈/신규 레포 — authoring flagship 경로):**
   기존 문서가 없어도 **종료하지 않는다**. doc-scanner Step 11(Gap 탐지)이 권장 문서(CLAUDE.md / AGENTS.md / ARCHITECTURE.md)의 **부재를 missing-doc gap으로 기록**한다 (빌드 매니페스트 + 소스 디렉토리 / ~10k LOC+ 가드 충족 시; `.gitignore` ignored 경로 제외). 빈/신규 레포는 authoring의 핵심 경로이므로, "문서 0개"는 종료가 아니라 **`payload.gaps[]`로 authoring 백로그를 emit**하는 진입점이다. 가드를 충족하는 gap이 없으면 "생성할 권장 문서 없음(매니페스트/규모 가드 미충족)"으로 안내한다.

3. 결과를 사용자에게 출력:

   ```markdown
   # Document Health Report

   ## CLAUDE.md
   - 🔴 죽은 참조 N건 [auto-fix 가능]
   - 🟡 경로 이동 N건 [auto-fix 가능]
   - ℹ️ 규칙 모순 의심 [audit-only]

   ## 권장 문서 (authoring)
   - 📄 ARCHITECTURE.md 없음 (12k LOC) [authoring]

   ## Score: N/10
   ## Auto-fixable: N건 | Authoring: M건 | Audit-only: K건
   ```

   집계는 `payload.summary` 기준: `auto_fixable`(=issues[]), `authoring`(=`payload.gaps[]` 길이), `audit_only`(=issues[]). `total_issues`는 `documents[].issues[]`만 집계(gaps 제외 — dashboard metric 보존, D12).

4. auto-fix 또는 authoring 항목이 있으면 제안:
   "자동 수정 가능한 항목이 {N}건, 생성/재구성 가능한 권장 문서가 {M}건 있습니다. `/deep-docs garden`으로 처리하시겠습니까?"

### /deep-docs garden

scan 결과를 기반으로 자동 수정합니다.

**Steps:**

1. `.deep-docs/last-scan.json` 확인 (재사용 규칙, M3 envelope-aware, 5-요소 + 3 identity guards):
   - **identity 가드** (deep-docs/last-scan envelope 인지 확인 — defense-in-depth):
     - `envelope.producer === "deep-docs"`
     - `envelope.artifact_kind === "last-scan"`
     - `envelope.schema.name === "last-scan"`
   - `schema_version === "1.0"` (top-level) AND `envelope.schema.version === "1.1"`
   - `envelope.generated_at` 10분 이내
   - `envelope.git.head` 일치 (git)
   - `payload.provenance.worktree_hash` 일치 (git, `scan-filters/worktree-hash.md` 재계산)
   - 하나라도 실패 → 재-scan (legacy `schema_version: 2` numeric, payload `schema.version "1.0"` 형식 포함)
   - non-git 환경: identity 가드 + `envelope.generated_at` TTL + `payload.provenance.path_check_enabled` 비교 (git 환경과 무관하게 config 토글 무효화)

2. auto-fix 가능 항목만 추출 — `payload.documents[].issues[].category === "auto-fix"` 기준 (scan-rules.md):
   - 죽은 참조 (`type: "dead-reference"`)
   - 이동/리네임된 경로 (`type: "moved-path"`)
   - 오래된 예시/명령어 (`type: "stale-example"`)
   - 중복 지침 블록 (`type: "duplicate-block"`)

   `size-warning` 은 `category: "audit-only"` 로 emit 되어 Step 4 (참고) 에 표시 — garden 자동 수정 대상 아님 (분리는 구조적 판단 필요).

   **`payload.gaps[]` (authoring)** 은 치환 항목과 별개로 **Step 3.5 authoring sub-flow**에서 처리한다 (doc-author spawn → 구조화 draft → 승인 후 garden Write).

3. 각 항목을 순서대로 처리:

   a. 수정 내용을 diff로 보여줌:
   ```
   ## 수정 1/N: {파일} — {한국어 type 레이블}
   
   - `{current_value}` → `{suggested_value}` ({evidence})
   ```
   
   b. AskUserQuestion 1차 prompt (4지선다 — `AskUserQuestion` schema 의 `options` `maxItems: 4` 준수):
   - **(A) 적용**
   - **(B) 건너뜀 (이번만)**
   - **(C) 건너뜀 + 기록** (`.deep-docs/garden-ignored.json`에 signature 저장)
   - **(Batch) 일괄 처리** — 동일 type 전체에 대한 결정을 2차 prompt 에서 받음

   사용자가 **(Batch)** 를 선택하면 2차 AskUserQuestion (2지선다) 로 분기:
   - **(D) 이하 모두 적용 — "{한국어 레이블}" 일괄 수락** (현재 세션 + 동일 type)
   - **(E) 이하 모두 건너뜀 — "{한국어 레이블}" 일괄 거부** (현재 세션 + 동일 type)

   c. A/D 선택 → Edit tool로 수정 적용
      C 선택 → `.deep-docs/garden-ignored.json` append + skip
      B/E 선택 → skip

   **세션 정의**: 단일 `/deep-docs garden` 호출 (시작 ~ 종료) 내에서만 (D)/(E) 선택 유지. 호출 종료 시 in-memory state 소실 (단, C만 영구 기록).

   **세션 state 로직** (1차 4-option + Batch 2차 sub-prompt):
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

       # 1차 AskUserQuestion — 4 options (maxItems: 4 한계 준수)
       choice = ask_user_question(["A", "B", "C", "Batch"])
       if choice == "Batch":
           # 2차 AskUserQuestion — 2 options (D 일괄 수락 / E 일괄 거부)
           choice = ask_user_question(["D", "E"])

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

   **플랫폼 근거**: `AskUserQuestion` 의 `options` schema 는 `minItems: 2, maxItems: 4`. 5지선다 단일 prompt 은 platform 한계로 호출 불가하므로, 1차 4-option (Batch fan-out) + 2차 2-option (D/E) 의 두-단계 구조가 **canonical path** (런타임 fallback 이 아님).

3.5. **authoring sub-flow** (`payload.gaps[]` 처리 — 치환 흐름과 별개):

   garden 진입 시 `payload.gaps[]`를 **스냅샷으로 고정**한다 (세션 동안 불변). 치환 항목(`documents[].issues[]`)은 위 Step 3의 4+2 옵션 흐름을 **그대로** 따르고(불변), **authoring 항목(gaps[])은 다음 sub-flow**로 처리한다:

   각 gap에 대해 (garden-ignored signature 체크 후 — §"garden-ignored.json 스키마"의 missing/thin signature):

   a. **doc-author spawn** — Task 도구로:
      ```
      Task(subagent_type="doc-author", prompt="authoring_spec: {doc_kind, target_path, mode}.
      프로젝트 루트: {cwd}. git 사용 가능: {is_git}.
      references/authoring-rules/{doc_kind}.md 규칙대로 코드 분석 후 draft 구조화 result 반환.
      (restructure 시 기존 문서 내용 첨부)")
      ```
      → 구조화 result `{ draft_body, preserved_blocks[], removal_candidates[] }` 수신 (실패 시 `status: "degraded"` → audit-only 강등 + "수동 작성 권장").

   b. **① TOCTOU baseline 캡처 — garden이 소유** (doc-author 아님 — Bash 없어 hash 계산 불가):
      - **restructure**: garden이 doc-author spawn **전**에 `git hash-object <target_path>`로 baseline 캡처 → Write **직전** 재계산해 비교. 불일치(scan~Write 사이 변경)면 **fail-closed** ("이미 변경됨 — 재scan 또는 restructure로 전환?" 승인 요청).
      - **create**: garden이 spawn 전 target 부재 기록 → Write **직전** `lstat(target_path)` — **존재/심볼릭이면 fail-closed** ("이미 존재 — 재scan 또는 restructure로 전환?" 승인 요청).

   c. **② removal_candidates per-removal 승인** — 각 제거 후보에 대해 원본→draft 라인 diff를 보여주고 AskUserQuestion(2~3지선다):
      - **(적용)** 이 제거를 반영
      - **(수정요청)** doc-author에 재작업 요청 (또는 사용자가 직접 수정)
      - **(거부)** 이 블록 보존
      (라벨 `적용 / 수정요청 / 거부`는 garden 5지선다 A-E와 **별개로 공존**하는 authoring 전용 라벨.)

   d. **③ 미승인 removal 재삽입** — 승인 안 한 removal_candidate를 `anchor` 위치(직전 heading 매칭, 없으면 말미)에 **재삽입**한다 → 승인 안 한 고유 콘텐츠는 기계적으로 보존(silent omit 불가).

   e. **④ preserved_blocks 검증** — `preserved_blocks[]`의 각 블록이 `draft_body`에 부분문자열로 존재하는지 확인. 누락 시 **fail-closed**(draft 거부 + 사용자 경고) — preserved 경로의 silent-drop 사각을 닫는다.

   f. **⑤ target_path 재정규화 + byte 가드** — Write 직전:
      - `target_path` 재정규화: 절대경로 / `..` traversal / Windows separator(`\`) / drive-root(`C:`) / 심볼릭 링크 / `.gitignore` ignored 경로 **거부**, `doc_kind↔path` **root-only exact** 매칭 재확인(validator와 동일 allowlist predicate 공유 + symlink/ignored 추가 재확인).
      - **agents-md면** `draft_body`의 **UTF-8 byte ≤32KiB** 정확 확인 — 초과 시 fail-closed(분할/중첩 분산 제안). doc-author의 byte는 heuristic이므로 multibyte/long-line draft를 garden이 여기서 포착.

   g. **garden이 Write** — b~f 모두 통과 시에만 garden(메인 세션)이 신규 생성 또는 기존 교체. doc-author는 절대 Write하지 않는다.

   h. **cross-doc 포인터 / 공존 제안** — `authoring-rules/README.md` §cross-document 조건 충족 시: ARCHITECTURE.md가 존재/같은 세션 확정이면 CLAUDE/AGENTS에 참조 포인터 한 줄, CLAUDE↔AGENTS 거의 동일하면 공존 전략(심볼릭링크는 제안만, 승인 후 생성).

4. audit-only 항목은 마지막에 참고로 표시:
   ```
   ## 참고 (자동 수정 대상 아님)
   - ℹ️ 크기 초과: README.md 320줄 (한도 300) — 분리 제안
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

**authoring gap signature 인자** (missing-doc / thin-doc — Step 3.5 진입 전 동일 체크):

| 인자 | missing-doc | thin-doc |
|---|---|---|
| `type` | `"missing-doc"` | `"thin-doc"` |
| `path` | `target_path` | `target_path` |
| `content_preview` | `doc_kind` (예: `"architecture-md"`) | 기존 문서 첫 200자 |

→ 동일 공식 `sha256(type + "|" + target_path + "|" + preview[:200])`. C옵션(건너뜀+기록)으로 "이 프로젝트엔 ARCHITECTURE.md 불필요" 같은 결정을 영구 skip할 수 있다.

**⚠️ Signature 알고리즘 변경 시 주의**: 위 signature 공식 변경 시 기존 기록과 비호환. 변경 시 `garden-ignored.json`의 `schema_version`을 bump하고, garden 진입 시 version 불일치 감지 → 사용자에게 "기록 리셋됨" 안내 후 파일 삭제/백업 로직 필요.

### /deep-docs audit

문서 품질을 정량 평가합니다.

**Steps:**

1. `.deep-docs/last-scan.json` 확인 (재사용 규칙, M3 envelope-aware, 5-요소 + 3 identity guards — garden 과 동일):
   - **identity 가드**: `envelope.producer === "deep-docs"`, `envelope.artifact_kind === "last-scan"`, `envelope.schema.name === "last-scan"`
   - `schema_version === "1.0"` AND `envelope.schema.version === "1.1"`
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

`deep-docs`를 인수 없이 실행하면:
AskUserQuestion으로 질문: "scan, garden, audit 중 어떤 작업을 수행할까요?"
- (A) scan — 문서 건강 스캔
- (B) garden — 자동 정비
- (C) audit — 품질 리포트
