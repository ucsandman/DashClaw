---
source-of-truth: false
status: redirect
last-verified: 2026-06-11
doc-type: pointer
---

# DashClaw SDK Reference

> This file is a pointer, not a reference. The canonical SDK reference
> document moved to **[`sdk/README.md`](../sdk/README.md)** during the
> 2026-04-11 docs sync pass. The previous standalone reference drifted
> out of date with the actual SDK surface (it documented 45 methods while
> the v2 SDK had grown to 87) and was retired to prevent two sources of
> truth.

## Where to go

| Looking for | Canonical location |
|---|---|
| Full v2 method catalogue (137 methods) + canonical HITL flow + error handling + Execution Studio usage | **[`sdk/README.md`](../sdk/README.md)** |
| Domain-level parity between Node v2 / Node legacy / Python | **[`docs/sdk-parity.md`](./sdk-parity.md)** |
| Per-domain method inventory and system architecture | **[`PROJECT_DETAILS.md`](../PROJECT_DETAILS.md)** |
| Runtime governance loop (HTTP API shape) | **[`docs/architecture/runtime-api.md`](./architecture/runtime-api.md)** |
| Legacy v1 method surface (pairing, compliance, webhooks, drift, etc.) | **[`docs/sdk-parity.md`](./sdk-parity.md)** → Legacy Node section |
| Published npm package | [`npm install dashclaw`](https://www.npmjs.com/package/dashclaw) |

The historical content of this file is preserved at
[`docs/archive/sdk-reference-2026-04-11.md`](./archive/sdk-reference-2026-04-11.md)
for anyone tracing old links. Do not treat it as current — it was drifting
for months before being retired.

## x402 Spend Governance

DashClaw governs paid-API (x402) purchase intent and records spend — it never
holds a wallet. The agent executes the actual x402 call itself; the SDK
registers the provider, governs the purchase through the guard loop, and keeps
a tamper-evident ledger of agent spend. Full method docs and HITL flow live in
[`sdk/README.md`](../sdk/README.md) → **x402 Spend Governance**; domain parity
is in [`docs/sdk-parity.md`](./sdk-parity.md).

Node surface (9 methods): `listProviders`, `createProvider`, `getProvider`,
`updateProvider`, `listProviderEndpoints`, `createProviderEndpoint`,
`recordPurchase`, `listPurchases`, `recordPurchaseResult`.

Python surface (8 methods, snake_case): `list_providers`, `create_provider`,
`get_provider`, `update_provider`, `list_provider_endpoints`,
`create_provider_endpoint`, `record_purchase`, `list_purchases`.
`record_purchase_result` is **Node-only** — Python callers post the result
snapshot directly to `POST /api/artifacts` (`artifact_type='x402_purchase_result'`,
`source_action_id` = the `act_` id from `record_purchase`).

## FinOps Spend rollup (no SDK wrapper)

`GET /api/finops/spend?lens=fleet|claude-code` is a read-only operator rollup —
a presentation layer that aggregates agent LLM cost, x402 purchases, and Code
Sessions cost. It has **no SDK method**; it is backed by repository-level
`getFleetSpend` / `getClaudeCodeSpend` (`app/lib/repositories/finops.repository.js`),
not the `DashClaw` client surface, so it does not appear in the SDK method
counts. Query it directly over HTTP.

## Governance Posture (no SDK wrapper)

`GET /api/posture`, `GET /api/posture/findings`, `POST /api/posture/findings/:key/resolve`, and `POST /api/posture/scan` are read-only/operator-gated governance-posture routes — a gaming-resistant org score (6 dimensions) plus a human-gated remediation loop. They have **no SDK method** (and do not change the 137 Node / 233 Python counts); query them directly over HTTP, or use the `dashclaw_posture` / `dashclaw_posture_next` MCP tools or the `dashclaw posture` CLI command.

## Why this moved

`sdk/README.md` is the markdown served to the website `/docs` page via
`/api/docs/raw` and the **Copy as Markdown** button, so it is already the
most user-facing reference surface. Keeping a second reference document
in `docs/` that had to be manually synced turned out to produce drift
every time a new SDK method shipped. Single source of truth wins.
