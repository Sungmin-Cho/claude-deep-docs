[English](./README.md) | **한국어**

# Deep Docs 플러그인

에이전트 지침 문서(CLAUDE.md, AGENTS.md 등)의 신선도를 검증하고 자동 정비하는 가드닝 에이전트.

> "지침이 너무 많으면 지침이 되지 않는다. 순식간에 망가진다."
> — OpenAI, Harness Engineering

### 하네스 엔지니어링에서의 역할

deep-docs는 [Deep Suite](https://github.com/Sungmin-Cho/claude-deep-suite) 생태계에서 [Harness Engineering](https://martinfowler.com/articles/harness-engineering.html) 프레임워크의 두 사분면에 걸쳐 동작합니다:

- **Inferential Guide**: 에이전트 지침 문서(CLAUDE.md, AGENTS.md)의 품질을 유지하여 가이드가 정확하고 최신 상태를 유지하도록 함
- **Computational Sensor**: 문서 신선도 스캔(`last-scan.json`)이 Continuous 타이밍 밴드에서 [deep-dashboard](https://github.com/Sungmin-Cho/claude-deep-dashboard)가 소비하는 결정적 문서 건강 메트릭을 제공

## 문제

에이전트 지침 문서는 코드베이스가 발전함에 따라 빠르게 낡아집니다. CLAUDE.md와 AGENTS.md에는 죽은 참조, 이동된 경로, 오래된 예시가 쌓여갑니다. 에이전트가 오래된 문서를 기반으로 작업하면 더 이상 존재하지 않는 파일 경로, 폐기된 명령어, 삭제된 함수에 의존하는 잘못된 결정을 내리게 됩니다.

수동으로 문서를 관리하는 것은 번거롭고 잊기 쉽습니다. 문서와 코드 사이의 격차는 실제 문제가 발생하기 전까지 조용히 벌어집니다.

## 해결책

Deep Docs는 가드닝 워크플로로 함께 동작하는 세 가지 서브커맨드를 제공합니다:

- **scan**: 문서와 코드베이스 사이의 괴리를 탐지
- **garden**: 안전하게 수정 가능한 항목을 사용자 확인 후 자동 수정
- **audit**: 모든 문서 파일에 대한 정량적 품질 점수 산출

## 주요 커맨드

| 커맨드 | 설명 |
|--------|------|
| `/deep-docs scan` | 죽은 참조, 이동된 경로, 오래된 예시 탐지 |
| `/deep-docs garden` | diff 미리보기와 사용자 확인 후 자동 수정 |
| `/deep-docs audit` | 문서별 점수를 포함한 정량적 품질 리포트 |

인수 없이 `/deep-docs`를 실행하면 서브커맨드를 대화형으로 선택할 수 있습니다.

## 스캔 규칙

스캐너는 모든 발견 사항을 두 가지 카테고리로 분류합니다:

### Auto-fix 가능 (`garden`으로 수정)

| 규칙 | 설명 | 수정 방법 |
|------|------|-----------|
| 죽은 참조 | 문서에서 참조하는 파일 경로, 함수, 클래스가 코드에 존재하지 않는 경우 | 현재 경로/이름으로 업데이트하거나 `[삭제됨]`으로 표시 |
| 이동/리네임된 경로 | 존재하지 않지만 `git log --follow` 이름 변경 이력이 있는 참조 | 새 경로로 자동 업데이트 |
| 오래된 예시 | 문서의 CLI 명령어나 환경 변수가 `package.json` 스크립트 또는 `.env.example`과 불일치 | 정확한 대체값이 있을 때 조건부 auto-fix; 코드 예시는 audit-only |
| 중복 지침 블록 | 여러 문서에 동일한 블록(3줄 이상, 100% 일치)이 반복되는 경우 | 중복 제거; 유사하지만 다른 블록은 audit-only |
| 크기/구성 | CLAUDE.md 또는 AGENTS.md가 200줄 초과 | 분리 제안 (자동 분리 아님, 제안만) |

### Audit-only (리포트에만 표시, 자동 수정 안 함)

| 규칙 | 설명 | 자동 수정 안 하는 이유 |
|------|------|----------------------|
| 규칙-코드 모순 추론 | 문서는 "snake_case 사용"이지만 코드의 72%가 camelCase | 아키텍처 판단이 필요하고 false positive 가능성이 높음 |
| 커버리지 갭 추론 | `src/`의 주요 모듈이 문서에 전혀 언급되지 않는 경우 | "주요"의 판단이 주관적 |
| 맵 vs 매뉴얼 비율 | 직접 지침 vs 외부 포인터/링크의 비율 | 최적 비율이 프로젝트마다 다름 |

## Garden 워크플로

`/deep-docs garden`을 실행하면 에이전트가:

1. `.deep-docs/last-scan.json`이 **10분 이내**이고 HEAD SHA가 현재 커밋과 일치하면 스캔 결과를 재사용합니다. 그렇지 않으면 먼저 스캔을 다시 실행합니다.
2. auto-fix 가능 항목만 추출합니다 (죽은 참조, 이동된 경로, 확인된 오래된 예시, 완전 중복, 크기 경고).
3. 각 항목에 대해 diff를 보여주고 확인을 요청합니다:
   ```
   ## 수정 1/3: CLAUDE.md — 죽은 참조

   - `src/auth/middleware.ts` → `src/auth/auth-middleware.ts` (git rename 감지)

   이 수정을 적용할까요?
   ```
4. 확인 후 Edit 툴로 수정을 적용합니다.
5. 적용된 수정, 건너뜀, 참고용 audit-only 항목을 요약합니다.

Audit-only 항목은 항상 마지막에 참고 사항으로 표시되며 자동으로 수정되지 않습니다.

## Audit 지표

`/deep-docs audit`은 각 문서를 네 가지 측정 가능한 차원에서 점수를 매깁니다:

| 지표 | 측정 방법 | 점수 기준 |
|------|-----------|-----------|
| 크기 | 권장 한도 대비 라인 수 | CLAUDE.md/AGENTS.md: ≤100줄 = 10점, 100–200줄 = 7점, >200줄 = 4점 |
| 신선도 | `git log` 타임스탬프: 참조하는 경로 중 문서보다 최신인 것이 있는가? | 모두 최신 = 10점, 일부 stale = 7점, 대부분 stale = 4점 |
| 참조 정확도 | 유효한 참조 수 / 전체 참조 수 | 100% = 10점, 90–99% = 8점, 70–89% = 5점, <70% = 2점 |
| 중복도 | 다른 문서와 공유되는 중복 블록 수 | 0건 = 10점, 1–2건 = 7점, ≥3건 = 4점 |

신선도는 경로 범위(path-scoped)로 측정됩니다: 전체 레포가 아닌 각 문서에서 참조하는 파일만 확인하므로, 관련 없는 모듈의 변경이 문서 점수에 영향을 주지 않습니다.

**점수 등급:**

| 점수 | 등급 |
|------|------|
| 9–10 | Excellent (우수) |
| 7–8 | Good (양호) |
| 5–6 | Fair (정비 권장) |
| 1–4 | Poor (즉시 정비 필요) |

종합 점수는 측정 가능한 모든 차원의 평균입니다. 문서에 외부 참조가 없어 신선도를 측정할 수 없는 경우, 해당 차원을 제외하고 나머지 차원으로 평균을 산출합니다.

## 설정

Deep Docs는 별도의 설정 파일이 필요 없습니다. `.deep-docs/` 디렉토리는 첫 실행 시 자동으로 생성됩니다.

### 스캔 아티팩트: `.deep-docs/last-scan.json`

모든 스캔은 완전한 출처 정보(provenance)를 포함한 내구성 아티팩트를 기록합니다:

```json
{
  "scanned_at": "2026-04-17T14:30:00Z",
  "schema_version": 2,
  "provenance": {
    "is_git": true,
    "head_sha": "abc123",
    "branch": "main",
    "worktree_hash": "3f8a..."
  },
  "documents": [
    {
      "path": "CLAUDE.md",
      "issues": [...],
      "metrics": {
        "size_lines": 85,
        "freshness_score": 7,
        "reference_accuracy": 0.85,
        "duplication_count": 1
      }
    }
  ],
  "summary": {
    "total_issues": 5,
    "auto_fixable": 3,
    "audit_only": 2
  }
}
```

`garden`과 `audit`은 다음 **4가지 조건이 모두** 충족될 때 이 아티팩트를 재사용합니다:
- `schema_version == 2`
- 생성된 지 **10분 이내**
- `provenance.head_sha`가 `git rev-parse HEAD`와 일치 (git 환경)
- `provenance.worktree_hash`가 재계산값과 일치 (git 환경)

`worktree_hash`는 추적된 diff + 미추적 파일 목록/내용을 커버합니다 (NUL-safe, 파일별 git-hash-object). `scan-filters/worktree-hash.md` 참조.

git을 사용하지 않는 환경에서는 10분 TTL만 적용됩니다.

## 설치

```bash
claude plugin add deep-docs
```

## 라이선스

MIT
