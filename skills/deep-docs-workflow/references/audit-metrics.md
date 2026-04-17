# Audit Metrics

## 정량 지표

### 1. 파일 크기 (Size)

| 파일 | 기준 | 점수 |
|------|------|------|
| CLAUDE.md | ~100줄 권장 | ≤100줄: 10점, 100-200줄: 7점, >200줄: 4점 |
| AGENTS.md | ~100줄 권장 | 동일 |
| README.md | ~300줄 권장 | ≤300줄: 10점, 300-500줄: 7점, >500줄: 4점 |
| 기타 docs/ | ~200줄 권장 | ≤200줄: 10점, 200-400줄: 7점, >400줄: 4점 |

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

측정: (외부 포인터 라인 수) / (전체 지침 라인 수)
- 외부 포인터: "자세한 내용은 X 참조", 링크, "see also" 등
- 직접 지침: 구체적 규칙, 설정, 명령어 등

표시만 하고 점수 매기지 않음 (프로젝트마다 최적 비율이 다름).

## 종합 점수

측정 가능한 점수 항목들의 평균 (측정 불가 항목은 제외하고 나머지로 산출):
- 9-10: 🟢 Excellent
- 7-8: 🟡 Good (개선 여지 있음)
- 5-6: 🟠 Fair (정비 권장)
- 1-4: 🔴 Poor (즉시 정비 필요)
