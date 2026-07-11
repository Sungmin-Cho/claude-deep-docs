# Filter: cli-whitelist

## Purpose and executable source

The executable facts are `CLI_BINARIES`, `BUILTINS_MAP`, and `SYSTEM_COMMAND_WHITELIST` in `scripts/runtime/scan.js`, plus `ScanContextV1.package_scripts`. `extractReferences()` emits an inline command as one `cli` reference when its first token is in `CLI_BINARIES`.

This reference defines semantic classification over those facts. It is not an alternate parser or command runner.

## Ordered decision contract

1. Split the extracted CLI reference into tokens for classification only. Never execute it.
2. Prefer the most specific project lookup:
   - for `npm`, `pnpm`, `yarn`, or `bun` with `run <name>`, compare `<name>` with exact `ScanContextV1.package_scripts`;
   - an absent exact package script is a stale candidate;
   - a present exact package script is valid.
3. Otherwise check the manager's exact built-in set in `BUILTINS_MAP`.
4. Otherwise check the first token against `SYSTEM_COMMAND_WHITELIST`.
5. Only when scan was invoked with explicit `--path-check-enabled` may a host executable lookup provide additional “present” evidence.
6. Anything still unknown is audit-only by default. It becomes auto-fix only when the repository supplies an exact replacement; never delete or rewrite a command merely because it is unknown.

The project-script lookup precedes the generic whitelist. This prevents a recognized package-manager binary from bypassing validation of `run missing-script`.

## Static manager facts

- Package managers: `npm`, `pnpm`, `yarn`, `bun` share the documented npm-style built-ins with their source-defined additions.
- `uv` and `poetry` have their own built-in sets. `run` is intentionally not used as a generic “always valid” escape hatch.
- `make` has no source-defined built-ins; a target not represented by deterministic scan facts is audit-only unless semantic evidence proves it.
- `just` recognizes only its source-defined built-ins.

Unknown future subcommands are audit-only, not auto-fix. Updating a source allowlist is a tested runtime change, not an ad-hoc scanner exception.

## Static system-binary set

`SYSTEM_COMMAND_WHITELIST` is the exact source-defined set. It covers version control, language/build tools, package installers, test runners, search/file utilities, network/deployment tools, shells/runtimes, data/archive tools, and checksum utilities. Representative literal members include `git`, `cargo`, `go`, `dotnet`, `pytest`, `node`, `python3`, `rg`, `find`, `jq`, `xargs`, `docker`, `kubectl`, `terraform`, `gh`, `curl`, `ssh`, `tar`, `openssl`, and `shasum`.

These names are classification data, not permission to execute them. The scanner's terminal capability remains limited to the quoted deep-docs Node runtime.

## Optional host path check

Host lookup is disabled by default because it makes results machine-dependent. It is considered only when `scan-context` receives the literal `--path-check-enabled` flag.

When enabled:

- `ScanContextV1.path_check_enabled` is true;
- emitted payload provenance records the flag;
- `reuse` requires the current setting to match the artifact setting;
- “not found” remains classification evidence, never authority to execute a command.

The scanner must not read an environment toggle or silently enable this feature.

## Edge matrix

| Reference | Deterministic result |
|---|---|
| `npm run test` and `test` is in `package_scripts` | valid |
| `npm run missing` and `missing` is absent | stale candidate |
| `npm test` | valid source-defined built-in |
| known system binary with arguments | valid static command |
| unknown manager subcommand | audit-only by default |
| unknown binary with path check disabled | audit-only |
| unknown binary found with explicit path check | valid with host-dependent provenance |
| command with exact manifest-backed replacement | eligible stale auto-fix with that evidence |

## Failure behavior and integration

- Malformed or empty values are not executed and cannot become an auto-fix.
- Quoting is not interpreted as shell syntax; the scanner treats the extracted text as documentary content.
- `reference-extraction.md` owns CLI-first extraction. This file owns only stale classification.
- A stale result is emitted as `stale-example`; category is auto-fix only with an exact suggested value, otherwise audit-only.
