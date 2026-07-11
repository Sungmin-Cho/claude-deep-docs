# deep-docs — Project Guide for Claude

Document gardening agent that validates the freshness of agent instruction files (`CLAUDE.md`, `AGENTS.md`, project docs) and auto-repairs them — detecting stale references, moved paths, duplicates, and applying safe fixes with user confirmation.

For detailed version history see [`CHANGELOG.md`](CHANGELOG.md) / [`CHANGELOG.ko.md`](CHANGELOG.ko.md). This file is intentionally short — it holds the overview, structure, and drift-resistant conventions only.

To check the current version: `node -p "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')).version"`

> 📄 Documentation in this repo follows `docs/DOCS_RULE.md` (local maintainer guide — single-source-of-truth rules for README / CHANGELOG / this file).

---

## Project Overview

**deep-docs** is a Claude Code and Codex plugin that runs document-gardening cycles over a project's documentation surface. Inspired by OpenAI's [Harness Engineering](https://openai.com/index/harness-engineering/) ("a doc-gardening agent runs repeatedly, finds stale docs, and opens fix PRs"), it splits work cleanly into **auto-fixable** mechanical issues (dead references, moved paths, stale CLI examples, duplicate blocks) and **audit-only** subjective signals (size, rule-code contradiction, coverage, map-vs-manual ratio).

**Two artifacts drive everything:**
1. **`.deep-docs/last-scan.json`** — M3-envelope-wrapped scan result (documents, issues, scores), reusable for 10 min if HEAD SHA + worktree hash match
2. **`.deep-docs/garden-ignored.json`** — permanent skip list keyed by signature (sha256 of type + path + content_preview)

**Marketplace presence**: Published in the [claude-deep-suite](https://github.com/Sungmin-Cho/claude-deep-suite) marketplace for both Claude Code and Codex.

---

## 🚨 CRITICAL — Plugin Update Workflow

**Every deep-docs release must be accompanied by the following work. No exceptions.**

### 1. Sync the deep-suite marketplace (required)

Update the following in `/Users/sungmin/Dev/claude-plugins/deep-suite/`:

- **`.claude-plugin/marketplace.json`** and **`.agents/plugins/marketplace.json`** — under the `deep-docs` entry: `sha` = full 40-character merge commit hash on the new `main`; description = one-line headline summary.
- **`README.md`** / **`README.ko.md`** — the `deep-docs` row in the Plugins table and any narrative sections that reference the version.

After editing:
```bash
cd /Users/sungmin/Dev/claude-plugins/deep-suite
git add .claude-plugin/marketplace.json .agents/plugins/marketplace.json README.md README.ko.md
git commit -m "chore: bump deep-docs to vX.Y.Z — <one-line summary>"
git push
```

### 2. Update deep-docs CHANGELOG (both languages, required)

- Add a new version entry to both `CHANGELOG.md` and `CHANGELOG.ko.md`
- Bump the version in `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, and `package.json`
- If the `last-scan` schema changed, update its schema contract. The runtime reads the
  plugin version dynamically when it emits an envelope; do not copy a version literal
  into an agent definition.

**Do NOT inline release notes in this CLAUDE.md** — CHANGELOG is the single source of truth.

---

## Directory Structure

```
deep-docs/
├── .claude-plugin/plugin.json
├── .codex-plugin/plugin.json          # plugin manifest
├── package.json                         # private Node 22 ESM package; four portable npm gates
├── agents/
│   ├── doc-scanner.md                  # spawned subagent — Steps 1–13 (discover, extract, validate,
│   │                                    # track, freshen, dedup, size-check, rules, coverage, ratio,
│   │                                    # gap-detect, emit, save to M3 envelope)
│   └── doc-author.md                   # authoring subagent — drafts CLAUDE/AGENTS/ARCHITECTURE
│                                        # (Read/Glob/Grep only — no Write/Bash; structured result)
├── skills/
│   ├── deep-docs/
│   │   └── SKILL.md                    # /deep-docs scan|garden|audit — user-invocable entry skill
│   │                                    # (Claude Code slash + Codex $deep-docs:deep-docs entry)
│   └── deep-docs-workflow/
│       ├── SKILL.md                    # core workflow reference (auto-loaded, not user-invocable)
│       └── references/
│           ├── scan-rules.md           # Rules 1–4 auto-fix, Rules 5–8 audit-only, Rule 9 authoring
│           ├── audit-metrics.md        # scoring axes (size, freshness, ref-accuracy, duplication)
│           ├── authoring-rules/        # doc skeletons (claude-md, agents-md, architecture-md,
│           │                            # README index + cross-doc rules)
│           └── scan-filters/           # heuristic helpers (code-fence, reference-extraction,
│                                        # translation-pair, cli-whitelist, worktree-hash,
│                                        # freshness-timestamp)
├── scripts/
│   ├── deep-docs-runtime.js            # nine-command deterministic runtime entry
│   ├── runtime/                        # scan, Git, artifact, state, and authoring modules
│   ├── validate-envelope-emit.js       # envelope schema self-test (npm run validate:envelope)
│   └── verify-fixes.js                 # portable structural release-lint (npm run verify:fixes)
├── tests/
│   └── fixtures/
│       ├── sample-last-scan.json       # canonical M3-envelope-wrapped payload (schema 1.1, gaps[])
│       └── sample-last-scan-invalid-gap.json   # negative fixture — nested target_path rejected
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
envelope.producer_version:  dynamically loaded from the plugin manifest by the runtime
envelope.artifact_kind:     "last-scan"
envelope.schema:            { name: "last-scan", version: "1.1" }   # payload schema; top-level schema_version stays "1.0"
envelope.run_id:            ULID (26-char Crockford Base32, MSB-first, no I/L/O/U)
envelope.generated_at:      RFC 3339 UTC second-precision
envelope.git:               { head: 7–40 hex (or "0000000" non-git), branch, dirty: bool|"unknown" }
envelope.provenance:        { source_artifacts: [{ path }, ...], tool_versions: { node } }

payload.provenance.is_git:              bool
payload.provenance.worktree_hash:       sha1 40-hex (tracked + untracked files NUL-safe,
                                        per-file `git hash-object`) or "no-git"
payload.provenance.path_check_enabled:  optional — emitted ONLY when cli-whitelist PATH-check is ON

payload.documents[]:           # existing documents only
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

payload.gaps[]:                # optional — authoring (missing/thin recommended docs). NOT a reuse-guard input.
  - type:                 missing-doc | thin-doc
  - category:             "authoring"
  - severity
  - target_path:          root-only exact (CLAUDE.md | AGENTS.md | ARCHITECTURE.md); no nested/traversal
  - exists:               false (missing-doc) | true (thin-doc)
  - evidence
  - authoring_spec:       { doc_kind: claude-md|agents-md|architecture-md, mode: create|restructure, rationale }
                          # draft body NOT here — garden's doc-author generates it

payload.summary:  { total_issues, auto_fixable, authoring, audit_only }
                  # total_issues/auto_fixable/audit_only = documents[].issues[] ONLY (gaps excluded — dashboard metric preserved, D12)
                  # authoring = gaps[] length
```

### Reuse guard (5-element)

A `last-scan.json` is reusable if **all five** match:
1. Identity triple — `producer === "deep-docs"`, `artifact_kind === "last-scan"`, `schema.name === "last-scan"`
2. Top-level `schema_version === "1.0"` (envelope wrapper) AND payload `envelope.schema.version === "1.1"` (payload schema)
3. TTL — file modified < 10 minutes ago
4. `envelope.git.head` matches current HEAD
5. `payload.provenance.worktree_hash` matches recomputed (tracked diff + untracked file list / content, NUL-safe per-file `git hash-object`)

**Garden artifact invalidation (H-2 defense)** — when `garden` applies at least one
project-document edit or authoring commit, it calls the guarded Node `scan-invalidate`
command exactly once with the frozen artifact revision. A matching snapshot is removed,
a newer snapshot is preserved, and an already absent snapshot is idempotent success.

### Freshness scoring (path-scoped, git only)

| Stale ratio (outbound refs) | Score |
|---|---|
| `< 30%` | `10` |
| `30 – 70%` | `7` |
| `≥ 70%` | `4` |
| no outbound refs | `null` (dimension excluded from overall avg) |

### Category trichotomy (auto-fix / authoring / audit-only)

| Category | Issue / gap types | Rationale |
|---|---|---|
| **auto-fix** | dead-reference, moved-path, stale-example (CLI / env), duplicate-block | Mechanical substitution; safe to apply with diff + user confirmation |
| **authoring** | missing-doc, thin-doc (in `payload.gaps[]`) | Whole-document draft, not a `current → suggested` substitution; garden spawns `doc-author` and writes after per-removal approval |
| **audit-only** | size-warning, rules-code contradiction, coverage gaps, map-vs-manual ratio | Requires human judgment; no meaningful `current → suggested` mapping |

**Never** treat `size-warning` as auto-fixable — there is no replacement pair (splitting is structural judgment, not substitution). Authoring lives in `payload.gaps[]`, never in `documents[].issues[]`.

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

### Node runtime / cross-platform portability

- Support Node.js 22 on native Windows, macOS, and Linux. Git is optional;
  Git Bash and Python are not required.
- Resolve the plugin root from `import.meta.url`, never from the target cwd or a
  required environment variable.
- Resolve target roots to their physical absolute path and preserve native Windows
  drive, UNC, Unicode, and space-containing forms. Artifact child paths remain
  forward-slash repository-relative.
- Deterministic filesystem, Git, hashing, timestamp, envelope, and state mutations
  belong to `scripts/deep-docs-runtime.js` and `scripts/runtime/`.
- The authoring baseline is the exact raw-byte `sha256:<64 lowercase hex>` digest in
  Git, non-Git, and missing-Git modes. `authoring-commit` rechecks it immediately
  before an atomic approved write.
- Runtime and verification entry points invoke no shell, PowerShell, `cmd`, Python,
  or platform-specific utility.
- The runtime rejects pre-existing symlink/junction escapes and revalidates physical
  parents immediately before path-based I/O. The accepted same-user syscall-window
  residual and safe-cleanup boundary are documented in `SECURITY.md`.

### Conditional payload fields

`path_check_enabled` is emitted only when the cli-whitelist path-check toggle is
explicitly enabled for the Node `scan-context` command.

Always emitting or always omitting breaks the garden reuse-guard: config toggle changes must invalidate the artifact, and silent omission hides that drift from the 5-element check.

### Node conventions

- Node 22+, `"type": "module"` (ESM)
- Zero runtime dependencies in `scripts/`
- `verify-fixes.js` uses direct Node predicates and invokes only the current Node
  executable for its envelope fixture check

---

## Slash commands

Claude Code uses the slash commands below. Codex uses the equivalent
`$deep-docs:deep-docs scan|garden|audit` entrypoint; its generic author loads
`agents/doc-author.md`, receives read/search capability only, and keeps the same
preview, removal-approval, and authoring-baseline protections.

| Command | Signature | Description |
|---|---|---|
| `/deep-docs scan` | prompt-free | Detect stale references, moved paths, stale examples, duplicates → scan report + suggest garden |
| `/deep-docs garden` | prompt-per-issue or batch | Apply auto-fix issues with diff + 4-option prompt → on Batch, 2-option follow-up |
| `/deep-docs audit` | prompt-free | Score documents across size / freshness / ref-accuracy / duplication → per-file scores + recommendations |
| `/deep-docs` (no arg) | interactive | `AskUserQuestion`: "scan, garden, or audit?" |

---

## Tests

```bash
npm test                    # Node's built-in discovery of all tests
npm run validate:envelope  # envelope contract self-test
npm run validate:codex     # enforceable Codex manifest contract
npm run verify:fixes       # portable Node structural release-lint matrix
```

All four commands must be green before merge; `verify:fixes` must report
`Failed: 0`. The upstream official Codex `validate_plugin.py`, when installed,
is an advisory maintainer-only check that may be absent. It is not part of the
plugin runtime or the cross-platform test suite.

---

## Quick references

| Question | Answer |
|---|---|
| Garden applied fixes but scan re-uses stale data? | Verify one revision-guarded `scan-invalidate` call occurred after the successful mutation. |
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
