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

## 규칙 번호 ↔ doc-scanner Step 매핑

| 규칙 | doc-scanner.md Step |
|------|---------------------|
| Rule 1 (Dead References) | Step 2 (참조 추출) + Step 3 (참조 검증) |
| Rule 2 (Moved/Renamed Paths) | Step 4 (이동 추적) |
| Rule 3 (Stale Examples) | Step 3 (CLI 판정 — `scan-filters/cli-whitelist.md`) |
| Rule 4 (Duplicated Instructions) | Step 6 (중복 탐지) |
| Rule 5 (Size/Organization) — audit-only | Step 7 (크기 검사) |
| Rule 6 (Rule-Code Contradiction) — audit-only | Step 8 |
| Rule 7 (Coverage Gap) — audit-only | Step 9 |
| Rule 8 (Map vs Manual) — audit-only | Step 10 |
| Rule 9 (Missing/Thin Doc) — authoring | Step 11 |

구현자 참고: Rule은 분류 기준, Step은 실행 순서. 두 번호 체계는 동일 작업을 다른 관점에서 참조.

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

---

## Audit-only (리포트에만 표시, 자동 수정 안 함)

### 5. 크기/구성 (Size/Organization)

파일이 과도하게 큰 경우 (CLAUDE.md/AGENTS.md는 100줄, README.md는 300줄, 기타 docs/는 200줄 초과).

탐지: strict `>` 부등호 — `CLAUDE.md/AGENTS.md > 100`, `README.md > 300`, `기타 docs/ > 200` (audit-metrics.md §1과 경계 일치)
이유: 분리는 구조적 판단(섹션 경계, 외부 참조 보존)이 필요하고, garden 의 `current_value → suggested_value` diff 모델과도 부합하지 않음. **garden 자동 수정 대상 아님** — `payload.documents[].issues[].category: "audit-only"` 로 emit.
표시: ℹ️ 참고 — "크기 초과: {file} {N}줄 (한도 {limit}) — 분리 제안"

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

---

## Authoring (garden에서 생성/재구성)

스캔이 기존 문서를 **수정**하는 auto-fix/audit-only와 달리, authoring은 권장 문서가 **없거나 골격에 미달**할 때 garden이 `doc-author`를 통해 **draft를 생성/재구성**하는 카테고리다. scan(doc-scanner Step 11)은 **명세(gap)만** 기록하고 draft 본문은 garden에서 생성한다.

### 9. 부재/빈약 문서 (Missing/Thin Doc) — authoring

권장 에이전트 지침 문서(CLAUDE.md / AGENTS.md / ARCHITECTURE.md)가 **없거나**(missing-doc), 있으나 **공식 골격 대비 명백히 미달**(thin-doc)인 경우.

탐지 방법 (doc-scanner Step 11):

- **`missing-doc`** (category: `authoring`, `exists: false`) — 권장 문서가 아예 없음. **무차별 생성 가드**:
  - CLAUDE.md / AGENTS.md → git 루트에 **빌드 매니페스트**(`package.json` / `Cargo.toml` / `pyproject.toml` / `go.mod` 등)가 있고 **소스 디렉토리가 존재**할 때만 후보.
  - ARCHITECTURE.md → **~10k LOC+** 규모에서만 후보.
  - **모노레포는 루트만 1차 후보, 하위 패키지는 v2** (root-only).
- **`thin-doc`** (category: `authoring`, `exists: true`) — 문서는 있으나 공식 골격 대비 미달. **scan 판정은 보수적**(명백한 미달만). Rule 7(Coverage Gap, Step 9)의 `uncovered_modules[]`를 **입력 신호로 재사용**해 다음 OR로 판정:
  - (a) 공식 골격의 **필수 섹션 누락 수** ≥ 임계값, **OR**
  - (b) `len(uncovered_modules[]) / total_modules` ≥ 임계값(커버리지 갭 과다).

  Rule 7은 audit-only 보고(존재 문서의 갭), Rule 9는 그 신호를 authoring 판정에 재사용 — **중복 스캔 없이** Step 9 산출을 Step 11이 읽는다. (정량 임계값은 `authoring-rules/`에 명문화.)
- **ignored 경로 제외**: `.gitignore`로 ignored된 경로(특히 `docs/`)는 gap 후보에서 **제외**한다 — gap이 scan에서 먼저 생성되므로 scan-side에서 걸러야 garden까지 새지 않는다 (doc-author body 가드와 양쪽 대칭).

severity 부여:

| 케이스 | severity |
|---|---|
| missing-doc (CLAUDE / AGENTS) | `medium` |
| missing-doc ARCHITECTURE (10k+ LOC) | `high` (유지보수 비용 10배) |
| thin-doc | `low` ~ `medium` (미달 정도) |

분류: **authoring** — `current_value → suggested_value` 한 줄 치환 모델에 맞지 않으므로 auto-fix가 아니다. `payload.gaps[]`에 `authoring_spec`(doc_kind / mode / rationale)으로 emit되고, garden의 authoring sub-flow가 `doc-author` spawn → 구조화 draft → per-removal 승인 후 **garden만** Write한다.
