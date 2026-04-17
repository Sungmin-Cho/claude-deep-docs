# Design: deep-docs v1.1.0 — Ultrareview Fixes

- **Date**: 2026-04-17
- **Author**: Sungmin-Cho (with Claude Code)
- **Status**: Approved
- **Source Review**: `docs/ultrareview-2026-04-17.md`
- **Target Version**: v1.1.0 (semver minor)

---

## 1. Goal

`docs/ultrareview-2026-04-17.md`에서 식별된 24건의 결함(Critical 3, High 6, Medium 9, Low 6) 전부를 해결한다. 단순 문구 수정에 그치지 않고, 모호했던 heuristic과 스키마를 스펙 수준에서 못박아 구현자 간 재현성을 확보한다.

---

## 2. Non-Goals

- 신규 기능 추가(cross-plugin scan, CI hook 등 backlog 항목). 이번 릴리스는 "고치기"에 집중.
- 스키마 메이저 버전 업(아티팩트는 additive만).
- 새 외부 의존성 도입. 모든 변경은 markdown + bash 수준.

---

## 3. Architecture Overview

### 3.1 File Inventory

**수정 (9 항목 / 10 파일)**
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

**추가 (3)**
| 파일 | 목적 |
|------|------|
| `scripts/verify-fixes.sh` | grep 기반 스펙 준수 체크 |
| `.gitignore` | `.deep-docs/` 제외 |
| `docs/superpowers/specs/2026-04-17-deep-docs-ultrareview-fixes-design.md` | 본 문서 |

**삭제 (1)**
| 파일 | 이유 |
|------|------|
| `hooks/hooks.json` | v1.1 active hook 없음, non-standard `description` 필드 |

**스테이징 (1)**
| 파일 | 이유 |
|------|------|
| `docs/backlog-2026-04-16.md` | 기존 untracked 파일 커밋 |

---

## 4. Heuristic Specifications

### 4.1 번역 쌍 탐지 (C-1)

**규칙**: 중복 검사 전, 파일명을 `basename.locale.md` 패턴으로 그룹핑하여 동일 그룹 내 중복은 auto-fix 대상에서 제외.

- 정규식: `^(?<basename>[^.]+)\.(?<locale>[a-z]{2}(_[A-Z]{2})?)\.md$`
- 그룹 예: `README` = { `README.md`, `README.ko.md`, `README.ja.md`, `README.zh_CN.md` }
- 동일 그룹 내부 중복 블록은 **audit-only**로 분류(참고 표시). 자동 삭제 금지.

### 4.2 코드펜스 제외 (C-1)

중복 블록 탐지 시 ```` ``` ```` 로 둘러싸인 fenced code block은 비교 대상에서 제외. 언어 힌트(`json`, `bash` 등) 무관.

**구현**: 문서 로드 후 fenced block 범위를 선-제거한 텍스트로 3-line sliding window 해시 계산.

### 4.3 Backtick 참조 필터 (H-3)

Dead-reference 후보 자격 (**모두** 만족):

1. backtick(` `` `) 내부 문자열
2. 다음 중 **하나 이상** 만족:
   - 슬래시(`/`) 1개 이상 포함
   - 확장자 whitelist(아래)에 매치
3. 다음 중 **어느 것에도** 해당하지 않음:
   - `https?://` URL
   - 절대 경로(`/usr/`, `/etc/`, `/tmp/` 등으로 시작)
   - glob 단독(`**`, `*`)

**확장자 whitelist**: `.ts .tsx .js .jsx .py .md .json .sh .go .rs .rb .java .kt .cpp .c .h .yml .yaml .toml .css .html .sql`

조건 미달 backtick 문자열은 dead-reference 후보에서 스킵 → `true`, `npm`, `MyComponent` 등이 false-positive 유발하지 않음.

### 4.4 CLI 명령어 비교 범위 (M-7)

문서 내 CLI 참조 stale 판정은 다음 **합집합**에 대해 수행:
1. `package.json`의 `scripts` 키
2. `Makefile` target (`^[a-zA-Z0-9_-]+:`)
3. **시스템 명령 whitelist** (고정):
   `git npm pnpm yarn node deno bun python python3 uv pip poetry make ls find grep rg cat wc curl wget docker kubectl gh terraform aws gcloud`
4. `$PATH` 내 실제 실행 파일 — optional, Bash `command -v`로 체크

합집합에 없을 때만 stale 표시.

---

## 5. Schema & Artifact Changes

### 5.1 `.deep-docs/last-scan.json` — provenance 확장 (H-1, H-5)

```json
{
  "scanned_at": "2026-04-17T10:00:00Z",
  "schema_version": 1,
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

- `worktree_hash`: `git diff HEAD | sha1sum`의 첫 토큰. clean tree면 리터럴 `"clean"`.
- **non-git 환경**: `provenance`는 `{ "is_git": false }` 만. 다른 필드 생략.
- `schema_version`: 현재 `1`. 향후 스키마 변경 시 비교 기준.

### 5.2 재사용 3-요소 규칙 (H-1, H-2)

`garden`/`audit`는 기존 아티팩트 재사용 시 **전부** 만족해야 함:
1. `scanned_at`이 현재 기준 10분 이내
2. `provenance.head_sha` = 현재 `git rev-parse HEAD` (git 환경만)
3. `provenance.worktree_hash` = 현재 계산값 (git 환경만)

**추가**: `garden`이 1건이라도 수정을 적용하면 종료 시 `.deep-docs/last-scan.json`을 삭제. 다음 `audit`/`garden`은 반드시 재-scan.

### 5.3 Freshness 스코어 정규화 (H-4, M-1)

허용 값: **`{10, 7, 4, null}`**

| stale 비율 | 점수 |
|------------|------|
| `<30%` | 10 |
| `30–70%` | 7 |
| `≥70%` | 4 |
| 참조 경로 없음 | `null` (평균에서 제외) |

`doc-scanner.md` 예시 JSON의 `"freshness_score": 6` → `7`로 정정.

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

### 5.5 Issue 필드명 명확화 (M-6)

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

### 6.1 Size 임계값 통일 (M-3)

| 파일 유형 | scan 경고 임계값 | audit 점수 |
|-----------|------------------|------------|
| CLAUDE.md / AGENTS.md | `≥100` → 분리 제안 | `≤100:10, 100<x≤200:7, >200:4` |
| README.md | `≥300` | `≤300:10, 300<x≤500:7, >500:4` |
| 기타 docs/ | `≥200` | `≤200:10, 200<x≤400:7, >400:4` |

scan과 audit 경계값을 1:1 대응시킴.

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

### 7.1 Garden 배치 승인 (M-9)

각 항목에서 5지선다 `AskUserQuestion`:
- **(A) 적용**
- **(B) 건너뜀 (이번만)**
- **(C) 건너뜀 + 기록** (`garden-ignored.json` 추가, M-8 연동)
- **(D) 이하 모두 적용** (현재 세션 같은 `type` 일괄 수락)
- **(E) 이하 모두 건너뜀** (현재 세션 같은 `type` 일괄 거부)

(D)/(E) 범위는 **현재 세션 + 동일 `type`**. 다른 타입은 여전히 prompt.

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

grep 기반 스펙 준수 체크 10+:
- C-2: `doc-scanner.md`의 `tools`에 `Write`
- C-3: `commands/deep-docs.md`의 `allowed-tools`에 `Task` 포함, `Agent` 미포함
- H-1: `worktree_hash` 문구 존재
- H-4: `"freshness_score": 6` 미존재
- M-3: size 임계값 100 명시
- M-8: `garden-ignored.json` 문서화
- L-2: `package.json`의 `"private": true`
- L-3: `hooks/hooks.json` 부재 또는 빈 객체 아님
- L-5: `.gitignore`에 `.deep-docs/`
- Version sync: `plugin.json`과 `package.json` 버전 일치

전체 실행: `bash scripts/verify-fixes.sh`. fail 발생해도 끝까지 돌리고 마지막 exit code.

### 7.5 Dogfood 절차

커밋 7 완료 후 수동:
1. `/deep-docs scan` 을 deep-docs 레포에 실행
2. `README.md ↔ README.ko.md` JSON 중복이 **audit-only** 분류인지 확인 (번역 쌍 필터)
3. `src/auth/middleware.ts` 같은 예시 경로가 코드펜스 내면 audit-only인지 확인
4. `/deep-docs audit` 점수 소수점 1자리 표시 확인
5. 결과를 PR description에 요약

---

## 8. Commit Plan (8 commits)

| # | 제목 | 포함 | 주요 파일 |
|---|------|------|-----------|
| 1 | `fix(agent): wire up Write tool and correct Task permission` | C-2, C-3, M-4 | `agents/doc-scanner.md`, `commands/deep-docs.md` |
| 2 | `feat(scan): add dedup heuristics for translation pairs and code fences` | C-1, H-3, M-7 | `skills/.../scan-rules.md`, `agents/doc-scanner.md` |
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

### 롤백

각 커밋이 자기 완결. `git revert <sha>` 가능.

---

## 9. Execution Order (High-level)

1. 본 spec 커밋 (`docs/superpowers/specs/2026-04-17-...`)
2. 사용자 spec 승인
3. `writing-plans` 스킬로 상세 implementation plan 작성
4. plan 승인 후 커밋 1~8 순차 실행
5. 커밋 8 후 `bash scripts/verify-fixes.sh` 실행 — 전 체크 통과 확인
6. Dogfood (§7.5) 수행, 결과 캡처
7. (선택) PR 생성

---

## 10. Risks & Mitigations

| 리스크 | 확률 | 완화 |
|--------|------|------|
| 번역 쌍 정규식이 실제 naming을 놓침 (예: `readme-ko.md`) | 중 | locale `_{COUNTRY}` 변형까지 커버. 놓친 경우 추후 heuristic 확장. 현재는 `.{locale}.md` 규약이 사실상 표준. |
| 확장자 whitelist 누락 (예: `.mjs`, `.vue`) | 중 | 추후 추가 가능. 일단 주요 20개 언어 커버. |
| `Task` 권한 이름이 Claude Code 최신 스펙과 또 달라질 가능성 | 저 | plugin spec 문서 재확인 후 확정. verify-fixes.sh가 향후 regression 감지. |
| 기존 `.deep-docs/last-scan.json`이 신 schema와 비호환 | 매우 낮음 | 아티팩트는 재생성 비용 낮음. 스키마 버전 불일치 시 재-scan 하면 그만. |
| Dogfood에서 예기치 못한 regression 발견 | 중 | 커밋 단위가 작으므로 해당 커밋만 revert 후 spec 갱신. |

---

## 11. Out of Scope (for Follow-ups)

- Cross-plugin scan (deep-suite 전체)
- CI hook으로 문서 건강 점수 자동 체크
- `garden-ignored.json` 관리 UI(재검토/삭제 헬퍼)
- 규칙-코드 모순(Rule 6) 반자동화

상기 항목은 `docs/backlog-2026-04-16.md`에 이미 기록됨. 본 릴리스와 분리.
