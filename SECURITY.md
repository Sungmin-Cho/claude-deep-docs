# Security Policy

## Supported versions

Security fixes are delivered through the latest release of deep-docs. Check the current
version with `jq -r .version .claude-plugin/plugin.json`.

## Reporting a vulnerability

Please report security issues **privately** via
[GitHub Security Advisories](https://github.com/Sungmin-Cho/claude-deep-docs/security/advisories/new)
rather than opening a public issue.

We aim to acknowledge reports within a few days and will coordinate a fix and a
disclosure timeline with you.

## Scope

deep-docs runs inside the Claude Code / Codex plugin runtime and **reads and edits files
in the working tree** — specifically agent-instruction documents such as `CLAUDE.md`,
`AGENTS.md`, and project docs.

- The `garden` subcommand applies edits to these files, always behind a diff preview and
  explicit per-fix confirmation; review each diff before approving.
- The `scan` subcommand writes a `.deep-docs/last-scan.json` artifact into the working
  project; it does not transmit anything off the machine.

When reporting, please indicate the runtime and the document surface affected.
