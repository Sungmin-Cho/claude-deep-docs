# deep-docs v1.4.0 — Document Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** deep-docs가 대상 워크스페이스의 CLAUDE.md/AGENTS.md/ARCHITECTURE.md를 없으면 생성·있으면 재구성하는 authoring 능력을 추가한다(scan이 gap 탐지, garden이 doc-author 통해 draft 생성·승인 적용).

**Architecture:** 카테고리 삼분법(`auto-fix`/`authoring`/`audit-only`). scan(doc-scanner)이 `payload.gaps[]`에 authoring 명세만 기록, garden이 `doc-author`(Read/Glob/Grep만 — 권한 수준 비파괴) spawn → 구조화 result `{draft_body, preserved_blocks[], removal_candidates[]}`(TOCTOU `base_hash`는 **garden이 소유** — doc-author는 Bash 없어 hash 계산 불가) → per-removal 승인 + preserved 검증 후 garden만 Write. payload `schema.version` 1.0→1.1(compound 가드의 payload 측만 교체).

**Tech Stack:** Markdown(agent/skill/references), Bash(`verify-fixes.sh` grep 매트릭스), Node ESM(`validate-envelope-emit.js` zero-dep validator), JSON fixture.

**근거 spec:** `docs/superpowers/specs/2026-05-28-deep-docs-authoring-design.md` (deep-review-loop 4라운드 수렴, opus APPROVE). 본 plan의 각 Task는 spec의 결정(D1~D12)·컴포넌트표(§4.3)·안전성(§6)·테스트(§8)·릴리스(§9)를 구현 단위로 분해한다. spec은 승인된 single-source 설계이므로 Task가 `spec §N`을 참조하는 것은 정당(placeholder 아님).

---

## File Structure

**Create:**
- `agents/doc-author.md` — authoring 에이전트(코드 분석 → 구조화 draft result 반환; Write·Bash 없음)
- `skills/deep-docs-workflow/references/authoring-rules/claude-md.md` — CLAUDE.md 생성 규칙(200 ceiling/100 목표, 필터, 골격, hook 회피)
- `skills/deep-docs-workflow/references/authoring-rules/agents-md.md` — AGENTS.md 규칙(줄+바이트, Codex 계층, 복사 금지)
- `skills/deep-docs-workflow/references/authoring-rules/architecture-md.md` — matklad 5섹션, 링크 금지
- `skills/deep-docs-workflow/references/authoring-rules/README.md` — 인덱스 + cross-document 연결 규칙(D9)

**Modify:**
- `agents/doc-scanner.md` — Step 11(Gap 탐지) 신설, 기존 11/12→12/13 시프트, emit에 `gaps[]`/`summary.authoring`/payload `schema.version "1.1"`/`producer_version "1.4.0"`, 가드 라인 payload 측 `"1.1"`
- `skills/deep-docs-workflow/references/scan-rules.md` — Rule 9 추가, Rule↔Step 매핑 갱신
- `skills/deep-docs/SKILL.md` — garden authoring sub-flow, scan 리포트 authoring 집계, 가드 payload 측 `"1.1"`
- `skills/deep-docs-workflow/SKILL.md` — authoring 분기, "스캔 대상 판단"의 건너뜀 규칙, 가드 payload 측 `"1.1"`
- `scripts/validate-envelope-emit.js` — `:115`만 `'1.1'`, `:81-82` 유지, `payload.gaps[]`/`authoring_spec` shape 검사 추가
- `scripts/verify-fixes.sh` — authoring grep 체크 + schema 1.1 회귀 앵커(top-level 잔존) + producer_version 1.4.0
- `tests/fixtures/sample-last-scan.json` — `schema.version "1.1"`, `gaps[]`, `summary.authoring`, `producer_version "1.4.0"`
- `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `package.json` — `1.3.1`→`1.4.0`
- `CHANGELOG.md`, `CHANGELOG.ko.md` — `[1.4.0]` 엔트리
- `README.md`, `README.ko.md` — scan rules authoring 행, garden authoring sub-flow, dashboard 한계 고지
- `CLAUDE.md`, `AGENTS.md` — 스키마 섹션 동기(삼분법/gaps[]/schema 1.1)

**의존성 순서:** Task 1(envelope/버전 기반) → Task 2(scan rule/scanner) → Task 3(doc-author) → Task 4(authoring-rules) → Task 5(garden sub-flow) → Task 6(verify-fixes 통합) → Task 7(문서/릴리스). Task 1이 schema/버전 기반이라 먼저.

---

### Task 1: Envelope schema 1.1 + gaps[] + 버전 1.4.0 (기반)

**Files:**
- Modify: `tests/fixtures/sample-last-scan.json`
- Modify: `scripts/validate-envelope-emit.js:115` (payload guard) + payload.gaps[] shape
- Modify: `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `package.json` (version)

- [ ] **Step 1: fixture를 schema 1.1 + gaps[] + summary.authoring + producer_version 1.4.0으로 갱신**

`tests/fixtures/sample-last-scan.json` 편집 — `envelope.producer_version`을 `"1.3.1"`→`"1.4.0"`, `envelope.schema.version`을 `"1.0"`→`"1.1"`(top-level `schema_version`은 `"1.0"` 유지), `payload`에 `gaps[]` 추가, `summary`에 `authoring` 추가:

```json
    "summary": {
      "total_issues": 1,
      "auto_fixable": 1,
      "authoring": 1,
      "audit_only": 0
    },
    "gaps": [
      {
        "type": "missing-doc",
        "category": "authoring",
        "severity": "high",
        "target_path": "ARCHITECTURE.md",
        "exists": false,
        "evidence": "12k LOC, no ARCHITECTURE.md",
        "authoring_spec": {
          "doc_kind": "architecture-md",
          "mode": "create",
          "rationale": "large codebase lacks architecture map"
        }
      }
    ]
```

(envelope.producer_version `"1.4.0"`, envelope.schema.version `"1.1"`, top-level schema_version `"1.0"` 유지.)

- [ ] **Step 2: validator 실행해서 FAIL 확인 (schema.version 1.1이 :115 하드체크에 걸림)**

Run: `node scripts/validate-envelope-emit.js`
Expected: FAIL — `envelope.schema.version must be "1.0" for this release (got "1.1")` (그리고 producer_version 1.4.0 vs plugin.json 1.3.1 불일치도 가능)

- [ ] **Step 3: validator `:115` payload 가드를 `'1.1'`로 교체 ( `:81-82` top-level은 절대 유지 )**

`scripts/validate-envelope-emit.js` 라인 115-117 교체:

```javascript
  if (env.schema?.version !== '1.1') {
    fail(`envelope.schema.version must be "1.1" for this release (got ${JSON.stringify(env.schema?.version)})`);
  }
```

**라인 81-82(`data.schema_version !== '1.0'`, top-level wrapper)는 변경 금지** — spec §4.5 분기표. SCHEMA_VERSION_RE(`:112`)는 `\d+\.\d+`라 1.1 통과.

- [ ] **Step 4: payload.gaps[] + authoring_spec shape 검사 추가**

`scripts/validate-envelope-emit.js`의 payload 검사부(`pl.documents` 블록 다음, `pl.summary` 검사 앞)에 추가:

```javascript
  // payload.gaps[] (authoring; optional). [R3-plan:medium] write 경로 입력 — enum/매핑/traversal 강제.
  const DOC_KIND_TO_PATH = { 'claude-md': 'CLAUDE.md', 'agents-md': 'AGENTS.md', 'architecture-md': 'ARCHITECTURE.md' };
  if ('gaps' in pl) {
    if (!Array.isArray(pl.gaps)) {
      fail('payload.gaps must be an array when present');
    } else {
      pl.gaps.forEach((g, idx) => {
        if (!g || typeof g !== 'object' || Array.isArray(g)) {
          fail(`payload.gaps[${idx}] must be a non-null, non-array object`); return;
        }
        if (g.category !== 'authoring') fail(`payload.gaps[${idx}].category must be "authoring"`);
        const sp = g.authoring_spec;
        if (!sp || typeof sp !== 'object' || Array.isArray(sp)) {
          fail(`payload.gaps[${idx}].authoring_spec must be a non-null object`); return;
        }
        if (!(sp.doc_kind in DOC_KIND_TO_PATH)) {
          fail(`payload.gaps[${idx}].authoring_spec.doc_kind must be one of ${Object.keys(DOC_KIND_TO_PATH).join('|')}`);
        }
        if (sp.mode !== 'create' && sp.mode !== 'restructure') {
          fail(`payload.gaps[${idx}].authoring_spec.mode must be "create" or "restructure"`);
        }
        const tp = g.target_path;
        const expected = DOC_KIND_TO_PATH[sp.doc_kind];
        if (typeof tp !== 'string' || !tp) {
          fail(`payload.gaps[${idx}].target_path must be non-empty string`);
        } else if (tp.startsWith('/') || tp.includes('\\') || /^[A-Za-z]:/.test(tp) || tp.split('/').includes('..')) {
          // [R3-plan-R4] absolute / drive-root(C:) / backslash / ".." traversal 거부
          fail(`payload.gaps[${idx}].target_path must be root-local POSIX path (no absolute / drive-root / backslash / ".." traversal)`);
        } else if (expected && !(tp === expected || tp.endsWith('/' + expected))) {
          // [R3-plan-R4] 정확 매칭만: root expected 또는 모노레포 "<pkg>/expected". fooCLAUDE.md / src/x/CLAUDE.md 거부.
          fail(`payload.gaps[${idx}].target_path must be "${expected}" or "<pkg>/${expected}" (got "${tp}")`);
        }
      });
    }
  }
```

(symlink/ignored 경로 거부는 garden 의 Write-직전 검사가 담당 — validator 는 정적 JSON 만 보므로 enum/매핑/traversal 까지. spec §4.5.)

- [ ] **Step 5: 버전 3곳 1.4.0으로 bump**

`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `package.json`의 `"version": "1.3.1"`→`"1.4.0"`.

- [ ] **Step 6: validator 실행해서 PASS 확인**

Run: `node scripts/validate-envelope-emit.js`
Expected: PASS — `✓ tests/fixtures/sample-last-scan.json matches deep-docs M3 envelope contract` (단, producer_version 1.4.0 == plugin.json 1.4.0 동기 확인됨)

- [ ] **Step 6b: negative fixture(malformed gap) 거부 확인 `[R3-plan:medium]`**

`tests/fixtures/sample-last-scan-invalid-gap.json` 생성 — valid envelope(schema 1.1, producer_version 1.4.0)이되 `payload.gaps[0]` 에 **nested target_path**(예: `"target_path": "src/generated/CLAUDE.md"`, doc_kind `claude-md`) — `endsWith` 우회를 대표하는 케이스. 이 fixture 로 validator 실행:

Run: `node scripts/validate-envelope-emit.js tests/fixtures/sample-last-scan-invalid-gap.json`
Expected: FAIL (exit 1) — `payload.gaps[0].target_path must be "CLAUDE.md" or "<pkg>/CLAUDE.md" (got "src/generated/CLAUDE.md")`. **추가로** `fooCLAUDE.md`(접두)·`..\..\CLAUDE.md`(backslash traversal)·`C:\CLAUDE.md`(drive-root)도 거부됨을 구현 시 단위 확인(fixture 변형 또는 인라인 테스트). malformed gap 이 garden write 경로로 새기 전 validator 에서 차단됨을 증명.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/sample-last-scan.json tests/fixtures/sample-last-scan-invalid-gap.json scripts/validate-envelope-emit.js .claude-plugin/plugin.json .codex-plugin/plugin.json package.json
git commit -m "feat(envelope): schema 1.1 + payload.gaps[] (enum/traversal guard) + bump to 1.4.0"
```

---

### Task 2: scan-rules Rule 9 + doc-scanner Gap 탐지 Step

**Files:**
- Modify: `skills/deep-docs-workflow/references/scan-rules.md`
- Modify: `agents/doc-scanner.md`

- [ ] **Step 1: scan-rules.md에 Rule 9 추가 + Rule↔Step 매핑 갱신**

`skills/deep-docs-workflow/references/scan-rules.md`의 "규칙 번호 ↔ doc-scanner Step 매핑" 표에 행 추가:

```
| Rule 9 (Missing/Thin Doc) — authoring | Step 11 |
```

그리고 "Audit-only" 섹션 뒤에 새 "## Authoring (garden에서 생성/재구성)" 섹션 추가 — spec §4.2 내용: missing-doc(빌드 매니페스트+소스 디렉토리 조건, ARCHITECTURE는 ~10k LOC+, 모노레포 루트만 1차), thin-doc(공식 골격 대비 명백한 미달; Rule 7 `uncovered_modules[]`를 입력 재사용: 필수 섹션 누락 OR 커버리지 갭 과다), severity 표(missing CLAUDE/AGENTS=medium, missing ARCHITECTURE 10k+=high, thin=low~medium).

- [ ] **Step 2: doc-scanner.md Step 시프트 + Step 11 Gap 탐지 신설**

`agents/doc-scanner.md`에서 기존 `### 11. 결과 출력`→`### 12. 결과 출력`, `### 12. 결과 저장`→`### 13. 결과 저장`으로 번호 시프트. 그 사이에 `### 11. Gap 탐지 (Missing/Thin Doc — authoring)` 신설 — spec §4.2/§4.3: Glob으로 CLAUDE/AGENTS/ARCHITECTURE 존재 확인, 부재 시 missing-doc gap(가드 조건 충족 시), 존재하나 골격 미달 시 thin-doc gap. Step 9(coverage)의 `uncovered_modules[]` 재사용. 결과를 `payload.gaps[]`에 기록.
  **`[R3-plan:ℹ️-1]` scan-side gitignore 가드 (spec §6 item 9)**: Step 11 은 `.gitignore` 로 ignored 된 경로(특히 `docs/`)를 **gap 후보에서 제외**한다 — gap 이 scan 에서 먼저 생성되므로 scan-side 에서 걸러야 garden 까지 새지 않음(doc-author body 가드와 양쪽 대칭). scan-rules Rule 9 기술에도 "ignored 경로 제외" 명시.

또한 doc-scanner Step 1("문서 발견")이 glob 결과에서 **부재 권장문서(CLAUDE/AGENTS/ARCHITECTURE)를 gap 후보로 넘기도록** 보강(Step 11에서 가드 적용). `[R3-plan:opus ℹ️]` 참고: "없는 파일은 건너뛴다" 리터럴 자체는 doc-scanner 가 아니라 `skills/deep-docs-workflow/SKILL.md:76` "최소 1개 파일이 있어야 scan 실행 가능" 에 있으며 **Task 5 Step 2 가 그 위치를 개조**한다 — doc-scanner Step 1 은 glob 리스트만 산출하므로 여기선 "부재 문서를 gap 후보로 표시"만 추가.

- [ ] **Step 3: doc-scanner.md emit(Step 13)에 gaps[]/summary.authoring/schema 1.1/producer_version 1.4.0 반영**

`agents/doc-scanner.md`의 Step 12-B JSON 예시(현 `:228-281`)와 Step 12-A producer literal 갱신 — spec §4.5/§9:
- `producer_version="1.3.1"` literal(현 `:184`) → `producer_version="1.4.0"`
- emit JSON의 `"producer_version": "1.3.1"`(`:233`) → `"1.4.0"`
- payload schema: `"schema": { "name": "last-scan", "version": "1.0" }`(`:237`)의 **version만** `"1.1"` (top-level `"schema_version": "1.0"` (`:230`)는 유지)
- contract 명세(`:291` `envelope.schema.version === "1.0"`)의 payload 측 → `"1.1"` (top-level 서술 유지)
- reuse 가드(`:334` compound 라인)의 payload 측 `envelope.schema.version === "1.0"` → `"1.1"` (top-level `schema_version === "1.0"` 유지)
- JSON 예시 payload에 `gaps[]`(missing-doc 예시) + `summary`에 `authoring` 필드 추가
- `payload.summary` 설명에 "total_issues = documents[].issues[] only (gaps 제외), authoring = gaps[] 길이" 명시(D12)

- [ ] **Step 4: 임시 검증 — 시프트/가드가 깨지지 않았는지 grep**

Run:
```bash
grep -c '"schema_version": "1.0"' agents/doc-scanner.md   # top-level 유지 (≥1)
grep -c '"version": "1.1"' agents/doc-scanner.md            # payload schema 1.1 (≥1)
grep -n '### 1[123]\.' agents/doc-scanner.md                # Step 11/12/13 존재
```
Expected: top-level `schema_version "1.0"` 잔존(≥1), payload `version "1.1"` 등장, Step 11/12/13 헤딩 존재.

- [ ] **Step 5: Commit**

```bash
git add skills/deep-docs-workflow/references/scan-rules.md agents/doc-scanner.md
git commit -m "feat(scan): Rule 9 gap 탐지(Step 11) + doc-scanner emit gaps[]/schema 1.1"
```

---

### Task 3: doc-author 에이전트 (신규)

**Files:**
- Create: `agents/doc-author.md`

- [ ] **Step 1: doc-author.md 작성 (spec §5)**

`agents/doc-author.md` 생성 — frontmatter: `name: doc-author`, `model: sonnet`, `color: green`, `tools: [Read, Glob, Grep]`(Write·Bash 없음), `<example>` 2개(garden authoring sub-flow에서 missing-doc create / thin-doc restructure spawn 시나리오), `whenToUse`(garden authoring sub-flow에서만 spawn, 직접 호출 금지). 본문: spec §5 절차 1-5(authoring-rules 로드 → 코드 분석[Glob/Grep/Read, 매니페스트 Read 파싱] → create/restructure 분기 → cross-doc 연결·길이 가드·gitignore 가드 → 구조화 result 반환). 출력 계약 `{draft_body, preserved_blocks[], removal_candidates[](anchor 포함)}` + 실패 시 `status: "degraded"`. **`base_hash` 는 출력에 없음** `[R3-plan-R4:🔴 base_hash]` — doc-author 는 Bash 없어 `git hash-object` 계산 불가, TOCTOU baseline 은 garden 이 소유(Task 5). doc-scanner.md frontmatter 패턴 미러.

doc-scanner.md frontmatter를 참조 패턴으로:
```markdown
---
name: doc-author
model: sonnet
color: green
description: |
  garden authoring sub-flow에서 spawn되어 CLAUDE.md/AGENTS.md/ARCHITECTURE.md draft를
  생성/재구성하는 에이전트. 파일을 쓰지 않고 구조화 result를 반환한다.
  <example>
  Context: /deep-docs garden 의 authoring sub-flow 가 missing-doc(ARCHITECTURE.md) 처리 시 spawn
  prompt: "authoring_spec: {doc_kind: architecture-md, target_path: ARCHITECTURE.md, mode: create}. 프로젝트 루트: /Users/foo/proj. references/authoring-rules/architecture-md.md 규칙대로 코드 분석 후 draft 구조화 result 반환."
  </example>
  <example>
  Context: thin-doc(CLAUDE.md) restructure 시 spawn
  prompt: "authoring_spec: {doc_kind: claude-md, target_path: CLAUDE.md, mode: restructure}. 기존 문서 내용 첨부. 고유 콘텐츠 보존(preserved_blocks)/재생성가능(removal_candidates) 분류해 result 반환."
  </example>
whenToUse: |
  /deep-docs garden 의 authoring sub-flow 에서만 spawn 된다. 직접 호출하지 않는다.
  파일을 쓰지 않으며(Write·Bash 없음), draft 를 구조화 result 로 반환한다.
tools:
  - Read
  - Glob
  - Grep
---
```

- [ ] **Step 2: 검증 — Write/Bash 부재 grep (frontmatter 리스트 앵커)**

Run:
```bash
grep -Eq '^\s*-\s*Write\b' agents/doc-author.md && echo "FAIL: Write present" || echo "OK: no Write"
grep -Eq '^\s*-\s*Bash\b' agents/doc-author.md && echo "FAIL: Bash present" || echo "OK: no Bash"
grep -Eq '^\s*-\s*Read\b' agents/doc-author.md && echo "OK: Read present" || echo "FAIL: no Read"
```
Expected: `OK: no Write`, `OK: no Bash`, `OK: Read present`.

- [ ] **Step 3: Commit**

```bash
git add agents/doc-author.md
git commit -m "feat(authoring): add doc-author agent (Read/Glob/Grep only, structured result)"
```

---

### Task 4: authoring-rules references (4파일)

**Files:**
- Create: `skills/deep-docs-workflow/references/authoring-rules/claude-md.md`
- Create: `skills/deep-docs-workflow/references/authoring-rules/agents-md.md`
- Create: `skills/deep-docs-workflow/references/authoring-rules/architecture-md.md`
- Create: `skills/deep-docs-workflow/references/authoring-rules/README.md`

- [ ] **Step 1: claude-md.md 작성 (spec §3.1/§7.1)**

`claude-md.md` — 출처 주석(code.claude.com/docs). 규칙: soft 목표 ≤100줄, hard fail 없음(>200은 size-warning 비차단), "Claude가 코드에서 알 수 없는 것만" 필터, 섹션 골격(overview→commands→tech→structure→conventions→gotchas), build/test/lint는 매니페스트 Read 파싱, 제외 목록(파일별 설명/자명한 관행/linter 강제 스타일), **hook 회피 원칙(D8)**: "항상 X 전에 Y" 류 prose 금지. create/restructure 모드 + §6.2 고유 콘텐츠 식별 휴리스틱(재생성 가능→removal_candidates, 그 외→preserved_blocks 보수적).

- [ ] **Step 2: agents-md.md 작성 (spec §3.2/§7.2)**

`agents-md.md` — 출처(developers.openai.com/codex, agents.md). soft ≤100줄 + hard ≤32KiB(누적), 관용 섹션, README/CLAUDE.md 복사 금지, `--- project-doc ---` 회피, `~/.codex/AGENTS.md` 글로벌+`.git` 루트~CWD 계층/`AGENTS.override.md`, 모노레포 중첩 분산. byte 근사 heuristic(영문 ~60B/줄, 정확 측정은 doc-scanner 책임). 줄+바이트 비대칭 명시.

- [ ] **Step 3: architecture-md.md 작성 (spec §3.3/§7.3)**

`architecture-md.md` — 출처(matklad). 5섹션 골격(Bird's-eye→Codemap→Invariants→Layer boundaries→Cross-cutting), 직접 파일 링크 금지→심볼명 검색 유도, Codemap=모듈 역할 1~2문장, ~10k LOC+ 임계, 100~300줄.

- [ ] **Step 4: README.md 작성 (spec §7.4 — 인덱스 + cross-document 연결 규칙 D9)**

`authoring-rules/README.md` — 인덱스 + 공통 원칙(출처 주석/길이 자가검사) + cross-document 연결 규칙: ① CLAUDE/AGENTS 생성 시 ARCHITECTURE.md가 존재하거나 같은 세션 확정 시에만 "코드 구조는 ARCHITECTURE.md 참조" 포인터 삽입(거부 문서 포인터 금지), ② CLAUDE↔AGENTS 거의 동일 시 공존 전략(심볼릭링크/@import) 제안, ③ 심볼릭링크는 제안만·승인 후 생성.

- [ ] **Step 5: 검증 — 4파일 존재 + 공식 수치 박힘**

Run:
```bash
for f in claude-md agents-md architecture-md README; do
  [ -f "skills/deep-docs-workflow/references/authoring-rules/$f.md" ] && echo "OK: $f" || echo "FAIL: $f"
done
grep -q '200' skills/deep-docs-workflow/references/authoring-rules/claude-md.md && echo "OK: claude 200"
grep -Eq '32 ?KiB|32KiB' skills/deep-docs-workflow/references/authoring-rules/agents-md.md && echo "OK: agents 32KiB"
grep -Eq 'Codemap|Bird' skills/deep-docs-workflow/references/authoring-rules/architecture-md.md && echo "OK: arch 5섹션"
```
Expected: 모두 OK.

- [ ] **Step 6: Commit**

```bash
git add skills/deep-docs-workflow/references/authoring-rules/
git commit -m "feat(authoring): add authoring-rules references (CLAUDE/AGENTS/ARCHITECTURE + cross-doc)"
```

---

### Task 5: garden authoring sub-flow (SKILL 2개)

**Files:**
- Modify: `skills/deep-docs/SKILL.md`
- Modify: `skills/deep-docs-workflow/SKILL.md`

- [ ] **Step 1: deep-docs/SKILL.md에 authoring sub-flow 추가 (spec §4.4/§5/§6)**

`skills/deep-docs/SKILL.md`의 `### /deep-docs garden` 절차에 authoring 분기 추가: 진입 시 `payload.gaps[]` 스냅샷 고정 → 치환 항목은 기존 4+2 옵션(불변) → authoring 항목은 sub-flow: doc-author spawn(Task subagent_type=doc-author, authoring_spec 전달) → 구조화 result 수신 → ① **garden 이 TOCTOU baseline 소유 (doc-author 아님 — Bash 없음)** `[R3-plan:🔴 create-TOCTOU][R3-plan-R4:🔴 base_hash]`: garden 이 doc-author spawn **전** baseline 캡처(restructure: `git hash-object target` / create: 부재 기록), Write **직전** 재계산·`lstat` 비교 — restructure hash 불일치(변경)·create 존재/심볼릭이면 fail-closed("이미 존재/변경 — 재scan/restructure 전환?" 승인) → ② removal_candidates per-removal 승인(AskUserQuestion 적용/수정요청/거부) → ③ 미승인 removal을 anchor 위치 재삽입 → ④ preserved_blocks가 draft_body에 존재 확인(누락 fail-closed) → ⑤ **target_path 재정규화**(절대/traversal/symlink/ignored 거부, doc_kind↔path 매핑) → garden이 Write → cross-doc 포인터/공존 제안(§7.4 조건). 세션 종료 시 1회 last-scan 삭제(≥1 변경). scan 리포트에 authoring 집계 추가. 재사용 가드의 `envelope.schema.version` payload 측 `"1.0"`→`"1.1"`(top-level `schema_version` 유지) — `:90`, `:219`.
  또한 **deep-docs/SKILL.md scan 절차의 "문서 0개 → 종료"(현 `### /deep-docs scan` Step 2 "문서가 하나도 발견되지 않은 경우 … 종료")를 "missing-doc gap 탐지 진행"으로 개조** `[R3-plan-R4:🔴 entry-skill]` — entry skill 은 Codex/SDK self-contained 라 `deep-docs-workflow/SKILL.md`(Task 5 Step 2)와 **별도** 개조 필수(빈/신규 레포 = authoring 의 flagship 경로). Task 6 에 "scan no-documents early-exit 문구 제거" verify-fixes assertion 추가.

- [ ] **Step 2: deep-docs-workflow/SKILL.md에 authoring 분기 + 가드 갱신 (spec §4.4)**

`skills/deep-docs-workflow/SKILL.md`의 garden 워크플로우에 authoring sub-flow 요약 추가, "스캔 대상 판단"의 "없는 파일은 건너뛴다 ... 최소 1개 파일" → "없는 권장 문서는 missing-doc gap으로 기록(빈 프로젝트도 authoring 가능)"으로 개조. 재사용 가드 `:32`, `:53`의 payload 측 `envelope.schema.version === "1.0"`→`"1.1"`(top-level 유지).

- [ ] **Step 3: 검증 — authoring sub-flow 키워드 + 가드 1.1 + top-level 유지**

Run:
```bash
grep -q 'doc-author' skills/deep-docs/SKILL.md && echo "OK: doc-author spawn"
grep -q 'removal_candidates\|preserved_blocks' skills/deep-docs/SKILL.md && echo "OK: 구조화 contract"
grep -q '수정요청' skills/deep-docs/SKILL.md && echo "OK: authoring 3-option 라벨(적용/수정요청/거부)" || echo "FAIL: 3-option 라벨 누락"
grep -c 'envelope.schema.version === "1.1"' skills/deep-docs/SKILL.md skills/deep-docs-workflow/SKILL.md   # payload 가드 1.1
grep -c 'schema_version === "1.0"' skills/deep-docs/SKILL.md skills/deep-docs-workflow/SKILL.md            # top-level 유지
```
Expected: doc-author/구조화 OK, payload 가드 1.1 등장, top-level `schema_version "1.0"` 잔존.

- [ ] **Step 4: Commit**

```bash
git add skills/deep-docs/SKILL.md skills/deep-docs-workflow/SKILL.md
git commit -m "feat(garden): authoring sub-flow (doc-author spawn, structured apply, schema 1.1 guard)"
```

---

### Task 6: verify-fixes.sh authoring 체크 + 회귀 앵커 (통합 검증)

**Files:**
- Modify: `scripts/verify-fixes.sh`

- [ ] **Step 1: authoring 관련 grep 체크 추가**

`scripts/verify-fixes.sh`의 결과 출력(`echo "---"`) 앞에 체크 추가:

```bash
# ===== Authoring (v1.4.0) =====
check "doc-author agent exists" \
  "[ -f agents/doc-author.md ]"
check "doc-author has NO Write tool (frontmatter list)" \
  "! grep -Eq '^\s*-\s*Write\b' agents/doc-author.md"
check "doc-author has NO Bash tool (frontmatter list)" \
  "! grep -Eq '^\s*-\s*Bash\b' agents/doc-author.md"
check "authoring category enum in scan-rules" \
  "grep -q 'authoring' skills/deep-docs-workflow/references/scan-rules.md"
check "missing-doc / thin-doc types present" \
  "grep -Eq 'missing-doc' agents/doc-scanner.md && grep -Eq 'thin-doc' agents/doc-scanner.md"
check "entry skill no-documents path → missing-doc gap (빈 레포 authoring; R3-plan-R4 entry-skill)" \
  "grep -q 'missing-doc' skills/deep-docs/SKILL.md"
check "payload.gaps[] documented in doc-scanner" \
  "grep -Eq '\"gaps\"|payload\\.gaps|gaps\\[\\]' agents/doc-scanner.md"   # 구조 토큰 (ℹ️-2: 느슨한 'gaps' 단어 매칭 회피)
for f in claude-md agents-md architecture-md README; do
  check "authoring-rules/${f}.md exists" \
    "[ -f skills/deep-docs-workflow/references/authoring-rules/${f}.md ]"
done
check "doc-author spawn in entry skill garden" \
  "grep -q 'doc-author' skills/deep-docs/SKILL.md"
check "structured apply contract (removal_candidates/preserved_blocks)" \
  "grep -Eq 'removal_candidates|preserved_blocks' skills/deep-docs/SKILL.md"
check "authoring 3-option labels present, distinct from garden 5지선다 A-E" \
  "grep -Eq '수정요청' skills/deep-docs/SKILL.md"   # [R3-plan:🟡-2] spec §8 — authoring 적용/수정요청/거부 라벨 회귀 가드(5지선다 :111 과 별개 공존)
```

(라벨 토큰 `수정요청` 은 Task 5 Step 1 에서 작성하는 authoring sub-flow AskUserQuestion 의 고유 라벨 — garden 5지선다(적용/건너뜀/건너뜀+기록/일괄)에는 없으므로 두 옵션셋 공존을 구조적으로 보증.)

- [ ] **Step 2: schema 1.1 회귀 앵커 추가 (top-level 유지 + payload 1.1)**

```bash
# ===== schema 1.1 transition (top-level 1.0 유지) =====
check "doc-scanner payload schema.version is 1.1" \
  "grep -Eq '\"version\":\s*\"1\.1\"' agents/doc-scanner.md"
check "doc-scanner top-level schema_version STAYS 1.0 (회귀 앵커)" \
  "grep -Eq '\"schema_version\":\s*\"1\.0\"' agents/doc-scanner.md"
check "validator top-level guard :81 STAYS 1.0" \
  "grep -q \"data.schema_version !== '1.0'\" scripts/validate-envelope-emit.js"
check "validator payload guard :115 is 1.1" \
  "grep -q \"env.schema?.version !== '1.1'\" scripts/validate-envelope-emit.js"
```

- [ ] **Step 3: 기존 5지선다 검사 회귀 확인 (불변)**

`verify-fixes.sh:111-112`의 기존 "garden 5지선다(A-E)" 검사는 **그대로 유지**(authoring 3-option은 별개). 변경하지 않음. (authoring sub-flow가 entry skill의 기존 garden 옵션 라벨을 건드리지 않았는지 확인하는 의미.)

- [ ] **Step 4: 전체 verify-fixes + validate-envelope 실행 (green)**

Run:
```bash
npm run validate:envelope && npm run verify:fixes
```
Expected: validate-envelope `✓ ... matches`; verify-fixes 마지막 줄 `Passed: N  Failed: 1` — **남은 1건은 정확히 `CHANGELOG has current version entry [1.4.0]`** (`verify-fixes.sh:146`; `plugin.json` 은 Task 1 에서 1.4.0 으로 bump 됐으나 CHANGELOG `[1.4.0]` 엔트리는 Task 7 Step 1 에서 추가되므로 — opus 실측 재현 `[R3-plan:🟡-1]`). **이 CHANGELOG 1건을 제외한 다른 Failed 가 있으면 디버깅**(producer_version 2건은 Task 2 에서 이미 해소됐어야 함). Task 7 Step 4 에서 최종 `Failed: 0` 을 단언한다 — 즉 Task 6 의 의도된 1-fail 은 verify-fixes 무시 학습이 아니라 "버전↔CHANGELOG 동기의 마지막 조각이 Task 7" 이라는 명시적 상태다.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-fixes.sh
git commit -m "test(verify): authoring grep checks + schema 1.1 regression anchors"
```

---

### Task 7: 문서 / 릴리스 (CHANGELOG, README, CLAUDE/AGENTS)

**Files:**
- Modify: `CHANGELOG.md`, `CHANGELOG.ko.md`, `README.md`, `README.ko.md`, `CLAUDE.md`, `AGENTS.md`

- [ ] **Step 1: CHANGELOG (both languages) [1.4.0] 엔트리**

`CHANGELOG.md`/`CHANGELOG.ko.md` 상단(헤더 다음)에 `## [1.4.0] — 2026-05-28` 추가. `### Added`: document authoring (missing-doc/thin-doc → doc-author가 CLAUDE/AGENTS/ARCHITECTURE draft 생성·재구성), `payload.gaps[]`. `### Changed`: scan이 빈 프로젝트에서도 동작(없는 권장 문서를 gap으로 기록), `envelope.schema.version` 1.0→1.1, garden에 authoring sub-flow(구조화 승인). Keep a Changelog 형식, user-observable만(내부 리뷰 narration 금지 — DOCS_RULE.md §3).

- [ ] **Step 2: README (both) authoring 반영**

`README.md`/`README.ko.md`: Commands 표/Scan rules에 authoring 카테고리 행 추가, garden 워크플로우에 authoring sub-flow 한 단락, **빈/신규 레포 authoring gap의 dashboard 비노출 한계 한 줄**(spec §9.5/R4). `verify-fixes`가 grep하는 불변(`≥ 9.0`, `freshness_score: 6` 부재)은 보존.

- [ ] **Step 3: CLAUDE.md / AGENTS.md 스키마 섹션 동기**

`CLAUDE.md`의 "Key Concepts" envelope/payload 스키마에 삼분법(`auto-fix`/`authoring`/`audit-only`), `payload.gaps[]`, `envelope.schema.version "1.1"`(top-level `schema_version "1.0"` 유지), `summary.authoring`(total_issues 제외) 반영. "Auto-fix vs audit-only invariant" 표에 authoring 행. `AGENTS.md` Runtime Surfaces에 `agents/doc-author.md`, `authoring-rules/` 추가. DOCS_RULE.md 준수(짧게, 버전 하드코딩 금지).

- [ ] **Step 4: 전체 검증 재실행**

Run:
```bash
npm run validate:envelope && npm run verify:fixes
git status
```
Expected: 둘 다 green — verify-fixes 마지막 줄 **`Passed: N  Failed: 0`** (Task 6 의 의도된 1-fail 인 `CHANGELOG has current version entry [1.4.0]` 가 본 Step 1 의 CHANGELOG 엔트리 추가로 해소됨 `[R3-plan:🟡-1]`). validate-envelope `✓ matches`.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md CHANGELOG.ko.md README.md README.ko.md CLAUDE.md AGENTS.md
git commit -m "docs: v1.4.0 authoring — CHANGELOG/README/CLAUDE/AGENTS sync"
```

---

## 릴리스 게이트 (executable — Task 7 후, 워크플로우 step 7 merge **전** 필수) `[R3-plan-R4:🔴 suite gate]`

deep-docs 가 `schema.version 1.1` / `gaps[]` 아티팩트를 emit 하므로, **merge 전에 deep-suite 소비자가 1.1 을 수용**해야 한다(codex high — version-skew 시 suite strict validator 가 새 아티팩트 거부/telemetry 누락). 비범위 노트가 아니라 **executable 선행 게이트**:

- [ ] **Gate 1: deep-suite payload-registry v1.1 반영** — `/Users/sungmin/Dev/claude-plugins/deep-suite/schemas/payload-registry/` 의 last-scan schema(또는 deep-docs 항목)에 새 enum(`missing-doc`/`thin-doc`/`authoring`) + `gaps[]` + `schema.version 1.1` 추가. (실제 경로/구조는 suite repo 에서 확인 — codex 가 `deep-suite/scripts/validate-artifact.js` 존재 확인함.)
- [ ] **Gate 2: suite strict validation green** — deep-docs v1.1 fixture(`tests/fixtures/sample-last-scan.json`, gaps[]+summary.authoring)를 suite validator 로 검증 통과. Run: `node /Users/sungmin/Dev/claude-plugins/deep-suite/scripts/validate-artifact.js /Users/sungmin/Dev/claude-plugins/deep-docs/tests/fixtures/sample-last-scan.json` → exit 0.
- [ ] **Gate 3: 게이트 통과 후에만** deep-docs merge(워크플로우 step 7) → marketplace rollout(step 8). Gate 1–2 미통과 시 merge 보류.

(deep-dashboard `action-router.js` 의 `gaps[]`→`docs-missing` 소비는 **후속 release**(non-blocking) — 빈-레포 비노출은 spec §9.7 한계 고지. metric(total_issues 비율)은 D12 로 불변이라 dashboard 즉시 영향 없음.)

## 비범위 (spec §10)

- **deep-suite payload-registry v1.1 반영은 비범위가 아니라 위 "릴리스 게이트"(executable, merge 전 필수)로 승격됨** `[R3-plan-R4:🔴 suite gate]` (codex high — 비범위 노트로는 강제 안 돼 version-skew 발생). deep-dashboard `action-router.js` 의 `gaps[]`→`docs-missing` 소비만 후속 release(non-blocking, 빈-레포 비노출 §9.7).
- README/CHANGELOG/CONTRIBUTING authoring(v2), 모노레포 하위 패키지 missing-doc(v2), hook 안티패턴 탐지(v2), thin-doc 정량 임계값·doc-author model(§11 — 구현 중 dogfood).
- spec 파일 자체 tracked 해제(`git rm --cached`)는 워크플로우 step 7(머지) 단계.
