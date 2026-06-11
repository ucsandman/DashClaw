# Work Orders — Task-Grade Contracts for Agent Work

**Date:** 2026-06-11
**Status:** Approved design, pre-implementation
**Origin:** Integration of the task-grade-agent-marketplace-adapter concept (standalone MVP at `~/clawd/projects/task-grade-agent-marketplace-adapter`) into DashClaw as a native feature.

## Problem

Calling an agent today has no contract surface: untyped input, unpredictable output, no budget ceiling, no SLA, no verifiable record of what was done or what it cost. The standalone adapter MVP proved the contract model (typed schemas, budget gates, lifecycle, self-verifying receipts) but lives outside DashClaw as a separate Fastify/SQLite service with its own executor.

## Decision summary (brainstorm outcomes)

1. **Product shape:** DashClaw becomes the **contract + receipt system of record** ("task ledger"). Execution stays external — DashClaw never runs agent work. This preserves the governance boundary ("minimal governance runtime, not an agent platform"), requires no LLM key, and fits Vercel free tier (no workers, no cron).
2. **Execution side:** a claim/complete worker API + SDK methods. Any agent with an API key can be a worker. A ~100-line reference worker ships in `examples/`. The standalone MVP is demoted to prototype status (its own README notes DashClaw is canonical); its code is not vendored in.
3. **Schema model:** org-defined work order types (JSON Schema input + output contracts, budget/timeout defaults), with `research_brief` seeded as a working example.
4. **Surfaces in v1:** API + repositories + dashboard UI, Node + Python SDK methods, 2 MCP tools, full guard/policy integration.
5. **Name:** **Work Orders** — page `/work-orders`, API `/api/work-orders`. Distinct from the archived `routing_tasks` legacy (untouched).

## Architecture

```
Caller (agent/tool/human) ──POST /api/work-orders──▶ DashClaw
                                                      │ guard gate (evaluateGuard, in-process)
                                                      │ schema validation (registered input contract)
                                                      ▼
                                              work_orders ledger
                                                      ▲
Worker (any agent w/ API key) ◀─POST /claim (lease)──┤
                              ──POST /:id/complete──▶│ output-contract validation
                                                      │ receipt build + hash
                                                      │ audit record (existing record path)
                                                      ▼
                                          receipt + artifacts + governance trail
```

## Data model (3 new tables, drizzle migration)

### `work_order_types`
Org-scoped contract registry.
- `id` (`wot_` prefix), `org_id`
- `type` (slug, unique per org), `version` (e.g. `1.0`)
- `display_name`, `description`
- `input_schema` jsonb (JSON Schema), `output_schema` jsonb (JSON Schema)
- `default_max_cost_usd` numeric, `default_timeout_seconds` integer
- `status` (`active` | `disabled`)
- timestamps
- Seed: `research_brief@1.0` ported from the MVP's TASK-SCHEMAS.md, created on first access for an org (lazy seed, no migration data dependency).

### `work_orders`
- `id` (`wo_` prefix), `org_id`
- `type`, `type_version`
- `input` jsonb, `input_hash` (`sha256:` over canonical JSON)
- `budget` jsonb: `{ max_cost_usd, timeout_seconds }` (defaults from the type, overridable at submit, validated > 0)
- `status`: `pending_approval` | `queued` | `claimed` | `completed` | `failed` | `timed_out` | `cancelled` | `blocked`
- `requested_by` (agent id or user), `claimed_by` (agent id), `lease_expires_at`
- `guard_decision` jsonb (decision, risk score, matched policies, guard decision id)
- `error_code`, `error_details`
- `created_at`, `claimed_at`, `completed_at`, `updated_at`

Lifecycle rules:
- Legal transitions only; no backwards moves, no skips. Enforced in the repository layer.
- `pending_approval → queued` on approval; `pending_approval → cancelled` on deny/cancel.
- `queued → claimed` via claim (lease = `claimed_at + timeout_seconds`).
- `claimed → completed | failed` via complete; `claimed → timed_out` via lazy lease sweep.
- `queued | claimed → cancelled` via DELETE; terminal states return 409 `not_cancellable`.
- `blocked` is terminal and recorded at submit time (audit value: the ledger shows what policy stopped).
- **Lazy expiry (no cron):** list/get/claim calls sweep expired leases to `timed_out` (bounded UPDATE, same spirit as the drift tick debounce).

### `work_order_receipts`
One per terminal order (completed/failed/timed_out — not for blocked/cancelled-from-queue, which never ran).
- `id` (`wor_` prefix), `org_id`, `work_order_id` (unique)
- `receipt` jsonb — canonical body: ids, type+version, input_hash, lifecycle timestamps, worker id, cost breakdown (input/output tokens, total USD) as reported by the worker, `output_hash`, `governance` block (mode, guard decision id, audit_record_id), `over_budget` boolean, error block when failed/timed_out
- `receipt_hash` — SHA-256 over the canonical receipt body (stable key order, excluding the hash itself); recomputable by anyone holding the receipt JSON
- `created_at`

### Artifacts
Reuse the existing `artifacts` table + `artifacts.repository.ts`. Completed output bodies are stored as content-addressed artifacts (`content_hash = sha256(body)`), linked from the receipt by hash and by `work_order_id` reference. Size limit enforced at complete (reuse existing artifact size conventions).

## Governance integration

- **Submit:** `evaluateGuard(orgId, context, sql)` in-process with `action_type: 'work_order.submit'`, risk context fed by budget ceiling, type, and input hash. Outcomes:
  - `allow` → `queued`
  - `warn` → `queued`, warning stored in `guard_decision`
  - `block` → terminal `blocked` (the order row persists with the matched policy)
  - `require_approval` → `pending_approval`; surfaces in the existing Mission Control / approvals flow; approve → `queued`, deny → `cancelled`
- **Complete:** an audit record is written via the existing record path; the returned `audit_record_id` is stamped into the receipt's `governance` block.
- **Budget truth-telling:** DashClaw cannot halt remote execution mid-run. If reported cost > ceiling, the receipt is built anyway and flagged `over_budget: true`, and a signal is emitted. The contract is enforced at submission (ceiling required and sane) and audited at completion.

## API surface (~9 new route handlers)

All org-scoped, API-key authed, repository-backed (route-sql gate respected), structured errors via `apiErrorResponse`.

| Route | Behavior |
|---|---|
| `POST /api/work-orders` | Validate against registered input schema (structured 400 with per-field errors), validate budget (422 if absent/invalid), guard gate, insert. Returns `201 { work_order_id, status }`. |
| `GET /api/work-orders` | List with `?status=`, `?type=`, `?agent=` filters + pagination. Sweeps expired leases first. |
| `GET /api/work-orders/:id` | Order + receipt (if terminal). 404 `work_order_not_found`. |
| `DELETE /api/work-orders/:id` | Cancel queued/claimed/pending_approval; 409 `not_cancellable` for terminal. |
| `POST /api/work-orders/claim` | Body: `{ types: [...], agent_id }`. Atomically claims oldest queued order of a matching type (single UPDATE … RETURNING; no double-claim), sets lease. 204/empty when nothing queued. |
| `POST /api/work-orders/:id/complete` | Body: `{ status: completed\|failed, output?, cost?, error? }`. Claim-holder only. Output validated against the output contract (failed validation → completion rejected with structured errors, order stays claimed). Builds receipt + artifact, writes audit record. |
| `GET /api/work-orders/:id/artifacts` | Artifacts for the order. |
| `GET /api/work-orders/types` + `POST` | List/register contracts. POST validates that schemas are valid JSON Schema. |
| `GET/PUT/DELETE /api/work-orders/types/:type` | Read/update (version bump on schema change)/disable. DELETE = soft-disable, never destroys history. |

## Dashboard UI (`/work-orders`)

One page, two tabs, `.impeccable.md` rules (tokens only, evidence over decoration, calm under pressure):

- **Ledger tab:** orders table (status chip, type, cost vs budget, worker, age), filters, detail view with receipt (formatted + raw JSON), client-side "Verify hash" affordance that recomputes the receipt hash, linked artifacts, guard decision provenance.
- **Contracts tab:** type registry list, create/edit form with JSON Schema editors, seeded `research_brief` visible as example.
- Nav entry; demo-mode handlers for GET endpoints (demo middleware pattern in `middleware.js` route table / `demoMiddleware.ts` before the 403 fallback); pending-approval orders appear in existing approvals surfaces (they're guard decisions).
- Page is `.jsx`/`.tsx` per testability conventions; `useSearchParams` (if used) gets a Suspense wrapper.

## SDK / MCP / reference worker

- **Node SDK** (camelCase) and **Python SDK** (snake_case), 8 methods each: `submitWorkOrder`, `getWorkOrder`, `listWorkOrders`, `cancelWorkOrder`, `claimWorkOrder`, `completeWorkOrder`, `listWorkOrderTypes`, `registerWorkOrderType`. SDK parity doc + method counts updated; one unified version bump via `npm run version:set`.
- **MCP server:** 2 tools — `dashclaw_work_order_submit`, `dashclaw_work_order_status`. Tool counts updated everywhere they're cited (drift gates).
- **Reference worker:** `examples/work-order-worker/` — single Node script (~100 lines) on the Node SDK: poll → claim → execute pluggable handler (`research_brief` via Claude API when `ANTHROPIC_API_KEY` is set; deterministic mock otherwise) → complete. README with run steps. This is the copy-paste onboarding artifact.

## Marketing + docs accuracy pass (after the feature is verified)

- Landing page (`app/page.tsx` + `landingData.js`): Work Orders story ("Give your agents work orders, get back receipts").
- `/docs`: Work Orders guide — submit → claim → receipt walkthrough with real request/response examples.
- README, PROJECT_DETAILS, QUICK-START, SDK READMEs, plugin/skill surfaces.
- **Full accuracy audit:** every integration method and install path described on the marketing site verified against actual code (install commands, env vars, drift-gated counts: routes, SDK methods, MCP tools/resources).
- Then `/dashclaw-ship`: land on main, version bump, regenerate artifacts (OpenAPI, API inventory, livingcode, platform skill), deploy.

## Testing

Repo conventions (`__tests__/unit|integration/`, vitest, no jest-dom):
- Input-contract validation → structured 400 per-field errors; budget validation → 422.
- Lifecycle legality: every illegal transition rejected; timestamps recorded.
- Lazy lease expiry → `timed_out` on next read/claim.
- Claim atomicity (no double-claim under concurrent claims).
- All four guard outcomes incl. `pending_approval → queued` on approve and `blocked` persistence.
- Output-contract rejection at complete (order stays claimed).
- Receipt hash round-trip: build → recompute → match; tamper → mismatch.
- Over-budget flag + signal emission.
- Org isolation on every route; claim-holder-only completion.
- Gates before ship: `npm run lint`, `npx vitest run` (full), `npx next build`, `npm run typecheck`, doc-count checks.

## Error handling

- Loads → error + Retry; mutations → inline toast (existing patterns); no silent catches (guard test enforces).
- API errors structured via `apiErrorResponse` with stable `code` fields (`validation_failed`, `budget_invalid`, `not_cancellable`, `work_order_not_found`, `not_claim_holder`, `output_contract_violation`).

## Deliberately NOT in v1

- Callback webhooks (polling; the existing webhooks system can subscribe to work-order events later).
- Settlement/x402 wiring (receipts carry cost data; FinOps integration is a follow-up).
- Lease retries/redelivery counts, distributed claim fairness, marketplace discovery, reputation.
- Touching the archived `routing_tasks` legacy or the standalone MVP's code.

## Success criteria

1. Submit a `research_brief` work order via API/SDK → `201` + queued (or pending_approval under a strict policy).
2. Invalid input → structured 400 listing exactly which fields failed.
3. Reference worker claims, executes (mock or live), completes; order reaches `completed`.
4. Receipt exists with cost, lifecycle timestamps, output hash, governance trail; hash verifies by recomputation.
5. Guard `block` and `require_approval` paths observable end-to-end in the dashboard.
6. `$0.000`-style invalid budgets rejected; over-ceiling reported cost flags the receipt.
7. Full gate suite green; marketing site claims match the shipped code exactly.
