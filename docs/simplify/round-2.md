# Round 2: god-file decomposition

Branch `simplify/round-2`, base `f96fed8b` (main, v5.33.2). Numbers from `node scripts/loc-report.mjs`; invariants from `node --import tsx scripts/simplify-invariants.mjs` diffed against a snapshot of main taken in the `.worktrees/simplify-main` checkout of `f96fed8b`.

## Baseline column vs after

| Metric | Baseline (main d6b6b42c) | After round 1 | After round 2 | Round-2 delta |
|---|---:|---:|---:|---:|
| Source files | 820 | 827 | 849 | +22 (topic siblings) |
| Source LOC | 163,106 | 163,439 | 163,723 | +284 (import/export lines and facade headers; every function body is byte-identical) |
| Source code lines | 134,229 | 134,498 | 134,766 | +268 |
| Functions | 7,940 | 7,994 | 7,995 | +1 |
| Files >= 1,500 LOC | 9 | 9 | **5** | -4; the five left are `scripts/hn_readiness.py`, `hooks/dashclaw_pretool.py`, `schema/schema.js`, `scripts/policy-smoke.mjs`, `scripts/migrate-multi-tenant.mjs`, all excluded by the plan |
| Functions >= 150 LOC | 115 | 115 | 115 | 0 (decomposition splits files, not functions) |
| app/api LOC | 15,512 | 15,418 | 15,015 | -403 (guard route helpers now live in app/lib/guard) |
| app/lib LOC | 48,790 | 48,762 | 49,424 | +662 (+403 from the route, +259 headers/imports across 20 new files) |
| (root) LOC | 2,534 | 2,534 | 2,558 | +24 (middleware siblings) |

## What was split

| Original | Before | After (facade) | Siblings (LOC) |
|---|---:|---:|---|
| app/lib/repositories/actions.repository.ts | 2,601 | 63 (explicit named re-exports) | shared 27, approvals 593, list 354, create 462, outcome 535, trace 311, stats 162, delete 153 |
| app/lib/guard/evaluate.ts | 1,804 | 416 (`evaluateGuard` + type re-exports) | accumulator 170, external 184, types 35, grants 529, checks 343, finalize 241 |
| app/lib/demo/demoMiddleware.ts | 1,700 | 58 (explicit named re-exports) | actions 671, policies 599, sessions 272, misc 164 |
| middleware.js | 2,096 | 1,258 | middleware.demo.js 693, middleware.shared.js 169 |
| app/api/guard/route.ts | 702 | 299 (POST, GET, config) | app/lib/guard/route-record.ts 250, app/lib/guard/route-replay.ts 164 |

Body identity was proved mechanically by each worker (line-multiset / range reconstruction against `git show HEAD:<file>`), and re-checked here: the runtime export name sets of the three facades equal HEAD (actions.repository 49/49, evaluate 1/1 plus 4 type re-exports, demoMiddleware 48/48), `middleware.js` exports are exactly `invalidateApiKeyCache, __cacheStatsForTesting, middleware, config`, and `app/api/guard/route.ts` exports exactly `dynamic, revalidate, POST, GET`. `git ls-files app/api | grep -v route.` is still empty.

Newly `export`ed private names (visible only to siblings, not on any facade): 32 in the evaluate siblings, 4 in demoMiddleware siblings (`AnyRecord`, `demoTestEval`, `demoAgentIdList`, `buildDemoSessionList`, `buildDemoSessionActions`), 4 in actions.repository.shared (`Row`, `SqlClient`, `boundedIdText`, `sqlFragment`), 7 in middleware.shared.js, 3 in middleware.demo.js.

## Invariant diffs (all identical)

`diff -r <main v5.33.2 snapshot> <round-2 snapshot>`: **empty** (8 entries).

| Invariant | Result |
|---|---|
| `docs/openapi/**`, `contracts/**`, `docs/api-inventory.{json,md}`, `drizzle/*.sql`, `schema/schema.js` (92 files, CRLF-normalized sha256) | identical |
| MCP tool list + input schemas (17 tools, 3 resources) | identical |
| Node SDK exports | identical |
| Python SDK `__all__` + public attributes | identical |
| CLI `--help` (all subcommands) | identical |
| Guard calibration replay (43 vectors) | identical |
| Hook stdout/exit (13 payloads) | identical |
| `check-doc-counts` | identical |
| Policy smoke harness, `next start` of main (worktree, port 3001) vs branch (port 3000), same DB | `137 checks, 108 passed, 29 failed` on both; normalized diff **0 lines** |

## Gate output

| Gate | Output |
|---|---|
| `npm run lint` | `✖ 4 problems (0 errors, 4 warnings)` (same 4 pre-existing warnings as round 1) |
| `npm run typecheck` | exit 0 |
| `npx vitest run --maxWorkers=2` (final tree) | `Test Files  517 passed | 1 skipped (518)`, `Tests  5360 passed | 5 skipped (5365)` |
| `npx next build` | `✓ Compiled successfully in 7.4s`, `ƒ Proxy (Middleware)` present |
| `npm run openapi:check` | `OpenAPI artifact is up to date` |
| `npm run api:inventory:check` | `API inventory artifacts are up to date.` |
| `npm run route-sql:check` | `no direct SQL usage increases (current total 23, baseline total 23)` |
| `npm run version:check` | `OK no hardcoded version drift found` |
| `npm run doc:counts` | `all gated counts match source-of-truth.` |

Test files edited: **0**.

## DEVIATIONS

1. `app/api/guard/route.ts` helpers went to `app/lib/guard/route-record.ts` and `route-replay.ts`, not to `route.<topic>.ts` siblings: Next.js rejects extra exports from a route file and the repo keeps only `route.*` files under `app/api/`.
2. The actions.repository facade uses explicit named re-exports instead of `export *`. Under tsx (Node CJS interop, used by `app/lib/doctor/checks/write-canary.mjs` and the scripts) a star-only facade exposes no named exports (`Object.keys` gave `default, module.exports`); vitest and Turbopack were unaffected, but the surface must be identical under every loader.
3. `GuardOptions` / `GuardPhaseDeps` live in `evaluate.types.ts` (used by three siblings); one type-only import cycle exists between `evaluate.checks.ts` and `evaluate.finalize.ts` (erased at runtime).
4. `middleware.shared.js` was added beyond the planned `middleware.demo.js`: the demo block calls seven helpers (`withCors`, `checkRateLimit`, …) that the auth path also uses; a shared sibling avoids a runtime cycle.
5. The invariant baseline was recaptured at v5.33.2 in the main worktree (the round-1 release changed the OpenAPI version field and release plan). The worktree checkout carries CRLF on SQL/JSON, so `contracts.sha256` now hashes CRLF-normalized content, and the local-only `.claude/CODEBASE_MAP.md` line is dropped from `doc-counts.txt`.
6. `scripts/loc-report.mjs` gained the two middleware siblings in its root file list.

## THINGS LEFT UNTOUCHED

- Stale cross-reference comments the split created (comment edits are out of scope): `app/api/guard/route.ts` "see statedConfidence above" (now imported), `middleware.js:160` doc block naming `pruneRateLimitMap` (now in middleware.shared.js), the `/** Evaluate guard policies … */` docblock that sat above `interface AuditStatuses` and travelled to `evaluate.finalize.ts`, and the pre-existing unused `demoPolicyProof` import carried into `middleware.demo.js`.
- Docs citing old `evaluate.ts` line numbers (`docs/architecture/*`).
- The four remaining >= 1,500-line files (scripts, the single-file Python hook, schema.js) per the plan.
- Repositories under 700 lines (plans 653, hosted-workspace 619) and lib files under 1,000 (webhooks 865, loosening 822, signals 793): below the threshold this round set.
