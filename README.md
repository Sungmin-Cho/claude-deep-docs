**English** | [한국어](./README.ko.md)

# deep-docs

![version](https://img.shields.io/github/package-json/v/Sungmin-Cho/claude-deep-docs?label=version)
![license](https://img.shields.io/github/license/Sungmin-Cho/claude-deep-docs)
[![part of deep-suite](https://img.shields.io/badge/part%20of-deep--suite-5b8def)](https://github.com/Sungmin-Cho/claude-deep-suite)

> A document gardening agent that validates freshness and auto-repairs agent instruction files — `CLAUDE.md`, `AGENTS.md`, and project docs.

Agent instruction documents go stale quickly. As a codebase evolves, `CLAUDE.md` and `AGENTS.md` accumulate dead references, moved paths, and outdated examples — and agents working from stale docs make decisions based on information that no longer reflects reality. deep-docs runs a repeatable scan → garden → audit cycle that detects the gap, auto-fixes what can be safely repaired (with your confirmation), and scores overall doc quality.

> "Too many instructions stop being instructions. They rot fast." — OpenAI, Harness Engineering

## Role in deep-suite

deep-docs is one of the plugins in the [claude-deep-suite](https://github.com/Sungmin-Cho/claude-deep-suite). In the [Harness Engineering](https://martinfowler.com/articles/harness-engineering.html) framework it operates in two quadrants:

- **Inferential Guide** — keeps agent instruction documents accurate and current, so the guides agents read stay trustworthy.
- **Computational Sensor** — the freshness scan (`.deep-docs/last-scan.json`) emits deterministic document-health metrics that [deep-dashboard](https://github.com/Sungmin-Cho/claude-deep-dashboard) consumes.

## Install

Via the `claude-deep-suite` marketplace:

```bash
# Claude Code
/plugin install deep-docs@claude-deep-suite

# Codex
codex plugin install deep-docs
```

Or directly from this repo:

```bash
claude plugin add https://github.com/Sungmin-Cho/claude-deep-docs.git
```

After install, run `/deep-docs` in any project directory. The plugin auto-creates `.deep-docs/` on first use — no configuration file required.

## Quick start

```bash
/deep-docs scan      # detect stale references, moved paths, and outdated examples
/deep-docs garden    # auto-fix safe issues, with a diff preview and confirmation
/deep-docs audit     # quantitative quality report with per-file scores
```

Running `/deep-docs` with no argument prompts you to choose a subcommand interactively. Codex, Copilot CLI, and Gemini CLI users invoke the same workflow with `Skill({ skill: "deep-docs:deep-docs", args: "scan|garden|audit" })`.

## Commands

| Command | Description |
|---|---|
| `/deep-docs scan` | Detect dead references, moved paths, stale examples, and duplicate blocks |
| `/deep-docs garden` | Auto-fix issues with a diff preview and user confirmation |
| `/deep-docs audit` | Score each document across size, freshness, reference accuracy, and duplication |

## Scan rules

The scanner classifies every finding into one of three categories.

### Auto-fixable (repaired by `garden`)

| Rule | Description | Fix strategy |
|---|---|---|
| Dead references | File paths, functions, or classes referenced in docs that no longer exist | Update to the current path/name, or mark as `[removed]` |
| Moved/renamed paths | References with a `git log --follow` rename history | Update to the new path automatically |
| Stale examples | CLI commands or env variables that don't match `package.json` scripts or `.env.example` | Conditional auto-fix when an exact replacement is known; code examples are audit-only |
| Duplicated instructions | Identical blocks (3+ lines, 100% match) repeated across docs | Remove duplicates; near-duplicates are audit-only |

### Audit-only (reported, never auto-fixed)

| Rule | Description | Why not auto-fixed |
|---|---|---|
| Size/organization | `CLAUDE.md`/`AGENTS.md` >100, `README.md` >300, other `docs/` >200 lines | Splitting needs structural judgment |
| Rule–code contradiction | Doc says "use snake_case" but most code uses camelCase | Architecture judgment; high false-positive risk |
| Coverage gaps | Major modules not mentioned anywhere in docs | "Major" is subjective |
| Map vs manual ratio | Ratio of direct instructions to external pointers | Optimal ratio varies per project |

### Authoring (created/restructured by `garden`)

| Rule | Description | How it is handled |
|---|---|---|
| Missing doc | A recommended `CLAUDE.md`/`AGENTS.md` (build manifest + source dirs) or `ARCHITECTURE.md` (~10k+ LOC) does not exist | `garden` drafts it from a code analysis and writes it after approval |
| Thin doc | An existing doc falls clearly short of its official skeleton | `garden` restructures it, preserving your unique content by default |

Authoring uses built-in rules from `skills/deep-docs-workflow/references/authoring-rules/` (CLAUDE.md follows Anthropic's memory guide, AGENTS.md the OpenAI Codex/agents.md standard, ARCHITECTURE.md the matklad standard). Length targets are soft for `CLAUDE.md`/`ARCHITECTURE.md` line counts (an over-long draft is reported as a non-blocking size warning, matching the line-based `audit`), while `AGENTS.md` enforces a hard 32&nbsp;KiB byte ceiling (Codex truncates beyond it) — note this byte/line asymmetry: authoring considers the Codex byte budget, `audit` stays line-based.

## Garden workflow

When you run `/deep-docs garden`, the agent:

1. **Reuses** `.deep-docs/last-scan.json` if it is fresh (under 10 minutes old, matching HEAD and worktree); otherwise re-runs the scan first.
2. **Filters to auto-fixable issues** only — size warnings stay in the audit-only summary.
3. **For each issue**, shows a diff and asks for confirmation before applying the edit.
4. **Authoring sub-flow** — for each `gaps[]` entry, `garden` spawns the read-only `doc-author` agent, receives a structured draft, captures a TOCTOU baseline (so a file changed since the scan is never silently overwritten), asks per-removal whether to apply / revise / keep, re-inserts any unapproved removals, and only then writes the file itself. `doc-author` never writes — it has no `Write` or `Bash` tool.
5. **Summarizes** fixes applied, documents authored, skipped, and audit-only items noted for reference.

Audit-only items are always shown at the end as informational notes, never modified automatically.

> **Empty/new-repo note:** authoring gaps surface through `/deep-docs scan|garden` directly. Until deep-dashboard consumes `gaps[]`, the authoring backlog for an empty or brand-new repository (no existing documents) is **not visible on the dashboard** — the document-health metrics there only count issues found in existing documents.

## Audit metrics

`/deep-docs audit` scores each document across four measurable dimensions:

| Metric | How it is measured | Scoring |
|---|---|---|
| Size | Line count vs recommended limit | `CLAUDE.md`/`AGENTS.md`: ≤100 = 10, 100–200 = 7, >200 = 4 |
| Freshness | Are any referenced paths newer than the doc? | All fresh = 10, some stale = 7, mostly stale = 4 |
| Reference accuracy | Valid references / total references | 100% = 10, 90–99% = 8, 70–89% = 5, <70% = 2 |
| Duplication | Duplicate blocks shared with other docs | 0 = 10, 1–2 = 7, ≥3 = 4 |

Freshness is path-scoped — it checks only the files each doc references, so a change to an unrelated module does not penalize your docs.

**Scoring bands:**

| Score | Band |
|---|---|
| `≥ 9.0` | Excellent |
| `7.0 ≤ score < 9.0` | Good |
| `5.0 ≤ score < 7.0` | Fair (gardening recommended) |
| `< 5.0` | Poor (immediate attention needed) |

The overall score is rounded to one decimal. If a doc has no outbound references, the freshness dimension is excluded and the remaining dimensions are averaged.

## Scan artifact

Every scan writes `.deep-docs/last-scan.json`, wrapped in the [claude-deep-suite M3 cross-plugin envelope](https://github.com/Sungmin-Cho/claude-deep-suite) (top-level `schema_version` + `envelope` + `payload`). `garden` and `audit` reuse it only when the envelope identity, schema version, 10-minute TTL, `envelope.git.head`, and `payload.provenance.worktree_hash` all match; otherwise the scan re-runs. In non-git environments only the TTL applies, and the envelope emits a sentinel `git` block.

## Links

- [CHANGELOG](CHANGELOG.md) ([한국어](CHANGELOG.ko.md)) — release history
- [claude-deep-suite](https://github.com/Sungmin-Cho/claude-deep-suite) — the marketplace and the rest of the suite
- [deep-dashboard](https://github.com/Sungmin-Cho/claude-deep-dashboard) — consumes the freshness scan metrics

## License

[MIT](LICENSE)
