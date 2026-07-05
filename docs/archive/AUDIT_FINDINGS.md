# DashClaw End-to-End System Audit — Findings Log

**Started:** 2026-06-03
**Auditor:** Claude (ultracode multi-agent orchestration)
**Branch:** main @ 0907fb04

## Baseline (ground truth, run before audit)

| Gate | Result |
|------|--------|
| `npm run lint` (eslint .) | ✅ clean, 0 warnings |
| `npx vitest run` (full suite) | ✅ 2612 passed, 5 skipped (337 files) |
| `npx next build` | ✅ exit 0 |
| `npm audit` | ✅ 0 vulnerabilities |
| TODO/FIXME/HACK in source | 7 markers |

The repo passes all automated gates. This audit targets what those gates do **not** catch:
correctness gaps, logic edge cases, doc drift, stale references, dead files, tooling/config issues.

## System map

- **Frontend:** 88 pages (`app/**/page.{js,jsx}`), 79 components (`app/components/`)
- **Backend:** 272 API routes (`app/api/**/route.js`), 44 repositories, ~120 lib modules, `middleware.js`
- **SDKs:** Node (`sdk/`), Python (`sdk-python/`), CLI (`cli/`), MCP server (`mcp-server/`)
- **Tooling:** hooks (`hooks/`, `.claude/hooks/`), plugin (`plugins/dashclaw/`), skills (`.claude/skills/`), 13 CI workflows
- **Design boundary:** governance runtime, NOT an agent platform. Free-tier-only deploy. No payment provider by design. Setup needs no LLM key. `app/api/_archive/` is intentionally frozen.

---

## Direct verification (main-loop, pre-workflow)

**Automated guard battery — ALL GREEN** (ground truth, run this session):

| Guard | Result |
|-------|--------|
| `docs:check` | ✅ docs validation passed |
| `version:check` | ✅ no hardcoded version drift (canonical 2.18.0 / 3.0.0 / 2.14.0 / 1.0.2) |
| `openapi:check` | ✅ artifact up to date |
| `route-sql:check` | ✅ no direct-SQL increase (83 at baseline) |
| `contracts:check` | ✅ passed |
| `scripts:check-syntax` | ✅ 130 files OK |
| `api:inventory:check` | ✅ artifacts up to date |
| CI workflow → npm-script wiring | ✅ every `npm run X` in ci.yml / refresh-model-pricing.yml exists |

**Staged findings from direct inspection** (cross-checked below by workflow auditors):

| # | Sev | Finding | Location | Fix risk |
|---|-----|---------|----------|----------|
| D1 | low | `PROJECT_DETAILS.md` route count stale: says **270** (200 experimental); generated `docs/api-inventory.md` says **271** (201 experimental) | `PROJECT_DETAILS.md:28` | trivial |
| D2 | low | `.claude/hooks/` local install **drifted** from canonical `hooks/` source (missing `behavior_recorder.py`; `mcp_monitor.py`/`tool_recognizer.py`/3 top scripts differ). Gitignored, local-only — does not affect shipped product | `.claude/hooks/` | operator (local env) |
| D3 | low | Dead code: `generatePytestTests` is a stub emitting `# TODO: implement pytest generator`; both it and the implemented `generateJestTests` are **unreferenced** repo-wide | `app/lib/guardrails/generators/{pytest,jest}.js` | operator (tracked, "absorbed") |
| D4 | info | Stale root docs (last touched March 2026): `PROJECT_CONTEXT.md`, `AI_WORKFLOW.md`, `verify.js`, `verification.py` — archival candidates | repo root | operator (tracked) |
| D5 | low | Untracked cruft: `nul` (294B Windows device-redirect artifact), `findings.json` (gitnexus transient) — safe to remove | repo root | trivial (untracked) |

## Method

Orchestrated **20 scoped auditor agents → 20 adversarial verifiers** (40 agents, 3.5M tokens, 1323 tool-uses) across all six sections, each finding grounded in `file:line` evidence. The verifier pass returned **0 refutals of 92**, so I independently re-verified every HIGH/MEDIUM against the live code before acting (this caught 2 false-positive-shaped items: the `mcp/route.js` "sync params" was the JSON-RPC body field, not Next route params; and a Glob false-negative on `app/api/actions/**`). Net confirmed: **92 findings — 12 high, 15 medium, 47 low, 18 info.**

## Section-by-section status

| Section | Clean | Fixed this session | Flagged for operator |
|---------|-------|--------------------|----------------------|
| **1. Frontend** | Core pages (mission-control, decisions, setup, connect, dashboard, login) render correctly; data shapes match backends; loading/error states present | Buffer-in-browser crash (Replay "Policies" tab) ×2 pages; my-agent + assumptions agent-filter bugs; messages page hard-break; 6 unused landing imports | Orphaned pages wired to archived APIs (tokens/calendar/relationships/content); page-gate matcher gaps; dead components/imports; policy-generate agent scope; audit-log pagination reset |
| **2. Backend** | 271 routes wired; repository pattern intact; `route-sql`/`openapi`/`inventory`/`contracts` all green; auth applied broadly | 2 broken eval routes (Next 16 async `params`); approval-poll 405 message | Missing admin gate on `/api/policies/generate`; guard validation strips `intel`/`tool`/`write_paths`; input-validation 500s; env-var doc drift; revoked-key cache staleness |
| **3. Logic** | Governed-action loop (guard→record→approve→replay) solid; account-state handling consistent | Native-notification credential decryption (silent alert failures) | `require_approval` ignored on workflow-execute + capability-invoke approval surfaces not fired; Stripe scaffolding (intentional/dormant — confirm); fire-and-forget without `after()` |
| **4. Tooling** | CI npm-script wiring 100% correct; plugin/skill structure sound; hooks fire on correct events | Installer omitted code-session reporter; hooks/README category examples ×4 | Local `.claude/hooks/` drift vs source; local skill-doc drift (gitignored); BashBackground catalog note |
| **5. Documentation** | OpenAPI/inventory/contracts artifacts current; runtime-api loop accurate | Route counts (270→271) ×2; SDK version de-hardcoded; durable-finality cron architecture; runtime-api method count | platform-intelligence snapshot (259 routes); GEMINI.md stack mismatch; monetization-plan tool count; stale root docs |
| **6. Staleness** | `npm audit` 0 vulns; deps current or intentionally pinned (React 18, Tailwind 3); only 1 real TODO in source | Removed `nul` + `findings.json` cruft; email default `.com`→`.io` | Self-dep `dashclaw` 2.13→3.0; dead guardrail generators; eslint-config-next a major behind; gmail alert default; stale March root docs |

## Fixes applied this session (19, all verified green)

**HIGH-severity bugs (real runtime breakage, invisible to build/tests):**
1. `app/api/evaluations/runs/[runId]/route.js` — `params` not awaited (Next 16) → `runId` undefined → route broken. Fixed both GET + PATCH. (76 routes already await; these were outliers.)
2. `app/api/evaluations/scorers/[scorerId]/route.js` — same; PATCH/DELETE were silent no-op writes. Fixed both.
3. `app/decisions/[actionId]/page.js` + `app/actions/[actionId]/page.js` — `Buffer.from()` in `'use client'` components crashed the Replay "Policies" tab in-browser (`Buffer` not polyfilled by Next 16). Swapped to `btoa()`.
4. `app/my-agent/page.jsx` — read `guardJson.evaluations` but `/api/guard` returns `{ decisions }` → denials never displayed. Fixed key (+ corrected the test that masked it, see #19).
5. `app/lib/notification-adapters/index.js` — `deliverNativeNotifications` used raw setting values; encrypted Slack/Discord/Linear/GitHub/email credentials were sent as ciphertext → silent alert failures. Added decryption mirroring `integration-health.js` (no-op for non-encrypted rows).
6. `app/messages/page.js` — archived `/api/messages/docs` 404 threw inside `Promise.all`, hard-breaking the whole inbox. Made `fetchDocs` fail-soft.

**MEDIUM:**
7. `app/assumptions/page.js` — destructured `selectedAgentId` (nonexistent) from `useAgentFilter()`; agent filter silently ignored. Fixed to `agentId`.
8. `app/lib/notification-adapters/email.js` — SendGrid default sender `alerts@dashclaw.com` → `alerts@dashclaw.io` (owned domain).
9. `app/api/capabilities/[capabilityId]/invoke/route.js` — 202 approval response told callers to poll `/api/approvals/{id}` (POST-only → 405). Repointed to `GET /api/actions/{id}` (×2).
10. `scripts/install-hooks.mjs` (+ `hooks/README.md`) — installer never copied `dashclaw_code_session_reporter.py`, silently disabling Code Sessions after install. Added to copy loop + README.

**Documentation:**
11. `PROJECT_DETAILS.md` — route count 270→271/201; de-hardcoded stale SDK version `2.13.1` (now references `sdk/package.json`).
12. `README.md` — route count 270→271/201.
13. `docs/architecture/durable-execution-finality.md` — corrected false "daily via Vercel cron" claim → GitHub Actions every 15 min (vercel.json has no `crons`; free-tier).
14. `docs/architecture/runtime-api.md` — stale `2.11.1`/`92 methods` → `107` + `npm run sdk:count` reference.
15. `hooks/README.md` — `interactive`/`search` category examples corrected (WebFetch/WebSearch are `search`, not `interactive`; RemoteTrigger is `orchestration`) ×4 spots.

**LOW / cleanup / test:**
16. `app/page.js` — removed 6 unused lucide-react imports.
17. `app/api/webhooks/route.js` — corrected misleading secret-mask comment.
18. Removed gitignored cruft `nul` (stray Windows device-redirect artifact from another project) + `findings.json` (gitnexus transient).
19. `__tests__/unit/my-agent-page.test.jsx` — the test mocked `/api/guard` with the wrong `{ evaluations }` key (self-consistently validating the #4 bug). Corrected to `{ decisions }`.

## Flagged for operator review (NOT auto-fixed — by priority)

**P1 — Governance/security correctness (verified real; need owner judgment):**
- **`guard-intel-stripped` (HIGH)** — `GUARD_INPUT_SCHEMA` (`app/lib/validate.js:232`) omits `intel`/`tool`/`write_paths`; `validate()` drops non-schema keys, and the route feeds the engine the stripped `data`. So `green_contract`, `branch_freshness`, `permission_escalation`, and `protected_path` policies read undefined context → **4 of 12 policy types silently no-op over HTTP.** *Patch:* add `intel: { type: 'object' }`, `write_paths: { type: 'array' }`, `tool: { type: 'object' }` to the schema; reconcile hook's top-level `tool` vs policy's `intel.tool`; add a route-level test. **Enforcement-semantics change** — could start blocking actions that pass today, so review + test before shipping.
- **`policies-generate-missing-admin-gate` (HIGH, auth)** — `app/api/policies/generate/route.js:23-70` writes guard policies with no admin-role check, unlike every sibling policy-write route. *Patch:* add `getOrgRole(request) !== 'admin' → 403` before the write branch.
- **`workflow-execute-ignores-require-approval` (HIGH)** — `app/api/workflows/templates/[templateId]/execute/route.js:110-174` handles `block` but falls through `require_approval` and runs anyway. Needs a pending-approval branch (record + 202 + approval surfaces) mirroring capability-invoke.
- **`capability-invoke-approval-surfaces-not-fired` (MED)** — `app/api/capabilities/[capabilityId]/invoke/route.js` creates `pending_approval` records but never fires Discord/Telegram/webhook approval notifications like `/api/actions` does.

**P2 — Product decisions (live surfaces wired to archived `_archive`-only routes):**
- **`context-threads-route-archived-but-sdk-live` (HIGH)** — documented SDK `createThread`/`addThreadEntry`/`closeThread` call `/api/context/threads` which is archived-only (404). Restore the route or retire the SDK methods + docs.
- **`orphaned-pages-archived-apis` (MED)** — `/tokens`, `/calendar`, `/relationships`, `/content` pages (and `TokenChart`/`TokenBudgetCard`) fetch archived-only APIs → permanently empty. Delete the pages or restore the routes. (`/messages` docs tab is now fail-soft but shares this decision.)

**P3 — Infra / deps / migrations:**
- **`dashclaw-selfdep-major-behind` (HIGH)** — root `package.json` pins `dashclaw` `^2.13.0` (resolves 2.13.0) while published + local SDK is 3.0.0. Latent (no consumer calls v3-only methods yet). Bump + refresh lockfile.
- **`api-keys-key-hash-no-index` (MED, migration)** — no index on `api_keys.key_hash`, the hottest auth-lookup column (sequential scan on cache-miss). Add an index migration + mirror in `schema/schema.js`.
- `revoked-key-cache-staleness` (info) — revoked keys valid up to 5 min (apiKeyCache TTL); `expired-oauth-rows-not-purged` (info) — no purge of expired OAuth codes/tokens.

**P4 — Frontend behavior (correct fix known; needs in-browser verification per no-DevTools rule):**
- **`policy-generate-empty-agent-scope` (MED)** — `app/policies/generate/page.jsx:208` hardcodes `agents={[]}`; generated policies can't be agent-scoped. *Patch:* fetch `/api/agents` into state, pass through.
- **`audit-log-loadmore-resets` (MED)** — `app/audit-log/page.js` has `offset` in the fetch effect's deps → "Load more" re-runs a reset instead of appending.

**P5 — Doc/local staleness (lower impact):**
- Local-only (gitignored, won't appear in commit): `register-on-dashclaw`/`build-dashclaw`/`dashclaw-agent` skill docs cite removed `POST /api/agents`, `governance:boundary:check`, phantom `app/(extensions)/` dir, stale method counts; `.claude/hooks/` installed copy drifted from `hooks/` source. *Recommend re-running `node scripts/install-hooks.mjs --target=.` and refreshing local skills.*
- `platform-intelligence` snapshot claims 259 routes; `GEMINI.md` describes TypeScript+FastAPI (repo is JS/Next); `monetization-plan.md` says 23 MCP tools (actual 26); stale March root docs (`PROJECT_CONTEXT.md`, `AI_WORKFLOW.md`, `verify.js`, `verification.py`) use old "policy firewall" framing — archival candidates.
- `app/lib/notifications.js:18` defaults alert sender to your personal `practicalsystems.io@gmail.com` (env-overridable) — consider `alerts@dashclaw.io`. Left as-is (your address + deliverability).
- Dead code: `app/lib/guardrails/generators/{pytest,jest}.js` (unreferenced; pytest is a TODO stub) — deliberately "absorbed," so left for your call.
- `eslint-config-next` pinned `^15` while `next` is `^16` (lint config trails framework a major); DOMPurify override still effective but its stated rationale is stale.

**Intentional (no action — recorded to resolve audit-premise tension):**
- `stripe-payment-integration-present` (info) — real Stripe checkout/portal/webhook routes exist but are **dormant** (501 when env unset) per `docs/monetization-plan.md` (monetization UI retracted in 2.18.0). Not a bug; confirm whether dormant scaffolding should remain shipped.

## Full finding appendix (47 low + 18 info)

Complete grounded list (every `file:line` + evidence + verifier reasoning) is in **`.audit-findings-full.md`** at repo root (untracked working artifact). Section-grouped low/info index:

- **Backend (low/info):** `swarm-graph-dead-query`, `workflow-resume-no-quota-meter`, `workflow-duplicate-no-admin-gate`, `demo-actions-stats-duplicate-dead`, `ingest-jsonl-base64-zipbomb-unguarded`, `ingest-live-preview-check-unreachable`, env-var doc-drift cluster (`agent-online-window`, `guard-llm-model`, `disable-prompt-injection-scan`, `next-public-app-url`, `oidc-endpoint-overrides`, `google-ai-key`, `gemini-model-hardcoded`), `loops-loopid-get-join-missing-org-scope`, `analytics-days-nan-500`, `usage-costs-period-no-validation-500`, `integration-health-503-inconsistency`, `drift-routes-missing-force-dynamic`.
- **Frontend (low/info):** `matcher-omits-protected-pages`, `agents-401-swallowed`, `draggabledashboard-dead-imports`, `feedbackcard-broken-route-and-api`, `orphaned-components-zero-importers`, `goalschart-archived-api-refs`, `blog-stale-mirror-comment`, `scoring-pagelayout-description-prop`, `workflows-single-delete-no-feedback`, `workflows-misleading-client-admin-header`, `model-strategies-dead-createdefault`, `swarm-unused-lucide-imports`, `policies-customtab-type-filter-incomplete`, `relationships-hardcoded-today`, `usage-dead-state-imports`, `tokens-monthly-equals-weekly`.
- **Logic (low/info):** `eval-run-no-after`, `sse-maxduration-timer-leak`, `orgs-seed-no-await-no-after`, `token-dead-imports-and-diverging-formatcost`, `guard-get-selfhost-branch-redundant`, `connect-page-stale-card-counts`.
- **Tooling/Docs/Staleness (low/info):** `refresh-pricing-stale-vercel-comment`, `monetization-plan-stale-tool-count`, `readme-bashbackground-not-in-catalog`, `installed-claude-hooks-stale-vs-source`, `sdk-reference-stale-method-counts`, `build-dashclaw-approvals-bare-path`, `runtime-api-title-version`, `gemini-stack-mismatch`, `platform-intel-snapshot-259-routes`, `pytest-generator-dead-stub`, `stale-policy-firewall-framing`, `eslint-config-next-major-behind-framework`, `dompurify-override-pin-still-valid-not-redundant`.

---

## Remediation pass — 2026-06-03 (operator directive: fix P1–P4, retire P2)

All gates green after this pass: lint · **2611 JS tests** · **85 Python tests** · `next build` · 6 guard scripts (`docs/version/openapi/api-inventory/route-sql/contracts`) · `npm audit` 0 vulns.

**P1 — governance/security (all fixed):**
- `/api/policies/generate` now admin-gates the write path (`dry_run=false`), matching sibling policy routes.
- Guard validation: `GUARD_INPUT_SCHEMA` now passes through `intel` / `tool` / `write_paths` (were stripped → 4 policy types dead over HTTP); `permission_escalation` reads `context.intel.tool ?? context.tool` to match both hook and SDK shapes; added a `validate.test.js` regression test.
- `workflow-execute` now honors `require_approval` (creates a pending_approval record, fires approval surfaces, returns 202 — no longer runs the workflow).
- `capability-invoke` both `require_approval` branches now fire operator approval surfaces (Telegram/Discord/webhook) via a new shared `app/lib/approvalSurfaces.js` (mirrors POST /api/actions).

**P2 — retired (per directive):**
- Context-thread SDK methods removed from Node (`createThread`/`addThreadEntry`/`closeThread`) and Python (+`get_threads`); they called the archived `/api/context/threads`. Doc cascade updated across both READMEs, `app/docs/page.js`, `docs/sdk-parity.md`, `PROJECT_DETAILS.md`, `runtime-api.md`; **method counts 107/211 → 104/207** everywhere; parity tests updated.
- Orphaned pages deleted: `app/tokens`, `app/calendar`, `app/relationships`, `app/content` + their dead widgets (`TokenBudgetCard`, `TokenChart`, `CalendarWidget`, `FollowUpsCard`) + the dead imports in `DraggableDashboard.js`.

**P3 — infra (fixed):**
- Added `drizzle/0015_api_keys_key_hash_index.sql` (+ mirrored `keyHashIdx` in `schema/schema.js`), applied locally via `db:migrate`.
- Bumped self-dep `dashclaw` `^2.13.0 → ^3.0.0`; lockfile refreshed to 3.0.0, 0 vulns.
- `expired-oauth-rows-not-purged` (info): added `purgeExpired()` to `oauth.repository.js` (drops consumed/expired auth codes + revoked/aged-out access tokens — never live or refreshable rows) and wired it into the existing `/api/cron/jti-sweep` (best-effort; won't fail the jti sweep). + repo test.
- `revoked-key-cache-staleness` (info): documented the ≤5-min per-instance cache-propagation window at the revoke handler. A cross-instance invalidation is architecturally out of scope on the free-tier serverless design (the Node route can't reach the middleware-runtime cache); revocation is immediate in the DB.

**P4 — frontend (fixed; recommend a manual browser check per no-DevTools rule):**
- Policy generator now fetches `/api/agents` and passes them to the draft editor (agent scoping was impossible).
- Audit-log pagination: `offset` moved to a `useRef` so `fetchLogs` is stable — "Load more" appends instead of snapping back to page 0 (also removed a latent duplicate-first-page).

**NEW discoveries during the retire (flagged — the audit missed these; same restore-vs-retire decision as threads):**
- **`/api/context/points` is ALSO archived** — so the entire key-points feature is dead: Python `capture_key_point` / `get_key_points` / `get_context_summary` still call the 404 route (left in place; retiring them is a product decision beyond "retire the thread methods").
- **`/workspace` "Context" tab is wholly dead** — its `Promise.all` fetches both archived `/api/context/points` and `/api/context/threads`, so the tab errors on load. Left intact (removing it makes the key-points product call). Recommend deciding restore-vs-retire for the whole `/api/context/*` namespace.
- `app/docs/page.js` documents Node `captureKeyPoint` / `getContextSummary` methods that **do not exist** in the Node SDK (pre-existing doc rot; trimmed the retired-threads mention from `getContextSummary`).
- Residual demo flavor text in `app/lib/demo/fixtures/persona-agents.js` references the retired context-thread feature (and methods that never existed) — harmless demo seed content.
