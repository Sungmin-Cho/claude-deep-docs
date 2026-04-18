# Filter: worktree-hash

## 목적

`.deep-docs/last-scan.json`의 재사용 가능성을 판정하기 위한 워크트리 해시. 스캔 시점 이후 tracked/untracked 변경이 있었는지 1개 해시로 요약한다.

## 해결하는 리뷰 ID

- **H-1** (원본 ultrareview): HEAD SHA + TTL로는 워킹트리 변경 미감지
- **X-2** (deep-review 1차): tracked diff만으로는 untracked 파일 추가 누락
- **NEW-RCE** (deep-review 2차): `xargs -I{} sh -c`가 파일명의 shell metacharacter 실행 위험

## 입력

- 스캔 실행 시점의 git 저장소 (cwd)

## 출력

- `worktree_hash: str` — sha1 hex digest (40자) 또는 literal `"no-git"`
- tracked diff + untracked 파일 목록/내용을 **모두** 반영

## 알고리즘

### Step 1. git 환경 감지

```bash
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "no-git"
    exit 0
fi
```

non-git 환경이면 `"no-git"` 반환, 재사용 로직은 `scanned_at` TTL만 사용.

### Step 2. 안전한 직렬화 (NEW-RCE + BU-3 + BU-4 대응)

**절대 금지**:
- `xargs -I{} sh -c '... {}'` — 파일명이 `sh -c`에 삽입되어 shell이 재파싱 (NEW-RCE).
- `tr '\0' '\n'` — 파일명에 newline 포함 시 두 파일처럼 변질 (BU-3).
- `FILE:path\ncontent\nEOF\n` 같은 plain-text sentinel — 내용에 sentinel이 포함되면 서로 다른 worktree가 동일 스트림 생산 (BU-4 injection).

**Python primary 구현 (BU-3, BU-4 해결)**:

```python
import hashlib
import subprocess
from pathlib import Path

def compute_worktree_hash() -> str:
    """
    Unambiguous worktree fingerprint.
    - tracked diff: git diff HEAD --binary
    - untracked files: git hash-object per file, sorted
    Returns hex sha1 digest.
    """
    h = hashlib.sha1()

    # (A) tracked 변경 — git diff는 자체 구조가 unambiguous
    tracked_diff = subprocess.run(
        ["git", "diff", "HEAD", "--binary"],
        capture_output=True, check=False,
    ).stdout
    # length-prefix diff
    h.update(f"TRACKED_DIFF:{len(tracked_diff)}\n".encode())
    h.update(tracked_diff)

    # (B) untracked 파일 목록 — NUL-delimited 그대로 파싱
    untracked_raw = subprocess.run(
        ["git", "ls-files", "-z", "--others", "--exclude-standard"],
        capture_output=True, check=False,
    ).stdout
    paths = [p for p in untracked_raw.split(b"\x00") if p]
    paths.sort()

    # (C) 각 파일의 per-file digest — ambiguity 원천 제거
    h.update(f"UNTRACKED_COUNT:{len(paths)}\n".encode())
    for path_bytes in paths:
        path = Path(path_bytes.decode("utf-8", errors="surrogateescape"))
        obj_hash = _file_digest_streaming(path)       # N-3 대응: stream
        # record: length-prefixed path + its content digest
        h.update(f"{len(path_bytes)}\0".encode())
        h.update(path_bytes)
        h.update(f"\0{obj_hash}\n".encode())

    return h.hexdigest()


def _file_digest_streaming(path: Path) -> str:
    """
    Stream a file through sha1 in 64KB chunks (N-3 대응).
    Avoids loading large files (video, binaries) fully into memory.
    Returns git-style blob digest or '__MISSING__'.
    """
    import os
    try:
        size = os.path.getsize(path)
    except OSError:
        return "__MISSING__"
    h = hashlib.sha1()
    h.update(f"blob {size}\0".encode())
    try:
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
    except OSError:
        return "__MISSING__"
    return h.hexdigest()
```

**안전 특성**:
1. **NUL 보존 (BU-3)**: 파일 목록은 끝까지 NUL로 delimited 처리. 텍스트 변환 없음.
2. **Unambiguous 직렬화 (BU-4)**: 각 record가 `<length>\0<path>\0<sha1>` 형태로 길이-접두사 + fixed-width hash. sentinel 문자열 injection 불가.
3. **RCE-free (NEW-RCE)**: 파일명이 shell을 거치지 않음. Python `open()`에 bytes-path로 직접 전달.
4. **Cross-platform**: Python `hashlib.sha1`은 macOS/Linux 동일. `shasum`/`sha1sum` 분기 불필요.
5. **결정성**: `paths.sort()`로 순서 안정. 빈 untracked일 때도 `UNTRACKED_COUNT:0`가 hash에 포함됨 → 결정적.

**참고: Bash 근사 (정확성 미보장)**:
```bash
# WARNING: Python이 primary. 이 Bash는 디버깅/간이 확인용.
# ambiguity 완전 제거 못함 (newline in filename 경계 조건).
compute_worktree_hash_approx() {
    {
        printf 'TRACKED_DIFF:'
        git diff HEAD --binary 2>/dev/null | wc -c
        git diff HEAD --binary 2>/dev/null

        git ls-files -z --others --exclude-standard \
          | sort -z \
          | while IFS= read -r -d '' f; do
              [ -f "$f" ] || continue
              # git hash-object는 각 파일에 대해 unambiguous digest
              printf '%s\0' "$f"
              git hash-object -- "$f" 2>/dev/null || printf '__MISSING__'
              printf '\n'
            done
    } | shasum -a 1 | awk '{print $1}'
}
```
Bash 근사도 `git hash-object`로 per-file digest를 씀으로써 BU-4를 완화하지만, `sort -z`의 BSD/GNU 호환성 이슈가 남음.

### Step 3. 해시 정규화

- Python primary에서는 `hashlib.sha1`로 통일 — 외부 도구 의존 없음.
- `git diff --binary`: binary 파일도 base64 인코딩되어 diff에 포함됨 → 시간 독립적 해시 보장.
- Bash 근사에서 `shasum -a 1` 우선, `sha1sum` **사용 금지** (macOS 호환 + 스펙 일관성, BW-1 대응). 둘 다 없으면 `openssl dgst -sha1` fallback.

## 재사용 규칙 연동

`.deep-docs/last-scan.json`의 재사용은 다음을 모두 만족:

```python
def can_reuse_scan(artifact, now):
    if artifact["schema_version"] != CURRENT_SCHEMA_VERSION:
        return False
    if (now - parse_iso(artifact["scanned_at"])).total_seconds() > 600:
        return False
    prov = artifact["provenance"]
    if not prov.get("is_git"):
        # non-git: TTL only (already checked)
        return True
    if prov["head_sha"] != current_head_sha():
        return False
    if prov["worktree_hash"] != compute_worktree_hash():
        return False
    if prov.get("path_check_enabled") != config.enable_path_check:
        return False   # 환경 설정 변경도 무효화
    return True
```

## Edge Case 매트릭스

| 시나리오 | 해시 동작 |
|----------|-----------|
| clean tree, tracked 변경 없음, untracked 없음 | 결정적 해시 (sha1 of empty-ish input) |
| tracked 파일 1개 수정 | `git diff HEAD`가 변경 diff 반환 → 해시 바뀜 |
| untracked 파일 1개 추가 | ls-files --others에 잡힘 → 해시 바뀜 |
| untracked 파일 삭제 (추가 후 삭제) | 목록에서 빠짐 → 이전 추가 전 해시와 동일 |
| untracked 파일 수정 (이미 untracked인 파일 내용 변경) | 내용 재cat → 해시 바뀜 |
| 파일명에 `$()` 포함 | cat argument로만 전달 → shell 실행 안 됨 (NEW-RCE 해결) |
| 파일명에 newline 포함 | NUL-delimited read → 안전 처리 |
| 파일명이 `-rf` | `cat --`로 sentinel 뒤 argument 취급 → 옵션 해석 안 됨 |
| binary 파일 변경 | `--binary` 옵션으로 base64 포함 → 감지됨 |
| 파일 권한만 변경 (내용 동일) | diff에 mode change 포함 → 감지됨 |
| `.gitignore`로 무시되는 파일 | `--exclude-standard`로 제외 → 해시에 영향 없음 (의도) |

## Failure Modes

1. **symlink loop**: `cat`이 symlink를 따라가다 loop 걸리면 hang. 완화: `find -L` 대신 직접 `cat`만 — `cat`은 symlink를 한 번만 따라감, loop 시 파일로 인식 못하고 skip 가능.
2. **거대 untracked 디렉토리**: 수GB의 미커밋 빌드 산출물이 있으면 해시 계산 오래 걸림. 완화: `.gitignore` 지시. 사용자 책임.
3. **거대 untracked 파일 메모리** (N-3 대응): 500MB+ 개별 파일도 `_file_digest_streaming()`이 64KB chunk로 해시 → 메모리 사용량 O(1). 무한 파일 크기 대응.
4. **LFS 파일**: `git diff --binary`는 LFS pointer만 포함. 실제 large file 내용은 해시에 반영 안 됨. minor — LFS 파일 변경은 HEAD sha 비교로 감지됨.

## Bash 실행 가능성 확인

```bash
# Dogfood: 파일명에 shell metacharacter 포함 테스트
mkdir -p /tmp/deepdocs-hashtest
cd /tmp/deepdocs-hashtest
git init -q
touch "normal.txt"
touch "\$(echo hacked).md"         # RCE 시도
touch "-rf.md"                      # dash-prefix
hash1=$(compute_worktree_hash)
rm "\$(echo hacked).md"
touch "\$(echo hacked).md"          # 재생성
hash2=$(compute_worktree_hash)
[ "$hash1" = "$hash2" ] && echo "OK: deterministic" || echo "FAIL"
```

이 테스트가 안전하게 통과해야 함. `echo hacked`가 실제 실행되지 않아야 함.

## 통합 지점

- **Step 12 (doc-scanner.md)**: 아티팩트 저장 시 `provenance.worktree_hash`로 기록.
- **scan 재사용 판정 (commands/deep-docs.md)**: garden/audit 진입 시 본 필터 재실행 후 저장값과 비교.

## 버전

- **v1.0** (2026-04-17): 초안. NUL-safe loop, `shasum -a 1` 기반, `--binary` diff.
