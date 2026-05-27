# deep-docs — Document Authoring (생성/재구성) 기능 설계

- **상태**: 설계 승인 대기 → 승인 후 writing-plans 로 전환
- **작성일**: 2026-05-28
- **대상 버전**: v1.4.0 (minor — 신규 기능)
- **범위**: deep-docs 플러그인이 대상 워크스페이스에서 에이전트 지침 문서를 **생성/재구성**하는 능력 추가

---

## 1. 배경과 문제

현재 deep-docs 는 **기존 문서가 존재한다는 전제** 위에서만 동작한다.

- `doc-scanner` 는 Glob 으로 기존 문서를 찾고, **하나도 없으면 "스캔할 대상이 없습니다 → 종료"** 한다 (`deep-docs-workflow/SKILL.md` "스캔 대상 판단": *"없는 파일은 건너뛴다. 최소 1개 파일이 있어야 scan 실행 가능"*).
- `garden` 은 `current_value → suggested_value` **한 줄 치환(substitution)** 모델이다. 새 내용을 **작성(authoring)** 하는 능력이 없다.
- 카테고리 이분법: `auto-fix`(기계적·안전) vs `audit-only`(주관적·보고만).

요구되는 새 능력: 워크스페이스를 탐색해 **ARCHITECTURE.md / CLAUDE.md / AGENTS.md** 를 *없으면 생성, 있으면 개선*. 이는 본질적으로 **문서 작성(authoring)** 으로, 기존 substitution 모델에 없던 모델이다.

---

## 2. 확정된 설계 결정 (브레인스토밍 합의)

| # | 결정 | 근거 |
|---|---|---|
| D1 | **통합 진입 + 내부 분리** — 진입점은 기존 `scan → garden` 그대로, garden 내부에서 치환/authoring 을 다른 모델로 처리 | 단일 UX 유지(사용자 직관) + garden 의 "기계적·안전" 보장 보존 |
| D2 | **카테고리 삼분법** — `auto-fix \| authoring \| audit-only` | authoring 은 current→suggested diff 에 안 맞음 → 별도 카테고리 필요 |
| D3 | **v1 범위 = CLAUDE.md / AGENTS.md / ARCHITECTURE.md** (에이전트 지침 3종). README/CHANGELOG 는 동일 엔진으로 후속 | 세 문서 모두 "코드베이스 분석"을 공통 정보원으로 공유, deep-docs 정체성("에이전트 지침 문서")에 직결 |
| D4 | **개선 모드 = 적극적 재구성** — 기존 문서가 있어도 전면 점검·재작성 draft 제안 (draft 미리보기 + 승인) | 사용자 선택. 단 원본 비파괴 + 사용자 고유 콘텐츠 보존이 핵심 안전장치 |
| D5 | **authoring 실행 주체 = 신규 `doc-author` 에이전트** | scan→`doc-scanner` 위임 패턴과 대칭, 무거운 코드분석을 서브에이전트로 격리 |
| D6 | **공식 규칙을 `references/authoring-rules/` 로 내장** | 생성 로직이 공식 출처에 근거를 두고 버전 관리 |
| D7 | **부가: CLAUDE↔AGENTS 공존 전략 제안** (심볼릭링크/`@import`) | 둘이 거의 동일 시 중복 제거. Codex 가 README/CLAUDE.md 를 안 읽는 점 반영 |
| D8 | **hook 이관 안티패턴은 "생성 회피 원칙"으로만 흡수** (별도 탐지 기능은 후속) | false-positive 위험 + v1 응집도. 비용 0 으로 품질에 반영 |
| D9 | **ARCHITECTURE↔CLAUDE/AGENTS 연결 = 참조 포인터 권장** (`@import` 아님), 심볼릭링크는 CLAUDE↔AGENTS 동일 내용 시에만, 제안형 | `@import` 는 세션마다 전량 로드(컨텍스트 절감 없음); ARCHITECTURE 는 별도 내용 문서 |

---

## 3. 공식 규칙 근거 (authoring-rules 의 출처)

세 문서 유형의 생성 규칙은 다음 1차/권위 출처에서 도출했다.

### 3.1 CLAUDE.md — Anthropic 공식
- 출처: [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory.md), [best-practices](https://code.claude.com/docs/en/best-practices)
- **200줄 상한** (공식 수치, "Longer files consume more context and reduce adherence")
- 포함: Claude 가 추측 불가한 명령(build/test/lint), 기본값과 다른 규칙, 프로젝트 고유 아키텍처/함정
- 제외: 코드 읽으면 아는 것, 자명한 관행, 파일별 설명, linter 가 이미 강제하는 스타일
- 섹션 골격: Project overview → Essential commands → Tech stack → Directory structure(핵심 경로만) → Conventions(차이점만) → Gotchas
- `/init` 동작: 코드 분석해 생성하되 **있으면 덮어쓰지 않고 개선 제안** (= D4 모델과 일치)
- 안티패턴: 비대화, hook 으로 강제할 규칙을 prose 로 작성(= D8)

### 3.2 AGENTS.md — OpenAI Codex 공식 + agents.md 표준
- 출처: [developers.openai.com/codex/guides/agents-md](https://developers.openai.com/codex/guides/agents-md), [openai/codex `agents_md.rs`/`config_toml.rs`](https://github.com/openai/codex), [agents.md](https://agents.md)
- **32 KiB 바이트 예산** (`project_doc_max_bytes` 기본값, 줄 수 아님). 루트→리프 누적 합이 한도 도달 시 이후 파일 미포함 → "중첩 디렉터리로 분산" 또는 한도 상향
- 계층: `~/.codex/AGENTS.md`(글로벌) + `.git` 루트~CWD walk, **root→cwd concatenate, 가까운 게 우선**, `AGENTS.override.md` 가 같은 레벨 `AGENTS.md` 대체
- **Codex 는 README/CLAUDE.md 를 자동으로 읽지 않음** → 둘의 내용 복사 금지(바이트 예산 낭비)
- 자유 형식(표준 강제 섹션 없음). 관용 섹션: overview / setup / test / style / structure / PR / security / boundaries
- 내부 구분자 `--- project-doc ---` 문자열을 본문에 넣지 말 것(파싱 혼동 회피)

### 3.3 ARCHITECTURE.md — matklad 권위 표준
- 출처: [matklad.github.io/2021/02/06/ARCHITECTURE.md.html](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html)
- 목적: 메인테이너의 정신적 지도. "어디를 고칠지" 찾는 비용 10배 절감. 가끔 기여하는 사람 대상
- 5섹션 골격: **Bird's-eye overview → Codemap → Architectural invariants → Layer boundaries → Cross-cutting concerns**
- Codemap = "국가 지도"(모듈 역할 1~2문장; 파일 목록 아님)
- Invariants = 특히 부정형("X 는 Y 에 의존하면 안 된다") — 코드만 읽어선 발견 어려운 것
- **직접 파일/라인 링크 금지** ("links go stale") → 심볼 이름으로 검색 유도 (= deep-docs 의 dead-reference/stale-example 철학과 정합)
- 적용 임계값 ~10k LOC+, 길이 100~300줄, 코드와 과동기화 말고 연 2회 검토

---

## 4. 아키텍처

### 4.1 카테고리 모델 (이분법 → 삼분법)

```
auto-fix   : dead-reference, moved-path, stale-example, duplicate-block   (기존, 한 줄 diff)
authoring  : missing-doc, thin-doc                                        (신규, 전체 draft)
audit-only : size-warning, rule-code, coverage, map-manual                (기존, 보고만)
```

### 4.2 신규 issue type 2종

- **`missing-doc`** (category: `authoring`) — 권장 문서가 아예 없음.
  - **무차별 생성 금지 가드**: CLAUDE.md/AGENTS.md 는 "코드가 있는 프로젝트면 후보", ARCHITECTURE.md 는 **~10k LOC+ 에서만** 후보 (matklad 임계값).
- **`thin-doc`** (category: `authoring`) — 문서는 있으나 공식 골격 대비 **명백히 미달**(필수 섹션 다수 누락 / 비정상적으로 짧음 / 커버리지 갭 큼). 기존 Rule 7(coverage-gap, audit-only)을 actionable 하게 승격.
  - **시끄러움 방지**: scan 의 thin-doc 판정은 **보수적**(명백한 미달만). 멀쩡한 문서를 무차별 후보로 올리지 않음. "적극적 재구성"(D4)은 garden 에서 doc-author 가 만드는 **draft 의 적극성**으로 실현된다(미리보기에서 거부·수정 가능).

### 4.3 컴포넌트

| 컴포넌트 | 신규/변경 | 역할 |
|---|---|---|
| `agents/doc-scanner.md` | 변경 | Step 1 "없는 파일 건너뜀" → **"missing-doc gap 기록"**. gap 탐지 Step(Rule 9) 신설 |
| `agents/doc-author.md` | **신규** | gap 에 대해 코드 심층 분석 + authoring-rules 적용 → **draft 본문 생성** (tools: Read/Glob/Grep/Bash/Write) |
| `skills/deep-docs/SKILL.md` | 변경 | garden 에 authoring sub-flow, scan 리포트에 authoring 집계, no-arg 분기 |
| `skills/deep-docs-workflow/SKILL.md` | 변경 | 워크플로우에 authoring 분기, "스캔 대상 판단"의 "건너뜀" 규칙 수정 |
| `skills/deep-docs-workflow/references/authoring-rules/` | **신규** | `claude-md.md`, `agents-md.md`, `architecture-md.md`, `README.md`(인덱스 + cross-document 연결 규칙) |
| `skills/deep-docs-workflow/references/scan-rules.md` | 변경 | **Rule 9 (Missing/Thin Doc — authoring)** 추가, 규칙↔Step 매핑 갱신 |
| envelope payload schema | 변경 (minor) | issue `type`/`category` enum 확장 + `authoring_spec` 필드 |
| `scripts/verify-fixes.sh` | 변경 | authoring 관련 grep 체크 추가 |
| `scripts/validate-envelope-emit.js` | 변경 | `authoring_spec` 검증 + authoring fixture |
| `tests/fixtures/sample-last-scan.json` | 변경 | authoring 항목 예시 추가 |

### 4.4 데이터 흐름

```
/deep-docs scan
  └ doc-scanner: 기존 룰(1–8) + Rule 9 gap 탐지(missing/thin)
  └ last-scan.json  ← authoring 항목 포함 (명세만, draft 본문 없음)
  └ 리포트: "auto-fix N · authoring M · audit-only K"

/deep-docs garden
  ├ last-scan.json 재사용/재scan (기존 5-요소 + 3 identity 가드 그대로)
  ├ [치환 항목]    기존 4+2 옵션 diff 흐름 (변경 없음)
  └ [authoring 항목]  새 sub-flow:
       doc-author spawn → 코드분석 + authoring-rules → 전체 draft
       → 전체 미리보기(보존/신규/제거제안 구분) → AskUserQuestion(적용 / 수정요청 / 거부)
       → 적용 시 Write (신규 생성 or 기존 교체) + (해당 시) cross-document 포인터/공존 제안
  └ 1건 이상 변경 시 last-scan.json 삭제 (기존 H-2 규칙 그대로)
```

### 4.5 authoring 항목의 envelope 표현 (핵심 설계점)

scan 은 **"무엇을 어떻게 써야 하는지" 명세만 기록**하고, draft 본문은 garden 시점에 doc-author 가 생성한다(아티팩트 경량 유지 + 10분 TTL 안에 코드가 변해도 draft 는 항상 최신).

```jsonc
{
  "type": "missing-doc",            // 또는 "thin-doc"
  "category": "authoring",
  "severity": "medium",
  "line": null,                     // missing-doc 은 라인 개념 없음
  "current_value": null,            // missing-doc=null, thin-doc=문서 경로
  "suggested_value": null,          // draft 본문은 garden 에서 생성 → scan 단계는 null
  "evidence": "10k+ LOC project, no ARCHITECTURE.md",
  "authoring_spec": {               // 신규 필드 (authoring 항목에만 존재)
    "doc_kind": "architecture-md",  // claude-md | agents-md | architecture-md
    "target_path": "ARCHITECTURE.md",
    "mode": "create",               // create | restructure
    "rationale": "..."              // 왜 이 문서가 필요/부족한지
  }
}
```

- `authoring_spec` 은 `category === "authoring"` 일 때만 존재 (다른 카테고리는 미존재).
- envelope schema 의 `issues[].type` enum 에 `missing-doc`, `thin-doc` 추가. `category` enum 에 `authoring` 추가.
- 후방호환: 기존 소비자(deep-dashboard 등)는 알 수 없는 type/category 를 무시하면 됨. payload schema 버전은 `"1.0"` 유지(가법적 변경) — 단 verify:fixes / validate:envelope 로 신규 필드 계약 검증.

---

## 5. `doc-author` 에이전트 (신규)

- **frontmatter**: `name: doc-author`, `model: sonnet`(또는 opus 검토), `tools: [Read, Glob, Grep, Bash, Write]`, `whenToUse`: garden authoring sub-flow 에서만 spawn.
- **입력 프롬프트**: 프로젝트 루트, git 여부, `authoring_spec`(doc_kind/target_path/mode), 기존 문서 경로(restructure 시).
- **절차**:
  1. `authoring_spec.doc_kind` 에 맞는 `references/authoring-rules/<doc_kind>.md` 로드.
  2. 코드베이스 분석:
     - 공통: 디렉터리 구조, `package.json`/`Makefile`/`pyproject.toml`/`Cargo.toml` 등 빌드·테스트·린트 명령, 린터 설정 파일 존재.
     - architecture-md: 최상위 모듈/레이어, 진입점, 모듈 간 의존(국가 지도 수준).
  3. mode 분기:
     - `create`: 골격에 따라 신규 작성.
     - `restructure`: 기존 문서 파싱 → **공식 규칙으로 도출 불가한 프로젝트 고유 콘텐츠 식별** → 골격 재배치 + 군더더기 제거 + 누락 보강, 고유 콘텐츠 보존.
  4. cross-document 연결 규칙(§7.4) 적용.
  5. 길이 가드(§6.5) 적용.
  6. 산출: draft 본문(문자열) + 변경 요약(보존/신규/제거제안 구분) + (실패 시) 강등 사유.
- **출력 계약**: garden 메인 세션이 미리보기·승인·Write 를 담당. doc-author 는 **파일을 직접 쓰지 않고 draft 를 반환**하는 것을 기본으로 한다(원본 비파괴 — Write 권한은 보유하되 임시 draft 파일 용도로만, 최종 적용은 garden 이 사용자 승인 후 수행). 구현 단계에서 "draft 반환 방식"을 확정(임시파일 vs 본문 반환).

---

## 6. 안전성 / 엣지케이스 (D4 "적극적 재구성" 때문에 가장 중요)

1. **원본 비파괴** — restructure 는 기존 파일 덮어쓰기 전 **전체 미리보기 + 명시적 승인** 필수. 거부 시 원본 그대로. git 환경이면 `git diff` 롤백이 추가 안전망.
2. **사용자 고유 콘텐츠 보존(핵심 리스크)** — restructure 시 doc-author 는 "공식 규칙으로 도출 불가한 프로젝트 고유 지침"(특수 배포 절차, 도메인 규칙, 의도적 컨벤션)을 식별·보존. 미리보기에서 **보존 / 신규 / 제거제안** 을 구분 표시, 제거 후보는 명시 확인(silent drop 금지).
3. **doc-author 실패/빈약** — 의미 있는 draft 생성 실패 시 조용히 넘기지 않고 audit-only 로 강등 + "수동 작성 권장" 안내.
4. **garden-ignored 연동** — authoring 항목도 C옵션(건너뜀+기록)으로 영구 skip(예: "이 프로젝트엔 ARCHITECTURE.md 불필요"). signature 공식에 `authoring` type 포함(기존 `sha256(type + "|" + path + "|" + content_preview[:200])` 그대로 적용; missing-doc 은 content_preview 를 target_path 로).
5. **길이 가드** — draft 가 한도 초과 시 doc-author 자체 압축, 그래도 초과면 미리보기에 size-warning 동반. 한도: CLAUDE.md 200줄, AGENTS.md 32 KiB(누적), ARCHITECTURE.md ~300줄.
6. **non-git** — missing/thin 탐지는 파일 존재·크기·섹션 기반이라 git 무관 동작. freshness 등 git 의존 지표만 기존대로 skip.
7. **멱등성** — 재실행 시 해소된 missing-doc 은 사라지고, 충분해진 문서는 thin 후보에서 빠짐. garden 의 last-scan 삭제 규칙으로 재scan 보장.
8. **심볼릭 링크 자동 생성 금지** — 공존 전략(D7)의 심볼릭 링크는 Windows 호환성/사용자 git 워크플로우 위험이 있어 **제안만 하고 승인 후 생성**. 기본 권장은 `@import` 또는 참조 포인터.

---

## 7. authoring-rules references (신규)

`skills/deep-docs-workflow/references/authoring-rules/` 디렉터리. 기존 `scan-filters/` 와 동일한 reference 패턴(출처 주석 + 알고리즘/규칙).

### 7.1 `claude-md.md`
- 200줄 상한, "코드에서 알 수 없는 것만" 필터, 섹션 골격(§3.1), build/test/lint 추출원, 제외 목록.
- **hook 회피 원칙(D8)**: "항상 X 전에 Y 실행" 류는 prose 규칙으로 생성하지 말고, 필요 시 PreToolUse hook 을 권하는 한 줄만.
- create / restructure 모드 동작.

### 7.2 `agents-md.md`
- 32 KiB 바이트 예산(루트→리프 누적), 관용 섹션, README/CLAUDE.md 복사 금지, `--- project-doc ---` 회피, `AGENTS.override.md`/계층 인지, 모노레포 중첩 분산.

### 7.3 `architecture-md.md`
- 5섹션 골격, 직접 링크 금지→심볼명 검색 유도, Codemap=모듈 역할 1~2문장, ~10k LOC+ 임계, 100~300줄.
- Codemap 자동 생성 전략(디렉터리 구조 → 모듈 역할 서술, 파일 목록 금지).

### 7.4 `README.md` (인덱스 + cross-document 연결 규칙)
- 인덱스 + 공통 원칙(출처 주석, 길이 자가검사).
- **cross-document 연결 규칙(D9)**:
  - ① CLAUDE/AGENTS 생성 시 ARCHITECTURE.md 가 있으면(또는 함께 생성하면) **"코드 구조는 ARCHITECTURE.md 참조" 한 줄 포인터** 자동 삽입(`@import` 아님 — 컨텍스트 절감 + 신선도).
  - ② CLAUDE↔AGENTS 가 거의 동일(번역 쌍 아닌 동일 내용)하면 **공존 전략 제안**: 심볼릭링크 또는 CLAUDE.md 에서 `@AGENTS.md` import.
  - ③ 심볼릭 링크는 제안만, 승인 후 생성(§6.8).

---

## 8. 테스트 / 검증

- `verify-fixes.sh` grep 체크 추가:
  - `authoring` 카테고리 enum 존재 (SKILL/scan-rules/doc-scanner)
  - `missing-doc` / `thin-doc` type 존재
  - `authoring-rules/` 3개 규칙 파일 존재 + 공식 수치 박힘(`200`줄, `32`(KiB), matklad 5섹션 키워드)
  - `doc-author.md` 존재 & tools 에 `Write` 포함
- `validate-envelope-emit.js`: `authoring_spec` 필드(있을 때) 형태 검증 + authoring 항목 fixture self-test.
- `tests/fixtures/sample-last-scan.json`: authoring 항목 예시 추가.
- 기존 grep 체크(현재 43개)와 합산해 모두 green 후 릴리스.

---

## 9. 문서 / 릴리스 (CLAUDE.md "CRITICAL — Plugin Update Workflow" 준수)

1. **버전 minor bump `1.3.1 → 1.4.0`**. 3곳 동기: `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `package.json` + envelope `producer_version` literal(`doc-scanner.md` 내) 동기.
2. `CHANGELOG.md` + `CHANGELOG.ko.md` 에 `## [1.4.0]` 엔트리(Added: authoring 카테고리/`missing-doc`·`thin-doc`/doc-author/authoring-rules; Changed: scan 이 빈 프로젝트에서도 동작).
3. `README.md` + `README.ko.md`: scan rules 표에 authoring 행, garden 워크플로우에 authoring sub-flow, 새 명령 사용 예.
4. `CLAUDE.md` + `AGENTS.md`: 스키마 섹션 동기(삼분법, 새 type, `authoring_spec`) — DOCS_RULE.md 준수(짧게).
5. merge 후 **deep-suite 마켓플레이스 SHA 동기**(`/Users/sungmin/Dev/claude-plugins/deep-suite/` 의 marketplace.json ×2 + README ×2).

---

## 10. 비범위 (Out of Scope) / 후속

- README / CHANGELOG authoring (동일 엔진으로 v2 — D3).
- CONTRIBUTING.md / SECURITY.md authoring (v2 후보).
- hook 이관 안티패턴 **탐지** 기능(D8 — v1 은 생성 회피 원칙만).
- 다국어 문서(번역 쌍) 생성 — v1 3종은 보통 영어 단일.
- 이 플러그인 **자체**의 `docs/DOCS_RULE.md` dead-reference(gitignored 인데 공개 파일이 참조) — 별도 이슈.

---

## 11. 미해결 (구현 단계에서 확정)

- doc-author 의 draft 반환 방식: 본문 문자열 반환 vs 임시 draft 파일 경로 반환(§5 출력 계약).
- thin-doc 판정의 정량 임계값(필수 섹션 누락 N개 / 최소 줄 수 / 커버리지 갭 비율) — authoring-rules 에 명문화.
- `doc-author` model 선택(sonnet vs opus) — authoring 품질 대비 비용.
