# Deep Docs Ultrareview — 버그/오작동 분석 리포트

- **분석일**: 2026-04-17
- **분석 대상**: deep-docs v1.0.0 (전체 플러그인)
- **HEAD**: `db70507`
- **분석 범위**: `.claude-plugin/`, `agents/`, `commands/`, `hooks/`, `skills/`, `README.md`, `README.ko.md`, `package.json`

---

## 요약 (Severity 분포)

| 심각도 | 개수 | 대표 사례 |
|--------|------|-----------|
| 🔴 Critical | 3 | Self-corruption (dogfood), 에이전트 Write 미허용, `Agent` vs `Task` 권한 이름 불일치 |
| 🟠 High | 6 | Scan-artifact staleness 로직, false-positive dead-reference, garden→audit 순환성, freshness 점수 스케일 불일치 |
| 🟡 Medium | 9 | 기준 모호("대부분"/"일부"), audit 밴드 경계, scan/audit 크기 임계값 불일치, 모델 ID 형식 |
| 🔵 Low | 6 | 미커밋 backlog, package.json 중복, hooks.json non-standard 필드 등 |

---

## 🔴 Critical

### C-1. 자기 자신(deep-docs 레포)에 `garden`을 돌리면 문서가 손상될 수 있다 (Self-corruption / Dogfood bug)

- **위치**: `README.md:114-140` ↔ `README.ko.md:114-140` (27줄 완전 동일 JSON 블록)
- **검증**: `diff` 결과 완전 일치. 확인 완료.
- **영향 흐름**:
  1. `doc-scanner`가 규칙 4(중복 지침 블록)에 의해 "3줄 이상, 100% 일치"로 auto-fix 대상 flag
  2. `garden`이 한쪽에서 해당 블록을 삭제 제안 → 사용자가 Yes 시 Edit 적용
  3. EN 또는 KO 중 한 버전의 스키마 예시가 소실됨
- **근본 원인**: 다국어 문서(번역 쌍)와 "동일 블록"(스키마 예시, 코드 블록)을 구별하는 필터가 스펙에 없음. `scan-rules.md` Rule 4는 조건부 auto-fix라고 쓰여 있으나 "조건"의 정의가 "100% 일치"뿐.
- **권장 수정**:
  - 번역 쌍 탐지: `README.*.md` 또는 파일명 suffix 매칭으로 중복 검사에서 제외
  - 코드펜스(```) 내부 블록은 중복 검사에서 제외(문법 예시는 의도된 중복)
  - 최소한, garden 적용 전 "이 블록은 코드 예시입니다. 정말 삭제하시겠습니까?"로 2단계 확인

### C-2. `doc-scanner` 에이전트는 `.deep-docs/last-scan.json`을 저장할 수 없다 (스펙 vs 도구 권한 불일치)

- **위치**: `agents/doc-scanner.md:11-14` (tools) vs `agents/doc-scanner.md:125-165` (Step 12 결과 저장)
- **증거**:
  ```yaml
  tools:
    - Read
    - Glob
    - Grep
    - Bash
  ```
  그러나 Step 12는 `.deep-docs/last-scan.json`에 JSON을 저장하라고 지시. `Write`/`Edit` 도구가 없음.
- **결과**: 에이전트는 `Bash` + `cat > file << EOF` heredoc 해킹으로만 저장 가능. 이스케이프 실수 시 JSON 손상 가능성, 큰 결과는 argv 길이 한도 초과 위험.
- **연쇄 영향**:
  - `garden`/`audit`가 재사용할 아티팩트가 깨질 가능성
  - 결과 저장 실패 시 매 호출마다 재-scan → 성능 저하, Agent 반복 호출 비용 증가
- **권장 수정**: `tools`에 `Write` 추가:
  ```yaml
  tools: [Read, Glob, Grep, Bash, Write]
  ```

### C-3. 명령 `allowed-tools`의 `Agent`는 Claude Code의 실제 도구명이 아니다

- **위치**: `commands/deep-docs.md:2`
  ```
  allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion
  ```
- **문제**: Claude Code에서 서브에이전트 spawn은 `Task` 도구(또는 `Agent`가 별칭으로 허용될 수도). 스펙에 `Agent`로만 표기되면 권한 체크/경고가 발생하거나, 실행 시 Task 도구가 prompt 대상이 될 수 있음.
- **부가 문제**: `AskUserQuestion`은 deferred tool — `ToolSearch`를 통해 로드되어야 사용 가능. `allowed-tools`에 선언만으로 사전 로드된다는 보장이 없음.
- **권장 수정**: `Agent` → `Task`로 교체하고, 런타임에서 `AskUserQuestion` 사용 가능 여부 확인. 최소한 README/명령 문서 내부의 pseudo-code `Agent(doc-scanner): "…"`도 `Task(subagent_type="doc-scanner", …)` 형태로 정정.

---

## 🟠 High

### H-1. `HEAD SHA + 10분 TTL`로는 워킹트리 변경을 감지하지 못한다

- **위치**: `commands/deep-docs.md:69-72`, `skills/.../SKILL.md:30-33`, `README.md:142-144`
- **시나리오**:
  1. `/deep-docs scan` → 결과 저장 (SHA=A)
  2. 사용자가 파일 편집(커밋 없음) → SHA 여전히 A
  3. 10분 내 `/deep-docs garden` 실행 → stale 스캔 재사용 → 이미 수정된 참조를 "죽은 참조"로 제안, 실존하는 경로를 잘못 덮어쓸 가능성
- **권장 수정**: `git diff --name-only HEAD` 해시(또는 `git diff | sha1sum`)를 provenance에 추가하여 워킹트리 변경을 감지, 다르면 재-scan.

### H-2. `garden` 후 `audit` 재사용이 잘못된 점수를 보고한다

- **위치**: command `garden`/`audit` 단계 + 아티팩트 재사용 로직
- **시나리오**:
  1. `garden`으로 3건 수정 → HEAD SHA 변경 없음(사용자가 아직 커밋하지 않음), 10분 이내
  2. `audit` 실행 → 재사용 조건 충족 → 수정 전 이슈 수로 점수 계산
- **결과**: 사용자가 방금 고친 이슈가 여전히 점수에 반영되어 혼란
- **권장 수정**: `garden`이 수정 1건이라도 반영하면 아티팩트 무효화(또는 "dirty" flag) + `audit` 시 재-scan.

### H-3. Backtick 안 문자열을 "참조"로 간주하여 대량 false-positive 발생

- **위치**: `scan-rules.md:10` / `doc-scanner.md:50-55`
- **문제**: 스펙이 "backtick 내 파일 경로"를 추출 대상으로 지정. 그러나 backtick은 대부분의 비-파일 식별자에도 쓰임: `true`, `npm run build`, `README.md`(링크 텍스트), 개념 이름.
- **실제 사례**: README에서 예시로 적은 `src/auth/middleware.ts`는 이 플러그인 레포에 존재하지 않음 → dead-reference로 flag → garden이 `[삭제됨]` 치환 제안 가능 → 예시가 손상됨.
- **권장 수정**:
  - 확장자 whitelist (`.ts`, `.js`, `.py`, `.md`, …)로 1차 필터
  - 슬래시(`/`) 포함 또는 `./`, `../` 같은 파일-형태 패턴만 대상
  - 코드펜스(```) 블록과 인라인 예시(`###` 바로 아래의 예시 블록) 구분 필요

### H-4. `freshness_score: 6`은 audit-metrics 스케일에 존재하지 않는 값

- **위치**: `agents/doc-scanner.md:155` (`"freshness_score": 6`) vs `audit-metrics.md:22-26` (값 스킴은 10/7/4/제외만)
- **문제**: 스캔 아티팩트 예시에 정의되지 않은 점수가 들어 있음. 구현 시 어느 쪽을 따를지 모호 → `audit` 결과 재현성 저하.
- **권장 수정**: 예시를 `freshness_score: 7`로 정정하거나, 스케일을 0-10 연속값으로 명확히 정의.

### H-5. `non-git` 환경에서 `provenance.is_git: true/false` 혼동

- **위치**: `agents/doc-scanner.md:131-135` + `commands/deep-docs.md:72-74`
- **문제**: non-git이면 head_sha가 의미 없는데 스키마에서 optional 여부가 불명. 재사용 판정 분기("non-git: scanned_at만")와 실제 직렬화된 필드의 형태가 충돌할 수 있음.
- **권장 수정**:
  ```json
  "provenance": { "is_git": false, "scanned_at": "…" }
  ```
  non-git일 때 `head_sha`/`branch` 필드 자체를 생략.

### H-6. 문서의 `git log -1 --format=%aI`는 워킹트리 미커밋 수정을 반영 못함

- **위치**: `audit-metrics.md:17-19`
- **시나리오**: 사용자가 문서 방금 업데이트(커밋 전), 관련 코드는 이미 커밋됨 → 문서는 "오래됨"으로 오판 → stale 페널티.
- **권장 수정**: 문서 파일의 워킹트리 `mtime`과 git 시각 중 더 큰 값 사용, 또는 "dirty tree" 경고만 출력하고 freshness 판정 보류.

---

## 🟡 Medium

### M-1. Freshness 점수의 "대부분 / 일부" 기준 미정의
`audit-metrics.md:22-26`. 50% 이상을 "대부분"으로 볼지, 30%를 "일부"로 볼지 정의가 없어 구현마다 결과 재현성 없음. 권장: `≥70% stale → 4`, `30-70% stale → 7`, `<30% stale → 10`.

### M-2. Audit 밴드 경계값의 소유 애매
`README.md:95-102`: 9-10 Excellent, 7-8 Good. `8.5`는 반올림 규칙이 없어 어느 밴드에 속하는지 불명. `Math.round(score)`인지 `floor`인지 명시 필요.

### M-3. Scan 크기 임계값과 audit 크기 점수 구간 불일치
- Scan: `CLAUDE.md ≥200줄 → 경고` (`doc-scanner.md:96-98`, `scan-rules.md:47-52`)
- Audit: `100줄` 초과부터 점수 하락 (`audit-metrics.md:7-12`)
- 150줄 파일은 audit 7점(감점)이지만 scan은 경고 없음 → 사용자 혼란.
- 권장: scan 경고 임계값을 100줄과 일치시키거나, audit 경고 기준을 scan과 일치.

### M-4. `doc-scanner.md`의 model 식별자가 alias
```yaml
model: sonnet
```
Claude Code plugin spec이 alias를 허용하는지/full ID(`claude-sonnet-4-6`)가 필요한지 환경 의존. 향후 모델 대체 시 명시적 버전 관리가 어려움.

### M-5. scan-rules 번호(1-8)와 doc-scanner Step 번호(1-10) 불일치
번호 체계가 달라 리팩터링/커뮤니케이션 시 혼동 유발. 예: "Rule 6"과 "Step 6"이 전혀 다른 작업.

### M-6. `reference` JSON 필드 의미 모호
`doc-scanner.md:146` 예시에서 `"reference": "src/auth/middleware.ts"`가 "현재 값"인지 "새 값"인지 명시되지 않음. 소비자(`garden`)가 old/new를 혼동할 위험.

### M-7. Rule 3 CLI 명령어 비교 범위 너무 좁음
`scan-rules.md:31-35`는 `package.json scripts`, `Makefile targets`만 검사. 실제 문서에 등장하는 시스템 명령(`git log`, `find`, `npm`)은 전부 "없음"으로 flag될 수 있음. 시스템 명령 whitelist + `$PATH` 명령 체크 추가 필요.

### M-8. Garden의 거절 항목 추적 부재
사용자가 "No" 한 항목이 매번 다시 프롬프트됨 → UX 마찰. 권장: `.deep-docs/garden-ignored.json`에 skip 이력을 기록.

### M-9. `AskUserQuestion`으로 대량 항목 처리 시 UX
scan 결과가 50건이면 50번 prompt → 피로. 일괄 승인/거부 옵션 필요("모두 예", "이 규칙만 모두 거부").

---

## 🔵 Low

### L-1. `docs/backlog-2026-04-16.md`가 미커밋
`git status`에 `?? docs/`로 표시. 의도된 것인지 확인 필요. 실수로 로컬 전용 파일일 수도 있음.

### L-2. `package.json`과 `plugin.json` 중복
같은 `name`/`version`을 두 군데서 관리해야 함(`package.json`, `.claude-plugin/plugin.json`). npm 배포 목적이 아니라면 `package.json` 삭제 권장(혹은 `"private": true` 추가).

### L-3. `hooks/hooks.json`의 non-standard `description` 필드
```json
{ "description": "deep-docs hooks (v1.0: no active hooks)", "hooks": {} }
```
Claude Code hooks schema에 `description`이 정의되어 있는지 확인 필요. 플러그인 로드 시 엄격 검증 환경에서 경고 가능. 빈 hooks면 파일 자체 삭제도 가능.

### L-4. README의 `claude plugin add deep-docs` 명령
현재 배포 채널이 공개 marketplace인지 불명. 레포 설치(git URL) 안내가 먼저여야 할 수도 있음.

### L-5. `.deep-docs/` 자동 `.gitignore` 처리 미흡
사용자가 `git add -A` 시 `.deep-docs/last-scan.json`이 스테이징됨. README의 "automatic" 약속과 충돌. 최초 실행 시 `.gitignore` 한 줄 추가하는 로직 권장.

### L-6. `audit-metrics.md` Section 5("직접/외부 비율") 계산 공식 미정의
"직접 지침"과 "외부 포인터"의 판별 규칙("자세한 내용은 X 참조 등")이 휴리스틱에 가까워 구현 간 재현성이 낮음.

---

## 검증 완료 항목 (증거)

| # | 항목 | 검증 결과 |
|---|------|-----------|
| C-1 | EN/KO README 27줄 JSON 블록 동일성 | `diff` 결과 완전 일치 (확인) |
| C-2 | `doc-scanner` 도구에 `Write` 없음 | `tools: [Read, Glob, Grep, Bash]` 확인 |
| C-3 | `allowed-tools`에 `Agent` 명시 | `commands/deep-docs.md:2` 확인 |
| H-4 | `freshness_score: 6` 스케일 외 값 | 예시와 스케일 문서 대조 완료 |

---

## 우선순위별 수정 권고 (상위 5건)

1. **C-2 (5분 수정)**: `agents/doc-scanner.md`의 `tools`에 `Write` 추가.
2. **C-3 (5분 수정)**: `commands/deep-docs.md`의 `Agent` → `Task`, pseudo-code 정정.
3. **C-1 (설계 수정)**: 번역 쌍 + 코드펜스 블록을 중복 검사에서 제외하는 필터 규칙을 `scan-rules.md`에 추가.
4. **H-1 (스펙 보강)**: provenance에 워킹트리 해시 포함, 변경 시 재-scan.
5. **H-2 (플로우 수정)**: `garden`이 1건이라도 반영하면 아티팩트 무효화하는 규칙을 SKILL.md에 명시.

---

## 참고

- 본 리포트는 스펙/문서 레벨 분석으로, 런타임 동작은 실제 `/deep-docs scan` 실행을 통해 추가 검증 가능.
- 비슷한 플러그인 플랫폼(Claude Code plugin spec)의 최신 필드 요구사항은 환경에 따라 변동 — C-3, M-4, L-3은 플랫폼 스키마 재확인 후 확정 권장.
