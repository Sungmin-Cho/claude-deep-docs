[English](./README.md) | **한국어**

# deep-docs

![version](https://img.shields.io/github/package-json/v/Sungmin-Cho/claude-deep-docs?label=version)
![license](https://img.shields.io/github/license/Sungmin-Cho/claude-deep-docs)
[![part of deep-suite](https://img.shields.io/badge/part%20of-deep--suite-5b8def)](https://github.com/Sungmin-Cho/claude-deep-suite)

> 에이전트 지침 문서(`CLAUDE.md`, `AGENTS.md`, 프로젝트 문서)의 신선도를 검증하고 자동 정비하는 가드닝 에이전트.

에이전트 지침 문서는 빠르게 낡아집니다. 코드베이스가 발전하면서 `CLAUDE.md`와 `AGENTS.md`에는 죽은 참조, 이동된 경로, 오래된 예시가 쌓이고, 오래된 문서를 기반으로 작업하는 에이전트는 더 이상 현실과 맞지 않는 정보로 잘못된 결정을 내립니다. deep-docs는 scan → garden → audit 사이클을 반복적으로 실행해 이 괴리를 탐지하고, 안전하게 수정 가능한 항목을 사용자 확인 후 자동 수정하며, 전체 문서 품질을 점수화합니다.

> "지침이 너무 많으면 지침이 되지 않는다. 순식간에 망가진다." — OpenAI, Harness Engineering

## deep-suite에서의 역할

deep-docs는 [claude-deep-suite](https://github.com/Sungmin-Cho/claude-deep-suite)의 플러그인 중 하나입니다. [Harness Engineering](https://martinfowler.com/articles/harness-engineering.html) 프레임워크에서 두 사분면에 걸쳐 동작합니다:

- **Inferential Guide** — 에이전트 지침 문서를 정확하고 최신 상태로 유지하여, 에이전트가 읽는 가이드의 신뢰성을 보장합니다.
- **Computational Sensor** — 신선도 스캔(`.deep-docs/last-scan.json`)이 [deep-dashboard](https://github.com/Sungmin-Cho/claude-deep-dashboard)가 소비하는 결정적 문서 건강 메트릭을 emit합니다.

## 설치

`claude-deep-suite` 마켓플레이스를 통해 설치:

```bash
# Claude Code
claude plugin marketplace add Sungmin-Cho/claude-deep-suite
claude plugin install deep-docs@claude-deep-suite

# Codex
codex plugin marketplace add Sungmin-Cho/claude-deep-suite
codex plugin add deep-docs@claude-deep-suite
```

설치 후 프로젝트 디렉토리에서 Claude Code는 `/deep-docs`, Codex는 `$deep-docs:deep-docs`를 실행하세요. 최초 사용 시 `.deep-docs/`가 자동 생성되며, 별도의 설정 파일은 필요 없습니다.

## 빠른 시작

```text
# Claude Code
/deep-docs scan
/deep-docs garden
/deep-docs audit

# Codex
$deep-docs:deep-docs scan
$deep-docs:deep-docs garden
$deep-docs:deep-docs audit
```

어느 호스트에서든 인수 없이 진입점을 실행하면 서브커맨드를 대화형으로 선택할 수 있습니다.

## 커맨드

| Claude Code | Codex | 설명 |
|---|---|---|
| `/deep-docs scan` | `$deep-docs:deep-docs scan` | 죽은 참조, 이동된 경로, 오래된 예시, 중복 블록 탐지 |
| `/deep-docs garden` | `$deep-docs:deep-docs garden` | diff 미리보기와 사용자 확인 후 자동 수정 |
| `/deep-docs audit` | `$deep-docs:deep-docs audit` | 크기·신선도·참조 정확도·중복도 기준으로 각 문서 점수화 |

지원되는 로컬 런타임은 native Windows, macOS, Linux의 Node.js 22입니다. Git은 선택 사항이며 Git Bash와 Python은 필요하지 않습니다. 번들 Node 런타임이 scan, reuse, authoring 가드를 강제하고, 승인과 의미 분류는 계속 에이전트가 담당합니다.

## 스캔 규칙

스캐너는 모든 발견 사항을 세 가지 카테고리로 분류합니다.

### Auto-fix 가능 (`garden`으로 수정)

| 규칙 | 설명 | 수정 방법 |
|---|---|---|
| 죽은 참조 | 문서가 참조하는 파일 경로·함수·클래스가 더 이상 존재하지 않는 경우 | 현재 경로/이름으로 업데이트하거나 `[removed]`로 표시 |
| 이동/리네임된 경로 | `git log --follow` 이름 변경 이력이 있는 참조 | 새 경로로 자동 업데이트 |
| 오래된 예시 | CLI 명령어나 환경 변수가 `package.json` 스크립트 또는 `.env.example`과 불일치 | 정확한 대체값이 있을 때 조건부 auto-fix; 코드 예시는 audit-only |
| 중복 지침 블록 | 여러 문서에 반복되는 동일 블록(3줄 이상, 100% 일치) | 중복 제거; 유사 중복은 audit-only |

### Audit-only (리포트만, 자동 수정 안 함)

| 규칙 | 설명 | 자동 수정 안 하는 이유 |
|---|---|---|
| 크기/구성 | `CLAUDE.md`/`AGENTS.md` >100, `README.md` >300, 기타 `docs/` >200줄 | 분리에 구조적 판단 필요 |
| 규칙–코드 모순 | 문서는 "snake_case 사용"이지만 대부분의 코드가 camelCase | 아키텍처 판단 필요, false positive 위험 높음 |
| 커버리지 갭 | 주요 모듈이 문서에 전혀 언급되지 않는 경우 | "주요"의 판단이 주관적 |
| 맵 vs 매뉴얼 비율 | 직접 지침 대 외부 포인터의 비율 | 최적 비율이 프로젝트마다 다름 |

### Authoring (`garden`이 생성/재구성)

| 규칙 | 설명 | 처리 방법 |
|---|---|---|
| 부재 문서 | 권장 `AGENTS.md`/`CLAUDE.md`(빌드 매니페스트 + 소스 디렉토리; `AGENTS.md`는 root `CLAUDE.md`가 이미 있을 때도) 또는 `ARCHITECTURE.md`(~10k+ LOC)가 없는 경우 | `garden`이 코드 분석으로 draft를 작성해 승인 후 기록 |
| 빈약 문서 | 기존 문서가 공식 골격에 명백히 미달하는 경우 — `@AGENTS.md` import 없이 공용 지침을 담은 `CLAUDE.md` 포함 | `garden`이 고유 콘텐츠를 기본 보존하며 재구성 |

기본 관리 정책은 **AGENTS-first 단일 소스**입니다: 공용 에이전트 지침은 `AGENTS.md`에 두고, `CLAUDE.md`는 `@AGENTS.md` import + Claude Code 특화 메모만 담는 thin wrapper로 유지합니다. `garden`은 `AGENTS.md`를 먼저 작성한 뒤에만 `CLAUDE.md`를 전환하며, 공용 콘텐츠 이관은 per-removal 승인으로 처리합니다 (`AGENTS.md` draft를 거부하면 `CLAUDE.md`는 단독 full 문서로 유지됩니다).

Authoring은 `skills/deep-docs-workflow/references/authoring-rules/`의 내장 규칙을 사용합니다 (CLAUDE.md는 Anthropic 메모리 가이드, AGENTS.md는 OpenAI Codex/agents.md 표준, ARCHITECTURE.md는 matklad 표준). 길이 목표는 `CLAUDE.md`/`ARCHITECTURE.md` 줄 수에 대해 soft이며(과도하게 긴 draft는 비차단 size-warning으로 보고 — 줄 기반 `audit`과 대칭), `AGENTS.md`는 32&nbsp;KiB 바이트 hard 차단선을 강제합니다(Codex가 초과분을 잘라냄) — 이 바이트/줄 비대칭에 유의: authoring은 Codex 바이트 예산을 고려하고 `audit`은 줄 기반을 유지합니다.

## Garden 워크플로

`/deep-docs garden`을 실행하면 에이전트가:

1. `.deep-docs/last-scan.json`이 신선하면(10분 이내, HEAD 및 워크트리 일치) **재사용**하고, 그렇지 않으면 먼저 스캔을 다시 실행합니다.
2. auto-fix 가능 항목만 **추출**합니다 — 크기 경고는 audit-only 요약에 남습니다.
3. 각 항목에 대해 diff를 보여주고 수정을 적용하기 전에 **확인을 요청**합니다.
4. **Authoring sub-flow** — 각 `gaps[]` 항목에 대해 `garden`이 읽기 전용 `doc-author` 에이전트를 spawn해 구조화 draft를 받고, TOCTOU baseline을 캡처하며(스캔 이후 변경된 파일을 조용히 덮어쓰지 않음), 각 제거 후보에 대해 적용/수정요청/거부를 묻고, 미승인 제거를 재삽입한 뒤에만 파일을 직접 씁니다. Codex의 generic author는 먼저 동일한 agent 정의를 읽고 읽기/검색 기능만 받습니다. 두 호스트 모두 author는 draft만 만들고 대상 문서를 직접 쓰지 않습니다.
5. 적용된 수정, 작성된 문서, 건너뜀, 참고용 audit-only 항목을 **요약**합니다.

Audit-only 항목은 항상 마지막에 참고 사항으로 표시되며 자동으로 수정되지 않습니다.

> **빈/신규 레포 참고:** authoring 갭은 `/deep-docs scan|garden` 직접 실행으로 노출됩니다. deep-dashboard가 `gaps[]`를 소비하기 전까지, 기존 문서가 없는 빈/신규 레포의 authoring 백로그는 **대시보드에 비노출**됩니다 — 대시보드의 문서 건강 메트릭은 기존 문서에서 발견된 이슈만 집계하기 때문입니다.

## Audit 지표

`/deep-docs audit`은 각 문서를 네 가지 측정 가능한 차원에서 점수화합니다:

| 지표 | 측정 방법 | 점수 기준 |
|---|---|---|
| 크기 | 권장 한도 대비 라인 수 | `CLAUDE.md`/`AGENTS.md`: ≤100 = 10, 100–200 = 7, >200 = 4 |
| 신선도 | 참조하는 경로 중 문서보다 최신인 것이 있는가? | 모두 최신 = 10, 일부 stale = 7, 대부분 stale = 4 |
| 참조 정확도 | 유효한 참조 수 / 전체 참조 수 | 100% = 10, 90–99% = 8, 70–89% = 5, <70% = 2 |
| 중복도 | 다른 문서와 공유되는 중복 블록 수 | 0건 = 10, 1–2건 = 7, ≥3건 = 4 |

신선도는 path-scoped로 측정됩니다 — 각 문서가 참조하는 파일만 확인하므로, 관련 없는 모듈의 변경이 문서 점수에 영향을 주지 않습니다.

**점수 등급:**

| 점수 | 등급 |
|---|---|
| `≥ 9.0` | Excellent (우수) |
| `7.0 ≤ score < 9.0` | Good (양호) |
| `5.0 ≤ score < 7.0` | Fair (정비 권장) |
| `< 5.0` | Poor (즉시 정비 필요) |

종합 점수는 소수점 1자리로 반올림됩니다. 문서에 외부 참조가 없으면 신선도 차원을 제외하고 나머지로 평균을 산출합니다.

## 스캔 아티팩트

모든 스캔은 [claude-deep-suite M3 cross-plugin envelope](https://github.com/Sungmin-Cho/claude-deep-suite)으로 wrap된 `.deep-docs/last-scan.json`을 기록합니다 (최상위 `schema_version` + `envelope` + `payload`). `garden`과 `audit`은 envelope 식별 정보, schema 버전, 10분 TTL, `envelope.git.head`, `payload.provenance.worktree_hash`가 모두 일치할 때만 이를 재사용하며, 그렇지 않으면 스캔을 다시 실행합니다. non-Git 대상에는 신뢰할 수 있는 변경 감지기가 없으므로 재사용은 fail-closed되고 envelope은 sentinel `git` 블록을 emit합니다.

## 링크

- [CHANGELOG](CHANGELOG.md) ([한국어](CHANGELOG.ko.md)) — 릴리스 이력
- [claude-deep-suite](https://github.com/Sungmin-Cho/claude-deep-suite) — 마켓플레이스 및 나머지 suite
- [deep-dashboard](https://github.com/Sungmin-Cho/claude-deep-dashboard) — 신선도 스캔 메트릭을 소비

## 라이선스

[MIT](LICENSE)
