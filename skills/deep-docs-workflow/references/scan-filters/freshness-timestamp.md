# Filter: freshness-timestamp

## 목적

문서/참조 경로의 "마지막 수정 시각"을 macOS/Linux 양쪽에서 결정적으로 판정한다. 이 값은 freshness(H-4) 평가의 기초가 된다.

## 해결하는 리뷰 ID

- **H-4** (원본 ultrareview): freshness 스케일
- **H-6** (원본 ultrareview): 워크트리 미커밋 수정이 반영 안 됨
- **O-6** (deep-review 1차): macOS `sha1sum`/`stat` 차이
- **NC-2** (deep-review 2차): `sort -r | head -1`가 Linux에서 잘못된 max 반환

## 입력

- `path: str` — 대상 파일 경로 (repo-relative)
- git 환경 여부 (from worktree-hash detection)

## 출력

- `last_modified_epoch: int` — UNIX epoch seconds (정수)
- 반환 없음 시 `None` (파일 존재 안 함)

## 알고리즘

### 핵심 원칙 (NC-2 대응)

**문자열 비교 금지**. `sort -r | head -1`로 ISO 문자열을 비교하는 방식은 macOS/Linux `stat` 출력 포맷 차이로 오작동. **항상 epoch seconds(정수)로 변환 후 수치 비교**.

### Step 1. git 시각 (epoch)

```bash
git_epoch_for_path() {
    local p="$1"
    # %ct = committer timestamp in unix epoch (정수)
    git log -1 --format=%ct -- "$p" 2>/dev/null || echo 0
}
```

- `%aI`(ISO) 대신 `%ct`(epoch) 사용 — 포맷 해석 불필요, 직접 정수.
- 파일이 git에 없거나 커밋 이력 없으면 `0` 반환 (미래의 어떤 파일보다도 오래됨).

### Step 2. 파일시스템 mtime (epoch)

macOS(BSD)와 Linux(GNU)의 `stat` 구문이 다름 → fallback chain:

```bash
fs_epoch_for_path() {
    local p="$1"
    [ -e "$p" ] || { echo 0; return; }

    # macOS BSD stat: -f %m (epoch)
    if stat -f %m "$p" 2>/dev/null; then
        return
    fi
    # Linux GNU stat: -c %Y (epoch)
    if stat -c %Y "$p" 2>/dev/null; then
        return
    fi
    # Ultimate fallback: date -r (macOS/Linux common)
    date -r "$p" +%s 2>/dev/null || echo 0
}
```

모든 경로에서 **epoch seconds 정수** 반환. 타임존 문제 원천 제거.

### Step 3. 최종 last_modified 계산

```bash
last_modified_epoch() {
    local p="$1"
    local git_ts fs_ts
    git_ts="$(git_epoch_for_path "$p")"
    fs_ts="$(fs_epoch_for_path "$p")"

    # 숫자 비교 (NC-2 해결)
    if [ "$fs_ts" -gt "$git_ts" ]; then
        echo "$fs_ts"   # 워크트리에서 수정됐지만 미커밋인 케이스 반영
    else
        echo "$git_ts"
    fi
}
```

- 파일시스템 mtime이 git commit time보다 미래 → 미커밋 수정 → mtime 채택 (H-6 해결).
- 파일시스템 mtime이 더 오래됨(드문 경우: checkout만 하고 touch 안 했으면) → git time 채택.

## Stale 비율 계산 (doc-scanner.md Step 5)

문서 `doc`에서 참조하는 경로 리스트 `refs`에 대해:

```python
doc_ts = last_modified_epoch(doc_path)
stale_count = 0
total_refs = 0
for r in refs:
    r_ts = last_modified_epoch(r.path)
    if r_ts is None:
        continue           # 경로 없음은 dead-reference에서 별도 처리
    total_refs += 1
    if r_ts > doc_ts:
        stale_count += 1

if total_refs == 0:
    freshness_score = None           # 참조 없음
else:
    ratio = stale_count / total_refs
    if ratio >= 0.70:
        freshness_score = 4
    elif ratio >= 0.30:
        freshness_score = 7
    else:
        freshness_score = 10
```

## Edge Case 매트릭스

| 시나리오 | git_ts | fs_ts | last_modified | 기대 |
|----------|--------|-------|---------------|------|
| 파일 커밋됨, 워크트리 변경 없음 | 1712000000 | 1712000000 | 1712000000 | git_ts = fs_ts |
| 파일 커밋됨, 그 후 워크트리 수정 | 1712000000 | 1712100000 | 1712100000 | mtime 채택 (H-6) |
| 파일 커밋 없음, 워크트리 생성만 | 0 | 1712100000 | 1712100000 | mtime 채택 |
| 파일 커밋됨, checkout 후 시간 지남, touch 안 함 | 1712000000 | 1712000000 | 1712000000 | 양쪽 동일 |
| 타임존 KST(+09) vs UTC | 동일 epoch | 동일 epoch | 동일 epoch | 타임존 무관 (epoch) |
| 파일이 git에도 없고 fs에도 없음 | 0 | 0 | 0 | None 취급 권장 |
| macOS `stat -c` 실패 → `-f` fallback | - | OK | OK | platform auto-detect |
| Linux `stat -f` 실패 → `-c` fallback | - | OK | OK | platform auto-detect |
| 둘 다 실패 → `date -r` fallback | - | OK | OK | 최종 fallback |

## Bash-equivalent 전체 구현

```bash
#!/usr/bin/env bash
# scripts/lib/freshness.sh
set -eu

last_modified_epoch() {
    local p="$1"
    local git_ts fs_ts

    git_ts="$(git log -1 --format=%ct -- "$p" 2>/dev/null || true)"
    [ -z "$git_ts" ] && git_ts=0

    if [ -e "$p" ]; then
        fs_ts="$(stat -f %m "$p" 2>/dev/null || stat -c %Y "$p" 2>/dev/null || date -r "$p" +%s 2>/dev/null || echo 0)"
    else
        fs_ts=0
    fi

    if [ "$fs_ts" -gt "$git_ts" ]; then
        echo "$fs_ts"
    else
        echo "$git_ts"
    fi
}

# 사용: ts=$(last_modified_epoch "README.md")
```

## Failure Modes

1. **Clock skew**: 시스템 시계가 잘못되면 mtime이 git time보다 미래로 설정될 수 있음. mtime 채택 → 실제 stale이어도 fresh로 판정. 완화: clock skew는 드물고 모든 시스템에서 고려 외.
2. **File without git history**: `git_ts = 0` → mtime이 항상 큼 → mtime 채택. 정상.
3. **Symlink**: `stat`이 symlink 대상의 mtime 반환 (BSD/GNU 모두 `stat <symlink>`). symlink 자체 mtime 원하면 `-L` 플래그, but 실용상 target mtime이 맞음.

## 통합 지점

- **Step 5 (신선도, doc-scanner.md)**: 각 문서별로 본 필터 호출 → stale 비율 계산 → freshness_score.
- **Step 3 (참조 검증, dead-reference 판정 시점)**: 별도 사용 안 함. freshness는 dead-reference와 분리된 관점.

## 버전

- **v1.0** (2026-04-17): 초안. Epoch-only numeric comparison. macOS/Linux stat fallback chain. H-6 mtime 반영.
