# Deep Review Round 3 — 2026-04-17

- **Target**: v3 spec + `scan-filters/` 디렉토리 (architectural split)
- **Base**: `0fef6d4` (round 2) → `989e235` (v3 HEAD)
- **Review Mode**: 3-way (Opus + Codex review + Codex adversarial)

---

## Verdict

**🟡 CONCERN (not REQUEST_CHANGES, but not APPROVE)**

### Good news (round 2 blocker 해결 현황)

| Round 2 ID | 해결? | 증거 |
|----|:----:|------|
| NEW-RCE (xargs sh -c) | ✅ | Opus 실측 — 파일명 `$(echo hacked).md` 포함 실행에도 RCE 없음, 해시 결정적 |
| NC-2 (sort -r broken) | ✅ | 완전 epoch 비교로 교체, 실행 확인 |
| NC-1 (config.go.md) | ✅ | LOCALE_ALLOWLIST에 확장자 없음, Python 실행 검증 |
| Codex P2 (dir 병합) | ✅ | group_key에 dirname 포함 |
| NEW-CLI-BYPASS | ⚠️ | Python 로직 OK, **Bash에 새 버그 + extraction pipeline에서 도달 못함** |
| NEW-FENCE-INDENT | ⚠️ | Python/정규식 OK, **awk 구현에 새 버그** |

### Bad news: Round 3 새 발견 결함

**패턴**: 각 라운드마다 다른 angle에서 **새 결함이 도출됨**. Opus는 Python↔Bash 불일치, Codex review는 semantic correctness, Codex adversarial은 인코딩/dataflow ambiguity를 짚음.

---

## 🔴 Critical (cross-verified)

### BU-1. Package-manager built-in subcommand이 stale로 오판
**교차 검증: 3/3 일치.**

- Opus Critical 2 + Codex review P1 + Codex adversarial Medium
- 예: `npm install`, `npm ci`, `npm test`, `yarn install`, `pnpm add`, `bun install`, `uv run pytest`, `poetry run pytest` 모두 **scripts 키에 없어 stale 판정**.
- 원인: `cli-whitelist.md` Step 1이 `subcmd != "run"` 분기에서 `target = subcmd`로 설정 후 scripts 키와 대조.
- 실행 증거(Codex): `package.json`에 `scripts` 키 없는 프로젝트에서 `npm install` → Python `scripts.get('install')` → 없음 → stale.

**수정**: 매니저별 built-in 세트 추가:
```
NPM_BUILTINS = {"install", "ci", "test", "publish", "audit", "init", "create",
                "login", "logout", "version", "update", "outdated", "dedupe",
                "prune", "exec", "start", "stop", "add", "remove", "uninstall",
                "link", "unlink", "cache"}
UV_BUILTINS = {"sync", "add", "remove", "lock", "run", "tool", "python", "pip"}
POETRY_BUILTINS = {"install", "add", "remove", "update", "lock", "run", "shell", "build"}

if binary in BUILTINS_MAP:
    if subcmd in BUILTINS_MAP[binary]:
        return (False, f"{binary} built-in: {subcmd}")
    if subcmd == "run":        # 사용자 스크립트 호출
        target = tokens[2] if len(tokens) >= 3 else ""
        # scripts 검증 수행
```

---

## 🟠 High (단독이지만 실질 블로커)

### BU-2. `reference-extraction.md`가 CLI 참조를 애초에 추출 안 함 → CLI whitelist 로직 unreachable
**Codex adversarial 단독.**

- `reference-extraction.md` Rule 2가 "공백 포함하면 제외"를 명시.
- `` `npm run build` ``, `` `git log -1` ``은 공백 포함 → 추출 제외 → `kind: "cli"` 객체 생성 안 됨.
- 결과: NEW-CLI-BYPASS 수정이 `cli-whitelist.md`에서 아무리 완벽해도, 입력이 안 들어옴.

**수정**: Rule 5(CLI 추출)를 Rule 2와 독립된 branch로 분리:
```
# CLI 추출 branch (공백 허용)
backtick_contents = re.findall(r'`([^`]+)`', text)
for content in backtick_contents:
    first_token = content.split()[0] if content else ""
    if first_token in CLI_BINARIES:
        yield Reference(kind="cli", value=content, ...)
    elif "/" in content or matches_extension(content):
        yield Reference(kind="path", value=content, ...)
    elif re.match(r'[A-Z][a-zA-Z0-9_]*$|[a-z][a-zA-Z0-9_]*\(\)$', content):
        yield Reference(kind="symbol", value=content, ...)
```

### BU-3. `worktree-hash.md` Step B `tr '\0' '\n'`이 NUL-safety 깨트림
**Codex review P3.**

- `git ls-files -z --others --exclude-standard` 출력(NUL-delimited)을 `tr '\0' '\n'`로 변환해서 `sort` 후 해시.
- 문제: 파일명에 newline이 포함된 경우 두 개 파일(`a\nb`)이 `a`, `b` 두 파일처럼 보임.
- Step C(내용 해싱)는 NUL-safe이지만 Step B(파일 목록)가 ambiguous.

**수정**: Step B도 NUL-safe 유지 (GNU/BSD sort는 `-z` 플래그 지원):
```bash
git ls-files -z --others --exclude-standard | sort -z | xxd -p
```

### BU-4. `worktree-hash.md` 직렬화 ambiguity — 다른 worktree가 동일 해시 생산 가능
**Codex adversarial 단독.**

- 현재: `printf 'FILE:%s\n' "$f"; cat -- "$f"; printf '\nEOF\n'` 패턴.
- 공격: 파일 `a`의 내용이 `b\nEOF\nFILE:c\n`이면, **두 파일 `a`(`b`) + `c`(`""`)**와 동일 스트림 생산.
- 결과: cache hit으로 실제 다른 worktree에서 stale scan 결과 재사용.

**수정**: length-prefix 또는 per-file digest 사용:
```bash
# 방법 1: git hash-object 기반
hash1=$(git hash-object "$f")
printf '%s\0%s\n' "$f" "$hash1"

# 방법 2: size-prefix
size=$(stat -f %z "$f" 2>/dev/null || stat -c %s "$f")
printf '%s\0%d\0' "$f" "$size"
cat -- "$f"
```

### BU-5. `freshness-timestamp.md`: 존재하지 않는 파일이 `None` 대신 `0` 반환 → fresh로 오판
**Codex adversarial Medium.**

- 필터 contract: "파일 없으면 None 반환, freshness 계산에서 제외"
- 실제 Bash 구현: `[ -e "$p" ] || { echo 0; return; }` — **`0` 반환**.
- 결과: `r_ts = 0`, `doc_ts > 0` → `r_ts > doc_ts`가 false → stale count 안 올라감 → **dead reference가 fresh로 취급**, freshness score 인플레이션.

**수정**: Bash도 빈 문자열 또는 명시적 sentinel 반환:
```bash
fs_epoch_for_path() {
    local p="$1"
    [ -e "$p" ] || { echo ""; return; }   # None equivalent
    ...
}

# 호출 측:
ts=$(fs_epoch_for_path "$p")
[ -z "$ts" ] && continue    # skip missing paths
```

### BU-6. 깨끗한 checkout에서 mtime이 git time보다 항상 커서 fresh 오판
**Codex review P1.**

- `git clone` / `git checkout`은 파일 mtime을 체크아웃 시각으로 설정.
- `max(fs_ts, git_ts)` 채택 시 clean clone에서 **항상 mtime(최근)** 채택 → 모든 문서가 fresh로 판정 → stale 문서 감지 실패.
- 원래 H-6 의도: "dirty 파일의 mtime이 git time보다 클 때만 mtime 채택". 지금은 그 조건이 없음.

**수정**:
```
is_dirty = path in dirty_files_set  # git diff --name-only / ls-files --others
if is_dirty:
    return max(fs_ts, git_ts)
else:
    return git_ts   # clean file은 무조건 git time
```

### BU-7. `code-fence.md` awk 구현의 들여쓰기 fence 처리 버그
**Codex review P1.**

- 현재: `match($0, /^ {0,3}(\`{3,}|~{3,})/)` 후 `substr($0, RSTART, RLENGTH)`로 mark 추출.
- 문제: `RSTART=1, RLENGTH=N` (전체 매치 길이 — 들여쓰기 포함). `substr`는 들여쓰기까지 포함 → `mark="   \`\`\`"`, `ch=" "`(공백). closer는 공백으로 시작 못함 → **닫는 ``` ``` ```에 매칭 안 됨**.
- 결과: 들여쓰기 fence는 "열린 채로" 파일 끝까지 이어짐 → fenced 내용이 prose로 leak.

**수정**: gawk 3-argument `match`로 capture groups 분리, 또는 POSIX awk 불가하므로 bash regex(`[[ "$line" =~ ... ]]`) 사용.

### BU-8. Opus 단독: `npm run <target>` Bash 파싱 버그
**Opus Critical 1 (실측).**

```bash
target="${subcmd%% *}"          # target="run" (첫 단어)
if [ "${target%% *}" = "run" ]  # true
target="${target#run}"          # target="" (이미 "run"뿐이었음)
[ -z "$target" ] && return 1    # non-stale ← WRONG
```

**수정**:
```bash
set -- $subcmd   # positional args로 변환
if [ "${1:-}" = "run" ]; then
    target="${2:-}"
else
    target="${1:-}"
fi
```

---

## 🟡 Warnings (수정 권장, 블로커는 아님)

### BW-1. `sha1sum` fallback 허용 vs 스펙 "금지" 모순 (Opus)
`worktree-hash.md:74`에 `sha1sum` fallback 있지만 스펙 §7.4/§10은 "미사용/금지" 명시. `verify-fixes.sh`에서 `sha1sum` 문자열 체크하면 실패.

### BW-2. Bash system whitelist의 `...` placeholder (Opus)
`cli-whitelist.md:180`에 `git|hg|svn|cargo|go|pytest|...)` — 실행 불가. 완전 리스트 복사 필요.

### BW-3. `reference-extraction` Rule 5가 `cli-whitelist`에 구조 의존 (Opus)
Isolation 원칙 살짝 깨짐. CLI binary 리스트를 공유 파일로 분리하거나, Rule 5를 명시적으로 완화.

### BW-4. LOCALE_ALLOWLIST 남아시아 언어 누락 (Opus Info)
bn, ta, te, mr, ur, ne, si, sw, af, ca 추가 권장.

### BW-5. `cn`/`tw`/`kr` 비표준 관행 수용 (Opus Info)
명시적 "IETF BCP 47 비준수이지만 관행 수용" 주석 추가 권장.

---

## 교차 검증 매트릭스 (round 3)

| ID | Opus | Codex | Codex Adv | 확신도 |
|----|:----:|:-----:|:---------:|:------:|
| BU-1 built-in subcommand | ✅ Critical 2 | ✅ P1 | ✅ Medium | 🔴 3/3 |
| BU-2 ref-extraction CLI unreachable | — | — | ✅ High | 🟠 Adv 단독 |
| BU-3 tr NUL loss | — | ✅ P3 | — | 🟡 Codex 단독 |
| BU-4 sentinel ambiguity | — | — | ✅ High | 🟠 Adv 단독 |
| BU-5 missing→fresh | — | — | ✅ Medium | 🟠 Adv 단독 |
| BU-6 clean checkout mtime | — | ✅ P1 | — | 🟠 Codex 단독 |
| BU-7 awk indent bug | — | ✅ P1 | — | 🟠 Codex 단독 |
| BU-8 Bash `npm run` 파싱 | ✅ Critical 1 | — | — | 🟠 Opus 단독 (실측) |

---

## 메타 관찰: 반복 패턴

| Round | 해결 | 새 발견 |
|-------|------|---------|
| 1차 | 24건 원본 findings 대응 | 17건 (3 Critical + 6 High + …) |
| 2차 | 14/17 실질 해결 | 7건 (3 Critical + 2 High + 2 Warning) |
| 3차 | 5/7 실질 해결 + 분리 아키텍처 성공 | 8건 (1 Critical cross-verified + 6 High) |

**관찰**: 라운드마다 **새 결함의 세밀도(granularity)가 깊어짐**. 알고리즘 → 구현 언어 → 인코딩/dataflow로 넘어감.

**공통 관찰**: 거의 모든 새 결함이 **Bash-equivalent 구현**에서 발생. Python 로직/알고리즘은 대체로 옳음.

---

## Ship-readiness

**상태**: 🟡 CONCERN. writing-plans 진입 가능하되, **BU-1만은 반드시 수정** (3/3 cross-verified, 실사용에서 대량 false-positive 유발).

**권장 진행 방안** (세 가지 중 선택):

### Option A — 국소 수정 + 4차 리뷰
BU-1~BU-8 모두 수정 후 4차 re-review. 각 수정이 `scan-filters/` 내 단일 파일에 국한되므로 2-3시간.
- 장점: 스펙 완성도 극대화
- 단점: 4차에서 또 새 결함 가능 (Bash fragility)

### Option B — 스펙 기조 전환: "Python이 구현 언어, Bash는 참고"
`scan-filters/*.md`의 **Bash-equivalent 섹션을 "참고용 근사치"로 격하**하고, 실 구현은 Python 권장 명시. Claude agent는 Bash에서 Python 호출 가능(`python3 -c '...'`).
- 장점: 거의 모든 round 3 결함이 "Bash 구현 세부"라 한 번에 해결. BU-1만 남음.
- 단점: 사용자 환경에 Python 3 의존. (실무에서 거의 있음)

### Option C — Plan 선행 TODO로 blocker 이관
BU-1만 스펙 수정, 나머지는 implementation plan의 "commit 2 pre-step"으로 이관. 스펙 Freeze 후 plan 진입.
- 장점: 속도
- 단점: 위험 분산

---

## 제안

**Option B 강력 권장**. 관찰된 패턴은 "Bash 구현 fragility"가 본질임을 보여주고, Python이 Claude Code 환경에서 가용하므로 Bash를 "2차 참고"로 격하하는 게 실무적. 이 변경 자체도 `scan-filters/README.md` 한 파일 수정 + 각 필터 상단 주석 추가로 끝남.

BU-1(built-in subcommand)은 Option B와 별개로 `cli-whitelist.md`에서 직접 수정.
