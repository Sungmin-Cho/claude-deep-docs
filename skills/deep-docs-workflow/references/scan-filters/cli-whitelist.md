# Filter: cli-whitelist

## 목적

문서에 등장한 CLI 명령어가 **stale**(실제 존재하지 않는 script/target/binary를 참조)인지 판정한다.

## 해결하는 리뷰 ID

- **M-7** (원본 ultrareview): CLI 비교 범위가 좁아 `git log`·`find` 등이 false-positive로 flag
- **X-4** (deep-review 1차): 비교 방법(full command vs bare binary) 미정의
- **NEW-CLI-BYPASS** (deep-review 2차): whitelist 우회로 `npm run missing-script`가 검출 안 됨

## 입력

- `ref: Reference` with `kind == "cli"`, `value`는 전체 command string (예: `npm run build`)
- 스캔 중인 프로젝트 루트 (project_root)

## 출력

- `is_stale: bool` — True면 stale로 flag (category = `auto-fix` 또는 `audit-only`)
- `reason: str` — 판정 근거

## 판정 규칙 (순서 중요, NEW-CLI-BYPASS 대응)

**원칙**: 더 구체적인 매칭을 먼저. whitelist는 "못 찾았을 때 fallback"이지 shortcut 아님.

### Step 0. 토큰화

```python
tokens = ref.value.strip().split()
binary = tokens[0] if tokens else ""
subcmd = tokens[1] if len(tokens) >= 2 else ""
```

### Step 1. Project-specific 2단계 lookup (최우선, BU-1 대응)

binary가 script manager면 먼저 **built-in 서브커맨드 allowlist** 체크, 다음으로 `run <script>` 분기에서만 project 파일과 대조.

**각 매니저의 built-in subcommand set** (round 3 리뷰 BU-1 수정):

```python
NPM_BUILTINS = {
    # 설치/의존성
    "install", "i", "ci", "uninstall", "un", "remove", "rm", "rb",
    "add", "a", "update", "up", "outdated", "dedupe", "prune",
    "link", "ln", "unlink",
    # 실행/라이프사이클
    "test", "t", "start", "stop", "restart", "exec", "x", "pack",
    "publish", "unpublish", "version",
    # 레지스트리/인증
    "login", "logout", "whoami", "adduser", "token",
    "search", "s", "se", "view", "info", "show",
    # 조회 — BU-1 파생 N-1 대응 추가
    "ls", "list", "ll", "la", "fund", "explain", "why",
    "diff", "dist-tag", "ping", "bugs", "docs", "home",
    "edit", "owner", "repo", "root", "prefix", "bin",
    "completion", "help-search", "help",
    # 관리
    "init", "create", "cache", "config", "c", "get", "set", "doctor",
    "team", "org", "profile", "hook", "access", "deprecate",
    "audit", "shrinkwrap", "rebuild",
}
PNPM_BUILTINS = NPM_BUILTINS | {
    "dlx", "store", "env", "import", "fetch", "patch", "patch-commit",
    "deploy", "licenses", "setup", "recursive", "m", "multi",
}
YARN_BUILTINS = NPM_BUILTINS | {
    "workspaces", "workspace", "dlx", "policies", "upgrade", "upgrade-interactive",
    "autoclean", "check", "generate-lock-entry", "global",
}
BUN_BUILTINS = NPM_BUILTINS | {
    "dlx", "upgrade", "pm", "run", "create", "build", "x", "add",
}
# NOTE (N-2 대응): uv/poetry는 "run"을 built-in에 두지 않음 — Step 1-d granular lookup이 동작하도록.
UV_BUILTINS = {
    "sync", "add", "remove", "lock", "tool", "python",
    "pip", "venv", "tree", "export", "init", "build", "publish",
    "cache", "self", "version", "help",
    # "run" 제외 — Step 1-d(uv run <script>)에서 처리
}
POETRY_BUILTINS = {
    "install", "add", "remove", "update", "lock", "shell",
    "build", "publish", "init", "new", "version", "env", "config",
    "cache", "search", "show", "check", "about", "self", "source",
    "export", "sync",
    # "run" 제외 — Step 1-d에서 처리
}
MAKE_BUILTINS: set = set()   # make는 built-in subcommand 없음 (모두 target)
JUST_BUILTINS = {"--list", "--help", "--version", "--init"}

BUILTINS_MAP = {
    "npm": NPM_BUILTINS, "pnpm": PNPM_BUILTINS,
    "yarn": YARN_BUILTINS, "bun": BUN_BUILTINS,
    "uv": UV_BUILTINS, "poetry": POETRY_BUILTINS,
    "make": MAKE_BUILTINS, "just": JUST_BUILTINS,
}

SCRIPT_TARGETS_VIA_RUN = {"npm", "pnpm", "yarn", "bun", "uv", "poetry"}

# 사용자가 `npm foo`처럼 알 수 없는 subcommand를 쓴 경우의 처리 정책
# - True: stale로 flag (aggressive)
# - False: audit-only로 격하 (conservative, 권장)
UNKNOWN_SUBCOMMAND_IS_STALE = False
```

**판정 로직** (순서 중요):

```python
def check_script_manager(binary, tokens):
    """Return (is_stale, reason) or None if not a script manager."""
    if binary not in BUILTINS_MAP:
        return None                                      # fall through

    subcmd = tokens[1] if len(tokens) >= 2 else ""

    # 1-a. built-in subcommand 먼저 체크 (BU-1 핵심 수정)
    if subcmd in BUILTINS_MAP[binary]:
        return (False, f"{binary} built-in: {subcmd}")

    # 1-b. `npm run <script>` / `pnpm run <script>` 등 — user script 호출
    if binary in SCRIPT_TARGETS_VIA_RUN and subcmd == "run":
        target = tokens[2] if len(tokens) >= 3 else ""
        if not target:
            return (False, f"{binary} run with no target")
        scripts = load_scripts_from_package_json()
        if target in scripts:
            return (False, f"{binary} run script found: {target}")
        return (True, f"{binary} script '{target}' not in package.json")

    # 1-c. `make <target>` — Makefile에서 찾기
    if binary == "make":
        target = subcmd
        if not target:
            return (False, "make with no target")
        targets = load_makefile_targets()
        if target in targets:
            return (False, f"make target found: {target}")
        return (True, f"make target '{target}' not in Makefile")

    # 1-d. `uv run <script>` / `poetry run <script>` — pyproject 기반
    if binary in ("uv", "poetry") and subcmd == "run":
        target = tokens[2] if len(tokens) >= 3 else ""
        if not target:
            return (False, f"{binary} run with no target")
        # uv/poetry run은 임의 Python 커맨드도 허용 (`uv run python foo.py`, `uv run pytest`)
        if target in SYSTEM_COMMAND_WHITELIST:
            return (False, f"{binary} run + system command: {target}")
        scripts = (load_uv_scripts() if binary == "uv" else load_poetry_scripts())
        if target in scripts:
            return (False, f"{binary} run script found: {target}")
        return (True, f"{binary} run script '{target}' not in pyproject")

    # 1-e. 알 수 없는 subcommand — 정책에 따라 stale 또는 audit-only (N-1 완화)
    reason = f"{binary} subcommand '{subcmd}' is neither built-in nor a script"
    if UNKNOWN_SUBCOMMAND_IS_STALE:
        return (True, reason)
    else:
        # 보수적 기본값: stale로 판정하지 않고 audit-only로 기록
        return (False, f"{reason} (audit-only)")
```

**N-1 대응 추가 정책**: `UNKNOWN_SUBCOMMAND_IS_STALE`을 `False`로 기본 설정. 새로운 npm subcommand가 추가돼도 (예: 향후 `npm next-thing`) 즉시 stale로 flag되지 않음. audit-only 분류로 기록되어 사용자가 리뷰 시점에 판단. BUILTINS 업데이트는 점진적으로 가능.

### Step 2. 시스템 명령 whitelist 매칭

Step 1에서 처리 안 된 binary를 whitelist와 대조:

```
SYSTEM_COMMAND_WHITELIST = {
    # Version control
    "git", "hg", "svn",
    # Package managers & builders (non-script-manager usage)
    "cargo", "rustc", "go", "javac", "mvn", "gradle", "dotnet",
    "pip", "pipx", "pipenv", "conda",
    "brew", "apt", "apt-get", "yum", "dnf", "pacman",
    # Testing & dev
    "pytest", "tox", "nox", "jest", "vitest", "mocha", "cypress",
    "cmake", "ninja", "meson",
    # Shell utilities
    "ls", "find", "grep", "rg", "ag", "sed", "awk", "cat", "wc",
    "head", "tail", "sort", "uniq", "cut", "tr", "xargs", "tee",
    "cp", "mv", "rm", "mkdir", "rmdir", "touch", "chmod", "chown",
    "ln", "readlink", "realpath", "basename", "dirname",
    # Networking
    "curl", "wget", "ssh", "scp", "rsync", "nc",
    # Containers & cloud
    "docker", "podman", "kubectl", "helm", "kustomize",
    "gh", "glab", "terraform", "tofu", "ansible",
    "aws", "gcloud", "az", "heroku", "fly", "vercel",
    # Shells & language runtimes (direct invocation)
    "bash", "sh", "zsh", "fish", "dash",
    "node", "deno", "python", "python3", "ruby", "perl", "php",
    # Miscellaneous
    "jq", "yq", "tar", "gzip", "zip", "unzip", "diff", "patch",
    "shasum", "sha1sum", "sha256sum", "md5sum", "openssl",
    "date", "watch", "time", "env", "printenv",
}

if binary in SYSTEM_COMMAND_WHITELIST:
    return (False, f"system command: {binary}")
```

### Step 3. `$PATH` lookup (optional, 결정적 동작 보장)

이 단계는 **환경 의존**이므로 기본 OFF. 구현자가 `--with-path-check` 플래그로 켤 때만 동작:

```python
if config.enable_path_check:
    if shutil.which(binary):
        return (False, f"found in $PATH: {binary}")
```

**경고**: `$PATH` 체크가 켜지면 스캔 결과가 개발자 머신에 의존 → reproducibility 훼손. `last-scan.json.provenance`에 `path_check_enabled: true` 기록 + 재사용 시 설정 일치 검증.

### Step 4. 최종 판정

위 단계 전부 non-stale 판정 못했으면 stale:

```python
return (True, f"unknown command '{binary}'")
```

### 통합 함수 (최종)

```python
def is_cli_stale(command: str, *, config) -> tuple[bool, str]:
    tokens = command.strip().split()
    if not tokens:
        return (True, "empty command")
    binary = tokens[0]

    # Step 1: script manager
    result = check_script_manager(binary, tokens)
    if result is not None:
        return result

    # Step 2: system whitelist
    if binary in SYSTEM_COMMAND_WHITELIST:
        return (False, f"system command: {binary}")

    # Step 3: optional PATH check
    if config.enable_path_check:
        import shutil
        if shutil.which(binary):
            return (False, f"found in $PATH: {binary}")

    # Step 4: stale
    return (True, f"unknown command '{binary}'")
```

## 판정 예시 (Edge Case 매트릭스)

| 입력 CLI | binary | Step 1 | Step 2 | 최종 | reason |
|----------|--------|--------|--------|------|--------|
| `git log -1 --format=%aI` | `git` | N/A | ✅ | non-stale | system command |
| `npm run build` (scripts에 build 있음) | `npm` | ✅ non-stale | - | non-stale | found in scripts |
| `npm run missing` (없음) | `npm` | ❌ stale | - | **stale** | NEW-CLI-BYPASS 해결 |
| `npm install` | `npm` | non-stale (built-in) | - | non-stale | npm built-in (BU-1 해결) |
| `npm ci` | `npm` | non-stale (built-in) | - | non-stale | npm built-in |
| `yarn install` | `yarn` | non-stale (built-in) | - | non-stale | yarn built-in |
| `pnpm add foo` | `pnpm` | non-stale (built-in) | - | non-stale | pnpm built-in |
| `uv sync` | `uv` | non-stale (built-in) | - | non-stale | uv built-in |
| `uv run pytest` | `uv` | non-stale (run + system) | - | non-stale | uv run + whitelist |
| `poetry install` | `poetry` | non-stale (built-in) | - | non-stale | poetry built-in |
| `make test` (Makefile에 있음) | `make` | ✅ non-stale | - | non-stale | found in Makefile |
| `make missing-target` | `make` | ❌ stale | - | **stale** | not in Makefile |
| `pytest tests/` | `pytest` | N/A | ✅ | non-stale | system command |
| `foo --bar` (unknown) | `foo` | N/A | ❌ | stale | unknown command |
| `python manage.py runserver` | `python` | N/A | ✅ | non-stale | system (인자 `manage.py`는 reference-extraction에서 path로 별도 처리) |

## 참고: Bash 근사 (정확성 미보장)

**WARNING**: Python 구현이 primary. 아래 Bash 코드는 디버깅용 예시이며, round 3에서 `npm run <target>` 파싱 버그(BU-8) 지적됨. 실제 구현에서 이 섹션을 그대로 쓰지 말고 Python을 `python3 -c`로 호출할 것.

```bash
# package.json scripts 로드
get_npm_scripts() {
    [ -f package.json ] && jq -r '.scripts // {} | keys[]' package.json 2>/dev/null
}

# Makefile targets 로드
get_make_targets() {
    [ -f Makefile ] && grep -E '^[a-zA-Z0-9_-]+:' Makefile | sed 's/:.*//'
}

is_cli_stale() {
    local cmd="$1"
    local binary="${cmd%% *}"
    local subcmd="${cmd#"$binary"}"
    subcmd="${subcmd## }"
    local target="${subcmd%% *}"

    # Step 1: script manager
    case "$binary" in
        npm|pnpm|yarn|bun)
            if [ "${target%% *}" = "run" ]; then
                target="${target#run}"
                target="${target## }"
                target="${target%% *}"
            fi
            [ -z "$target" ] && return 1   # no target → non-stale
            get_npm_scripts | grep -qxF "$target" && return 1 || return 0
            ;;
        make)
            [ -z "$target" ] && return 1
            get_make_targets | grep -qxF "$target" && return 1 || return 0
            ;;
    esac

    # Step 2: system whitelist
    case "$binary" in
        git|hg|svn|cargo|go|pytest|ls|find|grep|rg|cat|wc|...) return 1 ;;
    esac

    # Step 3: optional $PATH check (ENABLED=0 기본)
    [ "${PATH_CHECK_ENABLED:-0}" = 1 ] && command -v "$binary" >/dev/null && return 1

    # Step 4: stale
    return 0
}
```

## Failure Modes

1. **Shell alias**: 사용자 shell alias로 정의된 명령은 whitelist에 없으면 stale. 의도적 — alias는 reproducibility 없음.
2. **Version-specific flag**: `git log --format=%aI` 같은 flag 변경은 본 필터가 감지 안 함 (binary 레벨만). stale-example 판정이 필요하면 별도 규칙 (현재 audit-only 처리).
3. **Unknown script manager**: `bun run`, `turbo run` 등이 모든 버전에 반영됐는지 allowlist 관리 필요. 새 tool 등장 시 allowlist 업데이트.

## 통합 지점

- **Input from `reference-extraction.md`**: `kind: "cli"` Reference를 입력.
- **Step 3 (참조 검증)**: stale 판정 결과를 issue로 기록 (`type: "stale-example"`, `category`에 따라 auto-fix 또는 audit-only).
- **Provenance**: `$PATH` check 사용 여부를 `last-scan.json.provenance.path_check_enabled`에 기록.

## 버전

- **v1.0** (2026-04-17): 초안. 4-step decision tree (project lookup → system whitelist → path → stale). NEW-CLI-BYPASS 대응으로 project lookup이 whitelist보다 우선.
