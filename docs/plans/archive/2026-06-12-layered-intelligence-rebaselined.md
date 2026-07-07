# Layered Intelligence — re-baselined plan (2026-06-12)

**Supersedes:** `docs/plans/2026-04-03-dashclaw-layered-intelligence.md` (3,597 lines) and `docs/rfcs/2026-04-03-dashclaw-layered-intelligence-design.md`.
**Audit basis:** read-only Explore fan-out (8 parallel agents) against main @ v4.16.0 (`32b9f132`), 2026-06-12.

## Headline

The 2026-04-03 plan was **already executed** — landed as commit `4c614e2e` ("feat: Layered Intelligence", 2026-04-04) and evolved since (strict-TS migration `3266dc1d`, the 4.7.x single-call guard path, W3 signal additions). 15 of 17 tasks are fully SHIPPED with functional evidence; the 2 PARTIAL verdicts are both **test-coverage gaps, not missing capability**. This document is the executable remainder: two test-only tasks.

## Re-baselined facts (verified live this audit — sources cited)

| Fact | Live value | Source checked |
|---|---|---|
| Unified platform version | 4.16.0 | `package.json` (version:sync:check green) |
| Routes | 320 total / 272 active / 48 archived | `docs/api-inventory.json` summary + path filter |
| Signal types | 18 | `app/lib/signals.ts` (18 distinct `type:` literals; line-35 comment) |
| MCP tools / resources | 32 / 6 | `mcp-server/lib/tools.js` / `resources.js` (TOOL_DEFINITIONS.length) |
| Tables | 100 (shape) / 101 `pgTable` declarations | `app/lib/doctor/generated/shape.json` / `schema/schema.js` |
| SDK methods | 137 Node / 233 Python | doc-counts gate green @ 4.16.0 (`npm run sdk:count` basis) |
| Guard policy types | 15 | `app/lib/validate.js:304` |
| Next.js | 16 (App Router, Turbopack) | `package.json` |
| Full suite baseline | 4419 passed / 5 skipped | `npx vitest run` @ 32b9f132 |
| Hooks suite | 206 intel tests collected (204 pass / 2 win32-symlink skips) within pytest hooks | `python -m pytest hooks` |

## 17-task verdict table

| # | Task (2026-04-03 plan) | Verdict | Evidence (current main) |
|---|---|---|---|
| 1 | Command parser foundation | **SHIPPED** | `hooks/dashclaw_agent_intel/command_parser.py:29-217`; `test_command_parser.py` (42 tests); used via classify_bash from `dashclaw_pretool.py:296` |
| 2 | Bash intent classifier | **SHIPPED** | `bash_classifier.py` + `test_bash_classifier.py` (42 tests); live call `dashclaw_pretool.py:296` |
| 3 | File security scanner | **SHIPPED** | `file_scanner.py` + `test_file_scanner.py` (39 tests); live call `dashclaw_pretool.py:342` |
| 4 | Tool surface recognizer | **SHIPPED** | `tool_recognizer.py` (41-tool catalog) + 38 tests; live call `dashclaw_pretool.py:1183` |
| 5 | Session state tracker | **SHIPPED** | `session_tracker.py` + 31 tests; exported in `__init__.py` (used by test_full_integration; not on the hot hook path — by design) |
| 6 | MCP health monitor | **SHIPPED** | `mcp_monitor.py` + 14 tests; imported `dashclaw_pretool.py:83` |
| 7 | Wire module public API | **SHIPPED** | `hooks/dashclaw_agent_intel/__init__.py:3-20`; vendored by `scripts/install-hooks.mjs:462-465` |
| 8 | Pretool hook v2 | **SHIPPED** (evolved) | intel imports `dashclaw_pretool.py:83-85`; enrichers :293-442; intel in guard payload :1026-1116; evolved past plan: `?record=true` single-call + behavior recorder; `test_pretool_integration.py` (21 tests) |
| 9 | Posttool hook v2 | **SHIPPED** (evolved) | outcome extraction `dashclaw_posttool.py:132-179`; error classifier :113-125; PATCH body :290-296; `test_posttool_integration.py` (16 tests) |
| 10 | Sessions table + permission level | **SHIPPED** | `schema/schema.js:1248` (agentSessions, all 14 planned cols), :1265 (sessionEvents), :1230 (agentPairings.permissionLevel); `drizzle/0002_agent_sessions_and_permission_level.sql`; `app/lib/sessions.ts` (422 lines); `sessions-lib.test.js`. Deviation (intentional): status default `running` not `spawning` (`app/lib/sessions.ts:150-154`) |
| 11 | Guard escalation + new policy types | **SHIPPED** | all 3 planned types live: `permission_escalation` (`app/lib/guard.ts:1200-1217`), `green_contract` (:1309-1321), `branch_freshness` (:1322-1332); validators `app/lib/validate.js:444-475`; `guard-intel.test.js` (16 tests); policy_type count 15 |
| 12 | New signal types | **PARTIAL** (code shipped; tests missing) | all 4 live: `session_stalled` (`app/lib/signals.ts:438`), `branch_stale` (:461), `mcp_degraded` (:487), `green_insufficient` (:514). MISSING: the plan's dedicated `signals-intel` unit tests were never created — coverage is only indirect (`guard-intel.test.js:286-331` recovery mappings; operations-feed UI tests) |
| 13 | Recovery recipe engine | **SHIPPED** | `app/lib/recovery.ts` (6 recipes, `evaluateRecoveryRecipes` :33-132); `recovery.test.js` (12 tests); guard integration `app/lib/guard.ts:15,648`; `guard-pipeline.test.js:325-350` |
| 14 | Session lifecycle API | **SHIPPED** (enhanced) | `app/api/sessions/route.ts:9-49` (POST/GET), `[sessionId]/route.ts:9-76` (GET/PATCH + summary salvage + 409 terminal guard), `/events`, `/actions` (beyond plan); MCP `dashclaw_session_start/end` (`mcp-server/src/tools.ts:688-708`); `sessions-detail.route.test.js` |
| 15 | Recovery in guard response | **SHIPPED** | `app/lib/guard.ts:635-653` (buildRecovery), :859 (conditional spread into response); integration test `guard-pipeline.test.js:325-350` |
| 16 | Pairings permission level | **SHIPPED** | PATCH accepts + validates `permission_level` (`app/api/pairings/[pairingId]/route.ts:57-82`); repo COALESCE update (`pairings.repository.ts:123-139`); `pairings-patch-route.test.js:59-67` |
| 17 | Full integration test | **PARTIAL** | `hooks/tests/test_full_integration.py` exists but is component-level (classify→intel assembly, SessionTracker transitions). MISSING: (a) no test runs the actual pretool flow against a mock guard returning a recovery recipe and asserts the hook surfaces it; (b) no JS-side test linking guard recovery → session persistence (blocked_reason/event); existing `guard-pipeline.test.js` is guard-isolated |

**DESCOPED entries: none.** No planned capability was superseded by a different 4.x mechanism (recovery vs learning-recommendations vs posture-next checked explicitly — separate layers, no overlap); everything either shipped or is a test gap below.

## Executable tasks (Phase 6 runs from this section alone)

> **Dispositions (2026-06-12, Phase 6):**
> - **LI-1: DONE** — `__tests__/unit/signals-intel.test.js` (20 tests; firing/clean/severity/dedup per type). No app-code changes; no behavior discrepancies found.
> - **LI-2: DONE** — `hooks/tests/test_full_pipeline_e2e.py` (4 tests) + `__tests__/integration/layered-intel-pipeline.test.js` (7 tests). The TDD red step found a TRUE WIRING BUG: `handle_warn`/`handle_block` in `hooks/dashclaw_pretool.py` dropped the guard's `recovery` object — fixed by adding `_log_recovery()` (suggestion + first 5 steps to stderr) at both call sites; exit-code contract unchanged. Opus review PASS (one doc-rot finding in test docstrings, fixed same turn).
> Commit ref: see Phase 6 commit on main (layered-intel test hardening + recovery surfacing fix).

### LI-1 — Dedicated unit tests for the 4 intel signal types (closes T12)

- **Target files:** none in `app/` (tests only). NEW test file: `__tests__/unit/signals-intel.test.js`.
- **What:** unit-test `session_stalled`, `branch_stale`, `mcp_degraded`, `green_insufficient` in `app/lib/signals.ts` (:438, :461, :487, :514): firing case + clean case per type, severity thresholds (stalled 2h amber / 4h red; branch >5 commits behind red; mcp `auth_required` red; green always red), and that each lands in the computed signal list with the right `type`/`severity`/`agent_id`.
- **Conventions:** follow `__tests__/unit/signals-w3.test.js` — mock `@/lib/db` `sql.query`/tagged calls **routed by query text, never call index** (drift-engine memory: signals tests route by query text); `__resetGuardCaches`-style helpers not needed here.
- **TDD order:** RED all firing/clean cases against current code (they should pass immediately ONLY if the mocks are right — write one deliberately-wrong expectation first to prove the harness bites, then correct it) → GREEN → refactor. Practically: these tests pin existing behavior; the red step is the harness-proof step.
- **Schema impact:** none. **Count impact:** none (signal count stays 18; no doc-count surfaces change).
- **Parallelizable:** yes (independent of LI-2).

### LI-2 — True end-to-end layered-intelligence integration test (closes T17)

Two halves, one per runtime:

- **(a) Python — hook→guard→recovery surfacing:** extend `hooks/tests/test_full_integration.py` (or sibling `test_full_pipeline_e2e.py` if cleaner): run the REAL `dashclaw_pretool` flow (same harness as `test_pretool_integration.py` — env + mocked HTTP transport, **mock server must strip query strings** per pretool memory) where the mock `/api/guard?record=true` response carries `decision: warn|block` + a `recovery` object (signal/suggestion/steps); assert the hook (1) completes the governed flow, (2) surfaces the recovery suggestion in its output/breadcrumb, (3) records session/turn state. 
- **(b) JS — guard recovery → session persistence linkage:** extend `__tests__/integration/guard-pipeline.test.js` (or NEW `__tests__/integration/layered-intel-pipeline.test.js`): drive `evaluateGuard` with intel that trips `branch_freshness` → assert recovery present, then drive the sessions layer (`app/lib/sessions.ts` `updateSession`) with the corresponding `blocked`/`blocked_reason` transition and assert the session event records it — proving the guard signal and session state agree end-to-end (mocked sql, per `reference_dashclaw_sql_fragment_test_gotcha`).
- **Target files:** `hooks/tests/test_full_integration.py` (extend), `__tests__/integration/guard-pipeline.test.js` or new sibling (extend/new). No app/ or hooks/ source changes expected; if a seam is genuinely missing, STOP and record it here rather than refactoring app code in a test task.
- **TDD order:** RED (a) hook e2e case (will fail if recovery isn't surfaced — finds real gaps) → GREEN (fix only if a true wiring bug emerges; else the test pins behavior) → RED (b) → GREEN.
- **Schema impact:** none (no migration; `npm run db:migrate` not needed). **Count impact:** none. **Hooks impact:** `hooks/tests/` touched → run `python -m pytest hooks` AND let pre-commit run `livingcode:refresh` (mirrors).
- **Parallelizable:** (a) and (b) are independent of each other and of LI-1.

## Constraints honored (sanity pass)

- Repository pattern: untouched (tests only; no SQL in routes).
- No cron / claimed-marker tick: untouched.
- hooks/ canonical + livingcode mirrors: only `hooks/tests/` touched; mirrors regenerate via pre-commit.
- Doc counts: no cited count changes in either task; `check-doc-counts --strict` must stay green with zero edits.
- Ship: Phase 7 releases as v4.17.0, platform-only (no sdk/ source → SDKs not republished, registries stay 4.11.0).
