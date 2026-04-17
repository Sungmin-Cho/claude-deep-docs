# Filter: reference-extraction

## 목적

markdown 문서에서 "코드 참조" 후보(파일 경로, 함수/클래스 이름, CLI 명령어, 환경 변수)를 추출한다. 추출된 후보는 이후 dead-reference / stale-example / moved-path 판정의 입력이 된다.

## 해결하는 리뷰 ID

- **H-3** (원본 ultrareview): backtick 안 모든 문자열을 참조로 간주해 false-positive 다발
- **X-3** (deep-review 1차): 코드펜스 내부 참조를 제외해야 함

## 입력

- `segments: list[Segment]` — `code-fence.md`가 산출한 non-fenced segment 배열

## 출력

- `references: list[Reference]`, 각 Reference는:
  - `value: str` — 추출된 문자열 (예: `src/foo.ts`)
  - `kind: "path" | "cli" | "env" | "symbol"` — 추출 종류
  - `location: tuple[str, int]` — (파일 경로, 라인 번호)

## 추출 규칙

**핵심 변경 (BU-2 대응, round 3 리뷰)**: Rule 5(CLI 추출)를 Rule 2(path 후보)와 **독립된 branch**로 분리. 공백 포함 backtick은 `kind: "cli"`로 분기되어 `cli-whitelist.md`에 도달해야 함.

### Rule 0. 처리 순서 (중요)

non-fenced segment의 각 inline backtick 내용에 대해:

```python
for content in extract_inline_backticks(segment):
    first_token = content.split()[0] if content else ""

    # (1) CLI 후보 먼저 (공백 허용, BU-2 대응)
    if first_token in CLI_BINARIES:           # cli-whitelist.md의 binary set
        yield Reference(kind="cli", value=content)
        continue

    # (2) 단일 토큰이면 path/env/symbol 후보 (공백 없음)
    if " " in content or "\t" in content:
        continue                               # CLI도 아니고 multi-token이면 extract 제외

    # (3) 환경 변수
    if re.match(r'^\$\{?[A-Z_][A-Z0-9_]*\}?$', content):
        yield Reference(kind="env", value=content.strip("${}"))
        continue

    # (4) path 후보
    if is_path_candidate(content):             # Rule 2 로직
        yield Reference(kind="path", value=content)
        continue

    # (5) symbol 후보
    if re.match(r'^[A-Z][a-zA-Z0-9_]*$', content) \
       or re.match(r'^[a-z][a-zA-Z0-9_]*\(\)$', content):
        yield Reference(kind="symbol", value=content)
```

### Rule 1. Fenced 영역 제외

**fenced code block 내부의 모든 backtick·link·import 문은 추출 대상 아님** (X-3 대응).

이유:
- 코드블록은 **의도된 예시**. `src/auth/middleware.ts` 같은 sample path가 실제 파일이 아니어도 설명용.
- 추출 + dead-reference 판정 → garden이 예시를 `[삭제됨]`으로 치환하면 문서 파괴.

### Rule 2. Path 후보 조건

Rule 0의 (4)에서 호출. single-token backtick 내용이 다음 **모두** 만족해야 `kind: "path"`:

1. 다음 중 **하나 이상**:
   - 슬래시(`/`) 1개 이상 포함
   - 확장자 whitelist에 매치
2. 다음 중 **어느 것에도 미해당**:
   - `https?://` URL
   - 절대 경로(`/usr/`, `/etc/`, `/tmp/`, `/var/`, `/bin/`, `/sbin/` 등)
   - glob 단독(`**`, `*`)

**공백/탭/개행 포함 backtick은 Rule 0에서 이미 CLI 또는 제외로 분기됨** (중복 검사 제거).

**확장자 whitelist** (v1.1):
```
.ts .tsx .js .jsx .mjs .cjs
.py .rb .go .rs .java .kt .scala .clj
.c .h .cpp .hpp .cs .swift .dart
.md .rst .txt
.json .yml .yaml .toml .xml .ini .conf
.sh .bash .zsh .ps1 .bat
.css .scss .less .html .htm .vue .svelte .astro
.sql .graphql .proto
```

### Rule 3. Markdown link 후보

`[text](path)` 형태에서 `path`가 다음 만족:
- 상대 경로 (`./`, `../`, 또는 단순 파일명)
- URL 아님 (`http:`, `https:`, `mailto:` 아님)
- 확장자가 whitelist에 속함 **또는** 슬래시 포함

`text`는 무시하고 `path`만 `kind: "path"` 참조로 추출.

### Rule 4. Indented code block 제외

CommonMark 규칙상 4+ space 들여쓰기 라인은 indented code block (prose 아님). 이 라인들도 참조 추출에서 **제외** — `code-fence.md`가 prose로 분류했더라도 본 필터에서 추가 거름.

```python
def is_indented_code(line: str) -> bool:
    return line.startswith("    ") or line.startswith("\t")
```

### Rule 5. CLI 명령어 추출 (Rule 0의 (1)에서 처리)

**Rule 0 순서에 통합** (BU-2 대응). CLI 판정이 path 판정보다 먼저 실행되어 `npm run build` 같은 공백 포함 명령이 올바르게 `kind: "cli"`로 분기됨.

**CLI_BINARIES 정의**: `cli-whitelist.md`의 built-in map + system whitelist를 합친 집합 (공유 모듈 `scan_filters.cli_binaries`로 노출).

```python
from scan_filters.cli_whitelist import BUILTINS_MAP, SYSTEM_COMMAND_WHITELIST
CLI_BINARIES = set(BUILTINS_MAP.keys()) | SYSTEM_COMMAND_WHITELIST
```

- 추출 시 `kind: "cli"`, value는 전체 command string (예: `"npm run build"`, `"git log -1 --format=%aI"`)

### Rule 6. 환경 변수 추출

- `$VAR_NAME` 또는 `${VAR_NAME}` 패턴
- 평문 또는 backtick 내부
- `kind: "env"`, value는 `VAR_NAME`

### Rule 7. 함수/클래스/심볼 추출

inline backtick 내부가 다음과 일치:
- `[A-Z][a-zA-Z0-9_]*` (PascalCase, 클래스 후보)
- `[a-z][a-zA-Z0-9_]*\(\)` (함수 호출 후보, 괄호 포함)
- `kind: "symbol"`

## Bash-equivalent 구현 지침

grep + awk로 순차 처리:

```bash
# Rule 1: fenced block 제외 — code-fence.md의 segment 출력을 input으로 받음
# Rule 2 inline backtick 파일 경로:
grep -oE '`[^`]+`' "$segment_stream" \
  | sed 's/^`//;s/`$//' \
  | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|py|md|json|sh|...)($|:)|/' \
  | grep -vE '^https?://|^/usr/|^/etc/|^/tmp/|^/var/|^\*+$'

# Rule 3 markdown links:
grep -oE '\[[^]]+\]\([^)]+\)' "$segment_stream" \
  | sed -E 's/.*\(([^)]+)\).*/\1/' \
  | grep -vE '^https?://|^mailto:'
```

## Edge Case 매트릭스

| 입력 라인 (non-fenced segment) | 추출 여부 |
|--------------------------------|-----------|
| `` `src/auth/middleware.ts` `` | ✅ (path, 확장자 .ts) |
| `` `npm run build` `` | ✅ (cli, binary `npm`) |
| `` `true` `` | ❌ (확장자 없음, `/` 없음) |
| `` `MyComponent` `` | ✅ (symbol) |
| `` `handleAuth()` `` | ✅ (symbol, 괄호) |
| `` `https://example.com/path.md` `` | ❌ (URL) |
| `` `/usr/local/bin/foo` `` | ❌ (절대 경로) |
| `` `**/*.ts` `` | ❌ (glob) |
| `` `$HOME` `` | ✅ (env) |
| `[doc](./setup.md)` | ✅ (path from link) |
| `[site](https://example.com)` | ❌ (URL) |
| 코드펜스 내부: `` `src/foo.ts` `` | ❌ (Rule 1, fenced 제외) |
| 4-space indented: `    const x = require('./foo')` | ❌ (Rule 4) |

## Failure Modes

1. **False negative**: backtick 없는 inline path (`See src/foo.ts for details`) — 추출 안 됨. 사용자가 backtick을 안 쓰면 무시. 이는 의도적(markdown convention).
2. **False positive**: `` `path/to/something` ``이 실제 파일 아닌 개념을 backtick으로 쓴 경우 — Rule 1 확장자 whitelist 없이 슬래시만으로 인식. minor, dead-reference 단계에서 이중 검증 권장.

## 통합 지점

- **Input from `code-fence.md`**: `segments` 기반으로만 동작.
- **Output to Step 3 (참조 검증)**: `Reference` 객체가 dead-reference 판정의 입력.
- **Output to `cli-whitelist.md`**: `kind: "cli"` 참조는 CLI stale 판정으로 전달.

## 버전

- **v1.0** (2026-04-17): 초안. 7개 추출 Rule, 확장자 whitelist v1.1.
