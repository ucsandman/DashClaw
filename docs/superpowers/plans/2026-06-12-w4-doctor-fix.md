# W4 — `dashclaw doctor --fix` implementation plan (TDD)

**Spec:** `docs/superpowers/specs/2026-06-12-w4-doctor-fix-design.md`
**Phases:** supergoal Phase 2 = T1–T3 (engine), Phase 3 = T4–T8 (CLI + MCP + docs). Ship = Phase 4 (v4.16.0).

Conventions: tests live in repo-root `__tests__/unit/`; mock `sql` per `reference_dashclaw_sql_fragment_test_gotcha`; exec/FS mocked in CLI tests (no real `git`/`npm`/registry calls); every task ends with the touched test file green and no other suite regressions.

## Phase 2 — engine (T1–T3)

### T1 — data-hygiene check module · sequential (T2 depends on it)
- **Target:** `app/lib/doctor/checks/data-hygiene.mjs` (NEW), `app/lib/doctor/engine.mjs` (register `data-hygiene` in CHECK_RUNNERS + CATEGORY_ORDER).
- **Tests:** `__tests__/unit/doctor-data-hygiene.test.js` (NEW); extend `__tests__/unit/doctor-engine.test.js` for the 11th category.
- **TDD order:** (1) RED — test: `runChecks` flags a mocked column with 3 parseable non-ISO + 1 garbage value (expect fail check w/ counts, garbage counted separately); test: clean data ⇒ pass check. (2) RED — engine test: `data-hygiene` present in category order/runners. (3) GREEN — implement `TIMESTAMP_COLUMNS` constant + SQL probe + classification; register in engine. (4) Refactor.

### T2 — normalize_timestamps fix · sequential (after T1)
- **Target:** `app/lib/doctor/fixes/normalize-timestamps.mjs` (NEW), `app/lib/doctor/fixes/index.mjs` (FIX_REGISTRY entry, scope `remote`).
- **Tests:** same file `doctor-data-hygiene.test.js`.
- **TDD order:** (1) RED — test: fix updates only parseable non-ISO values (mocked sql returns rowCount per column), reports `{column, rowsChanged}` list + garbage report; ISO + garbage untouched (assert UPDATE WHERE shape / no second mutation call). (2) RED — idempotency: second run (mock returns 0 rowCount) reports 0 rows changed. (3) RED — registry: `applyFix('normalize_timestamps')` routes with `allowLocal: false` (remote scope passes). (4) GREEN — implement. (5) Refactor.

### T3 — route exposure · parallelizable with T2
- **Target:** none expected (`app/api/doctor/route` is engine-driven); extend tests only — plus `POST /api/doctor/fix` allowlist if action list is explicit.
- **Tests:** extend `__tests__/unit/doctor.route.test.js`.
- **TDD order:** (1) RED — GET /api/doctor includes `data-hygiene` checks; `?category=data-hygiene` filters to it; `?category=database` excludes it. (2) RED — POST /api/doctor/fix accepts `normalize_timestamps` (mocked engine) and still rejects local-scope actions. (3) GREEN — only if route hardcodes category/action lists; otherwise tests pass against T1/T2 work.

## Phase 3 — CLI + MCP + docs (T4–T8)

### T4 — CLI local-doctor module: repo-aware checks · parallelizable with T5 (same NEW file — do T4 then T5, or one implementer for both)
- **Target:** `cli/lib/local-doctor.js` (NEW) — checks #2 `local_mcp_lib_stale`, #3 `local_gitattributes_drift`, #4 `local_schema_behind`, #5 `local_openclaw_plugin` (detect-only), repo-root resolution (cwd or `--repo`).
- **Tests:** `__tests__/unit/cli-local-doctor.test.js` (NEW), exec/FS fully mocked, win32 + POSIX path cases.
- **TDD order per check:** RED detection-positive → RED detection-negative (pass) → RED fix-guard (e.g. .gitattributes content-diff ⇒ detect-only warn, no exec; openclaw ⇒ assert no exec ever) → GREEN implement → next check.

### T5 — CLI machine checks · sequential after T4 (same module/file)
- **Target:** `cli/lib/local-doctor.js` — checks #6 `local_cli_shim_stale`, #7 `local_hooks_trust`, #8 `local_env_leak` (detect-only).
- **Tests:** same `cli-local-doctor.test.js`.
- **TDD order:** RED shim version-mismatch flags / equal passes / PATH-miss passes → RED hooks missing-script flags, intact passes → RED env-leak: vars found ⇒ warn with names-not-values + removal text, assert NO exec of any mutation → GREEN implement each.

### T6 — doctor.js + bin wiring: merged report, default flip, --fix · sequential (depends T4+T5; integrates everything)
- **Target:** `cli/lib/doctor.js` (merge local+remote, report-only default, `--fix` apply path + what-changed report + re-check, remote-unreachable degrade), `cli/bin/dashclaw.js` (`--fix`/`--repo` flags, help text), `scripts/doctor.mjs` (default flip to report-only, `--fix` opt-in).
- **Tests:** extend `__tests__/unit/doctor-cli-status.test.js` (+ new describe blocks): no-flags ⇒ apply spies NOT called + would-fix lines rendered; `--fix` ⇒ applies (local spies called, remote POST mocked) + what-changed report + re-check; `--no-fix` accepted; `--json` includes local checks w/ `local: true`; exit codes unchanged.
- **TDD order:** (1) RED default-no-apply test against current code (fails — today auto-applies) → GREEN flip. (2) RED --fix path → GREEN. (3) RED merged-report/json/degrade cases → GREEN. (4) Align `scripts/doctor.mjs`, rerun doctor-cli-status suite.

### T7 — MCP platform section · parallelizable with T4–T6
- **Target:** `mcp-server/src/service.ts` `doctor()` (+ helper for platform fetch), `mcp-server/src/tools/index.ts` (description text), **rebuild `mcp-server/lib` in the same commit**.
- **Tests:** extend `mcp-server/test/tools.test.ts`: no credentials ⇒ report shape unchanged (no `platform` or `{available:false}` per spec); credentials + mocked fetch ⇒ `platform.{status,summary,checks}` with fix metadata stripped; fetch error ⇒ `{available:false, reason}`.
- **TDD order:** RED all three cases → GREEN implement → `npm run build` in mcp-server → `npm test` (302+ baseline).

### T8 — docs + version · sequential, last (after T6/T7 behavior is final)
- **Target:** `cli/package.json` 0.3.2→0.4.0, `cli/README.md` (doctor section: default flip, --fix, local checks), README/PROJECT_DETAILS doctor mentions, CHANGELOG draft note (breaking: CLI no longer auto-fixes by default), doc-count gates re-run.
- **Tests:** none new — `node scripts/check-doc-counts.mjs --strict` + full gates.

## Parallelization summary

| Task | Parallel? | Notes |
|------|-----------|-------|
| T1 | sequential first | foundation for T2/T3 |
| T2 | after T1 | same test file as T1 |
| T3 | parallel with T2 | different test file |
| T4 | parallel with T7 | NEW cli module |
| T5 | after T4 | same module |
| T6 | after T4+T5 | integration |
| T7 | parallel with T4–T6 | isolated package (lib rebuild in-commit) |
| T8 | last | docs reflect final behavior |

Gates after each phase: `npm run lint` · `npm run typecheck` · `npx vitest run` (FULL) · `npx next build` · `npm run route-sql:check` · `node scripts/check-doc-counts.mjs --strict` · (Phase 3) mcp-server `npm test`.
