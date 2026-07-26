---
source-of-truth: true
owner: SDK Lead
last-verified: 2026-07-26
doc-type: architecture
---

# SDK Parity Matrix (Node vs Python)

## Current Policy

As of v5.0.0, both SDKs converge on the **governance core** — the intercept →
decide → approve → prove loop and its directly supporting calls. The SDKs are no
longer an agent-platform surface.

- `dashclaw` (Node) is the canonical SDK: **36 governance-core methods**.
- `dashclaw` (Python) exposes the same core plus a few read/admin conveniences:
  **56 methods**.
- The `dashclaw/legacy` Node compatibility subpath was **removed in v5.0.0**
  (its removal was announced with the v4.4.x deprecation notice).

Method counts are reproducible with `npm run sdk:count` (excludes the constructor
and `_`-private methods) and gated by `scripts/check-doc-counts.mjs --strict`.

## SDK Surfaces

| Surface | Entry point | Role |
|---|---|---|
| Node SDK | `sdk/dashclaw.js` / `import { DashClaw } from 'dashclaw'` | Canonical governance-core SDK (36 methods) |
| Python SDK | `sdk-python/dashclaw/client.py` | Governance core + read/admin conveniences (56 methods) |

## Governance-core surface (both SDKs)

The core methods present in **both** SDKs (Node `camelCase` / Python `snake_case`):

- **Guard / execution**: `guard`, `runGoverned` (Node adds `guardedFetch`).
- **Actions / record**: `createAction`, `updateOutcome`, `getAction`, `getActionGraph`.
- **Durable finality**: `reportActionOutcome`, `getActionOutcome`,
  `reportActionSuccess` / `Failure` / `Partial`, `deriveIdempotencyKey`.
- **Assumptions**: `recordAssumption`.
- **Approvals (HITL)**: `waitForApproval`, `approveAction`, `getPendingApprovals`.
- **Signals**: `getSignals`.
- **Sessions**: `createSession`, `getSession`, `updateSession`, `listSessions`,
  `getSessionEvents`.
- **Plans (preflight authorization)**: `submitPlan`, `getPlan`, `listPlans`,
  `resolvePlan`, `waitForPlanReview`.
- **Pairing (enrollment)**: `createPairing`, `waitForPairing`.
- **Security**: `scanPromptInjection`.

## Surface-specific methods

| Method | Where | Notes |
|---|---|---|
| `guardedFetch`, `simulatePolicy` | Node only | Fetch wrapper; side-effect-free policy dry-run |
| `create_webhook` / `get_webhooks` / `delete_webhook` / `test_webhook` / `get_webhook_deliveries` | Python only | Notification-destination management (Node uses HTTP) |
| `get_org` / `create_org` / `update_org` / `get_org_keys` | Python only | Org/tenancy reads (admin) |
| `get_activity_logs` | Python only | Audit/activity reads |
| `test_policies` / `import_policies` / `get_proof_report` | Python only | Policy testing + proof report |
| `register_identity` / `get_identities` / `get_pairing` | Python only | Admin identity reads/writes (Node calls the REST endpoints directly) |
| `get_assumption` / `validate_assumption` | Python only | Read/validate a recorded assumption (Node records via `recordAssumption`, then reads over HTTP). Both hit `GET`/`PATCH /api/assumptions/{id}` — the paths were corrected from a stale `/api/actions/assumptions/{id}` in the v5 final-fix. |

## Domain Status Matrix

| Domain | Node | Python | Status |
|---|:---:|:---:|---|
| Guard / actions / approvals | Yes | Yes | Canonical. Phase 2 JWKS attribution (`authToken` / `auth_token`) at parity; server returns `verification_status`. Non-fabrication (`content` + `sourceOfTruth` / `source_of_truth`) verified server-side with a signed Ed25519 receipt; re-verify at `POST /api/integrity/verify` (`/.well-known/jwks.json`). |
| Action outcome (durable execution finality) | Yes | Yes | `POST/GET /api/actions/:id/outcome` + cron sweep + `lost_confirmation` signal + SDK wrappers. Full parity. |
| Sessions / action graph | Yes | Yes | Canonical. |
| Plans (preflight authorization) | Yes | Yes | `submitPlan`/`submit_plan`, `getPlan`/`get_plan`, `listPlans`/`list_plans`, `resolvePlan`/`resolve_plan`, `waitForPlanReview`/`wait_for_plan_review`. Full parity (5 Node + 5 Python). |
| Assumptions | Record | Record + read/validate | `recordAssumption` at parity; `get_assumption` / `validate_assumption` are Python-only. Invalidated assumptions surface as the `assumption_drift` signal. |
| Signals | Yes | Yes | Canonical. |
| Security (prompt injection) | Yes | Yes | `POST /api/security/prompt-injection`. |
| Pairing / identities | Enrollment (`createPairing` + `waitForPairing`) | Enrollment + admin reads | Node enrollment is canonical; admin identity reads are Python-only (or HTTP). |
| Policies (test / import / proof) | `simulatePolicy` (dry-run) | `test_policies` / `import_policies` / `get_proof_report` | Governance-core policy surface. |
| Webhooks / org / activity | HTTP only | Yes | Read/admin conveniences in Python. |

Retired at v5.0.0 (no longer on either SDK — their backing routes were removed):
prompts library, learning/behavior, scoring/evaluations, drift engine, compliance
cockpit, messaging/handoffs/loops, reputation/registry, capability registry CRUD,
model strategies, knowledge/RAG, x402/FinOps, managed secrets, agent presence.

## Non-SDK Surfaces (Operational)

Reachable over HTTP but intentionally not SDK methods:

| Surface | Endpoint(s) | Where it belongs |
|---|---|---|
| Doctor (self-host diagnostics) | `GET /api/doctor`, `POST /api/doctor/fix` | CLI (`dashclaw doctor`) + `npm run doctor` |
| MCP server | `POST /api/mcp` (Streamable HTTP) | `@dashclaw/mcp-server` (stdio + HTTP) |
| Guard decisions audit log | `GET /api/guard/decisions` | Decisions ledger UI |
| Session actions ledger | `GET /api/sessions/[sessionId]/actions` | `/sessions/[sessionId]` page aggregation |

## Cross-SDK Integration Suite

Critical-domain contract coverage is validated against a shared harness:

- Shared fixture: `docs/sdk-critical-contract-harness.json`
- Node harness runner: `scripts/check-sdk-cross-integration.mjs` (`npm run sdk:integration`)
- Python harness test: `sdk-python/tests/test_ws5_m4_integration.py` (`npm run sdk:integration:python`)

## Version Compatibility Policy

- Node SDK (`sdk/dashclaw.js`): canonical governance-core surface. Requires Node 18+.
- Python SDK (`sdk-python/dashclaw/client.py`): governance core + conveniences. Supports Python 3.7+.
- `dashclaw/legacy` Node subpath: **removed in v5.0.0**.

## Notes

- Python method naming uses `snake_case`; Node uses `camelCase`.
- New feature design starts from the route contracts and the canonical SDK grouping.

## Related Documents

- [Product thesis](../THESIS.md)
- [Runtime API](./architecture/runtime-api.md)
