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
# v1.3.0: command→skill conversion. Skills have no `allowed-tools` frontmatter,
# so the two former allowed-tools assertions are removed. The Task pseudo-code
# checks remain, retargeted at the new entry skill.
check "doc-scanner has Write tool" \
  "grep -Eq '^\s*-\s*Write\b' agents/doc-scanner.md"

check "skill body uses Task(subagent_type=...) pseudo-code" \
  "grep -q 'Task(subagent_type=' skills/deep-docs/SKILL.md"

check "no Agent(doc-scanner): pseudo-code remains in entry skill" \
  "! grep -q 'Agent(doc-scanner):' skills/deep-docs/SKILL.md"

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
check "envelope schema_version \"1.0\" string in doc-scanner example" \
  "grep -Eq '\"schema_version\":\s*\"1\.0\"' agents/doc-scanner.md"

# C-1 fix: doc-scanner 의 producer_version literal ↔ plugin.json.version 동기 (Codex finding #1)
plugin_ver=$(python3 -c 'import json; print(json.load(open(".claude-plugin/plugin.json"))["version"])')
check "doc-scanner producer_version literal == plugin.json.version ($plugin_ver)" \
  "grep -Eq 'producer_version=\"'$plugin_ver'\"' agents/doc-scanner.md"

# Round-2 polish: doc-scanner Step 12-B JSON example must also match plugin.json.version
check "doc-scanner Step 12-B JSON example producer_version == $plugin_ver" \
  "grep -Eq '\"producer_version\":\s*\"'$plugin_ver'\"' agents/doc-scanner.md"

check "doc-scanner does NOT read .claude-plugin/plugin.json from cwd at runtime" \
  "! grep -E 'json\\.load\\(open\\(\"\\.claude-plugin/plugin\\.json\"\\)\\)' agents/doc-scanner.md"

check "envelope.producer \"deep-docs\" in doc-scanner example" \
  "grep -Eq '\"producer\":\s*\"deep-docs\"' agents/doc-scanner.md"

check "envelope.artifact_kind \"last-scan\" in doc-scanner example" \
  "grep -Eq '\"artifact_kind\":\s*\"last-scan\"' agents/doc-scanner.md"

check "envelope schema.name == artifact_kind identity in doc-scanner" \
  "grep -Eq '\"schema\":\s*\\{\s*\"name\":\s*\"last-scan\"' agents/doc-scanner.md"

check "worktree_hash in doc-scanner" \
  "grep -q 'worktree_hash' agents/doc-scanner.md"

check "worktree_hash in entry skill" \
  "grep -q 'worktree_hash' skills/deep-docs/SKILL.md"

check "worktree_hash in workflow SKILL.md" \
  "grep -q 'worktree_hash' skills/deep-docs-workflow/SKILL.md"

check "4-factor reuse rule documented (envelope-aware)" \
  "grep -Eq 'envelope.schema.version|envelope\\.generated_at|envelope\\.git\\.head' skills/deep-docs/SKILL.md skills/deep-docs-workflow/SKILL.md"

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
check "garden-ignored.json documented in entry skill" \
  "grep -q 'garden-ignored.json' skills/deep-docs/SKILL.md"

check "garden 5지선다 options A-E present (all 5) in entry skill" \
  "grep -c '(A) 적용\|(B) 건너뜀\|(C) 건너뜀.*기록\|(D) 이하 모두 적용\|(E) 이하 모두 건너뜀' skills/deep-docs/SKILL.md | awk '{exit \$1 < 5}'"

# ===== Housekeeping (L-1~L-5) =====
check "package.json has private: true" \
  "grep -q '\"private\":\s*true' package.json"

check "hooks/hooks.json removed" \
  "[ ! -f hooks/hooks.json ]"

check ".gitignore includes .deep-docs/" \
  "grep -q '^\.deep-docs/' .gitignore"

# docs/ 는 commit 3840da9 (chore: gitignore docs/) 이후 author-local. 추적 검사 제거.

# ===== Platform compat (O-6) =====
check "scan-filters use shasum -a 1 (not sha1sum)" \
  "grep -q 'shasum -a 1' skills/deep-docs-workflow/references/scan-filters/worktree-hash.md"

check "worktree-hash.md: no xargs sh -c in executable code blocks" \
  "! awk '/^\`\`\`/{inc=!inc; next} inc' skills/deep-docs-workflow/references/scan-filters/worktree-hash.md | grep -Eq 'xargs -I\{\}.*sh -c'"

check "worktree-hash.md: 절대 금지 educational warning present" \
  "grep -q '절대 금지' skills/deep-docs-workflow/references/scan-filters/worktree-hash.md"

# ===== Version sync =====
check "plugin.json version == plugin_ver ($plugin_ver)" \
  "grep -q '\"version\":\s*\"'$plugin_ver'\"' .claude-plugin/plugin.json"

check "package.json version == plugin_ver ($plugin_ver)" \
  "grep -q '\"version\":\s*\"'$plugin_ver'\"' package.json"

check "package.json type = module" \
  "grep -Eq '\"type\":\s*\"module\"' package.json"

check "CHANGELOG has current version entry [$plugin_ver]" \
  "grep -q '\['$plugin_ver'\]' CHANGELOG.md"

# ===== M3 envelope adoption =====
check "envelope fixture exists" \
  "[ -f tests/fixtures/sample-last-scan.json ]"

check "validate-envelope-emit.js exists" \
  "[ -f scripts/validate-envelope-emit.js ]"

check "envelope self-test passes" \
  "node scripts/validate-envelope-emit.js"

# ===== Authoring (v1.4.0) =====
check "doc-author agent exists" \
  "[ -f agents/doc-author.md ]"
check "doc-author has NO Write tool (frontmatter list)" \
  "! grep -Eq '^\s*-\s*Write\b' agents/doc-author.md"
check "doc-author has NO Bash tool (frontmatter list)" \
  "! grep -Eq '^\s*-\s*Bash\b' agents/doc-author.md"
check "authoring category enum in scan-rules" \
  "grep -q 'authoring' skills/deep-docs-workflow/references/scan-rules.md"
check "missing-doc / thin-doc types present" \
  "grep -Eq 'missing-doc' agents/doc-scanner.md && grep -Eq 'thin-doc' agents/doc-scanner.md"
check "entry skill no-documents path → missing-doc gap (빈 레포 authoring; R3-plan-R4 entry-skill)" \
  "grep -q 'missing-doc' skills/deep-docs/SKILL.md"
check "entry skill old no-documents early-exit 문구 제거됨 (빈 레포 회귀 차단; R4 codex medium)" \
  "! grep -q '스캔할 대상이 없습니다' skills/deep-docs/SKILL.md"
check "payload.gaps[] documented in doc-scanner" \
  "grep -Eq '\"gaps\"|payload\\.gaps|gaps\\[\\]' agents/doc-scanner.md"   # 구조 토큰 (ℹ️-2: 느슨한 'gaps' 단어 매칭 회피)
for f in claude-md agents-md architecture-md README; do
  check "authoring-rules/${f}.md exists" \
    "[ -f skills/deep-docs-workflow/references/authoring-rules/${f}.md ]"
done
check "doc-author spawn in entry skill garden" \
  "grep -q 'doc-author' skills/deep-docs/SKILL.md"
check "structured apply contract (removal_candidates/preserved_blocks)" \
  "grep -Eq 'removal_candidates|preserved_blocks' skills/deep-docs/SKILL.md"
check "authoring 3-option labels present, distinct from garden 5지선다 A-E" \
  "grep -Eq '수정요청' skills/deep-docs/SKILL.md"   # [R3-plan:🟡-2] spec §8 — authoring 적용/수정요청/거부 라벨 회귀 가드(5지선다 :111 과 별개 공존)

# ===== schema 1.1 transition (top-level 1.0 유지) =====
check "doc-scanner payload schema.version is 1.1" \
  "grep -Eq '\"version\":\s*\"1\.1\"' agents/doc-scanner.md"
check "doc-scanner top-level schema_version STAYS 1.0 (회귀 앵커)" \
  "grep -Eq '\"schema_version\":\s*\"1\.0\"' agents/doc-scanner.md"
check "validator top-level guard :81 STAYS 1.0" \
  "grep -q \"data.schema_version !== '1.0'\" scripts/validate-envelope-emit.js"
check "validator payload guard :115 is 1.1" \
  "grep -q \"env.schema?.version !== '1.1'\" scripts/validate-envelope-emit.js"

# ===== Result =====
echo "---"
echo "Passed: $pass  Failed: $fail"
[ "$fail" -eq 0 ] || exit 1
