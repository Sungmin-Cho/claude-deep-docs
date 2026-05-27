# deep-docs — Document Authoring (생성/재구성) 기능 설계

- **상태**: 설계 리뷰 중 (deep-review-loop 라운드 1·2 대응 반영) → 수렴 후 writing-plans 로 전환
- **작성일**: 2026-05-28
- **대상 버전**: v1.4.0 (minor — 신규 기능)
- **범위**: deep-docs 플러그인이 대상 워크스페이스에서 에이전트 지침 문서를 **생성/재구성**하는 능력 추가

> **리뷰 반영 이력**:
> - 라운드 1 (2-way) REQUEST_CHANGES 🔴5/🟡7 → 반영 (`[R1:Fn]` 표기).
> - 라운드 2 (2-way) REQUEST_CHANGES 🔴3/🟡6 → 반영 (`[R2:…]` 표기): doc-author `Bash` 제거(권한 수준 비파괴 완성), 구조화 출력 계약(default-keep 기계적 강제), schema 1.1 전환의 **6곳 가드 + validator:115** 일괄 명시, `total_issues` 의미 보존, 줄+바이트 dangling 결정 확정.

---

## 1. 배경과 문제

현재 deep-docs 는 **기존 문서가 존재한다는 전제** 위에서만 동작한다.

- `doc-scanner` 는 Glob 으로 기존 문서를 찾고, **하나도 없으면 "스캔할 대상이 없습니다 → 종료"** 한다 (`deep-docs-workflow/SKILL.md` "스캔 대상 판단": *"없는 파일은 건너뛴다. 최소 1개 파일이 있어야 scan 실행 가능"*).
- `garden` 은 `current_value → suggested_value` **한 줄 치환(substitution)** 모델이다. 새 내용을 **작성(authoring)** 하는 능력이 없다.
- 카테고리 이분법: `auto-fix`(기계적·안전) vs `audit-only`(주관적·보고만).

요구되는 새 능력: 워크스페이스를 탐색해 **ARCHITECTURE.md / CLAUDE.md / AGENTS.md** 를 *없으면 생성, 있으면 개선*. 이는 본질적으로 **문서 작성(authoring)** 으로, 기존 substitution 모델에 없던 모델이다.

---

## 2. 확정된 설계 결정 (브레인스토밍 합의 + 라운드 1 리뷰 반영)

| # | 결정 | 근거 |
|---|---|---|
| D1 | **통합 진입 + 내부 분리** — 진입점은 기존 `scan → garden`, garden 내부에서 치환/authoring 분리 처리 | 단일 UX + garden 안전성 보존 |
| D2 | **카테고리 삼분법** — `auto-fix \| authoring \| audit-only` | authoring 은 current→suggested diff 에 안 맞음 |
| D3 | **v1 범위 = CLAUDE.md / AGENTS.md / ARCHITECTURE.md** (에이전트 지침 3종). README/CHANGELOG 후속 | 코드베이스 분석 공통 정보원, deep-docs 정체성 |
| D4 | **개선 모드 = 적극적 재구성** (draft 미리보기 + 승인) | 사용자 선택. 원본 비파괴 + 고유 콘텐츠 보존이 안전장치 |
| D5 | **authoring 실행 주체 = 신규 `doc-author` 에이전트, `tools: [Read, Glob, Grep]` (Write·Bash 둘 다 없음)** `[R1:F1][R2]` | scan→doc-scanner 위임 대칭. **Write 제거 + Bash 제거로 원본 비파괴를 권한 수준에서 완전 보장** (Bash 가 있으면 `echo > file`/`sed -i`/`tee` 로 Write 없이도 파일 변경 가능 — codex[high]+opus F1). doc-author 는 코드 분석(Glob/Grep/Read, 매니페스트 Read 파싱)만 하고 **구조화 result 반환**, 최종 Write 는 garden 만 |
| D6 | **공식 규칙을 `references/authoring-rules/` 로 내장** | 생성 로직 출처 근거 + 버전 관리 |
| D7 | **부가: CLAUDE↔AGENTS 공존 전략 제안** (심볼릭링크/`@import`) | 중복 제거. Codex 가 README/CLAUDE.md 안 읽음 반영 |
| D8 | **hook 이관 안티패턴은 "생성 회피 원칙"으로만 흡수** (탐지 후속) | false-positive 회피 + v1 응집도 |
| D9 | **ARCHITECTURE↔CLAUDE/AGENTS = 참조 포인터 권장** (`@import` 아님), 심볼릭링크는 CLAUDE↔AGENTS 동일 내용 시에만, 제안형 | `@import` 는 세션마다 전량 로드 |
| **D10** | **payload `envelope.schema.version` 1.0 → 1.1** + **exact 가드 6곳 + validator:115 일괄 교체** `[R1:F2][R2]` | gaps[]/enum 추가 = minor bump. exact `=== "1.0"` 가드가 런타임 **6곳**(`doc-scanner.md:291,334`, `deep-docs-workflow/SKILL.md:32,53`, `deep-docs/SKILL.md:90,219`) + `validate-envelope-emit.js:115` 에 하드코딩 → **모두 `"1.1"` 로 교체**. legacy `1.0` 아티팩트는 가드 불일치로 **즉시 재-scan**(TTL 무관; gaps[] 부재 케이스 자연 회피). **소비자(deep-dashboard)는 `summary` 숫자만 읽고 enum strict 검증 안 함** — `total_issues` 의미만 보존하면 영향 없음(D12) |
| **D12** | **`summary.total_issues` 의미 보존** `[R2]` | dashboard 가 `summary.total_issues`/`auto_fixable` 로 docs metric 계산(codex 코드 확인). `total_issues` 는 **`documents[].issues[]` 만 집계**(gaps 제외), authoring 은 `summary.authoring`(=gaps[] 길이) 별도 카운트 → dashboard metric 불변 |
| **D11** | **authoring 길이 = soft 목표(줄), hard fail 은 AGENTS 32KiB 만** `[R1:F3][R3:🟡-3]` | size-warning(>100) 임계값 **불변**. 줄 수 초과는 audit size-warning(비차단)으로만 — authoring 도 줄 수에 hard fail 없이 audit 과 **대칭**(>200=저점수 허용). AGENTS 32KiB(Codex 잘림)만 진짜 차단선 |

---

## 3. 공식 규칙 근거 (authoring-rules 의 출처)

### 3.1 CLAUDE.md — Anthropic 공식
- 출처: [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory.md), [best-practices](https://code.claude.com/docs/en/best-practices)
- **길이** `[R1:F3]`: deep-docs authoring 생성 목표 **≤100줄** (기존 size-warning 임계값과 정렬). Anthropic 공식 **200줄** 은 절대 초과 금지선(hard ceiling) — doc-author 가 200줄 근처면 분할/압축, 100줄 이하를 목표.
- 포함: Claude 가 추측 불가한 명령(build/test/lint), 기본값과 다른 규칙, 함정. 제외: 코드 읽으면 아는 것, 자명한 관행, 파일별 설명, linter 가 이미 강제하는 스타일.
- 섹션 골격: Project overview → Essential commands → Tech stack → Directory structure(핵심 경로만) → Conventions(차이점만) → Gotchas.
- `/init` 동작: 코드 분석해 생성하되 **있으면 덮어쓰지 않고 개선 제안** (= D4).
- 안티패턴(D8): hook 으로 강제할 규칙을 prose 로 작성 금지.

### 3.2 AGENTS.md — OpenAI Codex 공식 + agents.md 표준
- 출처: [developers.openai.com/codex/guides/agents-md](https://developers.openai.com/codex/guides/agents-md), [openai/codex `agents_md.rs`/`config_toml.rs`](https://github.com/openai/codex), [agents.md](https://agents.md)
- **길이 — 줄 + 바이트 병행** `[R1:F11][R2:N3]`: ① 기존 size-warning 정렬 **≤100줄**(scan 의 줄 기반 측정과 호환), ② Codex `project_doc_max_bytes` **32 KiB** 누적(루트→리프). doc-author(authoring) 는 두 가드를 **모두** 적용.
  - **결정 (dangling 해소)**: audit size-warning 은 **줄 기반 불변**(`audit-metrics.md:11` 그대로). AGENTS 바이트 측정은 audit 에 **넣지 않는다**(v2 후보). 즉 authoring 가드(줄+바이트) ↔ audit size-warning(줄)의 비대칭을 **v1 의도된 분리**로 수용 — authoring 은 Codex 런타임 잘림 방지(바이트)까지 책임지고, audit 은 기존 줄 기반 신호 유지. 이 비대칭을 §7.2 / README 에 한 줄 명시해 사용자 혼동 방지.
- 계층: `~/.codex/AGENTS.md`(글로벌) + `.git` 루트~CWD walk, root→cwd concatenate(가까운 게 우선), `AGENTS.override.md` 가 같은 레벨 `AGENTS.md` 대체.
- **Codex 는 README/CLAUDE.md 를 자동으로 읽지 않음** → 둘의 내용 복사 금지(바이트 예산 낭비).
- 자유 형식. 관용 섹션: overview / setup / test / style / structure / PR / security / boundaries.
- 내부 구분자 `--- project-doc ---` 문자열을 본문에 넣지 말 것.

### 3.3 ARCHITECTURE.md — matklad 권위 표준
- 출처: [matklad.github.io/2021/02/06/ARCHITECTURE.md.html](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html)
- 목적: 메인테이너의 정신적 지도. "어디를 고칠지" 찾는 비용 10배 절감. 가끔 기여하는 사람 대상.
- 5섹션 골격: **Bird's-eye overview → Codemap → Architectural invariants → Layer boundaries → Cross-cutting concerns**.
- Codemap = "국가 지도"(모듈 역할 1~2문장; 파일 목록 아님). Invariants = 특히 부정형("X 는 Y 에 의존하면 안 된다").
- **직접 파일/라인 링크 금지** ("links go stale") → 심볼 이름으로 검색 유도 (= deep-docs dead-reference/stale-example 철학과 정합).
- 적용 임계값 ~10k LOC+, 길이 100~300줄, 과동기화 말고 연 2회 검토.

---

## 4. 아키텍처

### 4.1 카테고리 모델 (이분법 → 삼분법)

```
auto-fix   : dead-reference, moved-path, stale-example, duplicate-block   (기존, 한 줄 diff)
authoring  : missing-doc, thin-doc                                        (신규, 전체 draft)
audit-only : size-warning, rule-code, coverage, map-manual                (기존, 보고만)
```

### 4.2 신규 issue type 2종 + Rule 9

`[R1:F4]` **Rule 번호 체계**: 기존 Rule 7(Coverage Gap)은 **audit-only 로 유지**(doc-scanner Step 9 매핑 그대로). thin-doc 은 **새 Rule 9 (Missing/Thin Doc — authoring)** 로 신설. scan-rules.md 의 Rule↔Step 매핑 표(라인 21-31)에 Rule 9 행 추가.

`[R2:F4]` **Rule 7 → thin-doc 재사용 데이터 흐름 (메커니즘)**: Rule 7(doc-scanner Step 9)은 `uncovered_modules[]`(문서에 미언급된 src 하위 모듈 목록)를 산출한다. thin-doc(Rule 9)은 이를 **입력 신호 중 하나로 전달**받아 다음 OR 로 판정한다:
  - (a) 공식 골격의 **필수 섹션 누락 수** ≥ 임계값(§11 정량화), **OR**
  - (b) `len(uncovered_modules[]) / total_modules` ≥ 임계값(커버리지 갭 과다).
  Rule 7 은 audit-only 보고(존재 문서의 갭), Rule 9 는 그 신호를 authoring 판정에 재사용 — **중복 스캔 없이** Step 9 산출을 Step 11(Gap 탐지)이 읽는다.

- **`missing-doc`** (category: `authoring`) — 권장 문서가 아예 없음.
  - **무차별 생성 가드 강화** `[R1:F9]`: CLAUDE.md/AGENTS.md 는 **git 루트에 빌드 매니페스트(`package.json`/`Cargo.toml`/`pyproject.toml`/`go.mod` 등)가 있고 소스 디렉토리가 존재할 때만** 후보. ARCHITECTURE.md 는 ~10k LOC+ 에서만. **모노레포는 루트만 1차 후보, 하위 패키지는 v2.**
- **`thin-doc`** (category: `authoring`) — 문서는 있으나 **공식 골격 대비 명백히 미달**. scan 판정은 **보수적**(명백한 미달만; 정량 임계값은 §11 deferral, authoring-rules 에 명문화).

`[R1:F12]` **severity 부여 규칙**:
| 케이스 | severity |
|---|---|
| missing-doc (CLAUDE/AGENTS) | `medium` |
| missing-doc ARCHITECTURE (10k+ LOC) | `high` (유지보수 비용 10배) |
| thin-doc | `low` ~ `medium` (미달 정도) |

### 4.3 컴포넌트

| 컴포넌트 | 신규/변경 | 역할 |
|---|---|---|
| `agents/doc-scanner.md` | 변경 | `[R2:N4,F4,F7]` **Step 11 "Gap 탐지" 신설**(기존 Step 11 결과출력→**12**, Step 12 emit→**13** 으로 시프트; 소수 번호 회피). Step 1 "없는 파일 건너뜀"→"missing-doc gap 기록". **Step 12(리포트)에 authoring 섹션 추가, Step 13(emit) JSON 에 `summary.authoring` + `payload.gaps[]` emit + `schema.version: "1.1"`** |
| `agents/doc-author.md` | **신규** | gap 코드 분석 + authoring-rules 적용 → **구조화 result 반환**(§5). tools: **`Read, Glob, Grep` (Write·Bash 둘 다 없음)** `[R1:F1][R2]`. frontmatter 는 doc-scanner 패턴 미러(`color`, `<example>` 2개, `whenToUse`) `[R1:I3]` |
| `skills/deep-docs/SKILL.md` | 변경 | garden authoring sub-flow, scan 리포트 authoring 집계 |
| `skills/deep-docs-workflow/SKILL.md` | 변경 | authoring 분기, "스캔 대상 판단" 의 "건너뜀" 규칙 수정 |
| `references/authoring-rules/` | **신규** | `claude-md.md`·`agents-md.md`·`architecture-md.md`·`README.md`(인덱스+cross-doc 규칙) |
| `references/scan-rules.md` | 변경 | Rule 9 추가, Rule↔Step 매핑 갱신 |
| envelope payload schema | 변경 | `type`/`category` enum 확장 + `payload.gaps[]` + `envelope.schema.version` 1.1 |
| `scripts/verify-fixes.sh` | 변경 | authoring grep 추가 + **기존 5지선다 검사(라인 111) 회귀 점검** `[R1:F5]` |
| `scripts/validate-envelope-emit.js` | 변경 | `payload.gaps[]` 형태 + `authoring_spec` 검증 (책임 경계는 §8) |
| `tests/fixtures/sample-last-scan.json` | 변경 | gaps[] 예시 추가 |

`[R1:F3]` **size-warning 임계값 불변**: 본 기능은 scan-rules/audit-metrics/doc-scanner 의 size-warning 임계값(CLAUDE/AGENTS >100, README >300, docs >200)을 **변경하지 않는다**. authoring 길이 목표를 그 기준에 맞춰(D11) 정렬하는 방식으로 자기모순을 해소한다.

### 4.4 데이터 흐름

```
/deep-docs scan
  └ doc-scanner: 기존 룰(1–8) + Rule 9 gap 탐지(missing/thin) [Step 11; 기존 출력/emit→12/13]
  └ last-scan.json  ← payload.gaps[] 에 authoring 명세 (draft 본문 없음)
  └ 리포트: "auto-fix N · authoring M · audit-only K"

/deep-docs garden
  ├ last-scan.json 재사용/재scan (5-요소 + 3 identity 가드; schema.version 가드는 major-forward-compat)
  ├ [진입 시 authoring 항목 스냅샷] — 세션 동안 고정 [R1:F8]
  ├ [치환 항목]    기존 4+2 옵션 diff 흐름 (변경 없음; verify-fixes 5지선다 검사 그대로 유효)
  └ [authoring 항목]  새 sub-flow:
       doc-author spawn → 코드분석 + authoring-rules → draft 본문 반환
       → diff 미리보기(원본→draft, 보존/신규/제거제안 구분; 제거는 default-keep) [R1:F6]
       → AskUserQuestion(적용 / 수정요청 / 거부)  ← 별도 3-option 라벨 (새 grep)
       → 적용 시 **garden 이 Write** (신규 생성 or 기존 교체)
       → cross-doc 포인터/공존 제안은 §7.4 조건 충족 시
  └ garden 세션 **종료 시 1회** last-scan.json 삭제 (≥1 변경 시) [R1:F8]
```

### 4.5 authoring 항목의 envelope 표현 `[R1:F2,F7,F12]`

scan 은 **명세만 기록**, draft 본문은 garden 에서 doc-author 가 생성.

**`[R1:F7]` missing-doc/thin-doc 은 `payload.documents[]` 가 아닌 별도 `payload.gaps[]` 배열에 둔다** (존재하는 문서의 metrics 와 섞이지 않게):

```jsonc
"payload": {
  "documents": [ /* 기존 — 존재하는 문서만 */ ],
  "gaps": [
    {
      "type": "missing-doc",            // 또는 "thin-doc"
      "category": "authoring",
      "severity": "high",               // §4.2 규칙
      "target_path": "ARCHITECTURE.md",
      "exists": false,                  // missing-doc=false, thin-doc=true
      "evidence": "12k LOC, no ARCHITECTURE.md",
      "authoring_spec": {
        "doc_kind": "architecture-md",  // claude-md | agents-md | architecture-md
        "mode": "create",               // create | restructure
        "rationale": "..."
      }
    }
  ],
  "summary": { "total_issues": …, "auto_fixable": …, "authoring": …, "audit_only": … }
  // [R2:D12,F7] total_issues = documents[].issues[] 만 집계 (gaps 제외 — dashboard metric 보존).
  //            authoring = gaps[] 길이 별도 카운트. auto_fixable/audit_only 도 issues[] 기준.
}
```

`[R2:F7]` **gaps[] 는 reuse 5-요소 가드 입력이 아니다**: `worktree_hash` 는 tracked/untracked **파일 내용** 해시이고 gaps[] 는 그로부터 파생된 산출이므로, gaps[] 변화가 worktree_hash/reuse 에 영향을 주지 않는다 (가드는 identity·schema_version·TTL·git.head·worktree_hash 5요소만; gaps[] 미포함).

**`[R1:F2][R2][R3:🔴-1]` schema 버전 (D10) — payload `schema.version` 만 1.0→1.1, top-level `schema_version` 은 유지**:

⚠️ **compound 가드 주의 (라인 단위 일괄 치환 금지)**: 런타임 reuse 가드 라인들은 한 줄에 `schema_version === "1.0"`(top-level, **유지**) **AND** `envelope.schema.version === "1.0"`(payload, **→"1.1"**) 두 조건이 묶여 있다. 각 라인에서 **payload(`envelope.schema.version`) 측만** 교체하고 top-level 측은 그대로 둔다 — 전부 치환하면 top-level wrapper 가드가 깨져 **모든 정상 아티팩트가 영구 재-scan** 회귀(R3 🔴-1).

| 파일:라인 | 교체 | 반드시 유지 |
|---|---|---|
| `doc-scanner.md:237` (emit JSON `"schema":{…,"version"}`) | payload version `"1.0"`→`"1.1"` | 같은 emit 의 top-level `schema_version:"1.0"`(:230) |
| `doc-scanner.md:291` (contract 명세) | payload `schema.version` →`"1.1"` | top-level `schema_version` 서술 |
| `doc-scanner.md:334` (reuse 가드, compound) | payload 측만 →`"1.1"` | top-level `schema_version === "1.0"` |
| `deep-docs-workflow/SKILL.md:32`,`:53` (compound) | payload 측만 →`"1.1"` | top-level |
| `deep-docs/SKILL.md:90`,`:219` (compound) | payload 측만 →`"1.1"` | top-level |
| `validate-envelope-emit.js:115` (`env.schema?.version !== '1.0'`) | →`'1.1'` | **`:81-82` (`data.schema_version !== '1.0'`) 절대 유지** |

legacy `1.0` payload 아티팩트는 가드 불일치로 **즉시 재-scan**(self-emit, 혼용 전환기 없음). `verify-fixes` 에 **회귀 앵커** 추가: top-level `schema_version "1.0"` 가 doc-scanner emit/가드에 **잔존**하는지(=top-level 가드가 살아있는지) 확인하는 grep.

**`[R1:F7]` garden-ignored signature 인자 (missing-doc/thin-doc)**:
| 인자 | missing-doc | thin-doc |
|---|---|---|
| `type` | `"missing-doc"` | `"thin-doc"` |
| `path` | `target_path` | `target_path` |
| `content_preview` | `doc_kind` (예: `"architecture-md"`) | 기존 문서 첫 200자 |

→ `sha256(type + "\|" + target_path + "\|" + preview[:200])`. C옵션(건너뜀+기록)으로 "이 프로젝트엔 ARCHITECTURE.md 불필요" 영구 skip 가능.

---

## 5. `doc-author` 에이전트 (신규) `[R1:F1,I3]`

- **frontmatter**: `name: doc-author`, `model: sonnet`(§11 검토), `color`, `<example>` 2개(garden authoring sub-flow spawn 시나리오), `whenToUse`, **`tools: [Read, Glob, Grep]` — `Write`·`Bash` 둘 다 없음** `[R2]` (Bash 가 있으면 shell redirection 으로 Write 우회 가능 → 둘 다 제거해야 비파괴가 권한 수준에서 완전 보장).
- **출력 계약 (구조화 — 확정)** `[R1:F1,C5][R2: codex high default-keep]`: doc-author 는 파일을 쓰지 않고(Write·Bash 없음) **구조화된 result 객체를 반환**한다:
  ```jsonc
  {
    "base_hash": "<restructure 시 기존 문서의 git hash-object 값; create 는 null>",
    "draft_body": "<생성/재구성된 문서 전문 — 단일 구획, 메타텍스트 미포함>",
    "preserved_blocks": ["<기존 문서에서 보존한 고유 콘텐츠 블록>", …],
    "removal_candidates": [ { "text": "<제거 후보 원문>", "reason": "<재생성 가능 근거>", "anchor": "<재삽입 기준 — 직전 heading 또는 draft_body 내 sentinel; R3:🟡-2>" }, … ]
  }
  ```
  **garden 의 default-keep 기계적 강제** (codex high — prose 가 아닌 contract 로): garden 은
  ① restructure 시 `base_hash` 로 기존 문서가 그 사이 변경되지 않았는지 확인(TOCTOU 방지),
  ② `removal_candidates` 를 사용자에게 **per-removal 명시 승인** 요청,
  ③ **미승인 removal 은 `anchor` 위치(직전 heading 매칭, 없으면 말미) 에 재삽입한 뒤** Write — 승인 안 한 고유 콘텐츠는 기계적으로 보존(silent omit 불가),
  ④ `[R3:🟡-1]` **`preserved_blocks[]` 의 각 블록이 `draft_body` 에 부분문자열로 존재하는지 확인** — 누락 시 **fail-closed**(draft 거부 + 사용자 경고). preserved 경로의 silent-drop 사각을 닫는다(removal 경로만으로는 보존 미보장).
  `draft_body` 는 메타텍스트(요약/강등사유) 없는 단일 구획이므로 garden 이 그대로 Write.
- **입력 프롬프트**: 프로젝트 루트, git 여부, `authoring_spec`(doc_kind/target_path/mode), 기존 문서 내용(restructure 시 Read 결과).
- **절차**:
  1. `references/authoring-rules/<doc_kind>.md` 로드.
  2. 코드베이스 분석: 디렉터리 구조, 빌드/테스트/린트 명령(매니페스트 파싱), 린터 설정. architecture-md 는 최상위 모듈/레이어/진입점/의존(국가 지도 수준).
  3. mode 분기:
     - `create`: 골격대로 신규 작성.
     - `restructure`: 기존 문서 파싱 → **고유 콘텐츠 식별(§6.2 휴리스틱)** → 골격 재배치 + 누락 보강, 고유 콘텐츠 보존.
  4. cross-document 연결(§7.4) + 길이 가드(§6.5) + gitignore 가드(§6 항목 9) 적용.
  5. 산출: 위 **구조화 result 객체**(base_hash/draft_body/preserved_blocks/removal_candidates) + (실패 시) `status: "degraded"` + 강등 사유(별도 필드, draft_body 와 분리).

---

## 6. 안전성 / 엣지케이스 (D4 때문에 가장 중요)

1. **원본 비파괴 — 권한 수준 완전 보장** `[R1:F1][R2]`: doc-author 는 **Write·Bash 둘 다 없으므로** 어떤 경로로도(직접 Write, shell redirection/`sed -i`/`tee`) target 문서를 쓸 수 없다. garden 만 승인 후 Write. restructure 도 §5 구조화 contract(base_hash 확인 + per-removal 승인 + 미승인 재삽입) 통과 후에만 garden 이 교체.
2. **사용자 고유 콘텐츠 보존 — 메커니즘** `[R1:F6][R2: codex high]`: restructure 시 doc-author 는 다음 휴리스틱으로 분류한다 (authoring-rules 에 명문화):
   - **"재생성 가능"(→ `removal_candidates`)** = 코드/빌드설정/공식 규칙에서 **직접 도출 가능한** 문장만.
   - **그 외 전부 `preserved_blocks` 로 기본 보존(보수적 편향)** — 애매하면 보존.
   - **기계적 강제(§5 contract)**: 분류는 result 객체로 반환되고, garden 이 `removal_candidates` 를 per-removal 승인받아 **미승인분을 draft 에 재삽입**한다 → default-keep 이 prose 가 아닌 contract 로 강제됨(silent drop 불가).
   - 미리보기는 **원본→draft 라인 diff** 로 제시(통짜 비교 금지, 인지부하 완화).
3. **doc-author 실패/빈약**: 의미 있는 draft 실패 시 조용히 넘기지 않고 audit-only 강등 + "수동 작성 권장".
4. **garden-ignored 연동**: §4.5 signature 표대로 C옵션 영구 skip.
5. **길이 가드 — 목표 vs 차단 분리** `[R1:F3,F11][R2:F3 현실성]`: draft **목표** = CLAUDE ≤100줄 / AGENTS ≤100줄+≤32KiB / ARCH ≤300줄.
   - **100줄 초과는 authoring 실패가 아니다** — size-warning(audit-only, **비차단**)으로 보고만 된다. doc-author 는 100줄을 *지향*하되 과압축으로 정보를 잃지 않는다(실제 프로젝트 CLAUDE.md 는 흔히 150~200줄+; 100줄 hard target 은 비현실적이라 R2 지적).
   - **줄 수에는 hard fail 없음 — audit 과 대칭** `[R3:🟡-3]`: CLAUDE 줄 수가 200(공식 권고)을 넘어도 doc-author 는 **압축을 *시도*** 하되, 그래도 초과하면 **강제 분할이 아니라 size-warning(비차단)으로 보고만** 한다(audit-metrics 의 `>200 = score 4` "허용 저점수"와 대칭; 이 repo 자신의 276줄 CLAUDE.md 가 audit score-4 로 통과하는 것과 모순 없음).
   - **진짜 hard fail 은 AGENTS 32 KiB 만**: Codex 런타임이 32 KiB 초과분을 **잘라** 기능적 손실이 나므로, 이 경계만 doc-author 가 분할/중첩 분산을 강제 제안.
6. **non-git**: missing/thin 탐지는 파일 존재·크기·섹션 기반이라 git 무관 동작.
7. **멱등성** `[R1:F8]`: garden 진입 시 authoring 항목 스냅샷 고정; last-scan 삭제는 **세션 종료 시 1회**. 재실행 시 해소된 gap 은 사라짐.
8. **심볼릭 링크 자동 생성 금지**: 공존 전략(D7)의 심볼릭 링크는 Windows 호환성 위험 → 제안만, 승인 후 생성. 기본은 `@import`/참조 포인터.
9. **gitignore 가드 (신규)** `[R1:F10]`: doc-author/scan 은 `.gitignore` 를 읽어 **ignored 경로(특히 `docs/`)에는 missing-doc/생성을 제안하지 않는다**. CLAUDE.md/AGENTS.md/ARCHITECTURE.md 는 보통 루트라 안전하나 명문화한다.

---

## 7. authoring-rules references (신규)

`skills/deep-docs-workflow/references/authoring-rules/`. 기존 `scan-filters/` 와 동일 reference 패턴.

### 7.1 `claude-md.md`
- 길이(D11): 목표 ≤100줄, hard ceiling 200줄. "코드에서 알 수 없는 것만" 필터, 섹션 골격(§3.1), build/test/lint 추출원, 제외 목록.
- **hook 회피 원칙(D8)**: "항상 X 전에 Y" 류는 prose 규칙 금지, 필요 시 PreToolUse hook 권하는 한 줄만.
- create / restructure 모드 + §6.2 고유 콘텐츠 식별 휴리스틱.

### 7.2 `agents-md.md`
- 길이(D11/`[R1:F11]`): soft 목표 ≤100줄, hard fail 은 ≤32 KiB(누적, Codex 잘림선). 관용 섹션, README/CLAUDE.md 복사 금지, `--- project-doc ---` 회피, `AGENTS.override.md`/계층 인지, 모노레포 중첩 분산.
- **바이트 근사 `[R3:ℹ️]`**: doc-author 는 Bash(`wc -c`) 가 없으므로 32 KiB 를 **줄 수 × 평균 줄 길이로 근사**(영문 ~60 B/줄 기준 32KiB≈540줄; 한글/긴 줄은 보수적으로 하향). **정확한 바이트 차단은 doc-scanner(Bash 보유) 의 size 측정 책임** — authoring 은 soft 근사로 과대 생성만 예방.
- **줄+바이트 비대칭 명시(D11/N3)**: authoring 은 줄(soft)+바이트(hard) 둘 다 보지만 audit size-warning 은 줄만 본다 — README 에 "authoring 은 Codex 바이트 예산까지 고려, audit 은 줄 기반" 한 줄로 사용자 혼동 방지.

### 7.3 `architecture-md.md`
- 5섹션 골격, 직접 링크 금지→심볼명, Codemap=모듈 역할 1~2문장, ~10k LOC+ 임계, 100~300줄.

### 7.4 `README.md` (인덱스 + cross-document 연결 규칙)
- 인덱스 + 공통 원칙(출처 주석, 길이 자가검사).
- **cross-document 연결 규칙(D9)** `[R1:F8]`:
  - ① CLAUDE/AGENTS 생성 시 ARCHITECTURE.md 가 **이미 존재하거나 같은 garden 세션에서 적용 확정된 경우에만** "코드 구조는 ARCHITECTURE.md 참조" 한 줄 포인터 삽입(`@import` 아님). **거부된 문서로의 포인터 금지**(dead-reference 생성 방지).
  - ② CLAUDE↔AGENTS 가 거의 동일하면 공존 전략 제안(심볼릭링크 또는 `@AGENTS.md` import).
  - ③ 심볼릭 링크는 제안만, 승인 후 생성(§6 항목 8).

---

## 8. 테스트 / 검증 `[R1:F2,F5]`

- `verify-fixes.sh` grep 체크 추가:
  - `authoring` 카테고리 enum, `missing-doc`/`thin-doc` type, `gaps[]` 언급.
  - authoring-rules 3파일 존재 + 공식 수치(100/200줄, 32(KiB), matklad 5섹션 키워드).
  - `doc-author.md` 존재 & **tools 에 `Write`·`Bash` 가 없음** 검사 — `[R2:N2]` frontmatter 리스트 앵커로 한정: `! grep -Eq '^\s*-\s*Write\b' agents/doc-author.md` **AND** `! grep -Eq '^\s*-\s*Bash\b' agents/doc-author.md` (단순 `! grep Write` 는 본문 산문의 "Write" 때문에 항상 fail → false-negative 이므로 금지).
  - **authoring sub-flow 3-option 라벨**(적용/수정요청/거부) 새 grep — 기존 garden 5지선다(라인 111)와 **별개로 공존** 확인.
  - **기존 5지선다 검사 회귀 점검**: authoring 도입이 entry skill 의 garden 옵션 라벨을 건드리지 않음을 확인(라인 111 검사 그대로 green).
- `validate-envelope-emit.js` **책임 경계 + schema 가드 교체** `[R1:F2][R2:N1]`:
  - **라인 115만 교체 (필수), 라인 81-82 는 유지** `[R3:🔴-1]`: `:115` `if (env.schema?.version !== '1.0')`(payload) → `!== '1.1'`. **`:81-82` `if (data.schema_version !== '1.0')`(top-level wrapper) 는 절대 변경 금지** — 둘 다 바꾸면 top-level 게이트가 깨진다. 이 교체 없이 fixture 1.1 → validator fail → `verify-fixes:157` fail → 릴리스 차단(N1). schema.version(payload) 체크만 예외적으로 변경.
  - **로컬 검증기 추가**: `payload.gaps[]` 배열 형태 + 각 gap 의 `authoring_spec`(non-null object, doc_kind 문자열) 검사.
  - **suite payload-registry (cross-repo)**: `issues[].type`/`category`/`gaps[].type` enum 의 권위 검증은 suite-side 책임(§3.4 경계). → §9 release-blocking.
- `tests/fixtures/sample-last-scan.json`: `gaps[]` 예시 + `schema.version: "1.1"` 추가.
- 기존 43개 + 신규 합산 green 후 릴리스.

---

## 9. 문서 / 릴리스 (CLAUDE.md "CRITICAL" 워크플로우 준수)

1. **버전 minor bump `1.3.1 → 1.4.0`**. 3곳 동기 + envelope `producer_version` literal **2곳**(`doc-scanner.md` 의 `producer_version="…"` **그리고** Step 12-B JSON 예시) `[R1:I1]` — verify-fixes 라인 56,60 둘 다 검사.
2. **payload `schema.version` 1.0 → 1.1 (top-level `schema_version` 유지)** `[R1:F2][R2:N1][R3:🔴-1]`: §4.5 의 **compound 가드 분기표**를 따라 각 라인의 **payload 측만** `"1.1"` 로 교체(doc-scanner emit `:237`/contract `:291`/가드 `:334`, workflow SKILL `:32,53`, entry SKILL `:90,219`, validator `:115`) + fixture. **top-level `schema_version` 및 validator `:81-82` 는 유지** + verify-fixes 회귀 앵커. (누락/오치환 시 verify-fixes 차단 또는 영구 재-scan.)
3. **cross-repo 순서 분리** `[R1:F2][R2:F7]`:
   - **release 선행(blocking)**: claude-deep-suite `payload-registry` 의 last-scan schema 에 새 enum(`missing-doc`/`thin-doc`/`authoring`) + `gaps[]` + version 1.1 반영. v1.1 fixture(gaps[]+summary.authoring) 로 strict validation green 확인 **후** 플러그인 release.
   - **metric 영향 없음**: deep-dashboard `aggregator.js` 는 `summary.total_issues`/`auto_fixable` 만 읽어 `auto_fix_accept_rate` 계산 → D12(total_issues=issues only) 로 비율 불변(코드 확인). `suite-collector.js` 의 ingest 게이트도 top-level `schema_version==="1.0"` 유지로 계속 작동.
   - **`[R3:🔴-2]` 알려진 한계 (dashboard gaps 비가시)**: deep-dashboard `action-router.js` 의 `docs-stale` 라우팅은 `documents[].issues[]` 만 순회하고 **`gaps[]` 를 읽지 않는다**. 따라서 **빈/신규 레포**(CLAUDE/ARCHITECTURE 부재 → `documents[]` 비고 `gaps[]` 만 참) 의 authoring 백로그는 dashboard 에 **0건으로 보인다**. deep-docs 는 `gaps[]` 를 올바르게 emit 하므로 **`/deep-docs scan|garden` 직접 실행으로는 정상 노출** — 기능 자체는 dashboard 무관하게 동작. dashboard 가 `gaps[]` 를 `docs-missing` finding 으로 산출하는 건 **deep-dashboard repo 후속**(§10). v1 한계로 README + §10 에 명시.
4. `CHANGELOG.md`+`.ko.md` `[1.4.0]` 엔트리(Added: authoring/doc-author/authoring-rules/gaps[]; Changed: scan 이 빈 프로젝트에서도 동작, payload schema 1.1).
5. `README.md`+`.ko.md`: scan rules 표 authoring 행, garden authoring sub-flow, **빈/신규 레포 authoring gap 의 dashboard 비노출 한계 한 줄**(R3:🔴-2).
6. `CLAUDE.md`+`AGENTS.md`: 스키마 섹션 동기(삼분법, gaps[], schema 1.1) — DOCS_RULE.md 준수.
7. merge 후 deep-suite 마켓플레이스 SHA 동기.

---

## 10. 비범위 / 후속

- README / CHANGELOG authoring (v2 — D3).
- CONTRIBUTING.md / SECURITY.md authoring (v2).
- hook 이관 안티패턴 **탐지** 기능(D8 — v1 은 생성 회피 원칙만).
- 모노레포 하위 패키지 missing-doc(§4.2 — v2).
- thin-doc 탐지 기능(v1 포함), 다국어 번역 쌍 생성(v1 3종은 영어 단일 — 제외).
- **deep-dashboard 소비자의 schema 1.1 / 새 enum forward-compat 처리** `[R1:F2]` (cross-repo 후속).
- **deep-dashboard `action-router.js` 의 `gaps[]` 소비(`docs-missing` finding)** `[R3:🔴-2]` (cross-repo 후속) — 그전까지 **빈/신규 레포의 authoring gap 은 dashboard `docs-stale` 에 비노출**(알려진 한계). `/deep-docs` 직접 실행으로는 정상 노출되고 metric(total_issues 비율)도 D12 로 불변이므로 v1 release-blocking 아님. README 에 한계 명시.
- 이 플러그인 자체의 `docs/DOCS_RULE.md` dead-reference(gitignored 인데 공개 파일이 참조) — 별도 이슈.
- **이 spec 파일 자체의 tracked 상태** `[R1:F10/C7]`: 리뷰를 위해 `git add -f` 로 임시 추적 중. 머지 단계(워크플로우 step 7)에서 DOCS_RULE.md §1(specs=local-only) 정책에 맞춰 `git rm --cached` 로 추적 해제.

---

## 11. 미해결 (구현 단계에서 확정) `[R1:F1/C5 반영 — draft 반환 방식은 §5 에서 확정 완료]`

- ~~doc-author 의 draft 반환 방식~~ → **§5 에서 확정**: 본문 문자열 반환, Write 권한 없음.
- **thin-doc 정량 임계값**(필수 섹션 누락 N개 / 최소 줄 수 / 커버리지 갭 비율) — authoring-rules `architecture-md.md`/`claude-md.md` 에 명문화. scan 은 "보수적"(§4.2) 방향 고정이라 구현 차단 아님.
- **`doc-author` model 선택**(sonnet vs opus) — authoring 품질 대비 비용. 구현 후 dogfood 측정.
