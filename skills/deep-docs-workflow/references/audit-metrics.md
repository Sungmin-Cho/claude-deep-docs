# Audit Metrics

## 정량 지표

### 1. 파일 크기 (Size)

strict `>` 부등호로 scan 경고와 audit 만점 경계 일치 (CX-2 대응):

| 파일 | audit 점수 | scan 경고 |
|------|------------|-----------|
| CLAUDE.md / AGENTS.md | `≤100: 10`, `100 < x ≤ 200: 7`, `>200: 4` | `>100` |
| README.md | `≤300: 10`, `300 < x ≤ 500: 7`, `>500: 4` | `>300` |
| 기타 docs/ | `≤200: 10`, `200 < x ≤ 400: 7`, `>400: 4` | `>200` |

**라인 카운트 규약**: `wc -l` 기준 (trailing newline 없으면 +1 보정 필요). 경계값 판정은 Python `len(lines)`로 확인 가능.

### 2. 신선도 (Freshness) — Path-scoped

측정 방법 (`scan-filters/freshness-timestamp.md` 위임):
1. 문서가 참조하는 파일 경로 추출
2. 각 경로의 `last_modified_epoch`:
   - git 커밋 시각: `git log -1 --format=%ct -- <path>` (epoch)
   - 파일시스템 mtime: `stat -f %m` (BSD) / `stat -c %Y` (GNU)
   - **dirty 파일만** `max(fs_ts, git_ts)` 채택 (clean checkout에서 mtime이 git time보다 커도 git time 사용)
3. 문서 자체의 `last_modified_epoch`도 동일 방식
4. 참조 경로의 last_modified > 문서의 last_modified → stale

**점수 스케일** (허용 값 `{10, 7, 4, null}`):

| stale 비율 | 점수 |
|------------|------|
| `<30%` | 10 |
| `30–70%` | 7 |
| `≥70%` | 4 |
| 참조 경로 없음 | `null` (평균에서 제외) |

**경계 명확화** (M-1): 재현성 위해 정량 구간 정의. 비율은 `stale_count / total_refs`이며 `total_refs`에서 **존재하지 않는 경로는 제외**(BU-5).

### 3. 참조 정확도 (Reference Accuracy)

측정: (유효한 참조 수) / (전체 참조 수) × 100%

점수:
- 100%: 10점
- 90-99%: 8점
- 70-89%: 5점
- <70%: 2점

### 4. 중복도 (Duplication)

측정: 다른 문서와 중복되는 블록 수

점수:
- 0건: 10점
- 1-2건: 7점
- 3건 이상: 4점

### 5. 맵 vs 매뉴얼 비율 (audit-only)

**외부 포인터 라인** — 다음 중 하나:
- `[텍스트](URL)` 형태 또는 `[텍스트](상대경로)`
- `"참고:"`, `"see also"`, `"자세한 내용은"`, `"refer to"` 같은 리드 포함
- 단독 URL 라인 (`^https?://`)

**직접 지침 라인** — 외부 포인터도, 빈 라인도, 헤딩(`^#`)도, 코드펜스 라인도 아닌 평문 라인

**비율** = `외부 포인터 라인 수 / (외부 포인터 + 직접 지침 라인 수)`

표시만 하고 점수 매기지 않음 (프로젝트마다 최적 비율 다름).

## 종합 점수

측정 가능한 지표 평균, **소수점 1자리** 반올림 (`Math.round(score * 10) / 10`):

| 점수 구간 | 밴드 |
|-----------|------|
| `score ≥ 9.0` | 🟢 Excellent |
| `7.0 ≤ score < 9.0` | 🟡 Good |
| `5.0 ≤ score < 7.0` | 🟠 Fair |
| `score < 5.0` | 🔴 Poor |

문서에 참조 경로가 없어 특정 지표를 측정 못하면 해당 지표 제외하고 나머지로 평균.
