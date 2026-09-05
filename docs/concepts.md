# Concepts: how DashClaw works

One page, the whole mental model. Read this before any integration guide — every other doc assumes it.

## The problem DashClaw solves

An AI agent with credentials can deploy, delete, pay, and publish. The failure mode is not malice; it is an agent doing something expensive, irreversible, or embarrassing because nothing stood between its intent and the world. DashClaw evaluates supported integrations against policy **before** execution, routes sensitive actions to a human, and records the decisions and reported outcomes. Whether it can halt execution mechanically depends on the integration.

DashClaw is deliberately **not an agent platform**. It gives agents no tools to achieve goals — no calendar, no CRM, no messaging on their behalf. It governs the goals your agents already pursue with the tools they already have.

## Four primitives

Everything in DashClaw reduces to four records:

| Primitive | What it is | Created by |
|---|---|---|
| **Guard decision** | The answer to "can I do this?" — `allow`, `warn`, `allow_contained`, `require_approval`, or `block`, with a risk score and the matched policies | `POST /api/guard` |
| **Action** | The ledger entry for "I am doing this" — declared goal, risk, systems touched, lifecycle status | `POST /api/actions` |
| **Assumption** | A belief the action depends on ("staging tests passed") — auditable, and invalidatable by an operator later | `POST /api/assumptions` |
| **Outcome** | The agent's immutable terminal report — `completed`, `partial`, or `failed`; evidence, not independent proof of an external effect | `POST /api/actions/:id/outcome` |

Chained together they form **the governance loop**:

```
guard  →  record  →  (wait for approval)  →  do the work  →  outcome
 "may I?"   "I am."        if required            external act  "reported result"
```

Assumptions attach anywhere between record and outcome. The full HTTP contract for these four endpoints is [architecture/runtime-api.md](./architecture/runtime-api.md); the same loop in SDK form is [agent-bootstrap.md](./agent-bootstrap.md).

## Decisions: the five verdicts

- **`allow`** — proceed.
- **`warn`** — proceed, but the decision carries warnings and lands in the ledger flagged.
- **`allow_contained`** — proceed now, but staged: a provably file-scoped act runs inside an isolated git worktree instead of the working tree, or a provably database-scoped act runs against an ephemeral branch of the target database instead of the real one, and a human promotes or discards the result later. Negotiated per staging medium — a caller receives it only if it advertised that medium's capability string (`client_capabilities: ['allow_contained']` for files, `['allow_contained:db']` for a database branch); an older or non-cooperating caller gets `require_approval` instead (version skew only tightens). See [Containment Verdicts](./architecture/runtime-api.md#containment-verdicts-allow_contained).
- **`require_approval`** — the action is held (`status: pending_approval`) until a human approves or denies it, from any approval surface.
- **`block`** — do not proceed. **A block is never downgraded** — not by approval, not by grant, not by the maintainer. This is a charter invariant ([MAINTAINER.md](../MAINTAINER.md)).

One footgun worth learning early: `guard` returns a `decision_id` (an `act_gd_…` id). `createAction` returns the real `action_id` (an `act_…` id). **Approval waiting and outcome reporting use the `action_id` from `createAction`**, never the id from guard. They point at different tables.

## Risk scoring: the max blend

Agents self-report a `risk_score`, but DashClaw never simply trusts it downward:

1. The **server** computes its own heuristic from structured fields (`action_type`, `reversible`, `systems_touched`, the declared goal).
2. Any active org **risk template** contributes its score.
3. The **agent-reported** score is taken as advisory.
4. The effective score is the **max** of all three, optionally adjusted by a predictive layer (which can only amplify demonstrated failure patterns, and whose LLM component is only consulted when *server-side* evidence crosses the threshold).

The full derivation is returned on every decision as `risk_breakdown` and persisted, so every escalation is explainable after the fact.

**Evidence beats declaration.** Callers can attach the actual act to a guard call — the shell command, HTTP request, SQL statement, or file write (`act: { kind: 'shell', command: '…' }`). A shell act may also carry the body of the script the command runs (`act.script: { path, content_excerpt }`, capped at 6144 characters), so a purchase or a delete hidden one file away is graded rather than the bare command line; the Claude Code hook and the OpenClaw plugin attach it, and a script on a sensitive path sends its path only. The server classifies every part of it deterministically and folds the derived risk in via the same max rule: evidence can raise a score, never lower it. Every decision records `intent_source: evidence | declared`, and a `require_evidence` policy can escalate declared-only calls. This defeats a lying *model* (the wrapper authors the payload, not the LLM); it does not defeat a lying *process* — see the threat model in the [enforcement boundary ADR](./architecture/enforcement-boundary.md).

## What "block" means on your surface

This is the most important honesty in the product. A `block` decision is absolute at the decision layer on every surface. Whether the blocked action is **mechanically halted** or **cooperatively honored** depends on where the agent runs:

- **Mechanical** — something DashClaw controls sits between "the model decides" and "the tool executes": Claude Code / Codex hooks in enforce mode, the Hermes and OpenClaw plugin vetoes, and any capability DashClaw executes itself (`dashclaw_invoke` / `POST /api/capabilities/:id/invoke` — a block means the HTTP call never happens).
- **Cooperative** — the SDK, bare MCP tools, and chat connectors receive the decision and the calling code must honor it. The server will refuse to *record* a blocked action (403), but it cannot reach into your process and stop an out-of-band act.

The canonical per-surface table is [architecture/enforcement-boundary.md](./architecture/enforcement-boundary.md). Product copy that says "blocks" without qualification refers to mechanical surfaces only; where governance is cooperative, the docs say so.

## Approvals

A `require_approval` decision parks the action in a queue that resolves from any of five surfaces — the dashboard (`/approvals`), the CLI (`dashclaw approvals`), the mobile PWA (`/approve`), Telegram, or Discord. All of them post to the same endpoint. `waitForApproval()` uses SSE as a latency hint and reconciles with authoritative action state.

Three behaviors keep approvals sane at fleet scale:

- **Expiry.** A pending approval is only approvable while approving it can still release something. Clients declare their wait window; the server stamps an expiry (wait + 15-minute retry grace). Acting on an expired approval returns `410 Gone` — a truthful "this can no longer release anything," not a fake success.
- **Approval authority.** For a caller that advertises execution claims, an eligible retry can select an unexpired approval for the same principal, agent, action type, exact goal, and null-safe act hash. Selection does not consume it. Immediately before execution, protocol 1 rechecks current policy and atomically consumes the selected authority with one attempt claim. A different act, expired approval, self-approval, or current `block` cannot ride the prior approval. Legacy clients do not receive this approval-reuse authority.
- **Flood control.** When one policy (or the fleet) exceeds its interruption budget, per-action pings collapse into a single flood banner with pause and bulk-resolve controls. Pending approvals are never auto-resolved.

## Durable outcomes and one-attempt authority

Approved is not the same as done. An action starts with a `pending` outcome and can transition once to `completed`, `partial`, `failed`, or `lost_confirmation`. The first terminal report wins; a later report returns `409` with the current state. A sweep marks stale pending rows as `lost_confirmation` and emits a signal. Check the outcome before considering a retry, but do not infer that a failed or missing report means nothing happened. Reconcile the target system and use effect-specific idempotency before another attempt. A consumed execution claim cannot be reused. See the [execution and outcome contract](./architecture/durable-execution-finality.md).

## Policies

Policies are declarative rules evaluated on every guard call: risk thresholds, deploy gates, rate limiters, evidence requirements, capability access rules, semantic checks, and a `non_fabrication` verifier that blocks outbound content stating facts not traceable to a source of truth. You can build them in the dashboard's policy builder (ten pre-built safety switches), generate them with AI, import YAML, or adopt a [policy mode](./policy-modes.md) — a named pack like the Claude Code starter that compiles to guard policies.

A fresh self-hosted instance seeds the **catastrophe-only** pack at its first migrate. Its explicit baseline covers mass-destructive protected targets, force-push, secret writes, and real-money spend; it is not a general high-risk approval policy. Layer broader controls when you are ready — see [Operating DashClaw](./operations.md).

## Identity: who is this agent, really?

Two levels:

1. **API keys** (default). Every request carries `x-api-key`; the key resolves to an org and a role (`admin` / `member` / `readonly`). The `agent_id` on each call is self-asserted — fine for attribution inside a trusted deployment.
2. **Verified identity** (optional). Agents present a JWKS-verified JWT (EdDSA / RSA / ECDSA); DashClaw checks the signature against the issuer's published keys, rejects replayed tokens, and can bind a token to one intended action. The verified subject overrides any body-supplied `agent_id`. Setup: [agent-identity.md](./agent-identity.md).

Note the distinction from [OIDC login](./OIDC_SETUP.md), which signs *humans* into the dashboard. Same vocabulary (issuer, JWKS), entirely different purpose.

## The org, the fleet, and the ledger

Everything is org-scoped. Agents appear in the fleet (`/agents`) as they report; every governed action lands in the decisions ledger (`/decisions`) with its risk breakdown, matched policies, assumptions, and outcome — each one replayable (`/replay/:actionId`). Approvals (`/approvals`) is the live view; **posture** (`/posture`) is the score — a gaming-resistant 0–100 where a policy only counts once replaying real traffic proves it fires.

## Where to go next

- Try it: [QUICK-START.md](../QUICK-START.md)
- Connect an agent: [Claude Code](./integrations/claude-code.md) · [MCP](./integrations/mcp.md) · [SDKs](./agent-bootstrap.md) · [REST](./architecture/runtime-api.md)
- Operate: [Operating DashClaw](./operations.md)
