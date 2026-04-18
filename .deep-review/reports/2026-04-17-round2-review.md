# Deep Review Round 2 — 2026-04-17

- **Target**: `docs/superpowers/specs/2026-04-17-deep-docs-ultrareview-fixes-design.md`
- **Base**: `513f262` (초판) → `0fef6d4` (수정본)
- **Review Mode**: 3-way re-review (Opus + Codex review + Codex adversarial)
- **Purpose**: 1차 리뷰 REQUEST_CHANGES에 대한 대응이 실제 문제를 해결했는지 + regression 없는지 독립 검증

---

## Verdict

**🔴 REQUEST_CHANGES (2차)**

이전 리뷰의 14/17 항목은 실질 해결. 그러나 **3개는 문자적 대응만 했고 근본 문제가 잔존**하거나 **수정 과정에서 새 버그가 도입됨**. 특히 security issue 1건(RCE 가능성)이 새로 생김.

---

## 이전 17 항목 해결 여부

| 이전 ID | 해결? | 비고 |
|---------|------|------|
| X-1 (번역쌍 regex) | ⚠️ 부분 | README 케이스는 OK, but `config.go.md`/`install.sh.md` false-positive (NC-1) |
| X-2 (worktree_hash) | ✅ | untracked 포함 동작 실측 확인 (Opus 직접 테스트) |
| X-3 + CX-1 (코드펜스) | ⚠️ 부분 | 알고리즘 OK, but indented fence(`   \`\`\``) 미처리 (Codex R2 P1) |
| X-4 (CLI 토큰화) | ⚠️ 부분 | 2단계 lookup 명시됨, but whitelist 우회 규칙이 `npm` subcommand 체크 skip (Codex R2 P1) |
| CX-2 (size boundary) | ✅ | strict `>` 적용 |
| O-1~O-7, O-9~O-11 | ✅ | 10개 모두 반영 |
| O-8 (mtime fallback) | ❌ | 규칙 명시는 됐으나 `sort -r \| head -1` 비교가 Linux에서 broken (NC-2) |

---

## 🔴 Round 2 Critical (cross-verified)

### NC-2 / R2-P1 / Adv-High — 타임스탬프 비교 Linux 환경에서 잘못된 결과

**교차 검증: 3/3 리뷰어 독립 일치.** Opus는 실제로 테스트까지 수행.

- 스펙 §5.3 `last_modified="$(printf '%s\n%s\n' "$git_time" "$mtime" | sort -r | head -1)"`
- **실측**: `printf '%s\n%s\n' "2026-04-17T09:00:00+0900" "2026-04-17 10:00:00.000000000 +0900" | sort -r | head -1` → `2026-04-17T09:00:00+0900` (더 이른 시간을 max로 반환)
- 원인: lexicographic sort에서 `T`(0x54) > space(0x20). `git log --format=%aI` = `T` 포함, Linux `stat -c %y` = space 포함 → **항상 git 시간이 "이김"**.
- **결과**: H-6(워크트리 mtime 반영) 의도 **실제 미해결**. 커밋 전 수정된 문서를 계속 stale로 오판.

**수정**: epoch seconds 비교로 교체.
```bash
git_epoch=$(git log -1 --format=%ct -- "$P" 2>/dev/null)
mtime_epoch=$(stat -f %m "$P" 2>/dev/null || stat -c %Y "$P" 2>/dev/null)
last_epoch=$(( mtime_epoch > git_epoch ? mtime_epoch : git_epoch ))
```

### NC-1 / Adv-Medium / R2-P2 — 번역쌍 regex가 프로그래밍 언어 확장자를 locale로 오판

**교차 검증: Opus 실측 + Codex adversarial.**

- 스펙 §4.1 regex: `^(?P<base>.+?)(?:\.(?P<locale>[a-z]{2}([_-][A-Z]{2})?))?\.md$`
- **Python으로 실제 테스트 (Opus)**:
  ```
  config.go.md     → base='config',  locale='go'   ← 잘못된 pair
  install.sh.md    → base='install', locale='sh'   ← 잘못된 pair
  run.py.md        → base='run',     locale='py'   ← 잘못된 pair
  ```
- **별도 문제 (Codex)**: `basename()`만 써서 `docs/api/README.md`와 `docs/setup/README.ko.md`가 같은 그룹으로 오인.
- **결과**: `config.md`와 `config.go.md`를 translation pair로 오인 → 27줄 공유 prose가 auto-fix에서 **잘못 제외** (false negative). 실제로는 관련 없는 문서 간 중복이 은닉됨.

**수정 방안** (택 1):
1. **locale allowlist**: `(?:ko|ja|zh|en|ru|fr|de|es|pt|it|nl|pl|tr|vi|th|ar|hi|...)` 한정 집합만 허용.
2. **확장자 whitelist와 교집합 거부**: `.go/.sh/.py/.ts/.rs` 등은 locale로 취급하지 않음.
3. **basename allowlist**: 번역쌍 검사를 `README|ARCHITECTURE|CONTRIBUTING|CLAUDE|AGENTS|CHANGELOG` 같은 "표준 문서명"에만 적용.
4. **그룹 키에 디렉토리 경로 포함**: `group_key = dirname(F) + "/" + base` (Codex 지적 반영).

여러 개를 **조합 적용** 권장 (예: 3 + 4).

### NEW-RCE / Adv-Critical — `worktree_hash`의 `xargs -I{} sh -c`에 RCE 위험

**Codex adversarial 단독이지만 실제 보안 취약점.**

- 스펙 §5.1:
  ```bash
  git ls-files --others --exclude-standard | xargs -I{} sh -c 'printf "%s\n" "{}"; cat "{}" 2>/dev/null'
  ```
- 문제: `sh -c`에 path가 문자열 삽입됨. 파일명에 `$()`, backtick, `|`, `&` 등이 포함되면 **shell이 파싱하여 실행**.
- 공격 시나리오: 악성 레포를 `/deep-docs scan`하면 untracked 파일의 이름에 `"; rm -rf ~; echo "` 같은 문자열이 있으면 실행됨.

**수정** (Codex 권고):
```bash
# NUL-safe 열거 + 쉘 재파싱 없이 loop
while IFS= read -r -d '' f; do
  printf "%s\n" "$f"
  cat -- "$f" 2>/dev/null
done < <(git ls-files -z --others --exclude-standard)
```

### NEW-CLI-BYPASS / R2-P1 — CLI whitelist 우회 버그

**Codex review 단독.**

- 스펙 §4.4 수정 후 Stale 판정 Rule 1: "binary가 시스템 명령 whitelist에 있음 — 바로 통과 (인자 확인 불필요)"
- 문제: `npm`, `make`, `pnpm`, `yarn`이 whitelist에 있음 → `npm run missing-script`는 Rule 1에서 바로 통과 → **repo scripts 체크를 못 만나고 stale로 판정되지 않음**.
- **결과**: M-7 fix(CLI 명령어 stale 판정)가 흔한 케이스에서 무효화.

**수정**: Rule 순서를 뒤집음. **2단계 lookup을 먼저**, 실패 시 whitelist fallback.
```
1. binary + subcommand 2단계 (npm/pnpm/yarn/make) → 매치 여부로 결정
2. 그 외 binary만 whitelist 체크
```

### NEW-FENCE-INDENT / R2-P1 — Indented fence 미처리

**Codex review 단독.**

- 스펙 §4.2: `line.startswith("\`\`\`")` — column 0만 인식
- 실제: Markdown 명세는 최대 3 space 들여쓰기 허용. 이 레포의 `docs/ultrareview-2026-04-17.md:41`도 들여쓰기된 fence 존재.
- **결과**: indented fence 내부가 여전히 중복 탐지 + dead-ref 대상 → X-3/CX-1 부분 미해결.

**수정**: regex로 `^[ ]{0,3}\`\`\``로 인식. `~~~` 같은 tilde fence도 처리.

---

## 🟡 Round 2 Warnings (단독 지적)

### NW-1. xargs 빈 입력 동작 차이 (GNU vs BSD)
NEW-RCE 수정으로 `while read`로 교체되면 자동 해결.

### NW-2. Python pseudocode가 Bash에서 실행 불가
`re.match(r'...')` 식 Python 문법. Bash에는 non-greedy `.+?` + named capture group(`(?P<...>)`) 없음. 스펙에 Bash-equivalent 구현 지침 한 줄 필요.

### NW-3. Cross-document segment 중복 규칙 불명
§4.2가 "segment 내부에서만" 계산을 명시했지만, 문서 A·B 서로의 segment 간 매칭이 auto-fix 대상인지 audit-only인지 불명. translation pair 아닌 두 문서의 진짜 중복이 어느 쪽으로 가는지 명문화 필요.

### NW-4. `type` enum이 `doc-scanner.md`에 codified 안 됨
스펙 §7.1은 5개 `type`을 전제(dead-reference, moved-path, stale-example, duplicate-block, size-warning). 현 `doc-scanner.md`는 `dead-reference`만 예시로 존재. 커밋 6이 이걸 포함하는지 명문화 필요.

### NW-6. Dogfood "정확히 100줄" 기준 모호
`wc -l` vs Python `len(lines)` vs trailing newline 처리가 환경마다 다름. counting convention을 스펙에 고정 필요.

### NW-7. §4.4 `$PATH` lookup "optional"이 비결정성 유발
개발자 머신에 따라 판정 달라짐. 항상 skip 또는 항상 수행 중 택일.

---

## 🟢 Strengths (개선점 인정)

- 14/17 이전 항목이 실질 해결됨
- `schema_version: 2` bump가 4곳에 일관되게 반영 (breaking 인정)
- Dogfood 성공 기준이 "확인하라" → "체크박스 5개" 명문화
- §10 Risks에 플랫폼/외부 의존 항목 확장

---

## 2차 교차 검증 매트릭스

| ID | Opus | Codex | Codex Adv | 확신도 |
|----|:----:|:-----:|:---------:|:------:|
| NC-2 (timestamp sort) | ✅ 실측 | ✅ P1 | ✅ High | 🔴 3/3 일치 |
| NC-1 / Group key dir (번역쌍 추가 결함) | ✅ NC-1 | ✅ P2 | ✅ Medium | 🔴 2-3/3 일치 |
| NEW-RCE (xargs sh -c) | — | — | ✅ Critical | 🔴 단독, but security |
| NEW-CLI-BYPASS | — | ✅ P1 | — | 🟠 단독 |
| NEW-FENCE-INDENT | — | ✅ P1 | — | 🟠 단독 |
| NW-1 ~ NW-7 (Opus 추가) | ✅ | — | — | 🟡 단독 |

---

## Ship-readiness

**❌ 아직 불가.** writing-plans 진입 전 최소 다음 **4건의 blocker** 해결 필요:

1. **NEW-RCE** — 보안 이슈, NUL-safe 열거로 교체
2. **NC-2** — epoch 비교로 교체 (H-6 실해결)
3. **NC-1 + Group dir** — locale allowlist + dir 경로 포함
4. **NEW-CLI-BYPASS** — Rule 순서 역전

선택적: NEW-FENCE-INDENT, NW-2/3/4/6/7 동시 수정 권장.

---

## 다음 단계 옵션

1. **(추천)** 스펙 재수정 → 3차 re-review (실효성 확증)
2. **Pivot**: Approach 2(heuristic-rich)가 반복적으로 edge case 드러냄. Approach 1(conservative, 문구만 수정)로 scope 축소 검토
3. 남은 blocker를 plan의 선행 TODO로 분리하고 writing-plans 진입 (위험)
