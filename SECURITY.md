# Security Policy

## Supported versions

Security fixes are delivered through the latest release of deep-docs. Check the current
version with `node -p "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')).version"`.

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

## Filesystem containment boundary

Before supported path-based I/O, the bundled Node.js 22 runtime uses `lstat` on
the target components and `realpath` on the root and physical parent. It rejects
every pre-existing symlink or junction, non-directory parent, and containment or
parent-identity mismatch. Immediately before each read, exclusive temporary-file
open, and rename, it repeats the physical-parent and target checks.

Cleanup removes only a runtime-created temporary file, and only after a fresh
validation proves that its parent is still the originally validated physical
parent. If that proof fails, the runtime closes the handle and refuses to traverse
the replacement path.

A malicious same-user process can still replace a component after the final
validation and before the path-based syscall. Node.js 22 has no portable `dirfd`,
`openat`, or `renameat` no-follow API across all three supported operating systems;
this residual post-validation/pre-syscall window is accepted and must be included
in vulnerability analysis. The enforced boundary covers pre-existing escapes and
swaps observed by immediate revalidation, without claiming protection from an
unobserved concurrent replacement in that window.

When reporting, please indicate the runtime and the document surface affected.
