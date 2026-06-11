# Work Order Worker

A reference implementation of a DashClaw work-order worker. Claims queued work orders from DashClaw, executes them, and reports completion with a self-verifying receipt.

## The Goal

Show the complete worker lifecycle: claim a leased work order, run the work (mock or real Claude), report completion — and get back a receipt that anyone can independently verify by recomputing the SHA-256 hash of the canonical receipt body.

## Prerequisites

- Node.js 20+
- A running DashClaw instance (local or cloud)
- `DASHCLAW_API_KEY` from your instance (Settings > API Keys)
- (Optional) `ANTHROPIC_API_KEY` for real Claude execution. Without it the worker uses a deterministic mock output.

## Quick Start

```bash
cd examples/work-order-worker
cp .env.example .env
# Edit .env with your DASHCLAW_BASE_URL and DASHCLAW_API_KEY
npm install
```

## Run

```bash
node index.js
```

The worker polls every 5 seconds, claims the oldest queued `research_brief` order, executes it, and reports back.

To submit a work order for the worker to pick up:

```bash
curl -s -X POST http://localhost:3000/api/work-orders \
  -H "x-api-key: <your_api_key>" \
  -H "content-type: application/json" \
  -d '{"type":"research_brief","input":{"topic":"agent payment rails"},"budget":{"max_cost_usd":0.25}}'
```

Then poll until completed:

```bash
curl -s http://localhost:3000/api/work-orders/<id> -H "x-api-key: <your_api_key>"
```

## What This Proves

1. **Contract enforcement both directions** — the input is validated against the registered `research_brief` contract before queuing; the output is validated before the receipt is written. Contract violations get a 422 with per-field errors; the order stays claimed so the worker can fix and re-report.

2. **Atomic lease claim** — the `claim` step is a single `UPDATE ... SKIP LOCKED` statement; concurrent workers cannot double-claim the same order.

3. **Self-verifying receipt** — every terminal order gets a canonical, SHA-256-hashed receipt. The hash is `sha256:<base64url(sha256(canonical-json(receipt-body)))>`. Anyone with the receipt body can recompute it — no DashClaw-side secret involved.

4. **Governance trail** — the guard decision (allow/block/require_approval), matched policies, and audit record ID are embedded in the receipt, linking every completed order to its governance history.

## Expected Outcome

```
work-order worker polling http://localhost:3000 every 5000ms (types: research_brief)
claimed wo_<uuid> (research_brief)
completed wo_<uuid> — receipt sha256:<hash>
```

The `/work-orders` dashboard in DashClaw shows the order moving from `queued` → `claimed` → `completed`, with the receipt and a client-side "Verify receipt hash" button.

## Dashboard View

Open `http://localhost:3000/work-orders` in a browser, click the completed order row in the Ledger tab, then click "Verify receipt hash" to confirm the hash recomputes correctly in the browser.
