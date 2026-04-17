# Design: deep-docs v1.1.0 — Ultrareview Fixes

- **Date**: 2026-04-17
- **Author**: Sungmin-Cho (with Claude Code)
- **Status**: Revised v3 (deep-review 2차 REQUEST_CHANGES 대응 — heuristic을 `scan-filters/` 디렉토리로 분리, `.deep-review/reports/2026-04-17-round2-review.md` 반영)
- **Source Review**: `docs/ultrareview-2026-04-17.md`
- **Target Version**: v1.1.0 (semver minor)

---

## 1. Goal

`docs/ultrareview-2026-04-17.md`에서 식별된 24건의 결함(Critical 3, High 6, Medium 9, Low 6) 전부를 해결한다. 단순 문구 수정에 그치지 않고, 모호했던 heuristic과 스키마를 스펙 수준에서 못박아 구현자 간 재현성을 확보한다.

---

## 2. Non-Goals

- 신규 기능 추가(cross-plugin scan, CI hook 등 backlog 항목). 이번 릴리스는 "고치기"에 집중.
- 스키마 메이저 버전 업. 다만 §5.5 필드 rename은 breaking change이므로 `schema_version: 1 → 2`로 bump하고, consumer는 version 불일치 시 재-scan으로 대응(§5.2 참조).
- 새 외부 의존성 도입. 모든 변경은 markdown + bash 수준.

---

## 3. Architecture Overview

### 3.1 File Inventory

**수정 (9 항목 / 10 파일)** + **신규 `scan-filters/` 디렉토리 (6 파일 + README)**
| 파일 | 변경 요지 |
|------|-----------|
| `.claude-plugin/plugin.json` | 버전 `1.0.0` → `1.1.0` |
| `package.json` | 버전 bump + `"private": true` 추가 |
| `agents/doc-scanner.md` | `tools`에 `Write` 추가, 예시 JSON 정규화 |
| `commands/deep-docs.md` | `Agent`→`Task`, pseudo-code 교체, 가든 후 재스캔 로직 |
| `skills/deep-docs-workflow/SKILL.md` | 재사용 조건에 `worktree_hash` 추가, garden→무효화 |
| `skills/.../references/scan-rules.md` | 번역 쌍·코드펜스·backtick 필터·CLI whitelist heuristic 삽입, Rule 번호↔Step 번호 정합 |
| `skills/.../references/audit-metrics.md` | freshness 구간 명시, 반올림 규칙, 크기 임계값 정합, §5 공식화 |
| `README.md` + `README.ko.md` | scoring 밴드 부등호화, 새 아티팩트 안내, 설치 안내 보강 |
| `CHANGELOG.md` | v1.1.0 섹션 추가 |

**추가 (10)**
| 파일 | 목적 |
|------|------|
| `scripts/verify-fixes.sh` | grep 기반 스펙 준수 체크 |
| `.gitignore` | `.deep-docs/` 제외 |
| `docs/superpowers/specs/2026-04-17-deep-docs-ultrareview-fixes-design.md` | 본 문서 |
| `skills/deep-docs-workflow/references/scan-filters/README.md` | 필터 디렉토리 인덱스 |
| `skills/deep-docs-workflow/references/scan-filters/translation-pair.md` | 번역 쌍 그룹핑 필터 |
| `skills/deep-docs-workflow/references/scan-filters/code-fence.md` | fenced block + segment 분리 |
| `skills/deep-docs-workflow/references/scan-filters/reference-extraction.md` | 참조 추출 |
| `skills/deep-docs-workflow/references/scan-filters/cli-whitelist.md` | CLI stale 판정 |
| `skills/deep-docs-workflow/references/scan-filters/worktree-hash.md` | NUL-safe artifact 해시 |
| `skills/deep-docs-workflow/references/scan-filters/freshness-timestamp.md` | epoch 기반 신선도 |

**삭제 (1)**
| 파일 | 이유 |
|------|------|
| `hooks/hooks.json` | v1.1 active hook 없음, non-standard `description` 필드 |

**스테이징 (1)**
| 파일 | 이유 |
|------|------|
| `docs/backlog-2026-04-16.md` | 기존 untracked 파일 커밋 |

---

## 4. Heuristic Specifications — `scan-filters/` 디렉토리로 분리

**v3 변경**: heuristic 세부는 **독립 필터 파일**로 분리하여 각각 자기 완결적으로 리뷰·테스트 가능하게 한다. 본 스펙은 **조합 규칙**만 기술한다.

### 4.0 필터 디렉토리 구조

```
skills/deep-docs-workflow/references/scan-filters/
├── README.md                    # 필터 목록 + 호출 순서
├── translation-pair.md          # 번역 쌍 그룹핑 (C-1, X-1, NC-1, Codex P2)
├── code-fence.md                # fenced block 인식 + segment 분리 (CX-1, NEW-FENCE-INDENT)
├── reference-extraction.md      # backtick/link 참조 추출 (H-3, X-3)
├── cli-whitelist.md             # CLI stale 판정 (M-7, X-4, NEW-CLI-BYPASS)
├── worktree-hash.md             # artifact 재사용 해시 (H-1, X-2, NEW-RCE)
└── freshness-timestamp.md       # path별 last-modified (H-4, H-6, NC-2)
```

각 필터 파일은 공통 구조: **목적 / 입력 / 출력 / 알고리즘 / Bash-equivalent / Edge Case 매트릭스 / Failure Modes / 통합 지점 / 버전**.

### 4.1 조합 규칙 (스캔 Step별 필터 호출)

| doc-scanner.md Step | 호출 필터 | 역할 |
|--------------------|-----------|------|
| Step 1 (문서 발견) 후 | [`translation-pair.md`](../skills/deep-docs-workflow/references/scan-filters/translation-pair.md) | 번역 가족 그룹 맵 생성 |
| Step 2 (참조 추출) 전 | [`code-fence.md`](../skills/deep-docs-workflow/references/scan-filters/code-fence.md) | segment 분할 |
| Step 2 (참조 추출) | [`reference-extraction.md`](../skills/deep-docs-workflow/references/scan-filters/reference-extraction.md) | non-fenced segment에서만 추출 |
| Step 3 (참조 검증, CLI) | [`cli-whitelist.md`](../skills/deep-docs-workflow/references/scan-filters/cli-whitelist.md) | stale 판정 (2단계 lookup → whitelist) |
| Step 5 (신선도) | [`freshness-timestamp.md`](../skills/deep-docs-workflow/references/scan-filters/freshness-timestamp.md) | epoch 기반 max(git_ts, fs_ts) |
| Step 6 (중복 탐지) | `code-fence.md` + `translation-pair.md` | segment 내 3-line 해시, 번역 가족 내부는 audit-only |
| Step 12 (아티팩트 저장) | [`worktree-hash.md`](../skills/deep-docs-workflow/references/scan-filters/worktree-hash.md) | NUL-safe provenance 해시 |

### 4.2 스펙 레벨 조합 원칙 (필터 간 상호작용)

1. **Translation-pair 우선**: 중복 탐지 결과(Step 6)의 각 duplicate 쌍은 `translation-pair.md`의 그룹 맵을 통해 **auto-fix / audit-only** 카테고리가 결정된다. 동일 그룹 내부 중복은 audit-only.

2. **code-fence가 reference-extraction의 전제**: `reference-extraction.md`는 `code-fence.md`의 segment 출력을 입력으로 받는다. fenced block 내부 참조는 **아예 추출되지 않음** (X-3 해결).

3. **freshness-timestamp는 doc 자체에도 적용**: 문서와 참조 경로 모두 `freshness-timestamp.md`의 동일 로직으로 시각 판정. 양쪽 동일 기준으로 stale 비율 산출.

4. **CLI Rule 순서 역전 (NEW-CLI-BYPASS 해결)**: `cli-whitelist.md`에서 **project-specific 2단계 lookup(npm/make)**이 **system whitelist보다 먼저** 시도됨. `npm run missing-script`는 whitelist shortcut으로 새지 않음.

5. **Determinism 원칙**: `$PATH` lookup은 default OFF. 켜는 경우 `last-scan.json.provenance.path_check_enabled: true`로 기록하여 재사용 시 설정 일치 검증.

### 4.3 Dogfood 테스트 벡터

각 필터의 Edge Case 매트릭스에서 추출한 통합 테스트 세트 — §7.5에서 실제 실행:

- **Translation (C-1)**: `README.md` + `README.ko.md` 쌍은 동일 그룹, `config.md` + `config.go.md`는 다른 그룹.
- **Code fence (CX-1)**: 3 space 들여쓰기된 ```` ``` ````도 fence로 인식.
- **Reference (X-3)**: fenced block 내부 `` `src/auth/middleware.ts` ``은 dead-ref 후보 아님.
- **CLI (NEW-CLI-BYPASS)**: `npm run nonexistent-script`는 stale, `npm run build`(package.json 확인)는 pass.
- **Worktree hash (NEW-RCE)**: 파일명 `$(echo hacked).md` 포함해도 shell 실행 안 됨 + 해시 결정적.
- **Freshness (NC-2)**: 커밋된 git 시간보다 mtime이 더 새로우면 mtime 채택 (Linux/macOS 모두).

---

## 5. Schema & Artifact Changes

### 5.1 `.deep-docs/last-scan.json` — provenance 확장 (H-1, H-5)

```json
{
  "scanned_at": "2026-04-17T10:00:00Z",
  "schema_version": 2,
  "provenance": {
    "is_git": true,
    "head_sha": "db70507...",
    "branch": "main",
    "worktree_hash": "sha1:3f8a..."
  },
  "documents": [...],
  "summary": {...}
}
```

- `worktree_hash` — **`scan-filters/worktree-hash.md` 참조**. 핵심 속성:
  - `git diff HEAD --binary` + `git ls-files -z --others --exclude-standard` + NUL-safe bash loop로 tracked/untracked 모두 반영 (X-2)
  - `xargs -I{} sh -c '...'` **금지** — 파일명 RCE 위험 (NEW-RCE)
  - `shasum -a 1` 사용, `sha1sum` 금지 (macOS 호환, O-6)
  - 파일명에 `$()`, backtick, dash-prefix(`-rf`) 포함해도 안전
- **non-git 환경**: `provenance`는 `{ "is_git": false }` 만. 다른 필드 생략.
- `schema_version` (리뷰 O-2, O-4 대응): **`2`로 bump**. 이는 §5.5 필드 rename(breaking change) 반영. consumer는 §5.2의 재사용 규칙에서 version 비교 수행.

### 5.2 재사용 4-요소 규칙 (H-1, H-2, O-4 대응)

`garden`/`audit`는 기존 아티팩트 재사용 시 **전부** 만족해야 함:
1. **`schema_version` = `2`** (리뷰 O-4 대응 — 버전 불일치 시 재-scan)
2. `scanned_at`이 현재 기준 10분 이내
3. `provenance.head_sha` = 현재 `git rev-parse HEAD` (git 환경만)
4. `provenance.worktree_hash` = 현재 계산값 (git 환경만)

하나라도 불일치하면 기존 아티팩트 폐기하고 재-scan.

**추가**: `garden`이 1건이라도 수정을 적용하면 종료 시 `.deep-docs/last-scan.json`을 삭제. 다음 `audit`/`garden`은 반드시 재-scan.

### 5.3 Freshness 스코어 정규화 (H-4, H-6, M-1)

허용 값: **`{10, 7, 4, null}`**

| stale 비율 | 점수 |
|------------|------|
| `<30%` | 10 |
| `30–70%` | 7 |
| `≥70%` | 4 |
| 참조 경로 없음 | `null` (평균에서 제외) |

`doc-scanner.md` 예시 JSON의 `"freshness_score": 6` → `7`로 정정.

**Stale 판정의 timestamp 소스 — `scan-filters/freshness-timestamp.md` 참조**. 핵심 속성:

- **Epoch seconds로 수치 비교** (문자열 `sort -r` 금지 — Linux에서 `T` vs space 문제로 잘못된 max 반환, NC-2)
- `git log -1 --format=%ct -- "$P"` (epoch, 포맷 해석 불필요)
- macOS `stat -f %m` / Linux `stat -c %Y` / fallback `date -r +%s` — 모두 epoch 정수
- `max(git_ts, fs_ts)` 채택 — workspace에서 수정된 미커밋 파일이 올바르게 최신으로 인식됨 (H-6)
- 타임존 무관 (epoch는 절대시각)

### 5.4 `.deep-docs/garden-ignored.json` 새 아티팩트 (M-8)

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
- `garden` 실행 시 각 auto-fix 항목의 signature 계산 → `ignored`에 있으면 prompt skip
- 수동 삭제로 재노출 가능

### 5.5 Issue 필드명 명확화 (M-6, O-2 대응)

**Breaking change 인정**: 필드 rename은 backward-incompatible. 이를 위해 `schema_version: 1 → 2`로 bump(§5.1 참조). consumer(garden/audit)는 재사용 시 version 체크로 구버전 아티팩트를 자동 재-scan(§5.2 Rule 1). **마이그레이션 스크립트는 제공하지 않음** — 아티팩트는 재생성 비용이 낮고(수십 초), CHANGELOG v1.1.0 Breaking 섹션에 명시.

기존:
```json
{ "type": "dead-reference", "reference": "...", "suggestion": "..." }
```

변경:
```json
{
  "type": "dead-reference",
  "current_value": "src/auth/middleware.ts",
  "suggested_value": "src/auth/auth-middleware.ts",
  "evidence": "git rename detected"
}
```

---

## 6. Scoring & Threshold Unification

### 6.1 Size 임계값 통일 (M-3, CX-2 대응)

**Boundary 정합** (리뷰 CX-2 대응) — scan 경고는 **strict `>`**, audit 만점은 **`≤`**. 정확히 경계값이면 scan 경고 안 나오고 audit 만점 유지:

| 파일 유형 | scan 경고 (strict) | audit 점수 |
|-----------|--------------------|------------|
| CLAUDE.md / AGENTS.md | `>100` → 분리 제안 | `≤100:10, 100<x≤200:7, >200:4` |
| README.md | `>300` | `≤300:10, 300<x≤500:7, >500:4` |
| 기타 docs/ | `>200` | `≤200:10, 200<x≤400:7, >400:4` |

- 예: CLAUDE.md 정확히 100줄 → scan 경고 **없음**, audit **10점** (이전 스펙의 "경고+만점" 모순 제거)
- 101줄 → scan 경고 발생, audit 7점 (정합)
- scan과 audit 경계값을 1:1 대응시킴.

### 6.2 반올림 & 밴드 경계 (M-2)

- 종합 점수: `Math.round(score * 10) / 10` (소수점 1자리)
- 밴드:

| 점수 구간 | 밴드 |
|-----------|------|
| `score ≥ 9.0` | 🟢 Excellent |
| `7.0 ≤ score < 9.0` | 🟡 Good |
| `5.0 ≤ score < 7.0` | 🟠 Fair |
| `score < 5.0` | 🔴 Poor |

3개 파일 동시 반영: `audit-metrics.md`, `README.md`, `README.ko.md`.

**전환 안내 (리뷰 O-10 대응)**: 기존 README의 밴드 표는 정수 구간(`9–10, 7–8, 5–6, 1–4`)이었으나 v1.1.0부터 소수점 1자리 + strict 부등호로 변경됨. 이 변경은 CHANGELOG.md v1.1.0 "Changed" 섹션에 별도 항목으로 기록한다 ("Audit score now rounded to 1 decimal; bands use strict inequalities").

### 6.3 Map vs Manual 공식화 (L-6)

- **외부 포인터 라인** = 다음 중 하나를 포함:
  - `[텍스트](URL)` 또는 `[텍스트](상대경로)`
  - `"참고:"`, `"see also"`, `"자세한 내용은"`, `"refer to"`
  - 단독 URL 라인 (`https?://...`)
- **직접 지침 라인** = 외부 포인터 아님 ∧ 빈 라인 아님 ∧ 헤딩(`^#`) 아님 ∧ 코드펜스 라인 아님
- **비율** = `외부 포인터 / (외부 포인터 + 직접 지침)`
- audit-only (점수 없음)

### 6.4 단위 표기

- `reference_accuracy`: `0.0~1.0` float 유지. audit 점수 산출 시 `round(accuracy * 10, 1)` 적용 명시.
- `freshness_score`: 10점 만점 정수.
- `doc-scanner.md` 예시 JSON에 단위 주석 병기.

---

## 7. UX & Tooling

### 7.1 Garden 배치 승인 (M-9, O-3, O-7 대응)

**"세션" 정의** (리뷰 O-3 대응): "현재 세션"이란 **단일 `/deep-docs garden` 호출 (시작 ~ 종료)**을 의미. (D)/(E) 선택은 **in-memory**로 유지되며, 호출이 끝나면 소실됨(단, (C)는 `garden-ignored.json`에 영구 기록).

**`type` 사용자 표시 매핑** (리뷰 O-3 대응) — issue 객체의 `type` 필드를 한국어 레이블로 변환해서 prompt에 노출:

| `type` 값 | 한국어 레이블 |
|-----------|---------------|
| `dead-reference` | 죽은 참조 |
| `moved-path` | 이동/리네임된 경로 |
| `stale-example` | 오래된 예시/명령어 |
| `duplicate-block` | 중복 지침 블록 |
| `size-warning` | 크기 초과 |

각 항목에서 5지선다 `AskUserQuestion`:
- **(A) 적용**
- **(B) 건너뜀 (이번만)**
- **(C) 건너뜀 + 기록** (`garden-ignored.json` 추가, M-8 연동)
- **(D) 이하 모두 적용 — "{한국어 레이블}" 일괄 수락**
- **(E) 이하 모두 건너뜀 — "{한국어 레이블}" 일괄 거부**

(D)/(E) 범위는 **현재 세션 + 동일 `type`**. 다른 타입은 여전히 prompt.

**플랫폼 제약 대응 (리뷰 O-7)**: `AskUserQuestion`이 최대 4 옵션으로 제한되는 플랫폼일 수 있음. 플랜 단계에서 **POC 스텝** 필수:
- Step 1: 간단한 doc-scanner 호출로 5 옵션 `AskUserQuestion` 가능 여부 검증
- 실패 시 fallback: (C)+(D) 옵션을 별도 meta-prompt로 분리 ("이 유형을 모두 어떻게 처리할까요?"를 첫 번째 발생에서 한 번만 물어봄)
- 또는 옵션 축소: (A)/(B)/(C)/(D+E→배치) 4지선다로 재설계 후 배치 선택 시 세부 옵션 별도 질문

### 7.2 Agent Tooling (C-2, C-3, M-4)

- `agents/doc-scanner.md` `tools` 배열에 `Write` 추가.
- `commands/deep-docs.md` `allowed-tools`에서 `Agent` → `Task`.
- 본문 pseudo-code: `Agent(doc-scanner): "..."` → `Task(subagent_type="doc-scanner", prompt="...")`.
- `model: sonnet` 유지. 파일 상단(frontmatter 바로 아래) 마크다운 주석으로 "Claude Code plugin은 alias(`sonnet`) 허용; 특정 버전 고정 필요 시 `claude-sonnet-4-6` 등 full ID 사용 가능" 한 줄 추가.

### 7.3 Housekeeping (L-1~L-5)

- L-1: `docs/backlog-2026-04-16.md` 커밋 포함.
- L-2: `package.json`에 `"private": true`. 버전 1.1.0 동기.
- L-3: `hooks/hooks.json` 삭제.
- L-4: README 설치 섹션에 "marketplace 미공개 시 git URL 설치" 보조 안내 추가.
- L-5: 새 `.gitignore`에 `.deep-docs/` 추가.

### 7.4 검증 스크립트 `scripts/verify-fixes.sh`

grep 기반 스펙 준수 체크 (12+ 항목):
- C-2: `doc-scanner.md`의 `tools`에 `Write`
- C-3: `commands/deep-docs.md`의 `allowed-tools`에 `Task` 포함, `Agent` 미포함
- C-3 (본문): `Agent(doc-scanner):` pseudo-code가 본문에 **잔존하지 않음** (Task로 완전 교체)
- H-4: `"freshness_score": 6` 미존재
- M-3: size 임계값 strict 부등호(`>100`, `>300`, `>200`) 명시
- M-8: `garden-ignored.json` 문서화
- schema_version: `schema_version.*2` 명시 (O-2/O-4 대응)
- L-2: `package.json`의 `"private": true`
- L-3: `hooks/hooks.json` 부재 또는 빈 객체 아님
- L-5: `.gitignore`에 `.deep-docs/`
- Version sync: `plugin.json`과 `package.json` 버전 일치
- **Filter files 존재** (v3 분리):
  - `scan-filters/translation-pair.md` 존재 + ISO 언어 allowlist 포함 (NC-1)
  - `scan-filters/code-fence.md` 존재 + 들여쓰기 fence 규칙(`{0,3}`) 포함 (NEW-FENCE-INDENT)
  - `scan-filters/reference-extraction.md` 존재 + "non-fenced segment" 명시 (X-3)
  - `scan-filters/cli-whitelist.md` 존재 + "project lookup first" 순서 명시 (NEW-CLI-BYPASS)
  - `scan-filters/worktree-hash.md` 존재 + `xargs -I{} sh -c` **금지** 문구 포함 (NEW-RCE)
  - `scan-filters/freshness-timestamp.md` 존재 + `%ct` epoch 사용 명시 + `sort -r` 미사용 (NC-2)
  - 모든 filter 파일에 `shasum -a 1` 사용, `sha1sum` 미사용 (O-6)

전체 실행: `bash scripts/verify-fixes.sh`. fail 발생해도 끝까지 돌리고 마지막 exit code.

**한계 명시 (리뷰 O-9 대응)**: verify-fixes.sh는 **grep 기반 structural check**로 "필수 문구/필드 존재"만 검증. 다음은 검증 범위 밖:
- 의미론적 일관성 (예: Task pseudo-code가 모든 문맥에 올바르게 적용됐는지)
- 예시 JSON이 §5 스키마와 실제 매칭되는지
- 정규식/알고리즘이 실제로 의도대로 동작하는지

이를 보완하기 위해 **§7.5 Dogfood 절차가 semantic 검증 담당**. verify-fixes.sh 통과 = necessary but not sufficient.

### 7.5 Dogfood 절차

커밋 7 완료 후 수동. **성공 기준(명문화)**:

1. `/deep-docs scan`을 deep-docs 레포에 실행
2. **성공 기준 1 (번역쌍 X-1)**: `README.md ↔ README.ko.md`의 27줄 JSON 중복이 `duplicate-block / category=auto-fix`로 분류되지 **않고**, `audit-only`로 분류되어 `/deep-docs garden`에서 수정 제안에 포함 **안 됨**
3. **성공 기준 2 (코드펜스 X-3)**: 코드펜스 내 `src/auth/middleware.ts` 예시가 `dead-reference` 후보로 올라오지 **않음** (scan 출력에 해당 항목 부재)
4. **성공 기준 3 (worktree_hash X-2)**: 신규 untracked 파일 추가 후(`touch docs/test-untracked.md`) scan 재실행 → `.deep-docs/last-scan.json`의 `worktree_hash`가 **변경**됨 (`diff`로 확인)
5. **성공 기준 4 (boundary CX-2)**: 정확히 100줄짜리 CLAUDE.md 테스트 파일(예: `/tmp/test-claude.md`) 생성 → scan 경고 **없음**, audit 만점 10점
6. **성공 기준 5 (audit 표시)**: `/deep-docs audit` 점수가 `8.5/10` 같은 소수점 1자리로 표시됨
7. 결과를 PR description에 번호별 체크박스로 캡처

실패 시 해당 커밋을 revert하고 스펙 갱신.

---

## 8. Commit Plan (8 commits)

| # | 제목 | 포함 | 주요 파일 |
|---|------|------|-----------|
| 1 | `fix(agent): wire up Write tool and correct Task permission` | C-2, C-3, M-4 | `agents/doc-scanner.md`, `commands/deep-docs.md` |
| 2 | `feat(scan): add scan-filters directory (translation/code-fence/ref-extract/cli/hash/freshness)` | C-1, H-3, M-7, NC-1, NC-2, NEW-RCE, NEW-CLI-BYPASS, NEW-FENCE-INDENT | `skills/.../scan-filters/*.md` (6 신규), `skills/.../scan-rules.md`, `agents/doc-scanner.md` |
| 3 | `feat(artifact): add worktree_hash provenance and garden invalidation` | H-1, H-2, H-5 | `skills/.../SKILL.md`, `commands/deep-docs.md`, `agents/doc-scanner.md`, README×2 |
| 4 | `fix(audit): unify freshness scale and define stale thresholds` | H-4, H-6, M-1 | `skills/.../audit-metrics.md`, `agents/doc-scanner.md` |
| 5 | `fix(audit): unify size thresholds and add rounding/band rules` | M-2, M-3, L-6 | `skills/.../audit-metrics.md`, `skills/.../scan-rules.md`, README×2 |
| 6 | `refactor(scan): renumber rules/steps and clarify issue field names` | M-5, M-6 | `skills/.../scan-rules.md`, `agents/doc-scanner.md` |
| 7 | `feat(garden): batch approval + ignored history, plus housekeeping` | M-8, M-9, L-1~L-5 | `commands/deep-docs.md`, `package.json`, `hooks/hooks.json`(삭제), `.gitignore`, `docs/backlog-2026-04-16.md`, README×2 |
| 8 | `chore(release): v1.1.0 — bump version, changelog, verify script` | release prep | `plugin.json`, `package.json`, `CHANGELOG.md`, `scripts/verify-fixes.sh` |

### 커밋 간 의존성

- 1, 2, 4, 5, 6, 7은 상호 독립. 순서 자유.
- 3은 1 이후(agent tools 정리 먼저)가 권장.
- 8은 마지막 (verify 스크립트가 1~7 변경을 검사).

### 파일 중첩 매트릭스 (리뷰 O-5 대응)

동일 파일이 여러 커밋에서 수정됨. 각 커밋은 **파일 내 서로 다른 영역**을 건드리므로 순차 적용 시 충돌 없지만, revert 시 순서가 중요:

| 파일 | 건드리는 커밋 | 건드리는 섹션/앵커 |
|------|---------------|---------------------|
| `agents/doc-scanner.md` | 1, 2, 4, 6 | 1: frontmatter / 2: Step 2 본문 + scan-rules 레퍼런스 / 4: 예시 JSON `freshness_score` / 6: `issues[].current_value` 필드명 |
| `commands/deep-docs.md` | 1, 3, 7 | 1: frontmatter allowed-tools + Task pseudo-code / 3: 본문 "재사용 조건" 섹션 / 7: 본문 "Garden 배치 승인" 섹션 |
| `skills/.../scan-rules.md` | 2, 5, 6 | 2: Rule 1·3·4 내용 / 5: Rule 5 boundary / 6: Rule 번호 정합 |
| `skills/.../audit-metrics.md` | 4, 5 | 4: Section 2 freshness / 5: Section 1 size + Section 5 map-vs-manual |
| `README.md` / `README.ko.md` | 3, 5, 7 | 3: 설정 섹션 (worktree_hash) / 5: 밴드 표 / 7: 설치 섹션 |

### 롤백

각 커밋이 자기 완결. `git revert` 가능. **단 revert는 역순 권장** (커밋 8 → 7 → ... → 1) — 특히 `agents/doc-scanner.md`·README 양종이 여러 커밋에서 수정되므로 순방향 revert는 충돌 발생 가능. 충돌 시 수동 해결.

---

## 9. Execution Order (High-level)

1. 본 spec 커밋 (`docs/superpowers/specs/2026-04-17-...`)
2. 사용자 spec 승인
3. `writing-plans` 스킬로 상세 implementation plan 작성 — **외부 의존성 (리뷰 O-1 대응)**: `writing-plans`는 superpowers 플러그인(전역 설치) 제공 스킬. 플러그인 부재 시 fallback: 본 spec을 기반으로 **수동 implementation plan** 작성(커밋 1~8을 TODO 단위로 분해한 체크리스트를 `docs/superpowers/plans/2026-04-17-...-plan.md`에 저장).
4. plan 승인 후 커밋 1~8 순차 실행
5. 커밋 8 후 `bash scripts/verify-fixes.sh` 실행 — 전 체크 통과 확인
6. Dogfood (§7.5) 수행, 결과 캡처
7. (선택) PR 생성

---

## 10. Risks & Mitigations

| 리스크 | 확률 | 완화 |
|--------|------|------|
| 번역 쌍 정규식이 실제 naming을 놓침 (예: `readme-ko.md` 하이픈 스타일) | 낮음 | 하이픈 locale(`[_-]`) 양쪽 지원 + locale optional. 놓친 경우 추후 heuristic 확장. |
| 확장자 whitelist 누락 (예: `.astro`) | 중 | 이미 `.mjs`, `.cjs`, `.vue`, `.svelte` 포함. 추후 추가 가능. |
| `Task` 권한 이름이 Claude Code 최신 스펙과 또 달라질 가능성 | 저 | plugin spec 문서 재확인 후 확정. verify-fixes.sh가 향후 regression 감지. |
| 기존 `.deep-docs/last-scan.json`이 신 schema_version=2와 비호환 | 매우 낮음 | §5.2 Rule 1이 버전 불일치 시 자동 재-scan. 재생성 비용 수십 초. |
| Dogfood에서 예기치 못한 regression 발견 | 중 | 커밋 단위가 작으므로 해당 커밋만 revert 후 spec 갱신. 파일 중첩 매트릭스(§8)로 revert 안전성 확보. |
| **`writing-plans` 스킬 부재** (리뷰 O-1) | 중 | §9 step 3에 수동 fallback 명시 — plan 문서를 직접 작성. |
| **`AskUserQuestion` 5지선다 플랫폼 제약** (리뷰 O-7) | 중 | §7.1에 POC 스텝 + 4지선다 fallback 설계 포함. |
| **macOS/Linux 유틸리티 차이** (리뷰 O-6) | 중 | `shasum -a 1` 사용(`sha1sum` 금지), `stat -f`/`stat -c` 양방 처리. `grep -E`만 사용(`grep -P` 금지). |
| **`worktree_hash` false-positive/negative** (리뷰 X-2 대응 후 잔존 리스크) | 낮음 | `git ls-files --others --exclude-standard` 포함 확인 — binary diff 포맷 변화는 `--binary` 옵션 강제로 방지 검토. |
| **`signature` 알고리즘 변경 시 `garden-ignored.json` 무효화** (리뷰 O-11) | 낮음 | 알고리즘 변경 시 `garden-ignored.json`의 `schema_version` bump + 사용자에게 "기록이 리셋됨" 알림. v1.1.0 첫 도입이므로 당분간 고정. |

---

## 11. Out of Scope (for Follow-ups)

- Cross-plugin scan (deep-suite 전체)
- CI hook으로 문서 건강 점수 자동 체크
- `garden-ignored.json` 관리 UI(재검토/삭제 헬퍼)
- 규칙-코드 모순(Rule 6) 반자동화

상기 항목은 `docs/backlog-2026-04-16.md`에 이미 기록됨. 본 릴리스와 분리.
