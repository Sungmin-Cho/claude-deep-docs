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

### Step 2. NUL-safe 파일 열거 (NEW-RCE 대응)

**절대 금지**: `xargs -I{} sh -c '... {}'` — 파일명이 `sh -c`에 삽입되어 shell이 재파싱.

**올바른 방법**: NUL delimiter + bash loop:

```bash
compute_worktree_hash() {
    {
        # (A) tracked 변경
        git diff HEAD --binary 2>/dev/null || true

        # (B) untracked 파일 목록 (NUL-delimited)
        git ls-files -z --others --exclude-standard | tr '\0' '\n' | sort

        # (C) untracked 파일 내용 (NUL-safe loop)
        while IFS= read -r -d '' f; do
            [ -f "$f" ] || continue
            # 파일 구분자 (path를 그대로 shell에 재해석 안 함)
            printf 'FILE:%s\n' "$f"
            # 내용 append — path는 cat의 argument로만 전달됨
            cat -- "$f" 2>/dev/null || true
            printf '\nEOF\n'
        done < <(git ls-files -z --others --exclude-standard)

    } | shasum -a 1 | awk '{print $1}'
}
```

**보안 특성**:
- 파일명은 `cat --` 뒤에 **argument로만** 전달됨. shell이 재파싱하지 않음.
- `--` sentinel로 dash-prefix 파일명(`-rf`) 등 옵션 해석 방지.
- NUL(`\0`) delimiter로 newline 포함 파일명도 안전.

### Step 3. 해시 정규화

- `git diff --binary`: binary 파일도 base64 인코딩되어 diff에 포함됨 → 시간 독립적 해시 보장
- shasum이 없는 환경(매우 드묾): `openssl dgst -sha1` fallback
  ```bash
  hash_cmd=$(command -v shasum || command -v sha1sum || echo "openssl dgst -sha1")
  ```

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
3. **LFS 파일**: `git diff --binary`는 LFS pointer만 포함. 실제 large file 내용은 해시에 반영 안 됨. minor — LFS 파일 변경은 HEAD sha 비교로 감지됨.

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
