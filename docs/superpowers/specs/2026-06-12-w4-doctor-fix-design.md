# W4 — `dashclaw doctor --fix`: one-command self-repair (design)

**Date:** 2026-06-12
**Status:** Approved for build (close-the-loop sprint, W4)
**Prior art:** `docs/superpowers/specs/2026-06-11-close-the-loop-design.md` (W4 = "kill the setup tax")

## Goal

One command — `dashclaw doctor` — that diagnoses every recurring DashClaw setup/drift failure across the instance, the repo checkout, and the operator machine, and (only with `--fix`) repairs everything that is provably safe to repair, then reports exactly what changed.

The sprint's hand-found incident classes become permanent checks: schema-behind-code, stale compiled `mcp-server/lib`, OpenClaw runtime plugin disabled/stale, stale global CLI shim, `.gitattributes` drift, hooks folder-trust, leaked `DASHCLAW_*` machine env, and non-ISO timestamp hygiene.

## Current state (what exists)

- **Engine** (`app/lib/doctor/engine.mjs`): pluggable `CHECK_RUNNERS` over 10 categories (`database, config, auth, deployment, sdk, governance, shape, drift, openclaw-plugin, hosted`); `runDoctor({categories, includeFixes, env, host})`; status = `healthy | needs_attention | unhealthy`.
- **Fixes** (`app/lib/doctor/fixes/index.mjs`): `FIX_REGISTRY` with 7 fixes, each scoped `local` (filesystem) or `remote` (DB-safe); `applyFix(action, params, {allowLocal})` blocks local fixes unless `allowLocal: true`.
- **API**: `GET /api/doctor` (`?category=`, `?include_fixes=`), `POST /api/doctor/fix` (always `allowLocal: false`, re-checks after).
- **Local script** (`scripts/doctor.mjs`, `npm run doctor`): imports engine directly, `allowLocal: true`, **auto-applies** fixes unless `--no-fix`.
- **CLI** (`cli/lib/doctor.js` + `cli/bin/dashclaw.js` `cmdDoctor`): remote-only — fetches `/api/doctor`, **auto-applies remote fixes by default**, `--no-fix` / `--json` / `--category`. CLI version 0.3.2.
- **MCP** (`mcp-server/src/service.ts` `doctor()` ~L807, registered in `src/tools/index.ts` ~L396): a *separate* local-readiness doctor (project/env resolution, mappings, credential env vars, audit writability). Does not call `/api/doctor`. 32 tools total.

**The gap:** no machine/repo-level checks (the actual setup tax lives there), auto-apply-by-default semantics (surprising and unsafe for a fix-capable tool), and the MCP doctor is blind to platform health.

## Check/fix catalog

Layers: `engine` = server brain (`app/lib/doctor/`), runs wherever the engine runs (API, `npm run doctor`). `cli-repo` = CLI local check that requires the cwd (or `--repo <path>`) to be a DashClaw checkout. `cli-machine` = CLI local check that always runs on the operator machine.

| # | Check id | Layer | Detection | Fix action | Idempotency | Dry-run (default) | `--fix` |
|---|----------|-------|-----------|-----------|-------------|-------------------|---------|
| 1 | `dh_timestamp_format` | engine | SQL probe over `TIMESTAMP_COLUMNS` (client-written TEXT timestamp cols): value present AND NOT ISO-8601 regex; classify parseable vs garbage | `normalize_timestamps` (scope: `remote`) | UPDATE rewrites only parseable non-ISO values to ISO; second run matches 0 rows | Reports offending row counts per table.column; garbage counted separately, never mutated | Applies UPDATE, reports exact rows changed per table.column |
| 2 | `local_mcp_lib_stale` | cli-repo | newest mtime under `mcp-server/src/**` > newest mtime under `mcp-server/lib/**`, or `lib/` missing while `src/` exists | rebuild: `npm run build` in `mcp-server/` | Rebuild from same src is deterministic; fresh build ⇒ check passes ⇒ no-op next run | Would-fix entry: "compiled lib older than src — rebuild" | Runs the build, reports pass/fail + duration |
| 3 | `local_gitattributes_drift` | cli-repo | `git status --porcelain` shows ` M .gitattributes` AND `git diff -- .gitattributes` is provably line-ending/whitespace-only (every +/- line pair differs only by `\r`/trailing whitespace) | `git checkout -- .gitattributes` (only when proof holds) | Restore-to-index; once clean, detection finds nothing | Would-fix when proof holds; **detect-only warn** when diff has real content changes | Runs checkout only under proof; content diffs always remain warn-with-instructions |
| 4 | `local_schema_behind` | cli-repo | `drizzle/*.sql` migration names vs applied set in local DB (requires `DATABASE_URL` from repo `.env*`); unreadable DB ⇒ warn (degrade, no fix offered) | `npm run db:migrate` | The migrate script is already idempotent (applied-set diff) | Would-fix entry listing pending migration files | Runs db:migrate, reports applied count |
| 5 | `local_openclaw_plugin` | cli-repo | Gateway/runtime config references a DashClaw plugin path that is missing, foreign, or version-stale | **detect-only** | n/a (no mutation) | Warn + exact remediation text | Same as dry-run (never mutates someone's gateway) |
| 6 | `local_cli_shim_stale` | cli-machine | `dashclaw --version` resolved on PATH ≠ current CLI version (semver compare; PATH miss ⇒ pass/info) | `npm i -g @dashclaw/cli` | Reinstalling the same version is a no-op; version equal ⇒ check passes | Would-fix entry showing found vs expected version | Runs global install, re-compares versions |
| 7 | `local_hooks_trust` | cli-machine | DashClaw hooks present in `~/.claude/settings.json` AND every referenced script file exists | re-run installer: in-repo `node scripts/install-hooks.mjs --global --governance`; standalone `dashclaw install claude` | Installer is already idempotent (rewrites same config) | Would-fix entry naming the missing hook/script | Runs installer, reports re-installed hook set |
| 8 | `local_env_leak` | cli-machine | `DASHCLAW_*` vars at user/machine scope (win32: `reg query HKCU\Environment` + Machine env; POSIX: grep shell profiles) that can shadow per-project config | **detect-only** | n/a (no mutation) | Warn + exact removal instructions per platform (e.g. `[Environment]::SetEnvironmentVariable('DASHCLAW_API_KEY', $null, 'User')`) | Same as dry-run (deleting user env vars is not trivially safe) |

**Brief failure-class coverage (all 8):** schema-behind-code → #4; stale mcp-server lib → #2; OpenClaw plugin disabled/stale → #5 (detect-only); stale CLI shim → #6; `.gitattributes` drift → #3; hooks folder-trust → #7; `DASHCLAW_*` env leak → #8 (detect-only); timestamp hygiene → #1.

### `dh_timestamp_format` details (engine)

New category **`data-hygiene`** registered in `CHECK_RUNNERS` + `CATEGORY_ORDER` (11th category). Probed set is a module constant `TIMESTAMP_COLUMNS` covering client-written TEXT timestamp columns (initial set, finalized in implementation): `decisions.timestamp`, `health_snapshots.timestamp`, `token_snapshots.timestamp`, `agent_connections.reported_at`, `code_sessions.started_at/ended_at`, `code_session_messages.timestamp`, `code_session_tool_uses.timestamp`.

Detection classifies non-ISO values into:
- **parseable** (e.g. `Thu Jun 11 2026 ... GMT-0400 (...)` — `new Date(v)` valid) → fixable, counted per column;
- **garbage** (`new Date(v)` invalid) → reported per column, **never mutated**.

Fix `normalize_timestamps` (scope `remote`, same trust tier as the existing `migrate` fix — idempotent normalization of parseable values only): per column, `UPDATE ... SET col = <ISO(col)> WHERE col !~ iso_regex AND <parseable>`, returns `{column, rowsChanged}` per target plus a `garbageRows` report. Second run changes 0 rows by construction. Write-time prevention already exists (`app/lib/validate.js` datetime normalization); this is the backfill + detector for rows that predate it or bypass validation.

## CLI semantics change (BREAKING for automation that relied on auto-fix)

- **`dashclaw doctor` (no flags): report-only.** Today it auto-applies remote fixes; that stops. The report merges **local checks (new module) + remote `/api/doctor` checks**, grouped per category, and prints would-fix entries (`→ would fix: ...`) for every failing check that has a fix.
- **`dashclaw doctor --fix`: applies.** Local fixes run locally (per catalog guards); remote auto-fixes go through `POST /api/doctor/fix` (unchanged contract). After applying, doctor **re-checks** and prints a **what-changed report**: one line per attempted fix (`applied | skipped | failed` + result detail), then the refreshed summary.
- **`--no-fix`: kept as a no-op alias** (it now describes the default). Accepted without error or deprecation failure.
- **`--json`: additive.** Existing shape (status/summary/checks) unchanged; local checks appear as additional check objects (same `{id, category, status, title, message, fix}` shape, categories `local-repo` / `local-machine`); a `local` boolean marks them. Parseable in every state.
- **Exit codes unchanged:** 0 = healthy, 1 = not healthy (or fetch/auth error), exactly as today (`doctorExitCode` semantics for scripts; `cli/lib/doctor.js` exit paths preserved).
- **Remote unreachable** (standalone machine use): remote section degrades to a single fail check (today's behavior was hard-exit; local checks still run and report, exit 1).
- **`scripts/doctor.mjs` (`npm run doctor`) aligned:** report-only by default, `--fix` applies (with `allowLocal: true` as today), `--no-fix` alias kept, `--strict`/`--json`/`--category` unchanged.
- **CLI version: 0.3.2 → 0.4.0** (minor bump, behavior change documented in CHANGELOG). npm publish stays owner-gated.

## MCP extension (existing `doctor` tool — count stays 32)

`mcp-server` `doctor` tool gains a read-only **`platform`** section: when `DASHCLAW_URL` + `DASHCLAW_API_KEY` are configured (same envs as `dashclaw/client.ts`), it calls `GET /api/doctor` and appends `{status, summary, checks}` (fix metadata stripped) to the report under `platform`. When not configured or the fetch fails, the section is `{available: false, reason}` — the existing local-readiness report is **byte-identical to today** in shape. No MCP-side fixes, no new tool. Tool description updated. `mcp-server/lib` **rebuilt in the same commit** as any `src/` change.

## Safety invariants

1. Every fix is idempotent — second run is a provable no-op (asserted by test per fix).
2. Default invocation applies **zero** fixes, everywhere (CLI, npm script). `--fix` is the only apply path.
3. `.gitattributes` checkout runs only under the line-ending/whitespace-only proof; any content diff stays detect-only.
4. `local_env_leak` and `local_openclaw_plugin` are permanently detect-only (warn + remediation text; tests assert no exec).
5. `POST /api/doctor/fix` keeps `allowLocal: false` and its action allowlist; `normalize_timestamps` is the only new allowlisted action (remote scope).
6. No secrets in any output: API keys redacted (reuse the CLI's existing patterns; env-leak check prints variable **names**, never values).
7. `--fix` prints the exact command/mutation per fix before result; the what-changed report is the audit trail.

## Out of scope

- Instance-side mutations beyond `normalize_timestamps` (justification: same trust tier as the existing `migrate` fix — idempotent normalization of parseable values only; everything else machine-side stays local or detect-only).
- UI changes (doctor panel untouched), SDK surface changes, new MCP tools.
- Auto-deleting user env vars or mutating gateway configs (detect-only classes).
- Backfilling/repairing garbage (unparseable) timestamp values — reported, never guessed.

## Testing

| Layer | Test files |
|-------|-----------|
| engine | `__tests__/unit/doctor-data-hygiene.test.js` (NEW: category registration, detection vs mocked sql — dirty + clean, fix row counts, garbage untouched, idempotency = second run 0 rows); `__tests__/unit/doctor.route.test.js` (EXTEND: new category in GET /api/doctor + `?category=data-hygiene` filter); `__tests__/unit/doctor-engine.test.js` (EXTEND: CATEGORY_ORDER/runner registration) |
| cli | `__tests__/unit/cli-local-doctor.test.js` (NEW: each repo/machine check with exec/FS mocked, win32 + POSIX paths; .gitattributes proof positive/negative; detect-only classes assert no exec); `__tests__/unit/doctor-cli-status.test.js` (EXTEND: report-only default = no apply calls, `--fix` applies + what-changed, `--no-fix` alias, `--json` shape, exit codes unchanged) |
| mcp-server | `mcp-server/test/tools.test.ts` (EXTEND: doctor report unchanged without credentials; `platform` section present with mocked fetch when configured; fetch failure → `{available: false}`) |
| scripts | `__tests__/unit/doctor-cli-status.test.js` exit-code helpers already cover `doctorExitCode`; `scripts/doctor.mjs` default-flip covered via the same flag-parsing conventions (manual smoke in Phase 4 preship) |

All vitest work runs in the FULL suite (`npx vitest run`); mcp-server suite runs via its own `npm test` (302 tests baseline).
