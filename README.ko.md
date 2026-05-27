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
/plugin install deep-docs@claude-deep-suite

# Codex
codex plugin install deep-docs
```

또는 이 레포에서 직접 설치:

```bash
claude plugin add https://github.com/Sungmin-Cho/claude-deep-docs.git
```

설치 후 프로젝트 디렉토리에서 `/deep-docs`를 실행하세요. 최초 사용 시 `.deep-docs/`가 자동 생성되며, 별도의 설정 파일은 필요 없습니다.

## 빠른 시작

```bash
/deep-docs scan      # 죽은 참조, 이동된 경로, 오래된 예시 탐지
/deep-docs garden    # diff 미리보기와 확인 후 안전한 항목 자동 수정
/deep-docs audit     # 문서별 점수를 포함한 정량적 품질 리포트
```

인수 없이 `/deep-docs`를 실행하면 서브커맨드를 대화형으로 선택할 수 있습니다. Codex·Copilot CLI·Gemini CLI 사용자는 `Skill({ skill: "deep-docs:deep-docs", args: "scan|garden|audit" })`로 동일 워크플로를 호출합니다.

## 커맨드

| 커맨드 | 설명 |
|---|---|
| `/deep-docs scan` | 죽은 참조, 이동된 경로, 오래된 예시, 중복 블록 탐지 |
| `/deep-docs garden` | diff 미리보기와 사용자 확인 후 자동 수정 |
| `/deep-docs audit` | 크기·신선도·참조 정확도·중복도 기준으로 각 문서 점수화 |

## 스캔 규칙

스캐너는 모든 발견 사항을 두 가지 카테고리로 분류합니다.

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

## Garden 워크플로

`/deep-docs garden`을 실행하면 에이전트가:

1. `.deep-docs/last-scan.json`이 신선하면(10분 이내, HEAD 및 워크트리 일치) **재사용**하고, 그렇지 않으면 먼저 스캔을 다시 실행합니다.
2. auto-fix 가능 항목만 **추출**합니다 — 크기 경고는 audit-only 요약에 남습니다.
3. 각 항목에 대해 diff를 보여주고 수정을 적용하기 전에 **확인을 요청**합니다.
4. 적용된 수정, 건너뜀, 참고용 audit-only 항목을 **요약**합니다.

Audit-only 항목은 항상 마지막에 참고 사항으로 표시되며 자동으로 수정되지 않습니다.

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

모든 스캔은 [claude-deep-suite M3 cross-plugin envelope](https://github.com/Sungmin-Cho/claude-deep-suite)으로 wrap된 `.deep-docs/last-scan.json`을 기록합니다 (최상위 `schema_version` + `envelope` + `payload`). `garden`과 `audit`은 envelope 식별 정보, schema 버전, 10분 TTL, `envelope.git.head`, `payload.provenance.worktree_hash`가 모두 일치할 때만 이를 재사용하며, 그렇지 않으면 스캔을 다시 실행합니다. git을 사용하지 않는 환경에서는 TTL만 적용되고, envelope은 sentinel `git` 블록을 emit합니다.

## 링크

- [CHANGELOG](CHANGELOG.md) ([한국어](CHANGELOG.ko.md)) — 릴리스 이력
- [claude-deep-suite](https://github.com/Sungmin-Cho/claude-deep-suite) — 마켓플레이스 및 나머지 suite
- [deep-dashboard](https://github.com/Sungmin-Cho/claude-deep-dashboard) — 신선도 스캔 메트릭을 소비

## 라이선스

[MIT](LICENSE)
