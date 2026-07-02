---
source-of-truth: true
owner: SDK Lead
last-verified: 2026-07-02
doc-type: architecture
---

# SDK Parity Matrix (Node vs Python)

## Current Policy

The canonical SDK policy is defined in:

- [SDK Consolidation RFC](./rfcs/2026-04-07-sdk-consolidation.md)
- [SDK Migration Matrix](./planning/2026-04-07-sdk-migration-matrix.md)

In short:

- `dashclaw` is the canonical SDK surface for new product work.
- `dashclaw/legacy` is a **DEPRECATED** compatibility layer for older integrations; it will be removed in v5.0.0.
- Python remains broader today, but should converge around the same platform model and HTTP contracts.

## What This Document Tracks

This document tracks:

1. which surface is canonical,
2. which surface is compatibility-only,
3. where major domains currently live,
4. where remaining parity or consolidation work is needed.

### Scope note: operator-surface routes

The `/api/hosted/*` route family (provisioning, admin inspect/delete, cleanup sweeper) is operator-facing and intentionally NOT exposed through either the Node or Python SDKs. These endpoints exist only when `DASHCLAW_HOSTED=true` and produce the API key that downstream SDKs consume. No parity tracking is required.

## SDK Surfaces

| Surface | Entry point | Role |
|---|---|---|
| Canonical Node SDK | `sdk/dashclaw.js` / `import { DashClaw } from 'dashclaw'` | Primary SDK surface for new work |
| Legacy Node SDK | `sdk/legacy/dashclaw-v1.js` / `import { DashClaw } from 'dashclaw/legacy'` | DEPRECATED compatibility layer; removed in v5.0.0 |
| Python SDK | `sdk-python/dashclaw/client.py` | Broad current surface; should converge toward the same canonical platform model |

## Canonical Node Surface

The canonical Node SDK already includes the core runtime and a meaningful portion of the execution surface:

- guard, actions, assumptions, approvals,
- loops, signals, learning, scoring,
- messaging, handoffs, security scanning, sync,
- sessions and action graph,
- durable execution finality (`reportActionOutcome`, `getActionOutcome`, convenience wrappers, `deriveIdempotencyKey`),
- the full Prompt Library surface (template CRUD, version CRUD, `activatePromptVersion`, `renderPrompt`, `getPromptStats`, `listPromptRuns`),
- learning ledger (`recordDecision`, `getLearningRecommendations`),
- side-effect-free dry-runs (`simulatePolicy`, `previewScorer`),
- workflow templates,
- model strategies,
- knowledge collections,
- capability registry,
- canonical `execution.capabilities.invoke(...)` for governed runtime execution,
- canonical `execution.capabilities.test(...)`,
- canonical `execution.capabilities.getHealth(...)`,
- canonical `execution.capabilities.listHealth(...)`,
- canonical `execution.capabilities.getHistory(...)`,
- x402 spend governance: `listProviders`, `createProvider`, `getProvider`, `updateProvider`, `listProviderEndpoints`, `createProviderEndpoint`, `recordPurchase`, `listPurchases`, `recordPurchaseResult` (Node-only; Python uses the artifacts endpoint directly), `recordX402Purchase` (one-call self-report; Python parity `record_x402_purchase`).

This is the surface new SDK-facing product work should target first.

## Legacy Node Surface

The legacy Node SDK still contains a broader set of compatibility methods, including areas such as:

- pairing and identity flows,
- routing,
- compliance,
- activity logs,
- webhooks,
- older convenience wrappers and historical method shapes.

Legacy is preserved for compatibility. It is not the preferred entry point for new design work.

Where capability-runtime overlap exists, legacy should expose flat compatibility wrappers that call the same HTTP contracts as the canonical `execution.capabilities.*` surface.

## Python Surface

The Python SDK currently remains broader than the canonical Node SDK.

For the capability-runtime domain, Python now exposes the same route-contract surface as the canonical Node SDK:

- `list_capabilities(...)`
- `create_capability(...)`
- `get_capability(...)`
- `update_capability(...)`
- `invoke_capability(...)`
- `test_capability(...)`
- `get_capability_health(...)`
- `list_capability_health(...)`
- `get_capability_history(...)`

That is acceptable temporarily, but it should not define future product direction on its own. New design work should still align with:

- the canonical object model,
- the canonical HTTP contracts,
- the SDK consolidation policy.

## Domain Status Matrix

| Domain | Canonical Node | Legacy Node | Python | Status |
|---|---|---|---|---|
| Guard / actions / approvals | Yes | Yes | Yes | Stable, canonical in main SDK. Approvals use `POST /api/approvals/[actionId]` (shared by browser, CLI, `/approve` mobile PWA, SDK polling). Phase 1 agent attribution (`agent_id`, `agent_name`) supported in both SDKs — pass in constructor or per-call body (Node + Python both auto-include `agent_name` from constructor on `guard()`). Phase 2 JWKS verification shipped (#104) at full parity: pass `authToken` (Node) / `auth_token` (Python) in the constructor for cryptographic attribution; server returns `verification_status` on every guard response. Phase 2b jti replay protection (#120, `replay_status`) and Phase 2c action binding (#121, `act_status`) ship **server-side** as additional guard axes — configured by env var (`DASHCLAW_JTI_REPLAY_PROTECTION`, `DASHCLAW_ACT_BINDING`) and returned on the guard response, so they need no per-SDK surface. See `docs/agent-identity.md`. Non-fabrication content checks ship **server-side** as a `non_fabrication` guard policy: callers attach `content` + `sourceOfTruth` (Node) / `content` + `source_of_truth` (Python) to `guard()`/`createAction()` — both SDKs pass them through at parity — and the verdict plus a signed Ed25519 receipt come back under `non_fabrication`. Receipts and signed compliance bundles re-verify at `POST /api/integrity/verify` (public key at `/.well-known/jwks.json`). See `docs/architecture/runtime-api.md` § Non-Fabrication Policy & Signed Evidence. |
| Action outcome (durable execution finality) | Yes — Phase 3 (`reportActionOutcome`, `getActionOutcome`, `reportActionSuccess`/`Failure`/`Partial`) | n/a | Yes — Phase 4 (`report_action_outcome`, `get_action_outcome`, `report_action_success`/`failure`/`partial`) | `POST/GET /api/actions/:id/outcome` (Phase 1) + cron sweep `/api/cron/outcome-sweep` + `lost_confirmation` signal (Phase 2) + Node SDK wrappers (Phase 3) + Python SDK wrappers (Phase 4). Full parity. See `docs/architecture/durable-execution-finality.md`. |
| Sessions / action graph | Yes | Partial overlap | Yes | Stable, canonical in main SDK |
| Loops and assumptions | Yes | Yes | Yes | Canonical in main SDK |
| Workflows | Yes | Historical overlap | Yes | Canonical in main SDK, with Python route-contract parity for template CRUD, launch, and execute. `POST /api/workflows/draft` NL-to-workflow endpoint also exposed |
| Capabilities | Yes | Yes, as flat compatibility wrappers for current overlap | Yes | Canonical in main SDK, with Python route-contract parity for registry plus runtime methods. Legacy should only shim to the same routes |
| Model strategies | Yes | Limited overlap | Yes | Canonical in main SDK, with Python route-contract parity and contract-enforced runtime surface |
| Knowledge collections | Yes | Limited overlap | Yes | Canonical in main SDK, with Python route-contract parity and explicit API/SDK contract coverage |
| Messaging / handoffs / threads | Yes | Yes | Yes | Canonical in main SDK |
| Scoring profiles / dimensions | Yes | No | Yes | Canonical in main SDK (`createScoringProfile`, `scoreWithProfile`, `batchScoreWithProfile`, calibration) |
| Risk templates | Yes | No | Yes | Canonical in main SDK |
| Evaluations (scorers / scores / runs) | Yes | Limited overlap | Yes | Canonical in main SDK |
| Agent registry (`/api/agents/registry`, `/api/agents/invoke`) | Yes | No | Yes | Canonical in both SDKs: `registerAgent`/`listRegisteredAgents`/`getRegisteredAgent`/`updateRegisteredAgent`/`addAgentCapability`/`listAgentCapabilities`/`invokeRegisteredAgent` (+ snake_case Python). Registered agents are external, org-owned, delegatable providers that group capabilities; `invokeRegisteredAgent` routes through the existing capability runtime + guard + action ledger (no reimplemented HTTP). x402/auth metadata only, no settlement |
| x402 spend governance (`/api/x402/providers`, `/api/x402/purchases`) | Yes (10 methods) | No | Yes (9 methods) | Canonical in both SDKs. 8 base methods at route-contract parity: `listProviders`/`createProvider`/`getProvider`/`updateProvider`/`listProviderEndpoints`/`createProviderEndpoint`/`recordPurchase`/`listPurchases` (+ snake_case Python), plus `recordX402Purchase`/`record_x402_purchase` — a one-call self-report convenience (govern + record + outcome + receipt) present in BOTH SDKs for the pay-outside-a-hook pattern; the server resolves the provider from the `provider` name. **Node-only asymmetry:** `recordPurchaseResult` is a convenience wrapper over `POST /api/artifacts` — Python callers post to that endpoint directly with `artifact_type='x402_purchase_result'`. DashClaw never holds a wallet; agents execute x402 calls themselves. |
| Agent reputation (`/api/reputation/*`) | Yes | No | Yes | Canonical in both SDKs at route-contract parity: `getAgentReputation`/`listAgentReputationEvents`/`recomputeAgentReputation`/`getAgentReputationReceipt`/`verifyReputationReceipt` (Node) and the `get_agent_reputation`/`list_agent_reputation_events`/`recompute_agent_reputation`/`get_agent_reputation_receipt`/`verify_reputation_receipt` (Python). Time-decayed Bayesian vector; `risk_score` wraps the existing 0-100 risk; Ed25519-signed receipts re-verify against the instance JWKS |
| Prompt management (templates / versions / render) | Yes | Limited overlap | Yes | Canonical in main SDK — full Prompt Library surface (template CRUD, version CRUD + `activatePromptVersion`, `renderPrompt`, `getPromptStats`, `listPromptRuns`) |
| Learning analytics (velocity / curves / lessons / maturity) | Yes | Limited overlap | Yes | Canonical in main SDK |
| Security scanning (prompt injection / content) | Yes | Yes | Yes | Canonical in main SDK |
| Feedback (`/api/feedback`) | No (removed) | Yes | No (removed) | **Endpoint archived** (`app/api/_archive/feedback/*`). Canonical `submitFeedback` and the Python feedback suite (`submit_feedback`/`list_feedback`/`get_feedback`/`resolve_feedback`/`delete_feedback`/`get_feedback_stats`) were removed as a **breaking** change — they only ever 404'd. Legacy Node retains its frozen shims. |
| Drift detection | Yes (10 methods) | Yes | Yes | Canonical in both SDKs at route-contract parity: `detectDrift`/`computeDriftBaselines`/`recordDriftSnapshots`/`listDriftAlerts`/`acknowledgeDriftAlert`/`deleteDriftAlert`/`getDriftStats`/`getDriftSnapshots`/`getDriftMetrics`/`getDriftReport` (Node) and the `detect_drift`/`compute_drift_baselines`/`record_drift_snapshots`/`list_drift_alerts`/`acknowledge_drift_alert`/`delete_drift_alert`/`get_drift_stats`/`get_drift_snapshots`/`get_drift_metrics`/`get_drift_report` (Python). |
| Pairing / identities | Partial — `createPairing` + `waitForPairing` (enrollment) promoted from legacy (P10 2026-06-10); getPairing/registerIdentity remain legacy/Python-only | Yes | Yes | Enrollment at parity; remaining surface is a promotion candidate |
| Routing (`/api/routing/*`) | No | Yes | No (removed) | **Endpoints archived** (`app/api/_archive/routing/*`). The Python routing suite (`list_routing_agents`/`register_routing_agent`/`get_routing_agent`/`update_routing_agent_status`/`delete_routing_agent`/`list_routing_tasks`/`submit_routing_task`/`complete_routing_task`/`get_routing_stats`/`get_routing_health`) was removed as a **breaking** change — they only ever 404'd. Legacy Node retains its frozen shims. The live agent-registry/matching logic in `app/lib/routing/*` is unrelated and stays. |
| Context (`/api/context/*`) | No (removed) | Yes (frozen shims) | No (removed) | **Endpoints archived** (`app/api/_archive/context/*`). The canonical-Node context-thread methods (`createThread`/`addThreadEntry`/`closeThread`) and the Python context-thread + key-point methods (`get_threads`, `capture_key_point`/`get_key_points`/`get_context_summary`) were removed as a **breaking** change — they only ever 404'd (no `next.config` rewrite; the `context_threads` table was never created). Legacy Node retains its frozen context shims (points + threads). |
| Compliance | No canonical wrapper yet for full shape | Yes | Yes | Remain compatibility and admin-heavy for now |
| Webhooks / activity logs | No canonical wrapper yet for full shape | Yes | Yes | Remain compatibility and admin-heavy for now |
| Preferences / digest / ideas | No | Yes | Yes | Low-priority consolidation |
| Managed secrets delivery (`GET /api/secrets/env`) | Yes — `getAgentEnv({ agentId })` | No | Yes — `get_agent_env(agent_id=None)` | Canonical in both SDKs at route-contract parity. Returns `{ env, count, delivered }` — the org/agent-merged, delivery-enabled, decrypted secret bundle for one agent. **Values are live secrets: memory-only, never logged, never written to disk.** Secret *metadata* (register/rotate/delete, `/api/secrets`, `/api/secrets/[id]`, `/api/secrets/rotation-due`) stays operator/MCP-only — see Non-SDK Surfaces. CLI: `dashclaw env [--agent <id>] -- <command>` injects the bundle into a child process environment without ever printing values (no `--print`; fail-closed if the fetch fails). |
| Work Orders (`/api/work-orders`, `/api/work-orders/types`) | Yes — 8 methods: `submitWorkOrder`, `getWorkOrder`, `listWorkOrders`, `cancelWorkOrder`, `claimWorkOrder`, `completeWorkOrder`, `listWorkOrderTypes`, `registerWorkOrderType` | No | Yes — 8 methods: `submit_work_order`, `get_work_order`, `list_work_orders`, `cancel_work_order`, `claim_work_order`, `complete_work_order`, `list_work_order_types`, `register_work_order_type` | Task-grade contracts + self-verifying receipts ledger. Guard-gated submit, atomic lease claim (SKIP LOCKED), output-contract validation, SHA-256 receipt on every terminal order. DashClaw is the system of record only — execution is external workers via claim/complete. |

## Non-SDK Surfaces (Operational)

These are reachable via HTTP but are not intended as SDK methods. Documented here so SDK maintainers don't accidentally wrap them:

| Surface | Endpoint(s) | Where it belongs |
|---|---|---|
| Doctor (self-host diagnostics) | `GET /api/doctor`, `POST /api/doctor/fix` | CLI (`dashclaw doctor`) + local script (`npm run doctor`) |
| MCP server | `POST /api/mcp` (Streamable HTTP) | `@dashclaw/mcp-server` npm package (stdio + HTTP) |
| Analytics dashboard | `GET /api/analytics` | Dashboard frontend only |
| Guard decisions audit log | `GET /api/guard/decisions` | Policy Builder ActivityTab; no SDK wrapper yet |
| Agent governance profile | `GET /api/agents/[agentId]/profile` | `/agents/[agentId]` dashboard page aggregator |
| Session handoffs (agent runtime) | `POST/GET /api/handoffs`, `GET /api/handoffs/latest`, `GET /api/handoffs/[id]`, `POST /api/handoffs/[id]/consume` | Hermes hooks (`.hermes/hooks/dashclaw_on_session_{start,end}_hermes.py`) + MCP server (`dashclaw_handoff_create/latest/consume`). Agents pick up the previous session's bundle on first turn; not an SDK developer method. |
| Operator-tracked secrets (metadata) | `GET/POST /api/secrets`, `PATCH/DELETE /api/secrets/[id]`, `GET /api/secrets/rotation-due` | Operator surface + MCP server (`dashclaw_secret_list/due/mark_rotated`). Registration/rotation/deletion is an operator task; agents only check rotation due-dates via MCP. **Exception:** opt-in *value delivery* via `GET /api/secrets/env` IS SDK-exposed — `getAgentEnv` / `get_agent_env` + the `dashclaw env` CLI command (see the Managed secrets delivery row in the matrix above). |
| Skill safety scan | `POST /api/skills/scan`, `GET /api/skills/scans/[id]` | MCP server (`dashclaw_skill_scan`). Agents scan untrusted skill files before loading; results cached by content hash. |
| Governance posture | `GET /api/posture`, `GET /api/posture/findings`, `POST /api/posture/findings/[key]/resolve`, `POST /api/posture/scan` | Operator `/posture` page + MCP (`dashclaw_posture`, `dashclaw_posture_next`, read-only); remediation is human-gated, no SDK wrapper. |
| Session actions ledger | `GET /api/sessions/[sessionId]/actions` | `/sessions/[sessionId]` dashboard page (paginated actions list sharing the action_count predicate). Read-only display aggregation; promote alongside `getSessionEvents` if sessions get first-class SDK exposure. |

If any of these later need first-class SDK exposure, promote them into the matrix above.

## Cross-SDK Integration Suite

Critical-domain contract coverage is validated against a shared harness:

- Shared fixture: `docs/sdk-critical-contract-harness.json`
- Node harness runner: `scripts/check-sdk-cross-integration.mjs` (`npm run sdk:integration`)
- Python harness test: `sdk-python/tests/test_ws5_m4_integration.py` (`npm run sdk:integration:python`)

## Version Compatibility Policy

- Canonical Node SDK (`sdk/dashclaw.js`): primary target for new product work.
- Legacy Node SDK (`sdk/legacy/dashclaw-v1.js`): DEPRECATED — frozen compatibility maintenance only; removed in v5.0.0.
- Python SDK (`sdk-python/dashclaw/client.py`): broad surface; converge by domain over time.
- Node SDK requires Node 18+. Python SDK supports Python 3.7+.

## Notes

- Python method naming uses `snake_case`; Node uses `camelCase`.
- Legacy behavior may preserve older signatures for compatibility even where the canonical SDK uses newer semantics.
- New feature design should start from route contracts and canonical SDK grouping, not from legacy method history.

## Related Documents

- [SDK Consolidation RFC](./rfcs/2026-04-07-sdk-consolidation.md)
- [SDK Migration Matrix](./planning/2026-04-07-sdk-migration-matrix.md)
- [Platform Object Model](./architecture/platform-object-model.md)
