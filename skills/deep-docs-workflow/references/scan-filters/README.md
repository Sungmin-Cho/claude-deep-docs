# Scan Filters

deep-docs의 scan·garden·audit 동작에 쓰이는 heuristic을 **독립 파일**로 분리한 디렉토리. 각 필터는 자기 완결적이며 단위 리뷰/테스트 가능.

## 설계 원칙

1. **Isolation**: 한 필터의 결함이 다른 필터에 전파되지 않는다. 한 파일만 읽어도 해당 heuristic의 완전한 동작을 이해할 수 있다.
2. **Explicit Integration Points**: 각 필터는 어느 `doc-scanner.md` Step에서 호출되는지, 어떤 upstream/downstream과 연결되는지 명시한다.
3. **Edge case matrix**: 모든 필터는 통과/탈락 케이스를 표로 포함한다. 구현 시 이 표를 테스트 벡터로 사용.
4. **Failure modes**: false-positive / false-negative의 예시를 명시하여 "무엇이 깨지면 안 되는지"를 문서화한다.
5. **Platform compat**: bash 기준 macOS BSD + Linux GNU 양쪽 지원. POSIX 외 기능은 fallback 명시.

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
