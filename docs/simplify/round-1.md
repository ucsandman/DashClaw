# Round 1: helper unification

Branch `simplify/round-1`, base `54f37f5d` (main `d6b6b42c` + the phase-0 tooling commit). Numbers from `node scripts/loc-report.mjs`; invariants from `node --import tsx scripts/simplify-invariants.mjs`.

## Baseline column vs after

| Metric | Baseline (main) | After round 1 | Delta |
|---|---:|---:|---:|
| Source files | 820 | 827 | +7 (5 new helper modules, 2 phase-0 tooling scripts) |
| Source LOC | 163,106 | 163,439 | +333 raw; **-170 excluding the 503-line phase-0 tooling** (`scripts/loc-report.mjs`, `scripts/simplify-invariants.mjs`) |
| Source code lines | 134,229 | 134,498 | +269 raw, same tooling caveat |
| app/api LOC | 15,512 | 15,418 | -94 |
| app/lib LOC | 48,790 | 48,762 | -28 (net of three new modules) |
| app/(pages) LOC | 37,278 | 37,260 | -18 (net of one new module) |
| scripts LOC | 26,136 | 26,609 | +473 (= +503 tooling, -30 unification) |
| Files >= 1,500 LOC | 9 | 9 | 0 |
| Functions >= 150 LOC | 115 | 115 | 0 |
| Same-name clusters, similarity >= 0.60 | 70 | 57 | -13 |
| Structural clones | 17 | 12 | -5 |

The per-file diff is `27 files changed, 82 insertions(+), 355 deletions(-)` plus five new modules (`app/lib/api-keys.ts`, `app/lib/redis-command.ts`, `app/lib/outcome-timeout.ts`, `app/policies/lib/errorFrom.ts`, `scripts/lib/python-candidates.mjs`).

## What moved

| Helper | Copies deleted | Now lives in |
|---|---:|---|
| `hashKey`, `generateApiKey` | 3 (+1 composed) | `app/lib/api-keys.ts` (hosted-workspace.repository keeps its `{plaintext,keyHash,keyPrefix}` wrapper, now composed from the two) |
| `parseRules` | 2 | `app/lib/guardrails/short-list.ts` (inert-policies, misfireClient) |
| `errorFrom` | 4 | `app/policies/lib/errorFrom.ts` |
| memoized `getSql` wrapper | 2 | `app/lib/db.ts` `getSql` (already memoized via `globalThis`) |
| `RedisCommandTimeout`, `withCommandTimeout`, `safeDisconnect` | 2 | `app/lib/redis-command.ts` |
| `resolveTimeoutMinutes` / `resolveOutcomeTimeoutMinutes` | 3 | `app/lib/outcome-timeout.ts` `getOutcomeTimeoutMinutes` (actions.repository keeps its dynamic-import wrapper name) |
| `isStaleCustomerError` | 2 | `app/lib/billing-stripe.ts` |
| `buildPinnedDispatcher` | 1 | `app/lib/url-safety.ts` (canonical, with the `Array.isArray` guard the webhooks test asserts); `app/lib/webhooks.ts` re-exports it |
| `isWindows`, `getCandidates` | 2 | `scripts/lib/python-candidates.mjs` |
| `getInventoryJsonPath`, `getInventoryMarkdownPath` | 2 | exported from `scripts/generate-api-inventory.mjs` |

## Invariant diffs (all identical)

`diff -r <main snapshot> <round-1 snapshot>` over the 8 entries: **empty**.

| Invariant | Result |
|---|---|
| `docs/openapi/**`, `contracts/**`, `docs/api-inventory.{json,md}`, `drizzle/*.sql`, `schema/schema.js` (92 sha256 lines) | identical |
| MCP tool list + input schemas (17 tools, 3 resources, listed through the protocol on an in-memory server) | identical |
| Node SDK exports (CJS + ESM names, `DashClaw.prototype`, instance namespaces) | identical |
| Python SDK `__all__` + public `DashClaw` attributes | identical |
| CLI `--help` (top level + every subcommand, 1,540 lines) | identical |
| Guard calibration replay (43 golden vectors: `computeRiskScore`, `classifyAct`, `evidenceTotal`, flags) | identical |
| Hook stdout/exit on 13 fixed payloads (pretool, posttool, stop, db_containment, liveness probe) | identical |
| `node scripts/check-doc-counts.mjs` | identical, "all gated counts match source-of-truth" |
| Policy smoke harness (`scripts/policy-smoke.mjs` against `next start` of main and of the branch, same local DB) | `137 checks, 108 passed, 29 failed` on both; after normalizing generated ids the diff is only the two wrapper stack traces (worktree path, pid). The 29 failures are pre-existing on main (local approval 403 `SELF_APPROVAL_FORBIDDEN` family: A6, AE, AF2/3/6, AH5/6, T1, Z1/3/4/5, plus D1, DV1-4, F1, RS1, U4). |

## Gate output (read, not summarized)

| Gate | Output |
|---|---|
| `npm run lint` | `✖ 4 problems (0 errors, 4 warnings)` — the 4 warnings are pre-existing `no-location-assign-relative-destination` in UserMenu.tsx, page.tsx, LocalPasswordForm.tsx, ConnectNextStepPanel.tsx (untouched) |
| `npm run typecheck` | exit 0, no output |
| `npx vitest run --maxWorkers=2` | `Test Files  517 passed | 1 skipped (518)`, `Tests  5360 passed | 5 skipped (5365)` |
| `npx next build` | `✓ Compiled successfully in 6.4s`; 1 pre-existing Turbopack warning (`app/lib/widget/presence.ts:60` dynamic fs access) |
| `npm run openapi:check` | exit 0 |
| `npm run api:inventory:check` | `API inventory artifacts are up to date.` |
| `npm run route-sql:check` | exit 0 (no route gained direct SQL; two routes lost a memoization wrapper, no SQL moved) |
| `npm run version:check` | `OK no hardcoded version drift found (canonical: 5.33.1, 3.2.0, 3.1.5)` |
| `npm run doc:counts` | `doc-counts: all gated counts match source-of-truth.` |
| `npm run hooks:test:python` | sdk-python `Ran 133 tests OK`; hooks `Ran 776 tests OK (skipped=3)` |

Test files edited: **0**.

## DEVIATIONS

1. `redactAny` in `app/lib/guard/evaluate.ts` was NOT unified with `app/lib/security.ts`. About 20 test files mock `@/lib/security.js` with a literal `{ scanSensitiveData }` factory; importing `redactAny` from that module fails under those mocks (`No redactAny export is defined on the mock`) in 205 tests. Fixing that means editing test mocks, which this work forbids. The copy stays; it is listed in THINGS LEFT UNTOUCHED.
2. `parseRules` in `app/lib/policy-tuning/engine.ts` and `app/lib/posture/loosening.ts` was NOT unified. Both sit in the guard evaluation import chain; importing `guardrails/short-list.ts` pulls `POLICY_TYPES` from `validate.js` at module scope, and 7 guard-route test files mock `@/lib/validate` without it. Same reason, same outcome: left in place.
3. `getOutcomeTimeoutMinutes` lives in a new `app/lib/outcome-timeout.ts`, not in `settings.repository.ts` as planned. The two sweep route tests mock the settings module with a literal `{ getSettings }` factory; a helper inside that module would be mocked away. A separate module that itself calls `getSettings` is test-transparent.
4. `FLOOR_TIMEOUT_MINUTES` stays in `app/api/cron/outcome-sweep/route.ts`: it has a second use (`listOrgsWithStaleOutcomes(sql, FLOOR_TIMEOUT_MINUTES)`).
5. `scripts/loc-report.mjs` now lists tracked **and** untracked source files (`git ls-files --cached --others --exclude-standard`); the first version missed new modules until they were staged. The baseline numbers are unaffected (no untracked source existed at baseline time).
6. The main-vs-branch smoke replay needed a second built tree. A junction of `node_modules` into a scratch worktree broke Turbopack (`Symlink [project]/node_modules is invalid`), and `git worktree remove --force` on that scratch worktree followed the junction and emptied the main tree's `node_modules`. Restored with `npm ci` (666 packages); the main worktree now lives at `.worktrees/simplify-main` with its own `npm ci`. No source file was affected (verified by `git status`).

## THINGS LEFT UNTOUCHED

- Same-name clusters whose bodies differ: `toIso` x5, `safeJsonParse` x3, `formatDate` x3, `timeAgo` x3, `withAbort` x2, `decisionSummary` x3, `CopyButton` x5, `handleCopy` x5, `parseArgs` x13, `ensureTable` x5, `walkRouteFiles` x3 (route-sql-guard skips `_archive`, the inventory walker does not).
- Deliberate mirrors: `cli/lib/contained.js` vs `app/lib/guard/containment.ts` (CLI is a separate package by design), `middleware.js` `looksLikeJwt` (edge runtime cannot import `url-safety`), `cli/lib/config.js` vs `mcp-server/src/client.ts` `warnIfInsecureBaseUrl`.
- Trivial (< 5 lines): `pct`, `invalid`, `isShortString`, `isPemPublicKey`, `sleep`, `normalize`, `sameList`, `log` x14 in migration scripts.
- The two blocked unifications above (`redactAny`, `parseRules` in the guard chain) and the `parseRules` variants with different semantics (see found-bugs #2).
- `app/api/setup/ping/route.ts` `hashKey`: async WebCrypto variant, different on purpose.
- Everything under `sdk/`, `sdk-python/`, `mcp-server/`, `cli/`, `hooks/`, `schema/`, `drizzle/`.
