# Scan Rules — Auto-fix vs Audit-only

## Heuristic 세부 — `scan-filters/` 디렉토리 참조

각 규칙의 detailed algorithm은 독립 필터 파일로 분리됨 (v1.1.0 architectural split). 본 파일은 **auto-fix vs audit-only 분류 기준**만 기술하며, "어떻게 판별하는가"는 각 필터 참조.

| 규칙 | 필터 파일 |
|------|-----------|
| 번역 쌍 탐지 | `scan-filters/translation-pair.md` |
| 코드펜스 인식 + segment 분리 | `scan-filters/code-fence.md` |
| 참조 추출 | `scan-filters/reference-extraction.md` |
| CLI stale 판정 | `scan-filters/cli-whitelist.md` |
| 워크트리 해시 (artifact 재사용) | `scan-filters/worktree-hash.md` |
| Freshness 시각 비교 | `scan-filters/freshness-timestamp.md` |

**구현 언어**: Python 3.8+ primary (각 필터 파일의 알고리즘 섹션). Bash 근사는 "참고: Bash 근사 (정확성 미보장)" 섹션에만 제시됨 — 실 구현은 Python.

---

## Auto-fix 가능 (garden에서 자동 수정)

### 1. 죽은 참조 (Dead References)

문서에서 참조하는 파일/함수/클래스가 코드에 존재하지 않는 경우.

탐지 방법:
- **참조 추출**: `scan-filters/reference-extraction.md`의 Rule 0 순서를 따름
  - fenced block 내부 참조는 **추출 대상 아님** (코드펜스 예시 보호)
  - inline backtick 중 공백 있으면 CLI 분기, 없으면 path/env/symbol 분기
- **각 참조 검증**: `path` kind는 Glob/Grep으로 존재 확인
- **함수/클래스**: Grep으로 정의 검색

수정: 현재 경로/이름으로 업데이트. 삭제된 경우 "[삭제됨]" 표시.

### 2. 이동/리네임된 경로 (Moved/Renamed Paths)

문서의 경로가 존재하지 않지만, git log에서 이동 이력이 있는 경우.

탐지 방법:
- 죽은 참조로 탐지된 경로에 대해 `git log --follow --diff-filter=R -- {old_path}` 실행
- rename 이력이 있으면 새 경로 추출

수정: 새 경로로 업데이트.

### 3. 오래된 예시/명령어 (Stale Examples)

문서의 코드 예시나 CLI 명령어가 실제 코드/스크립트와 불일치.

탐지 방법:
- **CLI 명령어 stale 판정**: `scan-filters/cli-whitelist.md` 필터에 위임
  - Step 1: project lookup (npm run, make target 등)
  - Step 2: system command whitelist
  - Step 3: optional `$PATH` check (기본 OFF)
  - Step 4: 남으면 stale 후보 (UNKNOWN_SUBCOMMAND_IS_STALE=False 기본 — audit-only)
- **환경 변수 참조**: `.env.example`과 대조 (단순 존재 확인)

수정: **조건부 auto-fix** — CLI 명령어와 환경 변수는 정확한 대체값이 있으면 auto-fix. 코드 예시는 audit-only (정확한 대체 생성이 어려움).

### 4. 중복 지침 블록 (Duplicated Instructions)

여러 문서에 동일한 내용이 반복되는 경우.

탐지 방법:
- **코드펜스 분리**: `scan-filters/code-fence.md` 필터가 segment 단위로 문서 분할
  - 3 space 들여쓰기까지 fence 인식 (CommonMark 0.31)
  - tilde fence(`~~~`) 지원
- **3-line sliding window**: 각 segment **내부에서만** 해시 비교 (prose concatenation false-positive 방지)
- **번역 쌍 제외**: `scan-filters/translation-pair.md` 그룹 맵으로 동일 가족 간 중복은 auto-fix 제외
- **블록 해시**: Python `hashlib.sha1(line_triple)`로 동일성 판정 (100% 일치만 auto-fix, 유사는 audit-only)

수정: **조건부 auto-fix** — 완전 동일한 블록(3줄 이상 100% 일치)만 auto-fix 대상. 유사하지만 다른 블록은 audit-only.

### 5. 크기/구성 (Size/Organization)

파일이 과도하게 큰 경우 (200줄 이상의 CLAUDE.md).

탐지: 라인 수 체크
수정: 분리 제안 (자동 분리는 아님, 제안만).

---

## Audit-only (리포트에만 표시, 자동 수정 안 함)

### 6. 규칙-코드 모순 추론

문서의 규칙이 실제 코드 패턴과 모순되는지 추론.
예: "snake_case 사용" 규칙이지만 코드 72%가 camelCase.

이유: 아키텍처 추론이 필요하고 false positive 가능성이 높음.
표시: ℹ️ 참고 — "규칙 모순 의심: {내용}"

### 7. 커버리지 갭 추론

코드에 존재하지만 문서에 없는 주요 모듈/패턴.

이유: "주요"의 판단이 주관적이고 false positive 다발.
표시: ℹ️ 참고 — "미문서화 모듈: {경로}"

### 8. 맵 vs 매뉴얼 판단

직접 지침 vs 외부 포인터 비율 평가.

이유: 최적 비율이 프로젝트마다 다름.
표시: ℹ️ 참고 — "직접 지침 {N}%, 외부 포인터 {N}%"
