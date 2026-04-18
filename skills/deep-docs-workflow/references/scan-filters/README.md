# Scan Filters

deep-docs의 scan·garden·audit 동작에 쓰이는 heuristic을 **독립 파일**로 분리한 디렉토리. 각 필터는 자기 완결적이며 단위 리뷰/테스트 가능.

## 구현 언어 (중요)

**Python 3.8+가 primary 구현 언어**. 각 필터의 "알고리즘" 섹션이 정식 스펙이며, 제공되는 "참고: Bash 근사 구현" 섹션은 **이해를 돕기 위한 예시**일 뿐 정확한 semantics를 보장하지 않는다.

이유 (deep-review round 3의 반복 패턴에서 도출):
1. **인코딩 안정성**: 파일명에 newline/NUL/multi-byte 포함 시 bash `$()`·`tr`·`while read` 조합은 경계 조건에서 silent failure. Python `pathlib` + `bytes` API는 완전 handle.
2. **숫자 연산 정확성**: epoch-based timestamp 비교는 Python 정수 산술로 명확. Bash `$(( ))` + `test -gt`은 동작하지만, 이를 확장(예: microsecond precision)할 때 fragile.
3. **정규식 의미**: Python `re`는 non-greedy, named group, lookbehind 등 풍부. Bash/awk는 POSIX 제약으로 스펙 구현이 degraded됨.
4. **cross-platform**: `subprocess.run(..., capture_output=True)`는 macOS/Linux 동일 동작. Bash는 BSD/GNU coreutils 차이 관리 필요.

Claude Code agent 환경에서 Python 3는 `python3 -c '...'` 또는 heredoc으로 호출 가능:

```bash
python3 << 'PY'
from scan_filters import translation_pair
groups = translation_pair.group_files([...])
print(groups)
PY
```

**참고 Bash 섹션은 제거하지 않는다** (운영 편의 + 디버깅용). 다만 unit test는 Python 구현을 기준으로 작성하고, 스펙 준수 판정도 Python 기준.

## 설계 원칙

1. **Isolation**: 한 필터의 결함이 다른 필터에 전파되지 않는다. 한 파일만 읽어도 해당 heuristic의 완전한 동작을 이해할 수 있다.
2. **Explicit Integration Points**: 각 필터는 어느 `doc-scanner.md` Step에서 호출되는지, 어떤 upstream/downstream과 연결되는지 명시한다.
3. **Edge case matrix**: 모든 필터는 통과/탈락 케이스를 표로 포함한다. 구현 시 이 표를 Python 단위 테스트 벡터로 사용.
4. **Failure modes**: false-positive / false-negative의 예시를 명시하여 "무엇이 깨지면 안 되는지"를 문서화한다.
5. **Platform compat**: Python 3 표준 라이브러리만 사용 (`os`, `re`, `pathlib`, `subprocess`, `hashlib`). 외부 pip 의존성 없음.

## 필터 목록

| 필터 | 목적 | 호출 Step | 해결하는 리뷰 ID |
|------|------|-----------|------------------|
| [translation-pair.md](./translation-pair.md) | 번역 쌍(`README.ko.md` 등) 그룹핑 | Step 1 (문서 발견) 후처리 | C-1, NC-1, Codex P2 |
| [code-fence.md](./code-fence.md) | fenced code block 인식 + per-segment 분리 | Step 2·6 전처리 | CX-1, NEW-FENCE-INDENT |
| [reference-extraction.md](./reference-extraction.md) | backtick/link에서 참조 추출 | Step 2 | H-3, X-3 |
| [cli-whitelist.md](./cli-whitelist.md) | CLI 명령어 stale 판정 | Step 3 | M-7, X-4, NEW-CLI-BYPASS |
| [worktree-hash.md](./worktree-hash.md) | 아티팩트 재사용을 위한 워크트리 해시 | Step 12 (provenance 계산) | H-1, X-2, NEW-RCE |
| [freshness-timestamp.md](./freshness-timestamp.md) | path별 last-modified 판정 | Step 5 (신선도) | H-4, H-6, NC-2 |

## 호출 순서 (scan 실행 시)

```
1. Document discovery (Step 1)
   └─ translation-pair.md 으로 그룹핑

2. Per-document processing (Step 2~7)
   ├─ code-fence.md 으로 segment 분리
   ├─ reference-extraction.md 으로 참조 추출
   └─ freshness-timestamp.md 으로 stale 판정

3. Cross-document processing (Step 6)
   └─ code-fence.md segment를 기반으로 중복 탐지
       translation-pair.md 그룹 내부는 audit-only

4. CLI/stale 판정 (Step 3 하위)
   └─ cli-whitelist.md

5. Artifact write (Step 12)
   └─ worktree-hash.md 으로 provenance 계산
```

## 변경 정책

- 새 필터 추가: 이 README의 테이블 + 호출 순서 다이어그램 업데이트
- 기존 필터 수정: semantic change는 `scan-filters/CHANGELOG.md`(미래 추가)에 기록
- 필터 제거: breaking change, `last-scan.json`의 `schema_version` bump 동반
