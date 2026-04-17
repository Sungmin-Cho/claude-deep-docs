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

### Step 1. Project-specific 2단계 lookup (최우선)

binary가 script manager면 subcmd를 project 파일과 대조:

```python
SCRIPT_MANAGERS = {
    "npm": ("package.json", "scripts"),
    "pnpm": ("package.json", "scripts"),
    "yarn": ("package.json", "scripts"),
    "bun": ("package.json", "scripts"),
    "make": ("Makefile", "targets"),
    "just": ("justfile", "recipes"),
    "uv": ("pyproject.toml", "[tool.uv.scripts]"),
    "poetry": ("pyproject.toml", "[tool.poetry.scripts]"),
}

if binary in SCRIPT_MANAGERS:
    # npm/pnpm/yarn/bun는 "run" subcommand 자주 쓰임
    if binary in ("npm", "pnpm", "yarn", "bun") and subcmd == "run":
        target = tokens[2] if len(tokens) >= 3 else ""
    else:
        target = subcmd

    if target == "":
        return (False, "script manager without target")  # e.g., `npm install`

    scripts = load_scripts(SCRIPT_MANAGERS[binary])
    if target in scripts:
        return (False, f"found in {SCRIPT_MANAGERS[binary][0]}")
    else:
        return (True, f"{binary} target '{target}' not in {SCRIPT_MANAGERS[binary][0]}")
```

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

## 판정 예시 (Edge Case 매트릭스)

| 입력 CLI | binary | Step 1 | Step 2 | 최종 | reason |
|----------|--------|--------|--------|------|--------|
| `git log -1 --format=%aI` | `git` | N/A | ✅ | non-stale | system command |
| `npm run build` (scripts에 build 있음) | `npm` | ✅ non-stale | - | non-stale | found in scripts |
| `npm run missing` (없음) | `npm` | ❌ stale | - | **stale** | NEW-CLI-BYPASS 해결 |
| `npm install` | `npm` | non-stale (no target) | - | non-stale | no target |
| `make test` (Makefile에 있음) | `make` | ✅ non-stale | - | non-stale | found in Makefile |
| `make missing-target` | `make` | ❌ stale | - | **stale** | not in Makefile |
| `pytest tests/` | `pytest` | N/A | ✅ | non-stale | system command |
| `foo --bar` (unknown) | `foo` | N/A | ❌ | stale | unknown command |
| `python manage.py runserver` | `python` | N/A | ✅ | non-stale | system (인자 `manage.py`는 reference-extraction에서 path로 별도 처리) |

## Bash-equivalent 구현 지침

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
