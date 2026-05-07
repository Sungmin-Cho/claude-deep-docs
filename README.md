**English** | [한국어](./README.ko.md)

# Deep Docs Plugin

A document gardening agent that validates freshness and auto-repairs agent instruction files (CLAUDE.md, AGENTS.md, and project docs).

> "Too many instructions stop being instructions. They rot fast."
> — OpenAI, Harness Engineering

### Role in Harness Engineering

deep-docs operates in two quadrants of the [Harness Engineering](https://martinfowler.com/articles/harness-engineering.html) framework within the [Deep Suite](https://github.com/Sungmin-Cho/claude-deep-suite) ecosystem:

- **Inferential Guide**: Maintains the quality of agent instruction documents (CLAUDE.md, AGENTS.md), ensuring guides remain accurate and up-to-date
- **Computational Sensor**: The doc freshness scan (`last-scan.json`) provides deterministic document health metrics consumed by [deep-dashboard](https://github.com/Sungmin-Cho/claude-deep-dashboard) in the Continuous timing band

## The Problem

Agent instruction documents go stale quickly. As your codebase evolves, CLAUDE.md and AGENTS.md accumulate dead references, moved paths, and outdated examples. When agents work from stale docs, they make decisions based on information that no longer reflects reality — wrong file paths, deprecated commands, removed functions.

Manual upkeep is tedious and easy to forget. The gap between documentation and code widens silently until it causes real problems.

## The Solution

Deep Docs provides three subcommands that work together as a gardening workflow:

- **scan** detects the gap between your docs and your codebase
- **garden** auto-repairs what can be safely fixed, with your confirmation
- **audit** gives you a quantitative quality score across all doc files

## Key Commands

| Command | Description |
|---------|-------------|
| `/deep-docs scan` | Detect stale references, moved paths, and outdated examples |
| `/deep-docs garden` | Auto-fix issues with diff preview and user confirmation |
| `/deep-docs audit` | Quantitative quality report with per-file scores |

Running `/deep-docs` without arguments prompts you to choose a subcommand interactively.

## Scan Rules

The scanner classifies every finding into one of two categories:

### Auto-fixable (repaired by `garden`)

| Rule | Description | Fix Strategy |
|------|-------------|--------------|
| Dead References | File paths, functions, or classes referenced in docs that no longer exist in code | Update to current path/name, or mark as `[removed]` |
| Moved/Renamed Paths | References that don't exist but have a `git log --follow` rename history | Update to new path automatically |
| Stale Examples | CLI commands or env variables in docs that don't match `package.json` scripts or `.env.example` | Conditional auto-fix when exact replacement is known; code examples are audit-only |
| Duplicated Instructions | Identical blocks (3+ lines, 100% match) repeated across multiple docs | Remove duplicates; near-duplicates are audit-only |
| Size/Organization | CLAUDE.md/AGENTS.md >100, README.md >300, other docs/ >200 | Suggest splitting (proposal only, not automatic) |

### Audit-only (reported but not auto-fixed)

| Rule | Description | Why Not Auto-fixed |
|------|-------------|-------------------|
| Rule-Code Contradiction | Doc says "use snake_case" but 72% of code uses camelCase | Requires architecture judgment; high false-positive risk |
| Coverage Gaps | Major modules in `src/` not mentioned anywhere in docs | "Major" is subjective |
| Map vs Manual Ratio | Ratio of direct instructions vs external pointers/links | Optimal ratio varies per project |

## Garden Workflow

When you run `/deep-docs garden`, the agent:

1. **Loads scan results** from `.deep-docs/last-scan.json` if it is less than 10 minutes old and the HEAD SHA matches the current commit. Otherwise re-runs the scan first.
2. **Filters to auto-fixable issues** only (dead references, moved paths, confirmed stale examples, exact duplicates, size warnings).
3. **For each issue**, shows a diff and asks for confirmation:
   ```
   ## Fix 1/3: CLAUDE.md — Dead Reference

   - `src/auth/middleware.ts` → `src/auth/auth-middleware.ts` (git rename detected)

   Apply this fix?
   ```
4. **Applies the edit** with the Edit tool after you confirm.
5. **Summarizes** fixes applied, skipped, and audit-only items noted for reference.

Audit-only items are always shown at the end as informational notes, never modified automatically.

## Audit Metrics

`/deep-docs audit` scores each document across four measurable dimensions:

| Metric | How It Is Measured | Scoring |
|--------|--------------------|---------|
| Size | Line count vs recommended limit | CLAUDE.md/AGENTS.md: ≤100 lines = 10, 100–200 = 7, >200 = 4 |
| Freshness | `git log` timestamps: are any referenced paths newer than the doc? | All fresh = 10, some stale = 7, mostly stale = 4 |
| Reference Accuracy | Valid references / total references | 100% = 10, 90–99% = 8, 70–89% = 5, <70% = 2 |
| Duplication | Count of duplicate blocks shared with other docs | 0 = 10, 1–2 = 7, ≥3 = 4 |

Freshness is path-scoped: it checks the referenced files in each doc rather than the whole repo, so a change to an unrelated module does not penalize your docs.

**Scoring bands:**

| Score | Band |
|-------|------|
| `≥ 9.0` | Excellent |
| `7.0 ≤ score < 9.0` | Good |
| `5.0 ≤ score < 7.0` | Fair (gardening recommended) |
| `< 5.0` | Poor (immediate attention needed) |

The overall score is rounded to 1 decimal (e.g., `8.5`). If a doc has no outbound references (freshness cannot be measured), that dimension is excluded and the remaining dimensions are averaged instead.

## Configuration

Deep Docs requires no configuration file. It creates `.deep-docs/` automatically on first run.

### Scan artifact: `.deep-docs/last-scan.json`

Every scan writes a durable artifact wrapped in the **claude-deep-suite M3 cross-plugin envelope** (see `claude-deep-suite/docs/envelope-migration.md`):

```json
{
  "$schema": "https://raw.githubusercontent.com/Sungmin-Cho/claude-deep-suite/main/schemas/artifact-envelope.schema.json",
  "schema_version": "1.0",
  "envelope": {
    "producer": "deep-docs",
    "producer_version": "1.2.0",
    "artifact_kind": "last-scan",
    "run_id": "01KR0J7WBXJS57PBM04MYPHENX",
    "generated_at": "2026-05-07T14:30:00Z",
    "schema": { "name": "last-scan", "version": "1.0" },
    "git": { "head": "abc1234", "branch": "main", "dirty": false },
    "provenance": {
      "source_artifacts": [
        { "path": "CLAUDE.md" },
        { "path": "README.md" }
      ],
      "tool_versions": { "node": "v20.x", "python": "3.12.x" }
    }
  },
  "payload": {
    "provenance": {
      "is_git": true,
      "worktree_hash": "3f8a..."
    },
    "documents": [
      {
        "path": "CLAUDE.md",
        "issues": [...],
        "metrics": {
          "size_lines": 85,
          "freshness_score": 7,
          "reference_accuracy": 0.85,
          "duplication_count": 1
        }
      }
    ],
    "summary": {
      "total_issues": 5,
      "auto_fixable": 3,
      "audit_only": 2
    }
  }
}
```

`garden` and `audit` reuse this artifact if ALL hold (envelope-aware, 4-factor):
- `schema_version === "1.0"` AND `envelope.schema.version === "1.0"`
- `envelope.generated_at` within **10 minutes**
- `envelope.git.head` matches `git rev-parse HEAD` (git env)
- `payload.provenance.worktree_hash` matches recomputation (git env)

Legacy v1.1.0 shape (`schema_version: 2` numeric, `scanned_at` at root, `provenance.head_sha`) auto-fails check 1 → re-scan triggered. The 10-minute TTL absorbs migration; no upgrade tooling needed.

The `worktree_hash` covers tracked diff + untracked file list/content (NUL-safe, per-file git-hash-object). See `scan-filters/worktree-hash.md`.

In non-git environments, only the 10-minute TTL applies. Envelope emits sentinel `git = { "head": "0000000", "branch": "HEAD", "dirty": "unknown" }`.

## Installation

### From Claude Code Marketplace

```bash
claude plugin add deep-docs
```

### From Git URL (development / pre-release)

```bash
claude plugin add https://github.com/Sungmin-Cho/claude-deep-docs.git
```

After install, run `/deep-docs` in any project directory. The plugin auto-creates `.deep-docs/` on first use.

## License

MIT
