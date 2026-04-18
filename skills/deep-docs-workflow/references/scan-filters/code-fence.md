# Filter: code-fence

## 목적

markdown 문서에서 fenced code block(``` ``` 또는 ``` ~~~ ```)을 정확히 인식하고, 문서를 **segment 단위**로 분할한다. 중복 탐지와 참조 추출은 segment 경계를 넘어서 수행되지 않는다.

## 해결하는 리뷰 ID

- **C-1** (원본): 번역 쌍 JSON 예시 블록이 중복으로 오판되어 손상
- **CX-1** (deep-review 1차): 코드펜스 제거 후 prose concatenation으로 새 false-positive
- **NEW-FENCE-INDENT** (deep-review 2차): 들여쓰기된 펜스(`   \`\`\``) 미인식

## 입력

- markdown 파일 한 개의 전체 라인 배열 (list of strings)

## 출력

- `segments: list[Segment]` — 각 segment는 코드펜스 **바깥**의 연속된 prose 라인.
  - segment는 파일 내 순서를 유지한다.
  - fenced code block은 segment에 포함되지 않는다 (완전히 skip).
- `fenced_blocks: list[FencedBlock]` — 각 fenced block의 메타데이터(시작/끝 라인 번호, 언어 힌트, 들여쓰기 수준, 내용).

## 알고리즘

### Fence 인식 규칙

CommonMark 0.31 기준:

1. Fence opener:
   - 3개 이상의 연속된 backtick(`` ``` `` 이상) 또는 tilde(`~~~` 이상)
   - 라인 시작 기준 **최대 3개 space 들여쓰기** 허용
   - backtick fence 뒤에 언어 힌트 가능 (예: ``` ```json ```)
   - tilde fence는 언어 힌트에 tilde 허용
2. Fence closer:
   - opener와 동일 문자(backtick 또는 tilde)
   - opener 이상의 개수
   - opener와 동일 들여쓰기 수준 (최대 3 space)
   - closer 뒤에는 언어 힌트 **금지** (공백/탭만 허용)
3. **nested fence**: 미지원. opener의 문자/개수로만 매칭.

### Segment 분할 pseudocode

```python
def split_segments(lines: list[str]) -> tuple[list[Segment], list[FencedBlock]]:
    segments = []
    fenced_blocks = []
    current_segment_lines = []
    current_segment_start = 1

    in_fence = False
    fence_char = None       # '`' or '~'
    fence_count = 0         # 최소 3
    fence_indent = 0        # 0~3

    for i, line in enumerate(lines, start=1):
        # 들여쓰기 (최대 3 space) + fence 마커
        m = re.match(r'^(?P<indent> {0,3})(?P<mark>`{3,}|~{3,})\s*(?P<info>.*)$', line)

        if not in_fence:
            if m:
                # opener
                in_fence = True
                fence_char = m.group('mark')[0]
                fence_count = len(m.group('mark'))
                fence_indent = len(m.group('indent'))
                fenced_blocks.append(FencedBlock(
                    start=i, indent=fence_indent, lang=m.group('info').strip(),
                    lines=[]
                ))
                # 현재 segment를 종료
                if current_segment_lines:
                    segments.append(Segment(
                        start=current_segment_start, lines=current_segment_lines
                    ))
                    current_segment_lines = []
            else:
                current_segment_lines.append(line)
        else:
            # closer 체크: 동일 문자, 동일 이상 개수, 동일 들여쓰기, info string 없음
            if m and m.group('mark')[0] == fence_char \
                  and len(m.group('mark')) >= fence_count \
                  and len(m.group('indent')) == fence_indent \
                  and m.group('info').strip() == "":
                in_fence = False
                fenced_blocks[-1].end = i
                current_segment_start = i + 1
            else:
                fenced_blocks[-1].lines.append(line)

    # 파일이 fence 내부에서 끝나도 segment 계속
    if current_segment_lines:
        segments.append(Segment(
            start=current_segment_start, lines=current_segment_lines
        ))

    return segments, fenced_blocks
```

### 핵심 수정 사항 (NEW-FENCE-INDENT 대응)

- `line.startswith("```")` 대신 **최대 3 space 들여쓰기 허용** regex
- tilde fence(`~~~`) 지원
- closer가 opener와 **동일 들여쓰기**인 경우만 매칭

## 참고: Bash/awk 근사 구현 (정확성 미보장, BU-7 경고)

**WARNING**: Python 구현이 primary. 아래 awk는 **deep-review round 3 BU-7에서 들여쓰기 fence 처리 bug가 지적됨** — `RSTART=1, RLENGTH=N`에서 `substr($0, RSTART, RLENGTH)`가 들여쓰기 포함 전체 매치를 반환하여 `ch`가 공백이 됨. POSIX awk는 3-argument `match`를 지원 안 해 capture group 분리 불가.

**권장**: 실제 구현은 Python `re.match(r'^( {0,3})(\`{3,}|~{3,})(.*)$', line)`로 capture group 사용. Bash를 강제해야 하면 `[[ "$line" =~ ^([[:space:]]{0,3})(\`{3,}|~{3,})(.*)$ ]]`로 BASH_REMATCH 활용.

```python
# Python primary 구현
import re

FENCE_RE = re.compile(r'^(?P<indent> {0,3})(?P<mark>`{3,}|~{3,})(?P<info>.*)$')

def split_segments(lines: list[str]):
    segments = []
    fenced_blocks = []
    current = []
    seg_start = 1
    in_fence = False
    fence_ch = ""
    fence_count = 0
    fence_indent = 0

    for i, line in enumerate(lines, start=1):
        m = FENCE_RE.match(line)
        if not in_fence:
            if m:
                if current:
                    segments.append((seg_start, current))
                    current = []
                in_fence = True
                mark = m.group("mark")
                fence_ch = mark[0]
                fence_count = len(mark)
                fence_indent = len(m.group("indent"))
                fenced_blocks.append({
                    "start": i,
                    "indent": fence_indent,
                    "lang": m.group("info").strip(),
                    "lines": [],
                })
            else:
                current.append(line)
        else:
            if m and m.group("mark")[0] == fence_ch \
                and len(m.group("mark")) >= fence_count \
                and len(m.group("indent")) == fence_indent \
                and m.group("info").strip() == "":
                # closer
                in_fence = False
                fenced_blocks[-1]["end"] = i
                seg_start = i + 1
            else:
                fenced_blocks[-1]["lines"].append(line)
    if current:
        segments.append((seg_start, current))
    return segments, fenced_blocks
```

Bash 근사 참고는 생략 (BU-7 버그 상주). 필요 시 Python을 `python3 -c` 로 호출.

## Edge Case 매트릭스

| 입력 (3-line 예시) | 기대 동작 |
|----------------------|-----------|
| ``` ```\nX\n``` ``` | 단일 fenced block, segment 2개 (before/after) or 0개 |
| `   ` ```\nX\n   ``` ``` (3 space indent) | fenced block으로 인식 (NEW-FENCE-INDENT) |
| `    ` ```\nX\n    ``` ``` (4 space indent) | **fence 아님** — 코드블록 들여쓰기로 해석, prose로 취급 |
| `~~~\nX\n~~~` | tilde fence, 인식 |
| ```` ````\nX\n```` ```` (4 backtick) | 4+ backtick opener, closer도 4+ 필요 |
| ```` ```\nfoo ```\n```` | closer에 info가 있어 inner 라인이 closer 아님 → 계속 fence |
| fence opener만 있고 EOF | fence 미종료, 마지막까지 skip |

## Failure Modes

1. **Malformed markdown**: opener만 있고 closer 없으면 EOF까지 skip → 남은 prose segment 없음. 사용자가 문서를 고쳐야 함.
2. **4+ space indentation**: CommonMark 규칙상 indented code block(prose 아님). 본 필터는 이를 **prose로 취급** — indented code block의 import 문 등이 참조 추출 대상 되는 bug 가능. 완화: `reference-extraction.md`에서 추가 필터.
3. **HTML code tags**: `<pre>`, `<code>` 태그 내부는 본 필터가 인식 안 함. markdown 기준만 지원. 실무에서 거의 안 쓰임.

## 통합 지점

- **Step 2 (참조 추출)**: segment 배열을 기반으로 동작. fenced block 내부는 추출 대상 아님 (`reference-extraction.md` 참조).
- **Step 6 (중복 탐지)**: 3-line sliding window는 **각 segment 내부에서만** 계산. segment 경계를 넘는 매칭 불가 → prose concatenation false-positive 방지 (CX-1).
- **cross-document**: 문서 A의 segment `a_i`와 문서 B의 segment `b_j` 사이 3-line 매칭은 허용 (segment 단위로 해시 비교). translation-pair 그룹 내부 매칭만 audit-only.

## 버전

- **v1.0** (2026-04-17): 초안. CommonMark 0.31 fence 인식 + segment 분할 + tilde fence.
