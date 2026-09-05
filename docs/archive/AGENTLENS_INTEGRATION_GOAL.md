# /goal — Integrate AgentLens into DashClaw

> **HISTORICAL (archived 2026-09-05).** This May 2026 implementation goal
> describes the AgentLens and Code Sessions platform that DashClaw v5 later
> removed. It is preserved as decision history, not current architecture. See
> the canonical [product thesis](../../THESIS.md) and [v5 kill
> ledger](../releases/2026-07-07-v5-kill-ledger.md).

> Full absorption. AgentLens stops being a separate product. Its capabilities become a first-class part of DashClaw: Claude Code session analytics (repeated-runs, alerts, cache health, /goal autopsy, weekly memo, subagent ROI), and the differentiated **Generate Optimal Files** workflow — wired into DashClaw's existing hooks, action_records, pricing, MCP, plugins, CLI, `vitest` test surfaces, and Vercel cron mechanism.
>
> Every concrete claim in this file was verified against `C:\Projects\DashClaw` at HEAD on 2026-05-13 and against `C:\Projects\RevenueGoalExperiment-V3`. If something below contradicts the code on the day this is implemented, **stop and append an addendum to this file** before changing direction.

## Opus addendum (2026-05-13, final pre-flight pass)

A final hostile review caught several remaining issues. Resolutions below; the body text further down has also been edited to reflect these.

1. **Phase 2 had a contradiction.** One bullet said "Bulk insert messages (`postgres` array-of-values pattern) capturing `RETURNING id`" and the bullet immediately below said "loop of single-row `INSERT ... RETURNING id` calls." The loop-of-single-row version is correct and matches existing repositories. The contradictory line has been removed.
2. **Parser refactor was hand-waved.** `parseSessionFile` is a single ~200-line async function that streams from disk via `readline`. The new `parseSessionLines(lines, opts)` must not be a copy-paste. Refactor: extract the per-line body into an internal `_processLine(session, line, lineNo)` helper, then `parseSessionFile` becomes `await stream; for-await line of rl: _processLine(session, line, ++lineNo)`, and `parseSessionLines` becomes `for (let i=0; i<lines.length; i++) _processLine(session, lines[i], i+1)`. Both wrappers return the same `session` object shape. Phase 1 spec updated.
3. **`projectSlug` derivation was ambiguous.** AgentLens's ingest route does `parsed.projectSlug = path.basename(pdir)` where `pdir` is the Claude Code project directory under `~/.claude/projects/`. The server can't see the file path. **The CLI must pass `project.slug = path.basename(path.dirname(jsonlFilePath))` in the ingest body.** The Python reporter must pass `project.slug = os.path.basename(os.path.dirname(transcript_path))`. The server uses `body.project.slug` directly. If missing, fall back to sanitized `cwd` basename (existing AgentLens behavior preserved). Phase 3 and Phase 4 specs updated.
4. **`session_uuid` derivation was ambiguous.** The parser fills `session.sessionUuid` from the first record that has `sessionId` (parser.js line ~131). When the client supplies `session_uuid: null` in the body, the server uses the parser's output. When the client supplies a non-null `session_uuid` (the hook does, from stdin), the server must verify it matches the parser's extraction — mismatch is a 400 with `mismatched_session_uuid` reason. Phase 2 ingest-jsonl spec updated.
5. **Cron auth header is `Authorization: Bearer <CRON_SECRET>`, not a custom `timingSafeCompare` shape.** Verified against `app/api/cron/outcome-sweep/route.js`. The new cron routes (cache-crater, weekly-memo) use the same `Authorization: Bearer ${process.env.CRON_SECRET}` pattern with `timingSafeCompare` from `app/lib/timing-safe.js`. Phase 5 and Phase 7 specs updated.
6. **`tool_use_id` to action_id resolution on Windows.** The reporter must read from `tempfile.gettempdir()`, not `/tmp` (Windows is `C:\Users\<user>\AppData\Local\Temp`). Phase 3 example body had `/tmp/dashclaw_last_action_<tool_use_id>` hard-coded. **Always use `tempfile.gettempdir()` in actual Python code; `/tmp/...` in the goal is illustrative only.**
7. **Repository upsert flow needs to pass `session.id` (text PK) consistently.** `code_sessions.id` is the text PK (e.g. `cs_${uuid}`); `code_sessions.session_uuid` is the Claude Code session ID. The upsert returns `id` from the upsert RETURNING clause; that's what FKs to children use. Spelled out below.
8. **Phase 5 alert dedup syntax.** `INSERT ... ON CONFLICT DO NOTHING` against a partial unique index in Postgres requires the conflict target to match the partial index's expression. Use `ON CONFLICT ON CONSTRAINT code_session_alerts_dedup DO NOTHING` once the migration creates the named index. The migration must name the index for this to work.
9. **Capability registration not needed.** A11 settled this, but the deliverables checklist and earlier draft still had stale references to capability registration. None remain in the current file — verified.
10. **Mission Control reconciliation tooltip wording.** The A10 tooltip text was vague ("agent-level token folding"). Better wording for the actual tooltip: "Mission Control attributes each Claude Code turn's tokens to the action_records it touched, with cache reads counted at 10% rate matching Anthropic billing. Code Sessions prices raw cache_read and cache_write tokens separately against the full pricing table. The two will differ slightly on cache-heavy sessions." Use this wording in the implementation.

These resolutions are now reflected in the goal text below. Implementer: read this addendum first, then proceed.

## Inspection addendum (2026-05-13, post-inspection sweep)

A read-only inspection pass against `C:\Projects\DashClaw` and `C:\Projects\RevenueGoalExperiment-V3` at HEAD turned up four discrepancies between the body text and the live code. Resolutions below; the body has been edited.

1. **Migration numbering.** `drizzle/0005_orphan_action_backfill.sql` is already committed (a one-shot orphan-action backfill, unrelated to this work). The next free migration number is `0006_*`, not `0005_*`. Every `drizzle/0005_*` reference in this file has been updated to `drizzle/0006_*`. Latest-verified migration is now `0005_orphan_action_backfill.sql`.
2. **SDK version split.** `sdk/package.json` is at `2.12.0` (in-flight), but the root `package.json` still pins `"dashclaw": "^2.11.1"` (the last published version). The autonomous run cannot `npm publish`, so the consumer dep stays at `^2.11.1` for this work; the SDK source at v2.12.0 is the code being referenced when this goal says "current SDK". References in the body now spell out this split.
3. **`sdk/dashclaw.js` header comment.** Said `v2.11.0` while the package version is `2.12.0`. Header now reads `v2.12.0` (fixed as part of this pre-flight pass).
4. **Aggregate-count claims.** "17 src modules", "18 test files", and "~250-line `parseSessionFile`" were imprecise. Actual: AgentLens has 16 top-level `src/*.js` files (plus `src/rules/`, `src/routes/`, and `src/optimal-files/` subdirectories); `tests/` has 17 JS test files plus `launcher.test.py` (Python, not ported); `parseSessionFile` is ~200 lines. Phase 1 spec is unaffected because it lists each test file individually with its own `test()` count.

Everything else in this goal — schema line numbers, hook semantics, MCP tool list, capability runtime constraints, pricing structure, verification gates, all eleven architecture decisions — verified exact-match against the live code on 2026-05-13.

---

## Verification ledger (what was checked against actual code)

- AgentLens: 16 top-level `src/*.js` modules plus the `src/rules/`, `src/routes/`, and `src/optimal-files/` subdirectories; 17 JS test files in `tests/` (155 portable `test()` calls; `launcher.test.py` is Python and not ported), `src/db.js#persistSession` upsert/skip semantics, `src/parser.js` toolUses `messageIndex` shape, `src/pricing.js` 4-column table, `src/optimal-files/bundle.js` `fs.existsSync` + `db` dependencies, `src/routes/sessions.js` write modes (`side_by_side` / `merge` / `overwrite`).
- DashClaw schema: `agent_sessions` (live state), `session_events`, `action_records` (UNIQUE action_id), `open_loops` (unfinished follow-up, not loops), `scheduled_jobs` (exists in schema, no runner), `learning_recommendations` (per-(agent_id, action_type) aggregation, no source field).
- DashClaw infra: `app/lib/db.js` (`getSql()` neon-or-postgres detection), `app/lib/org.js` (`getOrgId` reads `x-org-id`), `middleware.js` (resolves `x-api-key` → injects `x-org-id`), `app/lib/billing.js` (`estimateCost` 4-arg, `DEFAULT_PRICING` 2-column), `app/lib/repositories/settings.repository.js` (`getModelPricing`).
- DashClaw repositories: `actions.repository.js` uses tagged-template SQL, no `sql.begin`, one-row `INSERT ... VALUES ... RETURNING *` pattern. `ON CONFLICT` used in `agents.repository.js`, `connections.repository.js`, `identities.repository.js`, `integration-health.repository.js`, `learningLoop.repository.js`, `messagesContext.repository.js`, `settings.repository.js`, `tokens.repository.js`. Zero `sql.begin` hits anywhere in `app/lib/`.
- DashClaw capabilities: `RISK_LEVELS = {low,medium,high,critical}`, `SOURCE_TYPES = {internal_sdk, http_api, webhook, human_approval, external_marketplace}`. `prepareCapabilityInvocation` rejects everything except `http_api`. Default source_type is `internal_sdk`. `capability_id` uses `cap_${uuid}`.
- DashClaw hooks: `dashclaw_pretool.py` writes action_id to `tempfile.gettempdir()/dashclaw_last_action_<tool_use_id>`. `_INTENT_TO_ACTION` produces `review|apply|security|api|build|deploy|other`. `dashclaw_stop.py` reads transcript_path from stdin, walks entries since cursor, folds cache_read at 0.1×. Orphan-actions written to `os.path.expanduser('~')/.dashclaw/orphan-actions.jsonl`.
- DashClaw tests: `vitest` 4.x, `environment: 'jsdom'`, alias `@` → `./app`, excludes `tests/` (Playwright). Tests use `vi.hoisted` + `vi.mock('@/lib/db.js')` for SQL mocking; `__tests__/helpers.js` exports `makeRequest` and `createSqlMock`. **`pg-mem` is not a dependency.**
- DashClaw hook tests: `hooks/tests/` uses Python **`unittest`** (not pytest), models include `test_stop_integration.py`, `test_pretool_integration.py`, `test_posttool_integration.py`.
- DashClaw cron: declared in `vercel.json` `crons` array pointing at `/api/cron/*` Next.js routes. Existing: `outcome-sweep`, `reset-meters`, `/api/hosted/cleanup`. `scheduled_jobs` table exists in schema but has no runner script.
- DashClaw MCP: `mcp-server/lib/tools.js` is hand-curated. `dashclaw_invoke` POSTs to `/api/capabilities/{id}/invoke`. Resources in `mcp-server/lib/resources.js`, same pattern.
- DashClaw CLI: `cli/` v0.3.0, depends on `dashclaw: "^2.2.1"` (older than current SDK 2.12.0). No `test/` directory, no `test` script. `engines: { node: '>=18.0.0' }`. No workspaces declared at repo root.
- DashClaw SDK: `sdk/dashclaw.js` belongs to the `dashclaw` package; `sdk/package.json` is at v2.12.0 in-flight while root `package.json` still pins `"dashclaw": "^2.11.1"` (last published). `files` allowlist ships only `dashclaw.js`, `index.cjs`, `LICENSE`, `README.md`, `legacy/`. Methods: `createAction`, `createCapability`, `invokeCapability`, etc.
- DashClaw migrations: latest committed is `drizzle/0005_orphan_action_backfill.sql`; next is `drizzle/0006_*`. `migrations/` directory exists with one recent file (not legacy). Workflow: `npm run db:generate` (drizzle-kit) → commit → `npm run db:migrate` (`scripts/auto-migrate.mjs`).

---

## Source-of-truth reading list (read before writing any code)

### AgentLens (source to absorb) — `C:\Projects\RevenueGoalExperiment-V3`

- `architecture.md` — stack, schema, endpoints, cost model
- `LAUNCH_HARDENING_REPORT.md` — current product state, test count `166 / 166 pass`
- `README.md`
- `src/db.js` — read carefully; `persistSession` upsert/skip semantics must be preserved
- `src/parser.js` — JSONL parsing, v2 dedup (`requestId → message.id → row uuid`), redacted `safeTarget`. Output shape includes `messages` and `toolUses` arrays; `toolUses[i].messageIndex` is an **index into the messages array**, not a DB id. The repository translates indices to FKs after batch-insert.
- `src/pricing.js` — model table with **4 price columns** per model: `input`, `output`, `cache_write`, `cache_read`. Strips `[1m]` suffixes when resolving.
- `src/repeated-runs.js` — confidence-labeled detector
- `src/insights.js`, `optimizer.js`, `rules/index.js` (7 rule modules), `alerts.js`, `audit.js`, `goals.js`, `memo.js`, `subagent-roi.js`, `claudemd.js`, `hooks-gen.js`
- `src/optimal-files/` — 10 modules: `analyze`, `bundle`, `hooks-bundle`, `merge`, `path-rules`, `recipe`, `root-claude-md`, `secret-scan`, `session-pack`, `skills`. **Important:** `buildOptimalFilesBundle` and `analyzeSession` are **not** pure today — they accept `db` and `analyze.js` calls `fs.existsSync` / `fs.readFileSync` on project files. The Phase 1 port refactors this; see A4.
- `src/routes/sessions.js` — read for the path-traversal guard (`_ensureInsideProject`), conflict UX (`mode: 'side_by_side' | 'merge' | 'overwrite'`), and the merge contract (`acceptedHeadings`, `acceptedBullets` → `applyMerge`). Do not port the route shells.
- `tests/` — 17 JS test files (plus `launcher.test.py` which is not ported). Vitest port plan below.

### DashClaw (target, this repo) — `C:\Projects\DashClaw`

- `package.json` — version `2.14.0`, test runner `vitest`, scripts include `db:migrate` (`scripts/auto-migrate.mjs`), `db:generate` (`drizzle-kit`), `hooks:install`, `hooks:diagnose`, `backfill:null-model-cost`, `setup`.
- `vitest.config.js` — `environment: 'jsdom'`, `globals: true`, alias `@` → `./app`, excludes `**/tests/**` (Playwright lives there).
- `schema/schema.js` — Postgres + Drizzle declarations. `agent_sessions` (line 1060) is **live agent state** (status, branch, freshness); not a Claude Code transcript. `session_events` (line 1077) is the event log on `agent_sessions`. `action_records` (line 71) has `action_id` UNIQUE (`ar_*` / `act_*` prefix) plus `tokens_in`/`tokens_out`/`cost_estimate`/`model`/`outcome_status`/`outcome_at`. `open_loops` (line 125) is **unfinished follow-up work**, not repeated-tool-loops. `scheduled_jobs` (line 917) exists. `learning_recommendations` (line 274) is a per-`(agent_id, action_type)` aggregation with `confidence`/`sample_size`/`success_rate`/`avg_score`/`hints`; **no `source` or `source_id` field**.
- `app/lib/db.js` — `getSql()` returns either a `@neondatabase/serverless` or `postgres` tagged-template SQL client; selected by URL detection (`.neon.tech` → neon). Routes/repositories use `` sql`SELECT ... WHERE org_id = ${orgId}` ``. **Drizzle is used only for schema declarations and migration generation**, not for query.
- `middleware.js` (~lines 1140–1270) — resolves `x-api-key` via the `api_keys` table and **injects `x-org-id` request header**. Routes read it via `getOrgId(request)` in `app/lib/org.js`. Hooks send `x-api-key`; middleware does the org resolution.
- `app/lib/billing.js` — `estimateCost(tokensIn, tokensOut, model, customPricing = null)`. `DEFAULT_PRICING` entries have only `input` and `output` columns. Unknown models return `0` with a one-time `console.warn` — **never silently price unknown models**, that's a deliberate decision (poisons cost dashboards). Extending with cache columns must preserve this contract.
- `app/lib/repositories/settings.repository.js` — `getModelPricing(sql, orgId)` is the canonical org-level pricing override read.
- `app/lib/repositories/actions.repository.js` — model file for the new repository. Pattern: `export async function foo(sql, orgId, ...)` returning rows from tagged-template `await sql\`...\``. **No `sql.begin` / transactions are used anywhere in `app/lib/repositories/`** — every repository function is single-statement. Multi-step state changes use `ON CONFLICT` / `RETURNING` / sequential statements, not transactions. Neon serverless's HTTP path does not support multi-statement transactions, so this is the deployment constraint.
- `app/api/actions/route.js` — POST/GET shape. Cost is derived server-side via `estimateCost`.
- `app/api/actions/costs/route.js`, `stats/route.js` — analytics. `app/api/actions/loops/route.js` is `open_loops` (unfinished follow-up work), **not** repeated-tool-loops. Name clash to avoid.
- `app/api/capabilities/[capabilityId]/invoke/route.js` — **critical**: `prepareCapabilityInvocation` throws `Capability is not an http_api type` for any `source_type !== 'http_api'`. So while the capabilities table accepts other source types (see below), the invoke pipeline only dispatches `http_api`. Optimal Files cannot use this pipeline — see A5.
- `app/lib/capability-runtime.js`, `app/lib/capability-contracts.js`, `app/lib/capability-invoke.js`, `app/lib/capability-health.js` — capability machinery.
- `app/lib/repositories/capabilities.repository.js` — `RISK_LEVELS = {low, medium, high, critical}`. `SOURCE_TYPES = {internal_sdk, http_api, webhook, human_approval, external_marketplace}`. Default source_type is `internal_sdk`; default risk_level is `medium`; default auth_type is `none`. `invocation_schema` is stored as `invocation_schema_json` (JSONB).
- `hooks/dashclaw_pretool.py`, `dashclaw_posttool.py`, `dashclaw_stop.py` — live Claude Code telemetry pipeline. Stop hook reads `transcript_path` from stdin, loads `_load_entries(transcript_path)`, walks new entries since `dashclaw_stop_cursor_<session_id>` cursor in tempdir, sums per-turn usage, PATCHes `tokens_in`/`tokens_out`/`model` onto the action_ids written by pretool. Pretool writes `action_id` into `/tmp/dashclaw_last_action_<tool_use_id>` keyed by `tool_use_id` — the **canonical cross-reference from JSONL tool_use to action_record**.
- `hooks/README.md` — semantics and the `~/.dashclaw/orphan-actions.jsonl` backfill pattern (pretool falls back to writing to this file when guard is unreachable; pattern precedent for "JSONL on disk → DashClaw API").
- `scripts/install-hooks.mjs` — one-command installer; copies hooks + `dashclaw_agent_intel/` Python module to `.claude/hooks/`.
- `scripts/auto-migrate.mjs` — non-interactive migration runner. Reads from `drizzle/`. **Note:** `migrations/` is a separate directory with at least one recent file (`2026-04-18-hosted-trial-columns.sql`); it is **not** purely legacy. New code-sessions migrations go in `drizzle/` (the standard drizzle-kit output path).
- `drizzle/` — existing migrations. Latest verified: `0005_orphan_action_backfill.sql` (a one-shot orphan-action cleanup unrelated to this work). Numbering has collisions historically (two `0003_*` files); the next free number is `0006_*`.
- `sdk/dashclaw.js` — SDK class `DashClaw`. Methods include `createAction`, `recordAssumption`, `createSession`, `createCapability(data)` (POST /api/capabilities), `invokeCapability(capabilityId, payload)`. SDK package name is `dashclaw`; `sdk/package.json` is at v2.12.0 (in-flight) while the root `package.json` still pins `dashclaw: ^2.11.1` (last published version). Bumping the consumer dep is coupled to `npm publish`, which the autonomous run cannot do — so the root dep declaration stays at `^2.11.1` for this work; when this goal says "current SDK" it refers to the v2.12.0 source in `sdk/`. `sdk/package.json` `files` allowlist: only `dashclaw.js`, `index.cjs`, `LICENSE`, `README.md`, `legacy/` — **publishing new exports requires expanding the allowlist and a version bump**.
- `cli/` — `@dashclaw/cli` v0.3.0. Single bin `cli/bin/dashclaw.js`. **Depends on `dashclaw: "^2.2.1"` (not the latest SDK)**. ESM. Imports `DashClaw` class from the installed npm package, not from `../sdk/`. The repo has **no `workspaces` declared** in the root `package.json`; the CLI is a sibling package with its own install.
- `mcp-server/lib/tools.js` — **hand-curated `TOOL_DEFINITIONS` array** and `createToolHandlers` factory. Existing tools: `dashclaw_guard`, `dashclaw_record`, `dashclaw_invoke` (POSTs to `/api/capabilities/{id}/invoke`), `dashclaw_capabilities_list`, `dashclaw_policies_list`, `dashclaw_wait_for_approval`, `dashclaw_session_start`, `dashclaw_session_end`. **Adding a new MCP tool requires adding both a `TOOL_DEFINITIONS` entry and a handler in `createToolHandlers`.** `dashclaw_invoke` is restricted to `http_api` capabilities by the invoke route, not by the MCP tool itself.
- `mcp-server/lib/resources.js` — `RESOURCE_DEFINITIONS` array and `createResourceHandlers` factory; same hand-curated pattern for read-only resources.
- `packages/openclaw-plugin/`, `plugins/dashclaw/`, `packages/dashclaw-demo/` — existing packages.
- `__tests__/unit/billing.test.js` — model vitest style: `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'`, imports via `@/lib/...`.
- `__tests__/integration/guard-pipeline.test.js` — model for integration tests using `vi.hoisted` + `vi.mock`.
- `__tests__/unit/actions.route.test.js` — model for route tests with mocked DB. Pattern: `vi.hoisted` declares `mockSql` and per-repository mocks; `vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }))`; `vi.mock('@/lib/repositories/actions.repository.js', () => ({ ... }))`. The DB layer is **not** real — every route test fakes `getSql` and the repository functions it imports. **`pg-mem` is not a dependency.**
- `__tests__/helpers.js` — exports `makeRequest(url, { headers, body })` for building mock Next.js requests and `createSqlMock({ taggedResponses, queryResponses })` for building tagged-template-aware SQL mocks. Use both in new route tests.
- `hooks/tests/` — Python **`unittest`** test suite (not pytest). Existing files include `test_stop_integration.py`, `test_pretool_integration.py`, `test_posttool_integration.py`, `test_pretool_guard_unavailable.py`, `test_handle_block_audit.py`. New Python tests for the reporter follow the same `import unittest` style.
- `vercel.json` — declares cron schedules pointing at `/api/cron/*` Next.js routes. Adding a scheduled job requires both creating the route under `app/api/cron/` and registering its schedule here. Existing schedules: `/api/cron/reset-meters` (monthly), `/api/hosted/cleanup` (daily 03:00), `/api/cron/outcome-sweep` (daily 02:00). There is no `scheduled_jobs`-based runner; the `scheduled_jobs` table exists in schema but is not the active cron mechanism.
- `CHANGELOG.md` — append a stanza per phase.

---

## Verified facts to internalize before any code change

This list exists because earlier passes of this goal misunderstood the platform. **Read this section twice before writing schema, route, hook, or CLI code.**

1. **Tool-call telemetry is already captured live.** `dashclaw_pretool.py` calls `POST /api/guard` and (depending on decision) `POST /api/actions`, creating `action_records` rows. The `action_type` value is derived from a semantic intent classifier — the `_INTENT_TO_ACTION` map in pretool emits one of `review`, `apply`, `security`, `api`, `build`, `deploy`, `other` (per bash intent), and file-op tools emit `security` or `apply` based on file-scanner signals. Rows carry semantic intel (bash classifier, file scanner, tool recognizer, session tracker, mcp monitor), `risk_score`, `status`, `parent_action_id`, `outcome_status`, `duration_ms`, and `agent_id`. Pretool writes the new `action_id` into `<tempdir>/dashclaw_last_action_<tool_use_id>` (Python `tempfile.gettempdir()` — `/tmp` on Linux/macOS, `C:\Users\<user>\AppData\Local\Temp` on Windows) so PostToolUse and Stop can find it.

2. **Token aggregation lives in `dashclaw_stop.py`.** At end of turn, the Stop hook:
   - Reads `transcript_path` from stdin and calls `_load_entries(transcript_path)` to load all JSONL entries.
   - Walks entries since `dashclaw_stop_cursor_<session_id>` cursor.
   - For each assistant message: `tokens_in += input_tokens + cache_creation_input_tokens + round(cache_read_input_tokens * 0.1)`. `tokens_out += output_tokens`. Captures first non-empty `message.model`.
   - Distributes totals evenly across the turn's action_ids from `/tmp/dashclaw_turn_<session_id>`.
   - PATCHes each action_id with `close_if_running: true`, tokens, and model.
   - Server derives `cost_estimate` from `estimateCost(tokens_in, tokens_out, model)` using `DEFAULT_PRICING` or org-custom pricing.
   - On text-only turns (no action_ids), if `DASHCLAW_TRACK_TEXT_TURNS` is enabled, posts a synthetic `action_type='conversation'`. Otherwise logs `orphan_tokens` to `dashclaw_hook_errors.log` and drops.

3. **Raw cache tokens are lost by the time data reaches `action_records`.** Folding `cache_read_input_tokens * 0.1` into `tokens_in` matches Anthropic's billing weight, but it destroys the raw signal needed for AgentLens cache analytics, `BAD_CACHE_HIT` rule, and weekly `CACHE_CRATER` alert. The new `code_session_messages` table preserves raw counts; Path A (Phase 3) is what populates them.

4. **Pricing schema has 2 columns.** `DEFAULT_PRICING` entries in `app/lib/billing.js` have only `input` and `output`. `estimateCost` is a 2-term sum. AgentLens prices in 4 columns (`input`, `output`, `cache_write`, `cache_read`). Extending the pricing surface (Phase 2) is a coordinated migration — the new columns default to `0` for backwards compatibility, the legacy 4-arg `estimateCost(tokensIn, tokensOut, model)` keeps identical numerical output, and a new 5-arg signature accepts `extras = { cache_creation_tokens, cache_read_tokens }`.

5. **No `sql.begin` / transactions in `app/lib/repositories/`.** Verified: zero hits across the directory. DashClaw's Neon serverless deployment path does not support multi-statement transactions over HTTP. Existing repositories use `ON CONFLICT` + `RETURNING` + sequential statements. **AgentLens's `persistSession` uses one transaction with mid-tx deletes/inserts.** The DashClaw port must reshape this into a non-atomic sequence with idempotent semantics:
   - Pre-check: read `(parser_version, source_mtime)` for the session.
   - Skip when `stored.source_mtime === incoming.source_mtime AND stored.parser_version >= incoming.parser_version`.
   - Otherwise: upsert `code_sessions` with `ON CONFLICT (org_id, session_uuid) DO UPDATE`; `DELETE FROM code_session_messages WHERE session_id = ...`; `DELETE FROM code_session_tool_uses WHERE session_id = ...`; bulk-insert new messages; bulk-insert new tool_uses with translated `message_id`s.
   - Document explicitly: a crash mid-sequence can leave a session with no children. Re-ingest of the same `source_mtime` will fix it once `parser_version` ticks; otherwise an out-of-band `code-sessions:repair` script (Phase 9) can be run.

6. **DB query style is tagged-template SQL.** `app/lib/db.js` returns a `postgres`/`neon` client. Repositories like `actions.repository.js` use `` await sql`SELECT ... ${value}` ``. Drizzle table declarations are for schema generation only. **Do not** import Drizzle's `eq`/`and`/`select` query builder.

7. **Migrations.** Edit `schema/schema.js` → `npm run db:generate` (drizzle-kit) produces a new `drizzle/0006_*.sql` → commit it → `npm run db:migrate` (`scripts/auto-migrate.mjs`) applies it. `migrations/` is an alternative location with a recent file; the standard pattern is `drizzle/`.

8. **`agent_sessions` is live agent state**, not transcripts. **`open_loops` is unfinished follow-up work**, not repeated-tool-loops. **`learning_recommendations` is per-(agent_id, action_type) aggregation** with no per-event `source` field. The new code-sessions tables use the `code_` prefix and live alongside, not within.

9. **Hooks send `x-api-key` only.** Middleware (`middleware.js`) hashes the key, looks it up in `api_keys`, and injects `x-org-id`. The new `from-hook` endpoint authenticates the same way — no new auth path needed.

10. **`tool_use_id → action_id` mapping already lives in `/tmp/dashclaw_last_action_<tool_use_id>` files.** The reporter (Phase 3) does **not** need heuristic matching. It reads these temp files as part of building its payload and sends the mapping explicitly to the server.

11. **`~/.dashclaw/orphan-actions.jsonl`** is precedent for "client writes JSONL → DashClaw API ingests later." Path resolved via `os.path.join(os.path.expanduser("~"), ".dashclaw", "orphan-actions.jsonl")` in `handle_guard_unavailable`. The new ingest path is a separate format.

12. **MCP `dashclaw_invoke` only works for `http_api` capabilities.** The capabilities table accepts `internal_sdk`/`http_api`/`webhook`/`human_approval`/`external_marketplace` as source types (default `internal_sdk`), but `prepareCapabilityInvocation` in `app/lib/capability-runtime.js` throws on anything that isn't `http_api`. **Optimal Files generation is not registered as a capability** — it lives as regular Next.js routes (Phase 6) and gets MCP exposure via two new hand-curated tools added to `mcp-server/lib/tools.js`.

13. **AgentLens uses CommonJS + `node:test`.** DashClaw uses ESM + `vitest`. Test files require mechanical rewrite (described in Phase 1).

14. **`dashclaw` npm package files allowlist is restrictive.** Currently ships only `dashclaw.js`, `index.cjs`, `LICENSE`, `README.md`, `legacy/`. Adding a `claudeCode` namespace requires editing the allowlist + bumping the version + publishing — **and `npm publish` is in the hard-rules-forbidden list for the autonomous run**. Therefore the CLI/hook parser-sharing strategy is **server-side parsing**: both callers send raw JSONL bytes to the server, the server runs the canonical JS parser. See A6.

15. **`@dashclaw/cli` v0.3.0 depends on `dashclaw: "^2.2.1"`**, current SDK is `2.12.0`. **No workspaces in the repo.** Treat the CLI as a sibling package with its own install. Server-side parsing keeps the CLI's dep on the published SDK simple.

16. **Capabilities, MCP tools, and resources are hand-curated.** No auto-generation. Additions are explicit edits to `mcp-server/lib/tools.js` and `mcp-server/lib/resources.js`.

17. **`buildOptimalFilesBundle` is not pure today.** It accepts `db` and calls `fs.existsSync` on every emitted file's resolved path to compute `overwriteRisk`. `analyze.js` calls `db.prepare(...)` for `projectMedianCost` and `similarSessionCount`, and calls `fs.readFileSync` to sample file contents for `summarizeFile`. The Phase 1 port refactors this — see A4.

18. **Current DashClaw version is `2.14.0`.** Target a `2.15` minor bump in CHANGELOG.

19. **AgentLens reports `166 / 166 tests passing`** per `LAUNCH_HARDENING_REPORT.md`. The 17 test files relevant to the port collectively contain roughly 155 `test()` calls (excluding `routes.test.js` which is Express + better-sqlite3 specific and `launcher.test.py` which is Python). The floor in Phase 1 is **≥140 vitest tests passing** — allowing budget for tests that depend on AgentLens-specific behaviors (auth, billing) that don't carry over.

---

## Why we're doing this

DashClaw already governs Claude Code at the *declaration* layer (policies, approvals, audit trail) **and** captures live execution telemetry through its hooks (tokens_in/out/cost_estimate/model per action_record). What it does **not** have, and what AgentLens uniquely provides:

- **Raw cache token preservation** for cache health analytics
- **Session-level aggregation of Claude Code transcripts** with parser-deduped totals (DashClaw has per-action records; not a session entity that links them)
- **Confidence-labeled repeated-run / stuck-loop detection**
- **Cost anomaly / cache crater / stuck-loop-streak alerts** with NULL-safe dedup
- **7 optimizer rules** with named savings estimates
- **/goal autopsy** classifier, **Subagent ROI** with cost-per-success, **weekly memo** generator
- **Generate Optimal Files** — concise root `CLAUDE.md`, session pack, path-scoped rules, hooks bundle, recipe, skill candidate, with secret-scan and three-way merge UX
- **Retroactive JSONL ingestion** for sessions that pre-date hook install or for users running un-hooked Claude Code

Absorption fills those gaps. Hook telemetry remains the *primary* live data source; JSONL is the *retroactive* backfill.

---

## Hard rules for the autonomous run

- No external publishing, deployment, posting, account creation, payments, or use of Wes's identity. No tweets, no emails, no Discord posts. **No `npm publish`. No `vercel deploy`. No `next start`** against a public DB.
- No live billing. Stripe stays untouched.
- No `--dangerously-skip-permissions` escapes around the above.
- The new local CLI must require explicit invocation. The autonomous build does not run it against `~/.claude/projects` on the user's real machine. **Use fixtures only.** Wes will run live ingestion himself.
- Every generated file (CLAUDE.md, rules, hooks, recipes) runs through `secret-scan.js` before any disk write. Secret scan runs again at write time inside the CLI.
- No deletions in `C:\Projects\RevenueGoalExperiment-V3`. Archive only (Phase 9).
- No deletions of existing DashClaw tables, routes, hooks, plugins, UI surfaces, or scripts. **Additive only.**
- Tests must actually pass. No `.skip`, no `expect(true).toBe(true)`, no mock-echo tests. Honor the ZERO SLOP standard in `C:\Users\sandm\clawd\AGENTS.md`.
- Use `subprocess.Popen([...])` / argv arrays in any launcher additions. **Never `shell=True`.**
- **Hook fail-silent contract is sacred.** Every change to `hooks/dashclaw_*.py` preserves: when `DASHCLAW_BASE_URL` or `DASHCLAW_API_KEY` is unset, or when the server is unreachable, the hook logs to `dashclaw_hook_errors.log` and exits 0. Claude Code never sees a failure. The autonomous run must include a regression test asserting `DASHCLAW_BASE_URL=""` + `DASHCLAW_CODE_SESSIONS_ENABLED=1` exits 0 cleanly.
- **Pricing migration must preserve historical costs.** Existing rows do not get re-priced. New columns default to 0. The legacy 4-arg `estimateCost(tokensIn, tokensOut, model)` keeps identical numerical output (vitest test asserts parity). Re-pricing is opt-in via a separate `scripts/backfill-code-session-cache-cost.mjs` run by an operator.
- Schema migrations are additive only. No `DROP COLUMN` / `DROP TABLE`. New tables and new columns only.
- No `sql.begin(...)` usage. Multi-step state changes use `ON CONFLICT` + sequential statements per existing patterns. Document the non-atomic property in code comments where it matters.

---

## Architecture decisions (fixed up front)

### A1 — Two ingestion paths, one storage shape

- **Path A — live (primary):** existing hooks capture tool calls and aggregate token totals into `action_records`. The Stop hook is **extended** (not replaced) by a new helper module `hooks/dashclaw_code_session_reporter.py` that runs after the existing PATCH loop. Activation gated by `DASHCLAW_CODE_SESSIONS_ENABLED=1`. The reporter posts new JSONL lines since the cursor plus the `tool_use_id → action_id` map to `POST /api/code-sessions/ingest-jsonl`. Server parses with the canonical JS parser.
- **Path B — retroactive (backfill):** new local CLI subcommand `dashclaw code ingest` reads JSONL files from `~/.claude/projects` and POSTs raw lines per file (chunked if large) to the same `POST /api/code-sessions/ingest-jsonl` endpoint. Used for sessions that pre-date hook install or for users running un-hooked Claude Code.

Both paths hit one endpoint. Server parses, runs `persistSession`-equivalent upsert, recomputes signals + alerts. Skip semantics mirror AgentLens: `source_mtime` + `parser_version` gate.

`source='hook'` for Path A, `source='jsonl'` for Path B. A session can be re-enriched by either path; UNIQUE on `(org_id, session_uuid)` prevents duplication.

### A2 — New schema lives under `code_` prefix

`code_projects`, `code_sessions`, `code_session_messages`, `code_session_tool_uses`, `code_session_signals`, `code_session_alerts`, `code_session_memos`, `code_optimal_file_manifests`. Distinct from `agent_sessions`, `session_events`, `open_loops`. Full DDL in Phase 2.

### A3 — Pure algorithmic logic lives in `app/lib/claude-code/`

ESM. No DB. No HTTP. No vitest globals. Reusable from API routes, scheduled jobs, MCP tool handlers, and tests. AgentLens's `src/db.js`, `src/auth.js`, `src/billing.js`, and `src/routes/` are **not** ported — those concerns are replaced by `app/lib/db.js`, existing auth (`x-api-key` → middleware → `x-org-id`), `app/lib/billing.js`, and Next.js route handlers.

### A4 — Optimal Files refactor: bundle takes data, not DB or fs

The Phase 1 port reshapes the optimal-files modules so they are dependency-injected:

- `analyzeSession({ session, project, toolEvents, projectCwd, projectMedianCost, similarSessionCount, projectFiles, now })` — accepts pre-computed aggregates and pre-read file contents. No `db`. No `fs`.
- `buildOptimalFilesBundle({ session, project, toolEvents, projectCwd, projectMedianCost, similarSessionCount, projectFiles, now, existingPaths = [] })` — accepts `existingPaths: Set<string>` to compute `overwriteRisk`. **The web server passes an empty set or omits `overwriteRisk` entirely (defaulting to `'unknown'`).** The CLI populates `existingPaths` from real disk state.
- `planBundleSelections({ bundle, projectCwd, selections })` (renamed from `writeBundleSelections`) — pure; returns per-file `{ path, status, content, mode, ... }` without touching disk.
- `applyBundlePlan({ plan, projectCwd, fs })` — does the disk writes. **Only the CLI calls this.** The web server never imports it.
- `listGeneratedFiles(projectCwd, fs)` — CLI-only.

Routes do their own SQL for `projectMedianCost` and `similarSessionCount` via the new repository and pass the results into `analyzeSession`. They do **not** pass `projectFiles` (the server cannot read the user's filesystem); when `projectFiles` is absent, `summarizeFile` returns a stub. The CLI, when generating Optimal Files locally for preview, can read project files and pass them in — but Phase 6 builds the preview server-side, so the initial UX trades richer summaries for safety. A future enhancement could allow the user to upload project files for analysis; out of scope for this goal.

### A5 — Generate Optimal Files is a regular route, NOT a DashClaw capability

DashClaw's `/api/capabilities/[id]/invoke` route only dispatches `source_type='http_api'` capabilities (verified via `prepareCapabilityInvocation` throwing `"not an http_api type"` for anything else). Optimal Files runs internally against ingested session data — it is not an external HTTP endpoint with auth/retry/mapping policy. Registering it as an `internal_sdk` capability is *legal* in the schema but it would not be invokable through the existing invoke route or `dashclaw_invoke` MCP tool. **Therefore Optimal Files is not registered as a capability at all.** It lives as:

- **REST:** routes under `/api/code-sessions/sessions/[sessionId]/optimal-files/...` (Phase 6).
- **MCP:** two new tools added to `mcp-server/lib/tools.js` — `dashclaw_optimal_files_preview` and `dashclaw_optimal_files_manifest` — with both a `TOOL_DEFINITIONS` entry and a handler in `createToolHandlers`. Handlers call the REST routes directly via the existing `DashClawClient`. Hand-curated additions; see Phase 8.
- **SDK:** the autonomous run does **not** publish a new `dashclaw` npm release. Local consumers (the CLI, tests) call the REST endpoints directly via `fetch`. A future SDK release can wrap them in a `dashclaw.codeSessions.optimalFiles.*` namespace, but that's out of scope for this goal.

### A6 — Server-side parsing, dumb clients

Both the hook reporter (Python) and the CLI (Node) send **raw JSONL data** to `POST /api/code-sessions/ingest-jsonl`. The server runs the canonical JS parser. Single source of truth, no Python port of the parser, no shared dependency between CLI and `app/lib/claude-code/`.

Request body shape:
```json
{
  "project": {
    "slug": "string",        // optional; derived from cwd if missing
    "cwd": "string|null",
    "source_host": "string"  // 'hook' | 'jsonl'; reported by the client
  },
  "session_uuid": "string|null",     // if known by the client (hooks know it from stdin)
  "source_file": "string",           // absolute path on the client (logged, never used for IO server-side)
  "source_mtime": "ISO8601 string",  // for skip-semantics
  "jsonl_lines": ["string", "string", ...],  // raw JSON-Lines, one per array entry
  "tool_use_action_map": { "<tool_use_id>": "<action_id>" }  // optional; hook reporter populates this
}
```

Server walks `jsonl_lines`, parses each, runs the existing `parseSessionFile` logic adapted to in-memory line arrays, persists via the new repository, computes signals + alerts. Response counts + skipped reasons.

### A7 — Web server never writes to the user's filesystem

The Optimal Files preview API returns a bundle. The manifest API persists the resolved write plan in `code_optimal_file_manifests` with a 24h expiry. **The local CLI is the only thing that writes to disk.** Re-runs `secret-scan` per file at write time. Enforces `_ensureInsideProject` (ported from AgentLens). Three-way merge UX matches AgentLens: `skip`, `side_by_side` (creates `.NEW`, refuses to clobber existing `.NEW` without `--overwrite`), `merge` (`applyMerge` with `acceptedHeadings` + `acceptedBullets`), `overwrite`.

### A8 — UI route is `/code-sessions`

Not `/sessions` (already used). Not `/claude-code`. Sidebar entry between Actions and Analytics, reusing existing layout components.

### A10 — Mission Control reconciliation (cost numbers must agree, or be explained)

Mission Control surfaces an **Agent Spend (30D)** tile broken down per `agent_id`, sourced from `SUM(action_records.cost_estimate)` over the last 30 days. The new `code_sessions.cost_usd` is a parallel, cache-aware total derived from per-message tokens through the extended 5-arg `estimateCost` (Phase 2). The two numbers will diverge for sessions that have both hook-captured actions AND code-session messages, because:

- `action_records.cost_estimate` was computed at Stop-hook time via 4-arg `estimateCost` where `tokens_in` already folded `cache_read * 0.1` into the input total. There is no separate cache_read pricing line.
- `code_sessions.cost_usd` (Phase 2 onwards) prices `cache_read_tokens` and `cache_creation_tokens` separately against the 4-column pricing table.

With identical raw token counts, the two numbers can differ by single-digit percent on cache-heavy sessions. **This is intentional, not a bug.** But it must be visible:

- Mission Control's Agent Spend tile reads `action_records.cost_estimate` and is **not changed by this work**. Same query. Same numbers. No regression.
- The Code Sessions session-detail Summary panel shows **both** numbers side-by-side: "Code Sessions cost: $X.XX (raw cache pricing)" and "Mission Control attribution: $Y.YY" with a one-line tooltip explaining that Mission Control attributes by agent-level token folding while Code Sessions prices raw cache tokens directly.
- Code Sessions project rollups use `code_sessions.cost_usd`. Mission Control fleet rollups use `action_records.cost_estimate`. The two surfaces are clear about which they're showing.
- Verification gate (added below): run Mission Control before and after a fresh hook-driven ingest; the 30D agent spend for `claude-code` must be **bit-identical**.

### A11 — Operations Feed scope

Mission Control's Operations Feed currently surfaces governance-decision-shaped signals (e.g. "Ungoverned high-risk decision: Bash: rm -rf ..."). The new `code_session_alerts` (`COST_ANOMALY`, `CACHE_CRATER`, `STUCK_LOOP_STREAK`, `MULTI_PROJECT_USAGE`) are cost/efficiency-shaped and would feel out of place in that feed.

**Default: code-session alerts do NOT appear in the Mission Control Operations Feed.** They live exclusively under Code Sessions (own surface, own unread counter on the sidebar entry). Surfacing them in the Operations Feed is a future opt-in decision, reversible without schema changes.

### A9 — Hook ecosystem is preserved

- `scripts/install-hooks.mjs` is **unchanged**. The new reporter module ships alongside the existing hook scripts in `hooks/` and is copied to `.claude/hooks/` by the existing installer (the script copies all `.py` files in `hooks/`).
- AgentLens's `hooks-gen.js` generates **per-session helper hooks** (stuck-loop guard, cost-limit guard) for a project's `.claude/hooks/` directory. These are *additional* opt-in hooks, **not replacements for** `dashclaw_pretool.py` / `dashclaw_posttool.py` / `dashclaw_stop.py`. Generator lives in `app/lib/claude-code/hooks-gen.js`. Output flows through the same CLI manifest mechanism as Optimal Files (the generated hook script becomes one entry in the bundle).

---

## Build order (phases)

Each phase ends with: vitest green, `npm run lint` clean, a CHANGELOG entry, a working demo path. **Do not start phase N+1 until phase N's exit gate passes.** If a phase decision turns out wrong, **stop and append a rationale to this goal file** before changing direction.

### Phase 1 — Pure module port (no DB, no HTTP, no `fs`)

Land the algorithmic core inside DashClaw, fully testable in isolation under vitest.

- Create `app/lib/claude-code/` (importable as `@/lib/claude-code/...`). Convert from CommonJS to ESM:
  - `parser.js` — port of `src/parser.js`. Same v2 dedup. Same redacted `safeTarget`. **Refactor required:** extract the per-line body of the existing `parseSessionFile` into an internal `_processLine(session, line, lineNo)` helper. Then expose two wrappers: `parseSessionFile(filePath, { mtime })` opens the file with `readline.createInterface` and calls `_processLine` for each streamed line (existing behavior preserved); `parseSessionLines(lines, { mtime, sourceFile })` iterates the in-memory array and calls `_processLine` directly. Both return the same `session` shape. The server's ingest endpoint calls `parseSessionLines`.
  - `pricing.js` — port of `src/pricing.js`. 4-column table. `priceFor`, `costForUsage`, `cacheSavingsForUsage`, `cacheHitRate`, `formatUSD`. Export `MODEL_PRICING` constant.
  - `repeated-runs.js` — port; same shape.
  - `insights.js` — port; same shape.
  - `optimizer.js` — port of `src/optimizer.js` + `src/rules/index.js`. All 7 rules in a `rules/` subdirectory. `runOptimizer(context)`, `totalEstimatedMonthlySavings(findings)`. **Drop** `buildSessionContext(db, session)` — that lived in AgentLens because it queried sqlite; the DashClaw equivalent is a route-layer helper in `app/lib/repositories/code-sessions.repository.js`.
  - `alerts.js` — port. Four kinds: `COST_ANOMALY`, `CACHE_CRATER`, `STUCK_LOOP_STREAK`, plus **`MULTI_PROJECT_USAGE`** (rename from AgentLens's `PLAN_FIT`; DashClaw doesn't have a free-tier-upsell concept, but a "this org has activity in N projects this month" informational signal is still useful). Keep `digestMarkdown`. Drop AgentLens's SQLite SCHEMA constant and `ensureSchema` / `persistAlerts` / `markAllRead` / `listAlerts` — those live in the new repository in Phase 2.
  - `goals.js` — port. Keep `classifyOutcome`, `extractGoalText`, `buildAutopsy`. Drop `buildAutopsyFromDb`.
  - `memo.js` — port. Keep `generateMemo`, `isoWeekTag`, `sanitizeSlug`. **Drop `writeMemoToDisk`** — disk writes are CLI-only.
  - `subagent-roi.js` — port. Keep `computeRoi`, `recommend`. Drop `buildInvocationsFromDb`.
  - `audit.js` — port. `buildAudit(session, messages, toolUses)` becomes pure.
  - `claudemd.js` — port with refactor: instead of `readSafely(absPath)` reading from disk, accept a `projectFiles: Map<relPath, content>` parameter passed by the caller. When `projectFiles` is absent or a path is missing, `summarizeFile` returns a stub (`{ heading: relPath, lines: ['(file content not available)'] }`).
  - `hooks-gen.js` — port. Output goes through the manifest flow, never written directly.
  - `secret-scan.js` — port. 10 patterns. Same `{status, redactions, redacted}` return.
  - `optimal-files/` — port the directory with the A4 refactor:
    - `analyze.js` — pure; accepts `{ session, project, toolEvents, projectCwd, projectMedianCost, similarSessionCount, projectFiles, now }`.
    - `bundle.js` — exports `buildOptimalFilesBundle` (pure), `planBundleSelections` (pure, renamed from `writeBundleSelections`), `previewBundleMerge` (pure), `absolutize` (pure), `sideBySidePath` (pure). **No `fs` imports.** The `overwriteRisk` field is computed from an `existingPaths: Set<string>` argument; default empty set ⇒ `'unknown'` for non-virtual entries.
    - `applyBundlePlan` — moved to a separate file `app/lib/claude-code/optimal-files/apply.js` that imports `fs/promises`. **Not imported from any route.** The CLI imports it.
    - `listGeneratedFiles` — moved to `apply.js`. CLI-only.
    - Other modules (`hooks-bundle`, `merge`, `path-rules`, `recipe`, `root-claude-md`, `session-pack`, `skills`) — port as pure.
- **Tests** under `__tests__/unit/claude-code/`. Rewrite each AgentLens test in vitest idiom:
  - Mechanical mapping: `require('node:test')` → `import { describe, it, expect } from 'vitest'`; `require('node:assert/strict')` → vitest expect; `assert.equal(a, b)` → `expect(a).toBe(b)`; `assert.deepEqual(a, b)` → `expect(a).toEqual(b)`; `require('../src/...')` → `import ... from '@/lib/claude-code/...'`.
  - Port these files (counts from `tests/` raw `test(` occurrences):
    - `parser.test.js` (5), `parser-dedupe.test.js` (8), `pricing.test.js` (10), `repeated-runs.test.js` (5), `insights.test.js` (11), `optimizer.test.js` (14), `context-gaps.test.js` (5), `optimal-files.test.js` (20 — **includes the `rm -rf /` regex regression test**), `merge.test.js` (16), `claudemd.test.js` (7) — note: claudemd tests assume disk reads; adapt to pass `projectFiles` map fixtures, `hooks-gen.test.js` (9), `alerts.test.js` (14 — adapt to test pure functions only; persistence tests deferred to Phase 2), `goals.test.js` (13), `memo.test.js` (5), `subagent-roi.test.js` (9), `audit.test.js` (4).
  - **Do not port** `routes.test.js` (Express + better-sqlite3) or `launcher.test.py`.
  - Floor: **≥140 new vitest tests passing**.
- **Scratch verification:** a one-off script under `scripts/scratch/claude-code-smoke.mjs` (commit not required) loads a fixture JSONL, calls `parseSessionLines`, runs `buildOptimalFilesBundle` with stub inputs, prints the result. Confirms the pure module works without any DB.
- **Exit gate:** `npm test` passes with ≥140 new tests under `__tests__/unit/claude-code/`. `npm run lint` clean. Smoke script produces expected output.

### Phase 2 — Schema, repository, ingest endpoint, pricing extension

Add tables, repository, the ingest endpoint, and cache-aware pricing.

- **Schema additions** in `schema/schema.js` (Drizzle declarations):
  - `codeProjects` → `code_projects(id text pk, org_id text not null references organizations(id), slug text not null, cwd text, source_host text, created_at timestamptz default now, updated_at timestamptz default now)` with `UNIQUE(org_id, slug)`.
  - `codeSessions` → `code_sessions(id text pk, org_id text not null references organizations(id), project_id text not null references code_projects(id), session_uuid text not null, source text not null, source_file text, source_mtime text, started_at text, ended_at text, message_count int not null default 0, model_primary text, input_tokens bigint not null default 0, output_tokens bigint not null default 0, cache_read_tokens bigint not null default 0, cache_creation_tokens bigint not null default 0, cost_usd numeric not null default 0, cache_savings_usd numeric not null default 0, stuck_loops int not null default 0, model_requests int not null default 0, jsonl_records int not null default 0, duplicate_fragments_skipped int not null default 0, naive_input_tokens bigint not null default 0, naive_output_tokens bigint not null default 0, naive_cache_read_tokens bigint not null default 0, naive_cache_creation_tokens bigint not null default 0, naive_cost_usd numeric not null default 0, parser_version int not null default 2, created_at timestamptz default now, updated_at timestamptz default now)` with `UNIQUE(org_id, session_uuid)` and `CHECK (source IN ('hook','jsonl'))`.
  - `codeSessionMessages` → `code_session_messages(id serial pk, session_id text not null references code_sessions(id) on delete cascade, uuid text, role text, model text, timestamp text, input_tokens int, output_tokens int, cache_read_tokens int, cache_creation_tokens int, cost_usd numeric, text_preview text, request_id text, message_id text)` with indexes on `(session_id)` and `(session_id, request_id)`.
  - `codeSessionToolUses` → `code_session_tool_uses(id serial pk, session_id text not null references code_sessions(id) on delete cascade, message_id int references code_session_messages(id) on delete set null, action_id text references action_records(action_id) on delete set null, name text not null, target text, timestamp text, duration_ms int, tool_use_id text, request_id text, source_line int)` with indexes on `(session_id, name)`, `(session_id, request_id)`, `(action_id)`.
  - `codeSessionSignals` → `code_session_signals(id serial pk, session_id text not null references code_sessions(id) on delete cascade, kind text not null, confidence text, savings_usd numeric, payload jsonb, created_at timestamptz default now)` with index on `(session_id, kind)`.
  - `codeSessionAlerts` → `code_session_alerts(id serial pk, org_id text not null references organizations(id), project_id text references code_projects(id) on delete cascade, session_id text references code_sessions(id) on delete cascade, kind text not null, severity text not null default 'info', scope text not null default 'session', title text not null, body text, read_at timestamptz, created_at timestamptz default now)` with a partial unique index `CREATE UNIQUE INDEX code_session_alerts_dedup ON code_session_alerts (org_id, kind, COALESCE(project_id, ''), COALESCE(session_id, ''))` to get Postgres-NULL-safe dedup matching AgentLens semantics.
  - `codeSessionMemos` → `code_session_memos(id serial pk, org_id text not null references organizations(id), project_id text not null references code_projects(id) on delete cascade, iso_week_tag text not null, body_md text, created_at timestamptz default now)` with `UNIQUE(org_id, project_id, iso_week_tag)`.
  - `codeOptimalFileManifests` → `code_optimal_file_manifests(id text pk, org_id text not null references organizations(id), session_id text not null references code_sessions(id) on delete cascade, project_cwd text not null, plan jsonb not null, expires_at timestamptz not null, created_at timestamptz default now)`.

- **Migration generation:** edit `schema/schema.js`, run `npm run db:generate`, verify the generated SQL in `drizzle/0006_*.sql` against the spec above, commit. Confirm the partial unique index for `code_session_alerts` is in the generated SQL — drizzle-kit may not emit `COALESCE` expressions; if not, write the partial index as a separate `--> statement-breakpoint` block manually appended to the file (matching the pattern in `0004_action_outcome_finality.sql`).

- **Pricing extension** in `app/lib/billing.js`:
  - Extend `DEFAULT_PRICING` entries with optional `cache_write` and `cache_read` columns. Add explicit non-zero values for `opus-4-7` (18.75 / 1.50), `sonnet-4-6` (3.75 / 0.30), `haiku-4-5` (1.25 / 0.10) from AgentLens `src/pricing.js`. Other entries default to 0 (no cache pricing).
  - Extend `estimateCost(tokensIn, tokensOut, model, customPricing = null, extras = null)`. When `extras = { cache_creation_tokens, cache_read_tokens }` is non-null:
    ```
    extraCost = (cache_creation_tokens * entry.cache_write + cache_read_tokens * entry.cache_read) / 1_000_000
    ```
    Added to the base sum. When `extras` is absent or null, behavior is bit-for-bit identical to today.
  - Preserve the "unknown model → 0 + one-time warn" contract.
  - Vitest test under `__tests__/unit/billing-cache.test.js`: legacy 4-arg parity (every existing pricing entry must return the same number as before), 5-arg with extras for opus-4-7 / sonnet-4-6 / haiku-4-5, 5-arg with extras for an unpriced model returns same as 4-arg (cache contributions = 0).

- **Repository** at `app/lib/repositories/code-sessions.repository.js`:
  - All functions take `(sql, orgId, ...)` and use tagged-template SQL matching `actions.repository.js`. No `sql.begin`. Multi-step writes are sequential and idempotent.
  - `upsertProject(sql, orgId, { slug, cwd, source_host })` — `INSERT ... ON CONFLICT (org_id, slug) DO UPDATE SET cwd = EXCLUDED.cwd, source_host = EXCLUDED.source_host, updated_at = NOW() RETURNING id`.
  - `getSessionFreshness(sql, orgId, sessionUuid)` — returns `{ id, source_mtime, parser_version }` or null.
  - `upsertSessionWithChildren(sql, orgId, parsed, { toolUseActionMap })` — implements the non-atomic AgentLens semantics:
    1. Read freshness via `getSessionFreshness`.
    2. If `stored.source_mtime === incoming.source_mtime && stored.parser_version >= incoming.parser_version`, return `{ skipped: true, reason: 'unchanged' }`.
    3. Otherwise upsert `code_sessions` with `ON CONFLICT (org_id, session_uuid) DO UPDATE` returning the row id.
    4. `DELETE FROM code_session_messages WHERE session_id = ${id}`.
    5. `DELETE FROM code_session_tool_uses WHERE session_id = ${id}`.
    6. Row-by-row `INSERT INTO code_session_messages ... RETURNING id` loop. Collect returned ids into `messageIds[]` indexed by position.
    7. Row-by-row `INSERT INTO code_session_tool_uses` loop. For each tool use: resolve `message_id = messageIds[parsed.toolUses[i].messageIndex]`; if `tool_use_id` is a key in `toolUseActionMap`, set `action_id` to the mapped value. Skip if `messageIndex` is out of range (defensive).
    8. Recompute signals + alerts (Phase 5 wires this; here it's a stub that does nothing).
    Document explicitly in code comments: "this sequence is intentionally non-atomic because Neon serverless does not support multi-statement transactions over HTTP. A crash mid-sequence is recovered by re-ingestion."
    - **Bulk-insert pattern:** existing repositories use one-row `INSERT ... VALUES (...) RETURNING *` per call, not multi-row inserts. Phase 1 ships the row-by-row loop above. If profiling later shows this is slow, refactor to `sql.unsafe(...)` with a multi-row VALUES string — only after measuring, and document the change in CHANGELOG.
    - **`session.id` is the internal text PK** (e.g. `cs_${uuid}`, server-generated); `session.session_uuid` is the Claude Code session ID from the JSONL. Children (`code_session_messages`, `code_session_tool_uses`, `code_session_signals`, `code_session_alerts`) FK on `session.id`, not `session.session_uuid`. Generate `session.id` on the first insert; the upsert RETURNING clause returns it for subsequent updates.
  - `listProjects(sql, orgId)`, `listSessions(sql, orgId, projectId, { limit, offset })`, `getSessionDetail(sql, orgId, sessionId)`, `getSessionInsights(sql, orgId, sessionId)`, `getProjectMedianCost(sql, orgId, projectId, excludeSessionId)`, `getSimilarSessionCount(sql, orgId, projectId, session)`, `listAlerts(sql, orgId, { onlyUnread, limit })`, `markAlertsRead(sql, orgId, ids)`, `listMemos(sql, orgId, projectId)`, `saveManifest(sql, orgId, sessionId, plan, ttlHours)`, `getManifest(sql, orgId, manifestId)`.

- **API routes** under `app/api/code-sessions/`:
  - `POST /api/code-sessions/ingest-jsonl` — body shape per A6. Validates `body.project.slug` is present (clients must derive it: CLI from `path.basename(path.dirname(file))`, hook reporter from `os.path.basename(os.path.dirname(transcript_path))`). Calls `parseSessionLines(body.jsonl_lines, { mtime: body.source_mtime, sourceFile: body.source_file })`. If `body.session_uuid` is non-null and `parsed.sessionUuid` differs from it, return 400 `mismatched_session_uuid`. Otherwise call `upsertSessionWithChildren(sql, orgId, parsed, { toolUseActionMap: body.tool_use_action_map || {} })`. Returns `{ project: { id, slug }, session: { id, session_uuid, source_mtime, parser_version, skipped, reason } }`.
  - `GET /api/code-sessions/projects` — list with rollups.
  - `GET /api/code-sessions/projects/[projectId]/sessions` — paginated.
  - `GET /api/code-sessions/sessions/[sessionId]` — detail (session + messages + tool_uses).
  - `GET /api/code-sessions/sessions/[sessionId]/insights` — signals + repeated-runs + cache health (Phase 5 fully wires this; here it returns repeated-runs only).
  - `GET /api/code-sessions/sessions/[sessionId]/autopsy` — (Phase 8).
  - `GET /api/code-sessions/alerts?onlyUnread=1&limit=50` and `POST /api/code-sessions/alerts/read-all` — (Phase 5 wires alerts; here the endpoints return empty).

- **Tests** under `__tests__/integration/code-sessions/` and `__tests__/unit/code-sessions/`:
  - **Test DB strategy:** all new route tests follow the existing pattern from `__tests__/unit/actions.route.test.js`. Use `vi.hoisted({ mockSql, mockListSessions, ... })`, `vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }))`, `vi.mock('@/lib/repositories/code-sessions.repository.js', () => ({ ... }))`. Build mock requests with `makeRequest` from `__tests__/helpers.js`. Build mock SQL clients with `createSqlMock` when needed. **`pg-mem` is not a dependency; do not introduce it.**
  - `ingest-jsonl.route.test.js` — POST landed → repository mock called with expected payload; org A cannot read org B (assert middleware-injected `x-org-id` is honored); malformed JSONL line → response includes a `parser_skipped` counter; re-ingest with same `source_mtime` + same `parser_version` → `skipped: true`; re-ingest with newer `parser_version` → repository upsert called.
  - `pricing-cache.test.js` lives under `__tests__/unit/billing-cache.test.js` per Phase 2 deliverables.
  - `repository-upsert.test.js` (unit) — exercises the non-atomic upsert sequence against a `createSqlMock` capturing tagged-template calls. Asserts the exact statement order: `SELECT` freshness → `INSERT ... ON CONFLICT` upsert → `DELETE messages` → `DELETE tool_uses` → row-by-row `INSERT messages RETURNING id` loop → row-by-row `INSERT tool_uses` loop. Asserts idempotency: a second call with identical `source_mtime`/`parser_version` short-circuits to `skipped: true` after the SELECT.

- **Exit gate:** `npm run db:migrate` against a fresh local Postgres applies cleanly. Phase 2 tests green. Smoke: a curl command lands a fixture JSONL payload through `POST /api/code-sessions/ingest-jsonl` and reads it back through `GET /api/code-sessions/projects`.

### Phase 3 — Path A: extend Stop hook with code-session reporter

Make the live hook also feed the new tables without breaking existing telemetry.

- New file `hooks/dashclaw_code_session_reporter.py` — a Python module imported by `dashclaw_stop.py`. Activation gated by `os.environ.get('DASHCLAW_CODE_SESSIONS_ENABLED', '').strip().lower() in ('1','true','yes')`.
- The reporter is invoked **after** the existing `_apply(...)` PATCH loop completes. It receives the already-loaded `entries` list, `transcript_path`, `session_id`, `agent_id`, the `new_cursor` value, and the *previous* cursor.
- Reporter behavior:
  1. Compute the slice of `entries` since the previous cursor (this matches what `_collect_turn_usage` walks, but the reporter wants the raw lines, not aggregates).
  2. Read raw lines from `transcript_path` (re-open and re-read; the `entries` array is parsed JSON, not raw lines). Apply the cursor-based slice. **Skip if zero new lines.**
  3. Build `tool_use_action_map`: for every `tool_use_id` referenced by these lines, attempt to read `/tmp/dashclaw_last_action_<tool_use_id>`; include the mapping when found.
  4. Construct the request body per A6:
     ```
     {
       "project": { "slug": null, "cwd": <CWD env or null>, "source_host": "hook" },
       "session_uuid": session_id,
       "source_file": transcript_path,
       "source_mtime": iso_now,
       "jsonl_lines": [...],
       "tool_use_action_map": {...}
     }
     ```
  5. POST to `BASE_URL + '/api/code-sessions/ingest-jsonl'` with the same `x-api-key` header and 3-second timeout used elsewhere in the stop hook.
  6. On any failure: `_log_hook_error("code_session_reporter -> ...")` and return. Never raises.
- Integration in `dashclaw_stop.py` `main()`:
  ```python
  # AFTER _apply(action_ids, ...) and BEFORE _write_cursor(...)
  if CODE_SESSIONS_ENABLED:
      try:
          from dashclaw_code_session_reporter import report_turn
          report_turn(
              base_url=BASE_URL,
              api_key=API_KEY,
              agent_id=AGENT_ID,
              session_id=session_id,
              transcript_path=transcript_path,
              entries=entries,
              previous_cursor=last_uuid,
              new_cursor=new_cursor,
          )
      except Exception as e:
          _log_hook_error("code_session_reporter -> " + type(e).__name__ + ": " + str(e))
  ```
- The server endpoint resolves the `project.slug` from the supplied `cwd` if none given (slug = sanitized cwd basename).
- The server uses `tool_use_action_map` to populate `code_session_tool_uses.action_id` directly — **no heuristic matching**.
- **Tests:**
  - **Vitest** test in `__tests__/integration/code-sessions/ingest-jsonl-hook-payload.route.test.js` using a fixture body that includes a `tool_use_action_map`. Assert the repository call wires `action_id` onto the tool_use insert.
  - **Python unittest** test at `hooks/tests/test_code_session_reporter.py` (the existing directory uses unittest; new tests follow that style). Fixture input. Start a mock HTTP server on a random port like `test_stop_integration.py` does. Assert: request URL is `<BASE_URL>/api/code-sessions/ingest-jsonl`, request body shape matches A6, `tool_use_action_map` is populated by reading `tempfile.gettempdir() / dashclaw_last_action_<tool_use_id>` files (pre-seeded by the test), idempotency on a re-run with the same cursor. **Do not** port AgentLens's `safeTarget` regexes to Python — the **server** runs the parser, including redaction. The Python reporter sends raw lines unchanged.
  - **Critical regression test** at `hooks/tests/test_stop_fail_silent.py` using **`unittest`** (matching the existing test files in that directory):
    ```python
    import os, subprocess, sys, unittest

    class TestStopHookFailSilent(unittest.TestCase):
        def test_runs_with_code_sessions_enabled_and_no_base_url(self):
            env = {**os.environ, "DASHCLAW_BASE_URL": "", "DASHCLAW_API_KEY": "", "DASHCLAW_CODE_SESSIONS_ENABLED": "1"}
            result = subprocess.run(
                [sys.executable, "hooks/dashclaw_stop.py"],
                input=FIXTURE_STDIN, env=env, capture_output=True, timeout=10,
            )
            self.assertEqual(result.returncode, 0)
            self.assertNotIn(b"Traceback", result.stderr)
    ```
- **Exit gate:** Phase 3 tests green. Wes runs a short real Claude Code session with `DASHCLAW_CODE_SESSIONS_ENABLED=1` and confirms a `code_sessions` row with `source='hook'` and raw `cache_read_tokens`/`cache_creation_tokens` populated; tool_uses link to action_ids.

### Phase 4 — Local CLI (`@dashclaw/cli code …`)

Extend the existing `@dashclaw/cli` v0.3.0 package. Sibling package; no workspaces; treats `dashclaw` as an installed peer.

- New subcommand group `dashclaw code` registered in `cli/bin/dashclaw.js`:
  - `dashclaw code ingest [--once|--watch] [--dry-run]` — Path B JSONL ingest.
    - Reads `CLAUDE_PROJECTS_DIR` (default `%USERPROFILE%\.claude\projects` on Windows / `$HOME/.claude/projects` elsewhere).
    - For each `.jsonl` file: stat the file, build a request body per A6 (`source_host = 'jsonl'`, `source_mtime = stat.mtimeIso`, `jsonl_lines = all lines`, `session_uuid = null` because the CLI doesn't always know it; the server extracts it from the first qualifying record).
    - POST to `<BASE_URL>/api/code-sessions/ingest-jsonl` using a small `fetch` wrapper with `x-api-key` header from the existing `resolveConfig()` helper in `cli/lib/config.js`. **Do not** wait on the `dashclaw` SDK to expose a method — the installed SDK version is `^2.2.1` which is older than the current `2.12.0`, and the autonomous run cannot `npm publish`. Direct `fetch` is the right path.
    - Streamed file read line by line. Skip files larger than 50 MB with a warning logged to stderr — chunked POST is out of scope.
    - Log per-file `{file, posted_lines, status, reason}`. **Never logs raw line content.**
  - `dashclaw code apply <manifestId> [--dest=<dir>] [--yes]` — see Phase 6 for the wire format.
  - `dashclaw code memo [--project=<slug>] [--save]` — fetch the latest weekly memo.
- The CLI **does not** import `app/lib/claude-code/*`. No monorepo workspace; cross-package imports would require build tooling. Server-side parsing per A6 means the CLI never needs the parser. The only AgentLens-derived code in the CLI is the apply-time path-traversal guard (`_ensureInsideProject`) and the `applyMerge` function — these are small enough to **vendor** into `cli/lib/code/` directly. Vendored files carry a header comment pointing to `app/lib/claude-code/optimal-files/merge.js` as the canonical source. Add `scripts/sync-cli-vendored-code.mjs` (run manually after edits to the canonical source) to keep them in sync.
- **Tests under `cli/test/code/`.** The `cli` package currently has no `test/` directory and **no `test` script in `cli/package.json`** (verified). Add:
  - `"test": "node --test test/**/*.test.js"` to `cli/package.json` `scripts` (use `node --test` rather than vitest — no jsdom needed, smaller dep footprint, matches the `engines: { node: '>=18.0.0' }` minimum).
  - `cli/test/fixtures/claude-projects/` fixture tree with 2 projects, 3 sessions, one with a known repeated-run pattern.
  - Test ingest flow against a local stub HTTP server (`node:http`). Assert payload shape, env-var resolution from `resolveConfig`, idempotency (re-running posts same `source_mtime` → server can return `skipped`), exit codes.
- **Tests cover:** env-var resolution, payload shape against a fixture project tree at `cli/test/fixtures/claude-projects/`, idempotency (re-running posts same `source_mtime` → server skipped), exit codes.
- Apply-mode tests deferred to Phase 6.
- **Exit gate:** `dashclaw code ingest --dry-run` against `cli/test/fixtures/claude-projects/` prints expected POST payload summary. Live mode against a local dev DashClaw round-trips into the DB. Wes runs live mode against his real `~/.claude/projects` himself.

### Phase 5 — UI: Code Sessions

First UI cut. Match existing IA. Data renders.

- New top-level route `app/code-sessions/`:
  - `page.js` — projects table.
  - `[projectId]/page.js` — sessions table with `source` badge.
  - `[projectId]/[sessionId]/page.js` — session detail with three panels: **Summary** (model mix, cost breakdown derived from `code_session_messages`, cache health with 0.30 flag, source badge), **Timeline** (messages with role/model/tokens/cost + inline tool calls; when `tool_use.action_id` is set, show a "governed" badge linking to `/replay/<action_id>`), **Signals** (repeated-runs grouped by tool + confidence badges; optimizer findings with rule code + savings; alerts panel with read/unread state).
- Sidebar: insert "Code Sessions" entry between Actions and Analytics. Show unread alert count.
- **Signals + alerts wiring:**
  - Both `POST /api/code-sessions/ingest-jsonl` and `POST /api/code-sessions/from-hook` (the latter is the same endpoint via A1) trigger optimizer + alerts recomputation at session-upsert time:
    - `runOptimizer(buildSessionContext(...))` → upsert into `code_session_signals` (delete-then-insert for the session, matching the upsert semantics).
    - `detectForSession(...)` → insert into `code_session_alerts` with `ON CONFLICT ON CONSTRAINT code_session_alerts_dedup DO NOTHING` (the partial unique index must be named `code_session_alerts_dedup` in the Phase 2 migration so this conflict target works).
  - **Weekly cache-crater check via Vercel cron, NOT `scheduled_jobs`.** DashClaw's active cron mechanism is Vercel crons declared in `vercel.json` pointing at `/api/cron/*` routes (existing examples: `outcome-sweep`, `reset-meters`). The `scheduled_jobs` table exists in schema but has no active runner.
    1. Create `app/api/cron/code-session-cache-crater/route.js` following the shape of `app/api/cron/outcome-sweep/route.js`: `export const dynamic = 'force-dynamic'`, `export const maxDuration = 60`, GET handler. **Auth pattern:** read `process.env.CRON_SECRET`; if missing return 503; otherwise read `Authorization` header and `timingSafeCompare(authHeader, \`Bearer ${cronSecret}\`)` — same shape as outcome-sweep verified at `app/api/cron/outcome-sweep/route.js`. Then iterate orgs, run `detectCacheCrater` per (org, project, ISO week), insert alerts.
    2. Add to `vercel.json` `crons` array: `{ "path": "/api/cron/code-session-cache-crater", "schedule": "0 3 * * 1" }` (Monday 03:00 UTC).
    3. Idempotency from the partial unique index on `code_session_alerts(org_id, kind, COALESCE(project_id,''), COALESCE(session_id,''))` (Phase 2 schema).
- **Learning bridge:**
  - `GET /api/learning/code-signals?period=30d` — joins `code_session_signals` with `code_sessions` and `action_records` (when `tool_uses.action_id` is set). Returns top findings grouped by `kind` (rule id) with total `savings_usd`. **Does not write into `learning_recommendations`.**
  - On `app/learning/page.js` (the existing learning page; a single 34KB file), add a "Code Recommendations" tile that reads this endpoint. Match the existing component composition pattern in that file — do not introduce a new layout primitive. If the page is currently a server component and the new tile needs client-side fetching, follow whatever pattern the surrounding tiles already use.
- **Tests** under `__tests__/unit/code-sessions-ui/` (component tests; reuse the JSX test patterns from `__tests__/unit/capabilities.page.test.jsx`) and `__tests__/unit/code-sessions/` (signals/alerts repository tests using `createSqlMock`). For each of the 7 rules: a fixture session that triggers it and one that does not. For each alert kind: a fixture that triggers it. Idempotency on re-ingest (re-run produces zero new rows). Cron route test: `__tests__/unit/cron-cache-crater.route.test.js` exercises the new `/api/cron/code-session-cache-crater` route with mocked SQL, asserts the `CRON_SECRET` `timingSafeCompare` guard, walks orgs, calls `detectCacheCrater`, and inserts alerts.
- **Exit gate:** logged-in user with ingested data navigates Projects → Session → Detail and sees real numbers from both hook-sourced and JSONL-sourced sessions, including signals + alerts. Wes confirms with a real session.

### Phase 6 — Generate Optimal Files (regular routes + manifest + CLI apply)

The differentiated AgentLens feature. **Not** a DashClaw capability. Regular routes + MCP tools (Phase 8).

- **Routes:**
  - `POST /api/code-sessions/sessions/[sessionId]/optimal-files/preview` — calls `buildOptimalFilesBundle` with pre-queried `projectMedianCost` + `similarSessionCount`, empty `projectFiles` map, empty `existingPaths` set. Returns grouped preview (Recommended-now / Optional / Not-recommended-yet) with per-file confidence, secret-scan status, `overwriteRisk='unknown'`. **Does not** touch disk; does not persist a manifest.
  - `POST /api/code-sessions/sessions/[sessionId]/optimal-files/manifest` — body `{ selections: [{path, overwrite?, mode?: 'skip'|'side_by_side'|'merge'|'overwrite', acceptedHeadings?, acceptedBullets?}] }`. Validates: each `path` must match an entry in the bundle, paths restricted to `CLAUDE.md`, `.claude/agentlens/*`, `.claude/rules/*`, `.claude/hooks/*`, `.claude/skills/*`, path-traversal refused. Rebuilds the bundle, calls `planBundleSelections` (pure). Stores the resolved plan in `code_optimal_file_manifests` with `expires_at = NOW() + INTERVAL '24 hours'`. Returns `{ manifest_id, expires_at }`.
  - `POST /api/code-sessions/sessions/[sessionId]/optimal-files/merge-preview` — body `{ path }`. Returns the merge plan (`previewBundleMerge` output) for one bundle file. The server cannot read the user's on-disk file, so this endpoint returns the **bundle-side** plan — the CLI computes the actual on-disk merge at apply time. (The original AgentLens endpoint had access to disk; this one doesn't. Document that the CLI's apply step is where the real merge happens.)
  - `GET /api/code-sessions/manifests/[manifestId]` — returns the plan JSON. Auth required; org-scoped. Refuse if `expires_at < NOW()`.
- **UI:** on session detail (Phase 5), add a "Generate Optimal Files" button. Clicking shows preview with confidence / secret-scan / `overwriteRisk='unknown'` badges, per-file Copy / Download, three-way merge dialog for conflicts (note: the dialog presents on-bundle merge candidates; the user picks which headings/bullets to accept). After selection, the UI calls `manifest` and presents a one-line shell command for copy-paste: `dashclaw code apply <manifestId> --dest=<project-cwd>`.
- **CLI apply (`dashclaw code apply`):**
  - Fetches manifest via `GET /api/code-sessions/manifests/[manifestId]`.
  - For each selected file:
    1. Compute the absolute path inside `--dest`. Refuse path-traversal (port AgentLens's `_ensureInsideProject`).
    2. Re-run `secret-scan` on the file's content. If `redactions.length > 0` and the user did not pass `--allow-redactions`, refuse the file and continue.
    3. Apply per `mode`:
       - `skip` — no-op.
       - `side_by_side` — write to `<path>.NEW`. Refuse to clobber existing `.NEW` unless `--overwrite`.
       - `merge` — read existing file, call `applyMerge` with `acceptedHeadings` + `acceptedBullets` from the manifest, write result.
       - `overwrite` — write directly (refuse without `--yes` or explicit prompt confirm).
    4. Per-file status reporting: `{ path, status: 'written'|'skipped'|'redacted'|'merged'|'conflict'|'refused', reason }`.
- **MCP exposure:** add two new tools to `mcp-server/lib/tools.js` (hand-curated additions):
  - `dashclaw_optimal_files_preview` — input `{ session_id }`. Handler calls `POST /api/code-sessions/sessions/{id}/optimal-files/preview`. Returns the preview JSON.
  - `dashclaw_optimal_files_manifest` — input `{ session_id, selections }`. Handler calls `POST .../manifest`. Returns `{ manifest_id, expires_at, apply_command }`.
- **Tests:** unit tests for `planBundleSelections` already exist from Phase 1. Route tests under `__tests__/integration/code-sessions/optimal-files.route.test.js`: preview returns expected groups; manifest validates paths and persists; manifest expires after 24h. CLI test under `cli/test/code/apply.test.js`: fixture manifest → temp dest dir → all four modes asserted; path-traversal refused.
- **Exit gate:** end-to-end demo with a fixture session: preview → manifest → `dashclaw code apply <manifestId> --dest=tmp/sandbox/` writes the expected files. Wes runs the same flow against a real session writing into `C:\Projects\DashClaw\tmp\optimal-files-sandbox\`.

### Phase 7 — /goal autopsy, Subagent ROI, Weekly memo

- `GET /api/code-sessions/sessions/[sessionId]/autopsy` — uses `goals.js#buildAutopsy` with messages + tool_uses + signals loaded from the repository.
- `GET /api/code-sessions/subagent-roi?project_id=...` — `computeRoi` over subagent invocations. **Prefer** `action_records.parent_action_id` chains where present (higher-fidelity than JSONL re-derivation); fall back to JSONL-derived invocations otherwise. Document the selection logic in the route.
- `GET /api/code-sessions/memos?project_id=...` — list persisted memos. `POST /api/code-sessions/memos/regenerate?project_id=...` — manual rerun. **Weekly memo generation via Vercel cron**, same pattern as cache-crater: create `app/api/cron/code-session-weekly-memo/route.js` and add `{ "path": "/api/cron/code-session-weekly-memo", "schedule": "0 4 * * 1" }` to `vercel.json` (Monday 04:00 UTC). One memo per (org, project, ISO week), idempotent via `UNIQUE(org_id, project_id, iso_week_tag)` on `code_session_memos`.
- UI: three new tabs/subpages under Code Sessions. Memos render as markdown.
- **Tests:** fixture-driven, stable on rerun.
- **Exit gate:** all three views render with real data.

### Phase 8 — MCP resources, plugin notes, archive

- **MCP resources** in `mcp-server/lib/resources.js`:
  - `dashclaw://code-sessions/projects` → calls `GET /api/code-sessions/projects`.
  - `dashclaw://code-sessions/sessions/{session_id}` → calls `GET /api/code-sessions/sessions/{id}`.
  - Add definitions and handlers following the existing pattern.
- Smoke test under `__tests__/unit/mcp-server-code-sessions.test.js`: imports `TOOL_DEFINITIONS` from `mcp-server/lib/tools.js` and `RESOURCE_DEFINITIONS` from `mcp-server/lib/resources.js`, asserts the new entries are present.
- **OpenClaw plugin (`packages/openclaw-plugin/`):** README note linking to the Code Sessions surface. No config-schema changes.
- **Codex plugin (`plugins/dashclaw/`):** add a short skill blurb under `plugins/dashclaw/skills/dashclaw-platform-intelligence/` describing the new surface. No new MCP server.
- **`@dashclaw/cli`:** update `cli/README.md` to document `dashclaw code …`.
- **`hooks/README.md`:** document the new `DASHCLAW_CODE_SESSIONS_ENABLED` env var.
- **AgentLens archive (no deletions):**
  - `C:\Projects\RevenueGoalExperiment-V3\ARCHIVED.md` explaining absorption with pointers to this goal and to `C:\Projects\DashClaw`.
  - `C:\Projects\RevenueGoalExperiment-V3\README.md` top section updated to "Archived; absorbed into DashClaw — see ARCHIVED.md."
- **DashClaw memory + CHANGELOG:**
  - `CHANGELOG.md` entry under a 2.15.0 bump summarizing the absorption.
  - `CLAUDE.md` note that `app/lib/claude-code/` is the canonical home for session analytics logic.
  - `C:\Users\sandm\clawd\memory\projects\dashclaw.md` updated: DashClaw now includes Claude Code session telemetry (Path A hooks + Path B JSONL backfill), Generate Optimal Files routes, and absorbed AgentLens.

### Phase 9 — Cleanup helpers (small, focused)

- `scripts/repair-code-sessions.mjs` — operator-run script to find orphan `code_sessions` rows (sessions whose child rows were lost mid-upsert) and either re-ingest them from the original JSONL file (if `source='jsonl'` and `source_file` still exists) or mark them for re-collection on next hook turn. Runs idempotently.
- `scripts/backfill-code-session-cache-cost.mjs` — operator-run; re-prices historical `code_sessions` rows using the new 5-arg `estimateCost` extras. Opt-in only. Logs every change. Never modifies `action_records`.

---

## Verification gates (run all before declaring done)

- `npm test`: full suite green. New tests under `__tests__/unit/claude-code/`, `__tests__/unit/code-sessions/`, `__tests__/integration/code-sessions/`, `__tests__/unit/code-sessions-ui/`, `__tests__/unit/billing-cache.test.js`, `__tests__/unit/mcp-server-code-sessions.test.js` together pass **≥140 new tests**. No `.skip`. No echo-tests.
- `npm run lint` clean.
- `npm run build` succeeds (Next.js production build).
- `npm run db:migrate` applies cleanly on a fresh local Postgres; generated `drizzle/0006_*.sql` committed; partial unique index on `code_session_alerts` present in the SQL.
- **Hook fail-silent regression:** `python hooks/tests/test_stop_fail_silent.py` passes — `DASHCLAW_BASE_URL=""` with `DASHCLAW_CODE_SESSIONS_ENABLED=1` exits 0 with no stderr Traceback.
- **Pricing parity:** vitest test asserts every existing `DEFAULT_PRICING` entry returns identical `estimateCost` numbers before and after the cache extension when called with the legacy 4-arg signature.
- **Mission Control regression check:** before any Phase 3+ work, capture Mission Control's Agent Spend (30D) for `agent_id='claude-code'` and the Operations Feed row count for the last hour. After Phase 7 completes and a real session has ingested, capture both again. The 30D spend must be **bit-identical** (within float rounding). The Operations Feed row count must not gain entries from `code_session_alerts` (per A11). If either fails, stop and append an addendum to this file.
- **Manual smoke (Wes runs):**
  1. With hooks installed and `DASHCLAW_CODE_SESSIONS_ENABLED=1`, run a short real Claude Code session. Confirm `code_sessions` row with `source='hook'`, raw `cache_read_tokens` / `cache_creation_tokens` populated, tool_uses linked to action_ids.
  2. `dashclaw code ingest --once` against a fixture; data visible in the UI.
  3. Navigate Projects → Session → Detail. See cost, cache health, repeated-runs, signals, alerts. **Confirm the Summary panel shows both "Code Sessions cost" and "Mission Control attribution" side-by-side** (per A10). Click "governed" badge → opens `/replay/<action_id>`.
  4. Mission Control unchanged: Agent Spend (30D) tile shows the same number for `claude-code` as before the run (within new-session delta), Operations Feed does not show new code-session alert kinds.
  5. Generate Optimal Files on a real session → receive manifest → `dashclaw code apply <manifestId> --dest=C:\Projects\DashClaw\tmp\optimal-files-sandbox\` writes the expected files (no real-repo writes during autonomous build).
  6. MCP client lists `dashclaw_optimal_files_preview` + `dashclaw_optimal_files_manifest` and invokes preview end-to-end.

---

## Deliverables checklist

- [ ] `app/lib/claude-code/` ESM module: parser (`parseSessionFile` + `parseSessionLines`), pricing, repeated-runs, insights, optimizer (incl. 7 rules in `rules/`), alerts, goals, memo, subagent-roi, audit, claudemd, hooks-gen, secret-scan, 10-file `optimal-files/` subdirectory with `apply.js` separated. No DB. No HTTP. No `fs` (except `optimal-files/apply.js`).
- [ ] AgentLens tests rewritten in vitest under `__tests__/unit/claude-code/`. ≥140 passing.
- [ ] `app/lib/billing.js` pricing schema extended with `cache_write`/`cache_read` (defaults 0). `estimateCost` 5-arg signature with optional `extras`. Legacy 4-arg parity test.
- [ ] Drizzle schema additions in `schema/schema.js`. Generated migration committed at `drizzle/0006_*.sql` including the manual partial unique index on `code_session_alerts`. `npm run db:migrate` applies cleanly.
- [ ] `app/lib/repositories/code-sessions.repository.js` with full upsert + read surface using non-atomic `ON CONFLICT` sequence.
- [ ] `POST /api/code-sessions/ingest-jsonl` (Path A + Path B share this endpoint) and GET endpoints under `app/api/code-sessions/`.
- [ ] `hooks/dashclaw_code_session_reporter.py` plus opt-in `DASHCLAW_CODE_SESSIONS_ENABLED` integration in `dashclaw_stop.py`. Fail-silent contract preserved. Python regression test `test_stop_fail_silent.py` landed.
- [ ] `dashclaw code ingest|apply|memo` subcommands in `cli/bin/dashclaw.js`. **No parser code in the CLI** — server-side parsing only.
- [ ] `app/code-sessions/` UI: projects, sessions, session detail with governed-action cross-links.
- [ ] Optimizer + alerts pipeline wired into ingest. Sidebar unread count. Scheduled job for weekly cache-crater. Learning analytics "Code Recommendations" tile.
- [ ] Optimal Files preview + manifest + merge-preview routes. UI button + dialog. CLI apply with three-way merge.
- [ ] `dashclaw_optimal_files_preview` and `dashclaw_optimal_files_manifest` MCP tools added to `mcp-server/lib/tools.js`.
- [ ] /goal autopsy, Subagent ROI, Weekly memo routes + UI tabs.
- [ ] `mcp-server/lib/resources.js` additions for `dashclaw://code-sessions/...`.
- [ ] OpenClaw plugin README note. Codex plugin skill blurb. CLI README update. Hooks README env-var doc.
- [ ] `scripts/repair-code-sessions.mjs` and `scripts/backfill-code-session-cache-cost.mjs`.
- [ ] AgentLens repo archived (no deletions). DashClaw CHANGELOG entry under 2.15.0. Memory note updated.
- [ ] All verification gates passed.

---

## Paste-ready command

```text
/goal Implement @AGENTLENS_INTEGRATION_GOAL.md fully. Read the "Source-of-truth reading list", "Verified facts to internalize before any code change", and "Architecture decisions" sections first and treat them as authoritative. Inspect both repos before starting — DashClaw at C:\Projects\DashClaw (HEAD as of 2026-05-13) and AgentLens at C:\Projects\RevenueGoalExperiment-V3. Execute phases 1 through 9 in order, with every exit gate passing before moving to the next phase. Honor every hard rule. No external actions, no deployments, no npm publish, no Wes-identity use. Run the full verification gate suite before declaring done. Append a stanza to CHANGELOG.md at the end of each phase. If you discover a constraint that makes a phase decision wrong, stop and append a rationale as an addendum to this goal file rather than silently changing direction.
```
