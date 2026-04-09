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
| Size/Organization | CLAUDE.md or AGENTS.md exceeding 200 lines | Suggest splitting (proposal only, not automatic) |

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
| 9–10 | Excellent |
| 7–8 | Good |
| 5–6 | Fair (gardening recommended) |
| 1–4 | Poor (immediate attention needed) |

The overall score is the average of all measurable dimensions. If a doc has no outbound references (freshness cannot be measured), that dimension is excluded and the remaining dimensions are averaged instead.

## Configuration

Deep Docs requires no configuration file. It creates `.deep-docs/` automatically on first run.

### Scan artifact: `.deep-docs/last-scan.json`

Every scan writes a durable artifact with full provenance:

```json
{
  "scanned_at": "2026-04-08T14:30:00Z",
  "provenance": {
    "head_sha": "abc123",
    "branch": "main",
    "is_git": true
  },
  "documents": [
    {
      "path": "CLAUDE.md",
      "issues": [...],
      "metrics": {
        "size_lines": 85,
        "freshness_score": 6,
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
```

`garden` and `audit` reuse this artifact if:
- It is less than **10 minutes old**, and
- The stored `head_sha` matches the current `git rev-parse HEAD`

In non-git environments, only the 10-minute TTL applies. If either condition fails, the scan runs again automatically before proceeding.

## Installation

```bash
claude plugin add deep-docs
```

## License

MIT
