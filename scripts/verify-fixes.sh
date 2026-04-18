#!/usr/bin/env bash
# verify-fixes.sh — grep 기반 스펙 준수 체크
# 사용: bash scripts/verify-fixes.sh
# 목적: v1.1.0 수정사항이 runtime 문서에 반영됐는지 빠르게 확인
#
# 주의 (스펙 O-9): 본 스크립트는 structural check만 수행 — 특정 문구·필드의
# 존재 여부만 grep으로 검사합니다. semantic correctness(알고리즘이 실제
# 의도대로 동작하는지)는 §7.5 Dogfood 절차가 담당. 두 단계를 모두 통과해야
# 릴리스 가능.

set -u
cd "$(dirname "$0")/.."
fail=0
pass=0

check() {
  local name="$1" cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    printf "✓ %s\n" "$name"; pass=$((pass+1))
  else
    printf "✗ %s\n" "$name"; fail=$((fail+1))
  fi
}

# ===== Agent tooling (C-2, C-3) =====
check "doc-scanner has Write tool" \
  "grep -Eq '^\s*-\s*Write\b' agents/doc-scanner.md"

check "command uses Task (not Agent) in allowed-tools" \
  "grep -Eq '^allowed-tools:.*\bTask\b' commands/deep-docs.md"

check "command does NOT use Agent in allowed-tools" \
  "! grep -Eq '^allowed-tools:.*\bAgent\b' commands/deep-docs.md"

check "command body uses Task(subagent_type=...) pseudo-code" \
  "grep -q 'Task(subagent_type=' commands/deep-docs.md"

check "no Agent(doc-scanner): pseudo-code remains" \
  "! grep -q 'Agent(doc-scanner):' commands/deep-docs.md"

# ===== Scan-filters integration =====
check "scan-rules references scan-filters directory" \
  "grep -q 'scan-filters/' skills/deep-docs-workflow/references/scan-rules.md"

check "doc-scanner references scan-filters in Step 2/6" \
  "grep -c 'scan-filters/' agents/doc-scanner.md | awk '{exit \$1 < 2}'"

for filter in translation-pair code-fence reference-extraction cli-whitelist worktree-hash freshness-timestamp; do
    check "scan-filters/${filter}.md exists" \
      "[ -f skills/deep-docs-workflow/references/scan-filters/${filter}.md ]"
done

# ===== Artifact provenance (H-1, H-2, H-5) =====
check "schema_version == 2 in doc-scanner example" \
  "grep -Eq '\"schema_version\":\s*2' agents/doc-scanner.md"

check "worktree_hash in doc-scanner" \
  "grep -q 'worktree_hash' agents/doc-scanner.md"

check "worktree_hash in commands" \
  "grep -q 'worktree_hash' commands/deep-docs.md"

check "worktree_hash in SKILL.md" \
  "grep -q 'worktree_hash' skills/deep-docs-workflow/SKILL.md"

check "4-factor reuse rule documented" \
  "grep -Eq '4-요소|4-factor|schema_version.*일치|schema_version ==' commands/deep-docs.md skills/deep-docs-workflow/SKILL.md"

# ===== Freshness & audit (H-4, M-1, M-2, M-3) =====
check "freshness_score example uses valid scale (not 6) — all runtime files" \
  "! grep -rq '\"freshness_score\":\s*6' agents/doc-scanner.md README.md README.ko.md"

check "stale ratio thresholds 30%/70% documented" \
  "grep -Eq '30%.*70%|<30%|≥70%' skills/deep-docs-workflow/references/audit-metrics.md"

check "band uses strict inequality (≥ 9.0)" \
  "grep -Eq 'score ≥ 9\.0|≥ 9\.0' README.md README.ko.md skills/deep-docs-workflow/references/audit-metrics.md"

check "size warnings use strict > (not ≥)" \
  "grep -Eq '>100|>300|>200' skills/deep-docs-workflow/references/scan-rules.md skills/deep-docs-workflow/references/audit-metrics.md"

# ===== Issue field rename (M-6) =====
check "current_value / suggested_value documented" \
  "grep -Eq 'current_value.*suggested_value|suggested_value.*current_value' agents/doc-scanner.md"

check "old 'reference'/'suggestion' fields not in current example" \
  "! grep -Eq '\"reference\":\s*\"src/' agents/doc-scanner.md"

# ===== Garden UX (M-8, M-9) =====
check "garden-ignored.json documented" \
  "grep -q 'garden-ignored.json' commands/deep-docs.md"

check "garden 5지선다 options A-E present (all 5)" \
  "grep -c '(A) 적용\|(B) 건너뜀\|(C) 건너뜀.*기록\|(D) 이하 모두 적용\|(E) 이하 모두 건너뜀' commands/deep-docs.md | awk '{exit \$1 < 5}'"

# ===== Housekeeping (L-1~L-5) =====
check "package.json has private: true" \
  "grep -q '\"private\":\s*true' package.json"

check "hooks/hooks.json removed" \
  "[ ! -f hooks/hooks.json ]"

check ".gitignore includes .deep-docs/" \
  "grep -q '^\.deep-docs/' .gitignore"

check "docs/backlog-2026-04-16.md committed" \
  "git ls-files --error-unmatch docs/backlog-2026-04-16.md > /dev/null 2>&1"

# ===== Platform compat (O-6) =====
check "scan-filters use shasum -a 1 (not sha1sum)" \
  "grep -q 'shasum -a 1' skills/deep-docs-workflow/references/scan-filters/worktree-hash.md"

check "worktree-hash.md: no xargs sh -c in executable code blocks" \
  "! awk '/^\`\`\`/{inc=!inc; next} inc' skills/deep-docs-workflow/references/scan-filters/worktree-hash.md | grep -Eq 'xargs -I\{\}.*sh -c'"

check "worktree-hash.md: 절대 금지 educational warning present" \
  "grep -q '절대 금지' skills/deep-docs-workflow/references/scan-filters/worktree-hash.md"

# ===== Version sync =====
check "plugin.json version = 1.1.0" \
  "grep -q '\"version\":\s*\"1.1.0\"' .claude-plugin/plugin.json"

check "package.json version = 1.1.0" \
  "grep -q '\"version\":\s*\"1.1.0\"' package.json"

check "CHANGELOG has [1.1.0] entry" \
  "grep -q '\[1.1.0\]' CHANGELOG.md"

# ===== Result =====
echo "---"
echo "Passed: $pass  Failed: $fail"
[ "$fail" -eq 0 ] || exit 1
