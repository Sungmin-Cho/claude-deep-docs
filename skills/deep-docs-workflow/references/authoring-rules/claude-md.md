<!-- 출처: code.claude.com/docs/en/memory, code.claude.com/docs/en/best-practices (Anthropic 공식) -->

# CLAUDE.md Authoring Rules

`doc-author`가 CLAUDE.md를 **생성(create) / 재구성(restructure)**할 때 따르는 규칙. 출처는 Anthropic 공식 메모리/베스트프랙티스 가이드.

## 길이

- **soft 목표 ≤100줄** — deep-docs의 기존 size-warning 임계값(CLAUDE/AGENTS >100)과 정렬.
- **hard ceiling = 200줄** (Anthropic 공식 권고). 200줄 근처면 압축/분할을 **시도**한다.
- **hard fail 없음 (audit과 대칭)**: 100줄을 넘어도 authoring 실패가 아니다 — `size-warning`(audit-only, **비차단**)으로 보고만 된다. 과압축으로 정보를 잃지 않는다(실제 프로젝트 CLAUDE.md는 흔히 150~200줄+이며, audit-metrics의 `>200 = score 4`는 "허용 저점수"). 강제 분할이 아니라 size-warning으로만 처리한다.

## 필터 — "Claude가 코드에서 알 수 없는 것만"

포함:

- Claude가 추측 불가한 **명령**: build / test / lint (빌드 매니페스트를 **Read로 파싱**해 추출 — `package.json` scripts, `Makefile` targets 등. 추측 금지).
- **기본값과 다른 규칙** (관행에서 벗어난 컨벤션만).
- **함정(gotchas)** — 비직관적이지만 반드시 알아야 하는 것.

제외:

- 코드를 읽으면 바로 아는 것.
- 자명한 관행(일반적 git/언어 관용).
- **파일별 설명** (디렉터리 트리에 1~2줄이면 충분).
- **linter가 이미 강제하는 스타일** (들여쓰기/따옴표 등).

## 섹션 골격

```
Project overview → Essential commands → Tech stack → Directory structure(핵심 경로만) → Conventions(차이점만) → Gotchas
```

## hook 회피 원칙 (D8)

"항상 X 전에 Y" 류의 **강제 규칙은 prose로 작성하지 않는다**. 이런 행동 강제는 harness(PreToolUse hook)가 실행하는 것이지 prose 지침으로 보장되지 않는다. 필요 시 "이 동작은 PreToolUse hook으로 강제하길 권장" 한 줄만 남긴다. (탐지 기능은 v2 — v1은 생성 회피 원칙만.)

## mode 분기

### create

골격대로 신규 작성. 코드 분석(디렉터리/매니페스트/린터)에서 도출 가능한 것만 채운다.

### restructure — 고유 콘텐츠 식별 휴리스틱 (§6.2)

기존 문서를 파싱해 각 블록을 분류한다:

- **"재생성 가능"(→ `removal_candidates`)** = 코드 / 빌드설정 / 공식 규칙에서 **직접 도출 가능한** 문장만 (예: 매니페스트에서 그대로 읽히는 build 명령, 디렉터리 구조 나열).
- **그 외 전부 `preserved_blocks`로 기본 보존(보수적 편향)** — 사람이 작성한 함정/의사결정 근거/팀 컨벤션 등은 애매하면 **보존**(default-keep).
- 분류 결과는 구조화 result로 반환하고, garden이 `removal_candidates`를 per-removal 승인받아 **미승인분을 draft에 재삽입**한다 → default-keep이 contract로 강제됨(silent drop 불가).
