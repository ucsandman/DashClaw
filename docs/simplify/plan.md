# Simplification plan (zero behavior change)

Every number below is from `docs/simplify/baseline.md` (`node scripts/loc-report.mjs`, main @ d6b6b42c). Invariants are snapshotted by `node --import tsx scripts/simplify-invariants.mjs --out <dir>` and diffed with `diff -r` against the main snapshot; a round with a non-empty diff does not land.

Baseline: 820 source files, 163,106 LOC (134,229 code lines), 9 files >= 1,500 LOC, 115 functions >= 150 LOC, 70 similar same-name clusters, 17 structural clones.

## God files ranked by LOC x fan-in (top 10 from the baseline)

| Rank | File | LOC | Fan-in | LOC x fan-in | Round |
|---:|---|---:|---:|---:|---|
| 1 | app/lib/repositories/actions.repository.ts | 2,601 | 23 | 59,823 | 2 |
| 2 | app/lib/events.ts | 584 | 22 | 12,848 | 1 (redis helpers only) |
| 3 | app/lib/db.ts | 100 | 126 | 12,600 | untouched (100 LOC; fan-in is the point) |
| 4 | app/lib/validate.js | 1,028 | 11 | 11,308 | untouched (policy schema; guard invariant) |
| 5 | app/lib/webhooks.ts | 911 | 11 | 10,021 | 1 (buildPinnedDispatcher only) |
| 6 | app/lib/repositories/settings.repository.ts | 385 | 26 | 10,010 | 1 (gains outcome-timeout helper) |
| 7 | app/lib/repositories/guardrails.repository.ts | 444 | 22 | 9,768 | untouched |
| 8 | app/lib/repositories/hosted-workspace.repository.ts | 619 | 12 | 7,428 | 1 (generateApiKey) |
| 9 | app/lib/guard/caches.ts | 695 | 10 | 6,950 | untouched |
| 10 | app/lib/calibration-mining.js | 478 | 13 | 6,214 | untouched |

Files >= 1,500 LOC and their fate: actions.repository.ts (round 2), hn_readiness.py (script, fan-in 0, untouched), hooks/dashclaw_pretool.py (single-file hook by design: the installer copies one file, untouched), schema/schema.js (invariant, untouched), middleware.js (round 2, demo block only), scripts/policy-smoke.mjs (test harness, untouched), scripts/migrate-multi-tenant.mjs (one-shot migration, untouched), app/lib/guard/evaluate.ts (round 2), app/lib/demo/demoMiddleware.ts (round 2).

## Round 1: helper unification

Rule applied: unify only when the bodies are semantically identical (not just same-named), the helper is >= 5 lines or has >= 3 sites, and a natural home already exists or the helper has >= 4 callers.

| Cluster (baseline row) | Sites | Target | Files touched |
|---|---:|---|---|
| hashKey (1.00, 3 identical) + generateApiKey (1.00, 3 identical) | 4 | new `app/lib/api-keys.ts`; hosted-workspace composes the two | keys/route, orgs/route, orgs/[orgId]/keys/route, hosted-workspace.repository |
| parseRules (1.00) | 4 of 9 | existing export `app/lib/guardrails/short-list.ts` | inert-policies, policy-tuning/engine, posture/loosening, policies/lib/misfireClient |
| errorFrom (1.00, 6 identical pairs) | 4 | new `app/policies/lib/errorFrom.ts` | calibrationClient, looseningClient, proposalsClient, tighteningClient |
| getSql lazy wrapper (1.00) | 2 | `getSql` from `app/lib/db` (already memoized) | actions/[actionId]/trace/route, signals/route |
| withCommandTimeout + safeDisconnect + RedisCommandTimeout (1.00, clones) | 2 | new `app/lib/redis-command.ts` | events.ts, org-rate-limit.ts |
| resolveTimeoutMinutes (1.00, clone) + resolveOutcomeTimeoutMinutes | 3 | `getOutcomeTimeoutMinutes` in settings.repository | admin/trigger-outcome-sweep, cron/outcome-sweep, actions.repository |
| isStaleCustomerError (1.00, clone) | 2 | `app/lib/billing-stripe.ts` | billing/checkout, billing/portal |
| redactAny (0.95; the difference is formatting) | 1 | existing export `app/lib/security.ts` | guard/evaluate.ts |
| buildPinnedDispatcher (0.84; webhooks' copy has an Array.isArray guard the test suite asserts) | 2 | canonical in `app/lib/url-safety.ts` (with the guard), webhooks re-exports | url-safety.ts, webhooks.ts |
| getCandidates + isWindows (1.00, clone) | 2 | new `scripts/lib/python-candidates.mjs` | run-python-unittest, run-sdk-live-python |
| getInventoryJsonPath + getInventoryMarkdownPath (1.00) | 2 | export from generate-api-inventory | check-api-inventory-diff |

Expected LOC delta: about -170 (sum of deleted copies minus the four new modules). Untouched on purpose: same-name clusters whose bodies differ (toIso x5, safeJsonParse x3, formatDate x3, timeAgo x3, withAbort x2, decisionSummary x3, CopyButton x5, handleCopy x5, parseArgs x13, ensureTable x5); deliberate mirrors (cli/lib/contained.js vs guard/containment.ts, middleware.js looksLikeJwt for the edge runtime, cli/mcp-server warnIfInsecureBaseUrl across packages); trivial (< 5 lines: pct, invalid, isShortString, isPemPublicKey, sleep, normalize, sameList, log x14).

Invariant that proves it: full suite + contracts hash + guard calibration replay (evaluate.ts touched) + hook stdout; the SDK/CLI/MCP snapshots are unaffected by construction (no file in those trees changes) and are still diffed.

## Round 2: god-file decomposition

| File | LOC | Split (siblings `<stem>.<topic>.ts`, original re-exports) | Expected delta |
|---|---:|---|---:|
| app/lib/repositories/actions.repository.ts | 2,601 | `.approvals` (expiry, recordApproval, bulk, grants), `.list` (filters + listActions), `.create`, `.outcome` (update/set/sweep), `.trace` (trace + graph), `.stats` (stats + calibration), `.delete`; facade keeps `export *` | 0 net (+ ~40 import/export lines) |
| app/lib/guard/evaluate.ts | 1,804 | `.accumulator` (redact helpers, accumulator, block reasons), `.external` (external verdict + posture), `.grants` (allow / approval pause / interruption budget / operator grant / plan-step grant), `.checks` (prompt injection, webhook policies, calibration controller, signal checks, deviation), `.finalize` (audit statuses, decision row, publish, result, fold evidence, persist deviation); `evaluateGuard` stays | 0 net |
| app/lib/demo/demoMiddleware.ts | 1,700 | `.actions`, `.policies`, `.sessions`, `.misc`; facade re-exports | 0 net |
| app/api/guard/route.ts | 702 | Next forbids extra exports from a route file, so helpers move to `app/lib/guard/route-record.ts` (recordRunningAction and its reads/race recovery, attachAssumptionAlerts) and `app/lib/guard/route-replay.ts` (binding + idempotent replay); route.ts keeps POST/GET | 0 net |
| middleware.js | 2,096 | demo block (lines 883-1540: demo handlers + DEMO_API_ROUTES + dispatch) to `middleware.demo.js`; facade keeps exports `middleware`, `config`, `invalidateApiKeyCache`, `__cacheStatsForTesting` | 0 net |

Invariant that proves it: identical exported names per facade (checked by a before/after export-name diff of each facade), full suite (35 test files mock actions.repository by path, 9 import middleware.js), contracts + openapi + inventory unchanged (route files untouched except guard/route.ts imports), guard calibration replay, policy smoke harness (guard path).

## Round 3: dispatch tables + dead code

- Dispatch tables: scan for `else if` chains >= 6 branches keyed on a string constant; replace with a `Record<string, fn>` only when every branch is a pure call with the same signature and order does not matter (no overlapping predicates). Candidates are found by grep at round start; expected count is small (the CLI and demo API already use tables).
- Dead code: `repowise get_dead_code` (min_confidence 0.7) AND a grep across app/, sdk/, sdk-python/, mcp-server/, cli/, plugins/, scripts/, __tests__/, tests/ per symbol before deletion. Public surfaces (SDK exports, MCP tools, CLI commands, route files, hook entry points) are never deleted regardless of the report.

Invariant that proves it: everything in the list; dead-code deletions additionally require the grep transcript in the round report.

## Rules in force

- One round = one branch, landed via the `dashclaw-ship` skill before the next starts.
- Zero test files edited. A test that looks wrong is named in the round report and left alone.
- Generated artifacts regenerated, never hand-edited. Bugs found mid-refactor go to `docs/simplify/found-bugs.md`.
- Subagents do mechanical moves; the diffs are verified against the invariant list by the main loop.
