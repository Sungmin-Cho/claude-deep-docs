# deep-docs — Project Guide for Claude

Document gardening agent that validates the freshness of agent instruction files (`CLAUDE.md`, `AGENTS.md`, project docs) and auto-repairs them — detecting stale references, moved paths, duplicates, and applying safe fixes with user confirmation.

For detailed version history see [`CHANGELOG.md`](CHANGELOG.md) / [`CHANGELOG.ko.md`](CHANGELOG.ko.md). This file is intentionally short — it holds the overview, structure, and drift-resistant conventions only.

To check the current version: `jq -r .version .claude-plugin/plugin.json`

---

## Project Overview

**deep-docs** is a [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin that runs document-gardening cycles over a project's documentation surface. Inspired by OpenAI's [Harness Engineering](https://openai.com/index/harness-engineering/) ("a doc-gardening agent runs repeatedly, finds stale docs, and opens fix PRs"), it splits work cleanly into **auto-fixable** mechanical issues (dead references, moved paths, stale CLI examples, duplicate blocks) and **audit-only** subjective signals (size, rule-code contradiction, coverage, map-vs-manual ratio).

**Two artifacts drive everything:**
1. **`.deep-docs/last-scan.json`** — M3-envelope-wrapped scan result (documents, issues, scores), reusable for 10 min if HEAD SHA + worktree hash match
2. **`.deep-docs/garden-ignored.json`** — permanent skip list keyed by signature (sha256 of type + path + content_preview)

**Marketplace presence**: One of six plugins in the [claude-deep-suite](https://github.com/Sungmin-Cho/claude-deep-suite) marketplace.

---

## 🚨 CRITICAL — Plugin Update Workflow

**Every deep-docs release must be accompanied by the following work. No exceptions.**

### 1. Sync the deep-suite marketplace (required)

Update the following in `/Users/sungmin/Dev/claude-plugins/deep-suite/`:

- **`.claude-plugin/marketplace.json`** — under the `deep-docs` entry: `sha` = full 40-character merge commit hash on the new `main`; description = one-line headline summary.
- **`README.md`** / **`README.ko.md`** — the `deep-docs` row in the Plugins table and any narrative sections that reference the version.

After editing:
```bash
cd /Users/sungmin/Dev/claude-plugins/deep-suite
git add .claude-plugin/marketplace.json README.md README.ko.md
git commit -m "chore: bump deep-docs to vX.Y.Z — <one-line summary>"
git push
```

### 2. Update deep-docs CHANGELOG (both languages, required)

- Add a new version entry to both `CHANGELOG.md` and `CHANGELOG.ko.md`
- Bump the version in `.claude-plugin/plugin.json` and `package.json`
- If the `last-scan` schema changed, bump `producer_version` in the envelope (it's a literal sync with `plugin.json.version`, enforced by `scripts/verify-fixes.sh`)

**Do NOT inline release notes in this CLAUDE.md** — CHANGELOG is the single source of truth.

---

## Directory Structure

```
deep-docs/
├── .claude-plugin/plugin.json          # plugin manifest
├── package.json                         # `type: "module"`, npm scripts (validate:envelope, verify:fixes)
├── agents/
│   └── doc-scanner.md                  # spawned subagent — Steps 1–12 (discover, extract, validate,
│                                        # track, freshen, dedup, size-check, rules, coverage, ratio,
│                                        # emit, save to M3 envelope)
├── skills/
│   ├── deep-docs/
│   │   └── SKILL.md                    # /deep-docs scan|garden|audit — user-invocable entry skill
│   │                                    # (cross-platform: Claude Code slash + Codex/Copilot/Gemini Skill())
│   └── deep-docs-workflow/
│       ├── SKILL.md                    # core workflow reference (auto-loaded, not user-invocable)
│       └── references/
│           ├── scan-rules.md           # Rules 1–4 auto-fix, Rules 5–8 audit-only
│           ├── audit-metrics.md        # scoring axes (size, freshness, ref-accuracy, duplication)
│           └── scan-filters/           # heuristic helpers (code-fence, reference-extraction,
│                                        # translation-pair, cli-whitelist, worktree-hash,
│                                        # freshness-timestamp)
├── scripts/
│   ├── validate-envelope-emit.js       # envelope schema self-test (npm run validate:envelope)
│   └── verify-fixes.sh                 # release-lint (43 grep checks; hermetic, no install)
├── tests/
│   └── fixtures/
│       └── sample-last-scan.json       # canonical M3-envelope-wrapped payload
├── CHANGELOG.md / CHANGELOG.ko.md
├── README.md / README.ko.md
└── .deep-docs/                          # artifact directory (auto-created on first run)
    ├── last-scan.json                  # scan results (M3 envelope, 10-min TTL)
    └── garden-ignored.json             # rejected fixes (signature-based skip list, permanent)
```

---

## Key Concepts

### `last-scan.json` envelope + payload schema

```
Root:
  $schema: <URL of artifact-envelope.schema.json>
  schema_version: "1.0"                # envelope wrapper version (string, not numeric)
  envelope: { ... }
  payload: { ... }

envelope.producer:          "deep-docs"
envelope.producer_version:  literal sync with plugin.json.version (enforced)
envelope.artifact_kind:     "last-scan"
envelope.schema:            { name: "last-scan", version: "1.0" }
envelope.run_id:            ULID (26-char Crockford Base32, MSB-first, no I/L/O/U)
envelope.generated_at:      RFC 3339 UTC second-precision
envelope.git:               { head: 7–40 hex (or "0000000" non-git), branch, dirty: bool|"unknown" }
envelope.provenance:        { source_artifacts: [{ path }, ...], tool_versions: { node, python, ... } }

payload.provenance.is_git:              bool
payload.provenance.worktree_hash:       sha1 40-hex (tracked + untracked files NUL-safe,
                                        per-file `git hash-object`) or "no-git"
payload.provenance.path_check_enabled:  optional — emitted ONLY when cli-whitelist PATH-check is ON

payload.documents[]:
  - path
  - issues[]:
      - type:               dead-reference | moved-path | stale-example | duplicate-block | size-warning
      - category:           "auto-fix" | "audit-only"
      - severity
      - line
      - current_value
      - suggested_value     # null when category === "audit-only"
      - evidence
  - metrics:
      - size_lines
      - freshness_score:    null | 10 | 7 | 4
      - reference_accuracy: 0.0 – 1.0
      - duplication_count

payload.summary:  { total_issues, auto_fixable, audit_only }
```

### Reuse guard (5-element)

A `last-scan.json` is reusable if **all five** match:
1. Identity triple — `producer === "deep-docs"`, `artifact_kind === "last-scan"`, `schema.name === "last-scan"`
2. Envelope `schema_version === "1.0"`
3. TTL — file modified < 10 minutes ago
4. `envelope.git.head` matches current HEAD
5. `payload.provenance.worktree_hash` matches recomputed (tracked diff + untracked file list / content, NUL-safe per-file `git hash-object`)

**Garden artifact invalidation (H-2 defense)** — when `garden` applies ≥1 fix, it **deletes** `.deep-docs/last-scan.json` at session end. Next scan / garden / audit must unconditionally re-run (no TTL reuse).

### Freshness scoring (path-scoped, git only)

| Stale ratio (outbound refs) | Score |
|---|---|
| `< 30%` | `10` |
| `30 – 70%` | `7` |
| `≥ 70%` | `4` |
| no outbound refs | `null` (dimension excluded from overall avg) |

### Auto-fix vs audit-only invariant

| Category | Issue types | Rationale |
|---|---|---|
| **auto-fix** | dead-reference, moved-path, stale-example (CLI / env), duplicate-block | Mechanical substitution; safe to apply with diff + user confirmation |
| **audit-only** | size-warning, rules-code contradiction, coverage gaps, map-vs-manual ratio | Requires human judgment; no meaningful `current → suggested` mapping |

**Never** treat `size-warning` as auto-fixable — there is no replacement pair (splitting is structural judgment, not substitution).

### `garden-ignored.json` schema

```json
{
  "schema_version": 1,
  "ignored": [
    {
      "signature": "sha256(type + '|' + path + '|' + content_preview[:200])",
      "type": "dead-reference | moved-path | stale-example | duplicate-block",
      "path": "CLAUDE.md",
      "content_preview": "src/auth/middleware.ts",
      "ignored_at": "2026-04-17T10:05:00Z"
    }
  ]
}
```

Garden checks each auto-fix issue's signature **before** prompting. If already present in `ignored[]`, skip prompt. Permanent, not session-scoped.

### Garden batch flow (canonical, 4-option + 2-option)

`AskUserQuestion` schema enforces `options.maxItems: 4`. The canonical flow is:

1. **First prompt — 4 options**: A: apply, B: skip, C: skip + record (add to `garden-ignored.json`), Batch
2. **If Batch → second prompt — 2 options**: D: batch-apply, E: batch-reject

Session state (batch accept / reject type sets) is in-memory only and resets at each `/deep-docs garden` invocation.

---

## Workflows & Conventions

### Bash / cross-platform portability

- `shasum -a 1` (not `sha1sum`) with fallback chain for Linux / macOS
- `stat -f` for macOS, `stat -c` for Linux (dual-support tested)
- `wc -l` guarded by `[ -f ... ] &&` (glob no-match safety)
- ULID generation via Python 3 one-liner (Crockford Base32 alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`; no `O` / `I` / `L` / `U`)
- Never use `xargs -I{} sh -c` for filenames (RCE vector — use safer substitution)

### Conditional payload fields

`path_check_enabled` is emitted only when the cli-whitelist `$PATH` toggle is ON. **Pattern**:

```bash
if [ "${PATH_CHECK_ENABLED:-0}" = 1 ]; then
  PATH_CHECK_EMIT='"path_check_enabled": true,'
else
  PATH_CHECK_EMIT=''
fi
```

Always emitting or always omitting breaks the garden reuse-guard: config toggle changes must invalidate the artifact, and silent omission hides that drift from the 5-element check.

### Node conventions

- Node 20+, `"type": "module"` (ESM)
- Zero runtime deps in `scripts/` — `validate-envelope-emit.js` is a single-file validator
- `verify-fixes.sh` is hermetic (`bash` + standard utilities; no `npm install` needed)

---

## Slash commands

| Command | Signature | Description |
|---|---|---|
| `/deep-docs scan` | prompt-free | Detect stale references, moved paths, stale examples, duplicates → scan report + suggest garden |
| `/deep-docs garden` | prompt-per-issue or batch | Apply auto-fix issues with diff + 4-option prompt → on Batch, 2-option follow-up |
| `/deep-docs audit` | prompt-free | Score documents across size / freshness / ref-accuracy / duplication → per-file scores + recommendations |
| `/deep-docs` (no arg) | interactive | `AskUserQuestion`: "scan, garden, or audit?" |

---

## Tests

```bash
npm run validate:envelope     # node scripts/validate-envelope-emit.js — envelope contract self-test
npm run verify:fixes          # bash scripts/verify-fixes.sh — 43 grep-based release-lint checks
```

There is no `npm test` integration runner — tests are fixture-based (sample envelope validated against schema) plus the `verify-fixes.sh` grep matrix. Latest release (v1.3.0) shipped at "Passed: 43, Failed: 0" (two `allowed-tools` assertions removed in the command→skill conversion).

---

## Quick references

| Question | Answer |
|---|---|
| Garden applied fixes but scan re-uses stale data? | Garden must delete `last-scan.json` at session end; if missing, file a bug — H-2 defense rule |
| `path_check_enabled` toggled but artifact reused? | Reuse guard should invalidate on config drift; check 5-element guard logic |
| Need to permanently skip a recurring "fix"? | Choose option C in garden ("skip + record") — signature added to `garden-ignored.json` |
| `size-warning` showing up as auto-fix? | Bug — `size-warning` MUST be `category: "audit-only"`; check `payload.documents[].issues[].category` |
| 5-option garden prompt? | `AskUserQuestion` rejects > 4 options — use the canonical 4 + 2-option pattern |

---

## Related repositories

- **deep-suite (marketplace)**: https://github.com/Sungmin-Cho/claude-deep-suite — `/Users/sungmin/Dev/claude-plugins/deep-suite`
- **deep-work**: https://github.com/Sungmin-Cho/claude-deep-work
- **deep-wiki**: https://github.com/Sungmin-Cho/claude-deep-wiki
- **deep-evolve**: https://github.com/Sungmin-Cho/claude-deep-evolve
- **deep-review**: https://github.com/Sungmin-Cho/claude-deep-review
- **deep-dashboard**: https://github.com/Sungmin-Cho/claude-deep-dashboard

---

**🔁 Reminder**: This CLAUDE.md is intentionally kept short. For every new release:

1. **Write the details in CHANGELOG** (not here — prevents drift)
2. **Only sync the schema sections** (envelope shape, reuse guard, freshness scoring, garden flow) if the schema itself changed
3. **Sync the deep-suite marketplace** (see the "CRITICAL" section above)
