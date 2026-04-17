# Plan Review — 2026-04-17

- **Target**: `docs/superpowers/plans/2026-04-17-deep-docs-v1.1.0-fixes.md` (commit `769d396`)
- **Reference**: `docs/superpowers/specs/2026-04-17-deep-docs-ultrareview-fixes-design.md` (v6)
- **Review Mode**: Opus 단독 (Codex API limit)

---

## Verdict

**🔴 REQUEST_CHANGES**

Critical 2건 + Warning 8건. Plan은 구조적으로 잘 짜였고 24개 finding 매핑은 정확하나, **실행 시 실제 실패가 발생할 두 지점**과 line number reference의 부정확성이 다수 있어 agentic worker가 그대로 실행하면 verify-fixes.sh가 영원히 fail하거나 markdown 구조가 깨집니다.

---

## 🔴 Critical (실행 차단)

### PC-1. `verify-fixes.sh`의 `xargs -I{} sh -c` 체크가 원천적으로 fail

- **위치**: plan line 1207-1208, Task 8 verify script
- **문제**: check pattern — `! grep -Eq "xargs -I\{\}.*sh -c" skills/.../worktree-hash.md`
- **실제**: `worktree-hash.md`는 의도적으로 "절대 금지" 교육 예시로 해당 문자열을 **2회 포함** (filter 파일 line 11, 38). grep이 항상 match → `!` invert → check fail → Task 8 Step 6 "모든 체크 통과" 영원히 실패.
- **수정**: code block 내부의 실제 실행 가능 패턴만 검사하도록 scope 제한:
  ```bash
  # 금지 예시("**절대 금지**" heading 아래) 제외하고 code block 안 패턴 검사
  awk '/^```/{inc=!inc;next} inc' skills/.../worktree-hash.md | ! grep -Eq "xargs -I\{\}.*sh -c"
  ```

### PC-2. Task 3 Step 4가 `commands/deep-docs.md` step 2 heading 삭제

- **위치**: plan line 414-422
- **문제**: "line 69-74 교체" 지시. 실제 `commands/deep-docs.md` line 74는 **`2. auto-fix 가능 항목만 추출 (scan-rules.md 기준):`** (garden step 2 heading).
- **영향**: 교체 블록이 step 1 재사용 조건만 담고 있어, step 2 heading이 증발. markdown 구조 손상 → 이후 Task에서 "garden step 2"를 참조할 수 없음.
- **수정**: "line 69-72를 교체 (line 73 빈줄, line 74 step 2 heading 보존)"로 정정.

---

## 🟡 Warning (실행 품질 저하, 8건)

### PW-1. Task 3 Step 5 "line 107 직후" 삽입이 코드블록 내부로
- line 101-109가 garden step 5의 코드블록 ```` ``` ... ``` ````. "line 107 직후"에 markdown heading 삽입 → **코드블록 내부에 heading** → 렌더링 깨짐.
- 수정: "line 109 (코드블록 닫는 백틱) 직후" 명시.

### PW-2. Task 7 Step 1 "line 80-93" 범위가 이전 Task들 변경 이후 shift
- Task 1(line 2 수정 + 34-40 확장), Task 3(line 69-74 + 107 삽입) 모두 `commands/deep-docs.md` 건드림 → line 80-93이 도달 시점엔 이미 다른 위치.
- 수정: anchor text ("garden step 3 시작 `3. 각 항목을 순서대로 처리:`부터") 사용 권장.

### PW-3. Plan 전체에서 line number 참조가 shift 가정 무시
- Self-Review가 line number 일관성을 claim하지만, 동일 파일을 여러 Task가 수정하므로 순방향 실행 시 line 번호가 누적 shift됨.
- 수정: plan 서문에 주의사항 추가 또는 anchor text 기반 재작성.

### PW-4. Self-Review의 Task 2 매핑이 과장
- "Task 2: BU-1~BU-8, N-1, N-2, N-5, N-6, W-1"이라 claim. 실제 Task 2는 runtime 문서 integration 작업이며, 해당 findings는 **spec work 단계의 filter 파일에서 이미 해결**됨. technically false는 아니나 오해 여지.
- 수정: "already resolved in spec work" vs "integrated by this task" 분리 표기.

### PW-5. verify-fixes.sh가 README의 `freshness_score: 6` 잔존 감지 못함
- Task 3 Step 6-7이 README.md/ko.md 업데이트 지시, but verify check는 `agents/doc-scanner.md`만 검사.
- 수정: `! grep -rq '"freshness_score":\s*6' agents/ README.md README.ko.md`로 확장.

### PW-6. Task 3 Step 3 SKILL.md "line 30-34 영역" 범위 부정확
- line 30-33이 garden step 1 재사용 조건, line 34가 step 2 heading. PC-2와 동일 패턴.
- 수정: "line 30-33만 교체, line 34 heading 보존".

### PW-7. 5지선다 check threshold `< 3` 부적절
- `grep -c '(A)\|(B)\|(C)\|(D)\|(E)' | awk '{exit $1 < 3}'` — A/B/C만 있어도 통과. D/E 누락 감지 못함.
- 수정: `< 5`로 변경 또는 5 옵션 각각 별도 check.

### PW-8. (D)/(E) 세션 state 로직 pseudo-code 누락
- Task 7 Step 1이 "세션 내 동일 type 일괄 수락/거부"를 설명하지만 **in-memory state 구조**나 순회 로직 없음. 실행자가 추론 필요.
- 수정: 5-line pseudo-code 추가 (plan 본문에 batch accept/reject set 명시).

---

## ℹ️ Info (참고, 5건)

- PI-1. `docs/backlog-2026-04-16.md` 커밋 확인 step 부재 (git add에만 존재)
- PI-2. `rmdir hooks 2>/dev/null` 의도 주석 없음
- PI-3. Task 6 Step 3 "각 Step heading 뒤에 주석 추가" — 8 Step 각각의 구체 주석 내용 미정
- PI-4. Final Verification의 `git push -u origin main` — feature branch가 기본이어야
- PI-5. Execution Handoff의 질문 형식이 agentic worker에게 혼선 — 기본값 지정 필요

---

## Spec-Plan 매핑 요약

### 24개 원본 findings (C/H/M/L): **전부 매핑 확인**
| 범주 | 개수 | 매핑 Task |
|------|------|----------|
| Critical (C-1~C-3) | 3 | Task 1, 2 |
| High (H-1~H-6) | 6 | Task 2, 3, 4 |
| Medium (M-1~M-9) | 9 | Task 1, 2, 4, 5, 6, 7 |
| Low (L-1~L-6) | 6 | Task 5, 7 |

### 4 라운드 신규 findings: **전부 매핑 (간접 포함)**
- Round 1 (X-*, O-*, CX-*): 15건, 전부 Task 2~8
- Round 2 (NC-*, NEW-*): 5건, Task 2
- Round 3 (BU-*): 8건, Task 2, 4 (spec 단계에서 filter 파일로 해결, plan이 integrate)
- Round 4 (N-*): 8건, spec work에서 해결됨
- Round 5 (regression/I-1/W-1/W-2): spec work에서 해결됨

**누락**: 없음. 단, PW-4에서 지적한 "매핑 claim 정확성" 문제는 남음.

---

## Ship-readiness

**agentic worker 실행 가능?**: **No** (PC-1/PC-2 Critical)

### 최소 수정 세트 (이것만 하면 APPROVE 가능)

1. **PC-1**: verify-fixes.sh의 `xargs -I{} sh -c` check를 code block scope로 제한 (5분)
2. **PC-2**: Task 3 Step 4 line range "69-74" → "69-72" 정정 + step 2 heading 보존 명시 (2분)
3. **PW-1**: Task 3 Step 5 "line 107 직후" → "line 109 직후, audit 섹션 전" 명확화 (2분)
4. **PW-6**: Task 3 Step 3 SKILL.md "line 30-34" → "line 30-33" 정정 (2분)
5. **PW-7**: verify-fixes.sh 5지선다 check `< 3` → `< 5` (1분)

총 수정 시간: **~12분**. 두 Critical을 해결하지 않으면 릴리스 멈춤.

### 권장 추가 수정

6. **PW-3**: plan 서문에 "line number는 이전 Task 적용 후 재측정 필요" 주의 추가, 또는 전체 anchor text로 재작성 (30분 수정)
7. **PW-4**: Self-Review 매핑을 "spec work로 해결됨" vs "plan이 integrate" 분리 (5분)
8. **PW-5**: verify-fixes.sh freshness_score check에 README 포함 (2분)
9. **PW-8**: Task 7 Step 1 (D)/(E) 세션 state pseudo-code 추가 (5분)

총 50분 정도로 plan을 정밀하게 만들 수 있음.

---

## 다음 단계 옵션

1. **(추천) PC-1/PC-2 + 최소 수정 세트 적용 → plan v2 → 재리뷰**
2. PC-1/PC-2만 긴급 수정 후 writing-plans 승인
3. plan 전면 재작성 (anchor text 기반)
