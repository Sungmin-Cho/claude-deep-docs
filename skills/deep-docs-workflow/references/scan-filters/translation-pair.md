# Filter: translation-pair

## 목적

다국어 문서(예: `README.md` ↔ `README.ko.md`)를 동일 "문서 가족"으로 그룹핑하여, 그룹 내 중복 블록을 auto-fix에서 제외(audit-only로 격하)한다.

## 해결하는 리뷰 ID

- **C-1** (원본 ultrareview): README 자기 손상 버그
- **X-1** (deep-review 1차): 정규식이 base 파일 누락
- **NC-1** (deep-review 2차): `config.go.md`·`install.sh.md`가 locale로 오판
- **Codex P2** (deep-review 2차): `docs/api/README.md`와 `docs/setup/README.ko.md` 잘못 병합

## 입력

- 스캔 대상 markdown 파일 경로 리스트 (repo-relative, 예: `README.md`, `docs/api/README.md`)

## 출력

- `group_map: dict[str, list[str]]` — 그룹 키 → 해당 파일 경로 리스트
- 그룹 크기 `>= 2`인 키만 "번역 가족"으로 간주. 크기 1은 단독 파일.

## 알고리즘

### Step 1. Locale allowlist 정의

파일 확장자와의 충돌을 피하기 위해 **실제 ISO 639-1 언어 코드만 locale로 인정**. 프로그래밍 언어 확장자(`.go`, `.sh`, `.py`, `.ts`, `.rs`, …)는 locale에서 명시적으로 배제된다.

```
LOCALE_ALLOWLIST = {
    # ISO 639-1 (2자) — 동·서유럽
    "ko", "ja", "zh", "en", "fr", "de", "es", "pt", "it", "nl",
    "ru", "uk", "pl", "tr", "vi", "th", "ar", "hi", "fa", "he",
    "id", "ms", "cs", "sv", "da", "fi", "no", "el", "bg", "ro",
    "hu", "sk", "sl", "hr", "sr", "lt", "lv", "et", "is", "ga",
    # 남아시아·아프리카 (BW-4 대응)
    "bn", "ta", "te", "mr", "ur", "ne", "si", "sw", "af", "ca",
    # 비표준 관행 (BW-5) — 엄격한 BCP 47 준수는 아니지만 실운영에서 자주 쓰임
    # IETF 권장: `zh-CN`, `zh-TW`, `ko_KR`
    "cn", "tw",    # zh 변종 별칭
    "kr",          # ko 변종 별칭
}
```

**표준성 주석 (BW-5)**:
- `cn`/`tw`/`kr`은 ISO 639-1 공식 코드가 아님. 한국어는 `ko`, 한국 region은 `KR`, 중국어는 `zh`. 그러나 파일 명명 관행에서 자주 쓰이므로 포함.
- 엄격한 다국어 프로젝트에서는 `{basename}.{language}-{region}.md` 형태 권장 (예: `README.zh-CN.md`).

별도 `REGION` 세그먼트(`_KR`, `-CN` 등)는 2자 대문자(`[A-Z]{2}`) 허용. 예: `ko_KR`, `zh-CN`, `pt_BR`.

### Step 2. 그룹 키 산출

각 파일 `F`에 대해:

```python
def group_key(path: str) -> tuple[str, str | None]:
    """
    Returns (group_key, locale_or_none).
    group_key includes directory — 서로 다른 디렉토리의 동일 basename은 분리된 그룹.
    """
    dir_ = os.path.dirname(path)              # "docs/api" 또는 ""
    name = os.path.basename(path)             # "README.ko.md"

    # 파일 확장자가 .md 인지 확인
    if not name.endswith(".md"):
        return (None, None)                    # 그룹핑 대상 아님

    stem = name[:-3]                           # "README.ko"

    # stem을 "."로 split, 마지막 토큰이 locale allowlist에 있는지
    parts = stem.rsplit(".", 1)               # ["README", "ko"] 또는 ["README"]
    if len(parts) == 2:
        base, maybe_locale = parts
        # region/script 분리 (N-6 대응):
        #   language (2-3 글자) + 선택적 script subtag (4글자 title case, zh-Hant 등)
        #   + 선택적 region subtag (2글자 대문자, -KR / _KR)
        locale_match = re.match(
            r"^([a-z]{2,3})"              # language
            r"(-[A-Z][a-z]{3})?"          # script (optional): -Hant, -Hans, -Cyrl
            r"([_-][A-Z]{2})?$",          # region (optional): _KR, -CN
            maybe_locale
        )
        if locale_match and locale_match.group(1) in LOCALE_ALLOWLIST:
            return (os.path.join(dir_, base), maybe_locale)
    # locale 미검출 → base 파일 (locale is None)
    return (os.path.join(dir_, stem), None)
```

### Step 3. 그룹핑

```python
groups: dict[str, list[str]] = {}
for path in scan_files:
    key, _locale = group_key(path)
    if key is None:
        continue
    groups.setdefault(key, []).append(path)

# 크기 >= 2인 그룹만 번역 가족
translation_families = { k: v for k, v in groups.items() if len(v) >= 2 }
```

### Step 4. 중복 탐지 결과 후처리

중복 탐지(cross-document)에서 발견된 쌍 `(doc_a, doc_b, shared_block)`에 대해:

```python
key_a, _ = group_key(doc_a)
key_b, _ = group_key(doc_b)
if key_a == key_b and key_a in translation_families:
    issue.category = "audit-only"     # 번역 가족 내부 중복은 audit-only
else:
    issue.category = "auto-fix"
```

## 참고: Bash 근사 (정확성 미보장)

**WARNING**: Python 구현이 primary. 아래 Bash는 `BASH_REMATCH` 사용 — `bash 4.0+` 전용, `/bin/sh`(dash)에서 작동 안 함. 또한 정규식 문법이 Python과 미묘하게 다를 수 있음. 실 구현은 Python 사용.

Claude Code subagent는 bash 기반. Python 직접 호출이 불가할 수 있으므로 awk 또는 bash parameter expansion으로 동일 동작 구현:

```bash
# LOCALE_ALLOWLIST를 정규식 alternation으로 구성
LOCALES='ko|ja|zh|en|fr|de|es|pt|it|nl|ru|uk|pl|tr|vi|th|ar|hi|fa|he|id|ms|cs|sv|da|fi|no|el|bg|ro|hu|sk|sl|hr|sr|lt|lv|et|is|ga|cn|tw|kr'

# 파일 경로 F에서 group_key 산출
compute_group_key() {
    local f="$1"
    local dir name stem maybe_base maybe_locale
    dir="$(dirname "$f")"
    name="$(basename "$f")"
    case "$name" in *.md) ;; *) return 1 ;; esac
    stem="${name%.md}"
    # stem이 "base.locale" 형태인지
    if [[ "$stem" =~ ^(.+)\.(($LOCALES)([_-][A-Z]{2})?)$ ]]; then
        maybe_base="${BASH_REMATCH[1]}"
        # group_key = dir/base (locale 제거)
        [ "$dir" = "." ] && echo "$maybe_base" || echo "$dir/$maybe_base"
    else
        # locale 없음 → 전체 stem이 base
        [ "$dir" = "." ] && echo "$stem" || echo "$dir/$stem"
    fi
}
```

## Edge Case 매트릭스

| 파일 경로 | group_key | locale | 그룹 예상 |
|-----------|-----------|--------|-----------|
| `README.md` | `README` | None | `README` |
| `README.ko.md` | `README` | `ko` | `README` |
| `README.zh-CN.md` | `README` | `zh-CN` | `README` |
| `README.pt_BR.md` | `README` | `pt_BR` | `README` |
| `my.project.README.md` | `my.project.README` | None | `my.project.README` (단독 or base) |
| `my.project.README.ko.md` | `my.project.README` | `ko` | `my.project.README` |
| `ARCHITECTURE.md` (단독) | `ARCHITECTURE` | None | `ARCHITECTURE` (그룹 크기 1) |
| `docs/api/README.md` | `docs/api/README` | None | `docs/api/README` |
| `docs/setup/README.ko.md` | `docs/setup/README` | `ko` | `docs/setup/README` (**다른 그룹** — NC-1 대응) |
| `config.go.md` | `config.go` | None | `config.go` (단독, `go`는 locale 아님 — NC-1 대응) |
| `install.sh.md` | `install.sh` | None | `install.sh` (단독, `sh`는 locale 아님) |
| `run.py.md` | `run.py` | None | `run.py` (단독) |
| `foo.ab.md` (ab는 allowlist 미포함) | `foo.ab` | None | `foo.ab` (단독) |
| `README.xx.md` (xx는 allowlist 미포함) | `README.xx` | None | `README.xx` (단독) |
| `CHANGELOG.md` | `CHANGELOG` | None | `CHANGELOG` |

**핵심 검증 케이스**:
- `config.md` + `config.go.md`가 **다른 그룹**으로 분리됨 (NC-1)
- `docs/api/README.md` + `docs/setup/README.ko.md`가 **다른 그룹**으로 분리됨 (Codex P2)
- `README.md` + `README.ko.md`가 **동일 그룹 `README`**에 들어감 (C-1)

## Failure Modes

1. **False negative**: locale allowlist에 없는 실제 언어 코드(예: 아프리칸스어 `af`)는 단독 파일로 취급 → 실제로 번역 쌍인데 중복이 auto-fix 대상. **완화**: allowlist는 확장 가능, 자주 쓰이는 40+ 언어 커버.
2. **False positive (드묾)**: `README.kr.md` (표준 아닌 관행) — `kr`이 allowlist에 포함되어 있으므로 인식됨. 이는 의도적 수용.
3. **대소문자**: locale은 소문자 강제, region은 대문자 강제. 혼용(`ko_kr`, `KO_KR`) 파일명은 인식 안 됨. 운영 상 표준 따르도록 유도.

## 통합 지점

- **Step 1 (doc-scanner.md)**: `Glob` 후 수집된 파일 리스트를 본 필터로 post-process. 그룹 맵을 in-memory 유지.
- **Step 6 (중복 탐지)**: cross-document 중복 발견 시 이 필터의 Step 4(후처리)를 거쳐 카테고리 결정.
- **issue JSON**: `category: "audit-only"`로 기록 시 `evidence: "translation-pair: group=<key>"` 추가.

## 버전

- **v1.0** (2026-04-17): 초안. ISO 639-1 allowlist + region segment + 디렉토리 경로 포함 그룹 키.
