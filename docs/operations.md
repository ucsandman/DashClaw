# Operating DashClaw

You connected an agent. This page is the operator's side of the product: what to set up on day one, and what to check when you sit down at Mission Control.

## Day one: give guard something to enforce

A fresh instance has **no policies** — every guard call returns `allow`. Do one of these first:

- **Adopt a policy mode.** `/policies` → import a named pack. `claude-code-starter` is the day-one baseline for coding agents; [policy modes](./policy-modes.md) lists the rest (SOC 2 alignment, Enterprise Strict, …). Hosted trial workspaces come with the starter pre-seeded.
- **Build your own.** The policy builder ships ten pre-built safety switches (Deploy Gate, Risk Threshold, Rate Limiter, Evidence Required, and others), an AI generator, and YAML import.

Then prove it fires: `/policies` has per-policy **simulate** (replay a hypothetical action against the rule set), and your [posture score](#posture-the-score-that-cannot-be-gamed) only credits policies that demonstrably fire on real traffic.

Two policy behaviors to internalize:

- **A `block` is never downgraded.** Not by approval, not by anything. If a block is wrong, fix the policy.
- **Loosening is explicit.** Relaxing a policy is a first-class, logged operation — not a silent edit.

## Approvals

When a policy answers `require_approval`, the action parks in a queue and the agent waits. You resolve it from whichever surface you're nearest to — all five hit the same endpoint, and the agent unblocks near-instantly over SSE:

| Surface | Where | Setup |
|---|---|---|
| Dashboard | `/approvals` | none |
| CLI | `dashclaw approvals` (interactive), `dashclaw approve <id>` / `deny <id>` | `npm i -g @dashclaw/cli` |
| Mobile PWA | `/approve` — add to home screen | none |
| Telegram | inline Approve/Reject in an admin chat | [telegram-setup.md](./telegram-setup.md) |
| Discord | Approve/Deny buttons on DM embeds | `.env.example`, Discord section |

What keeps the queue honest:

- **Expiry.** Approvals are only approvable while approving can still release something. Overdue rows flip to `expired` and render in a distinct non-approvable section; acting on one returns `410 Gone`.
- **Late-approval grace.** If you approve after the agent's wait timed out, its identical retry within 15 minutes is honored (`allow`, with the covering approval named on the decision) instead of re-queuing. When the pending action carried an act payload (marked **Act-bound** on its card), the grant is pinned to that exact act — a retry presenting a different command or request re-queues instead of riding your approval.
- **Flood control.** When one policy (or the fleet) exceeds its interruption budget, per-action pings collapse into one flood banner with pause-rule and bulk-resolve controls. Nothing is ever auto-approved.

## The ledger: decisions, replay, signals

Every governed action lands in `/decisions` with its risk breakdown, matched policies, assumptions, signature state, and terminal outcome. Click through to `/replay/:actionId` for the full causal chain — this is the artifact you hand an auditor. Risk signals (stuck loops, lost confirmations, drift) surface in Mission Control's intervention queue; repeated occurrences collapse into one row, and dismissing it clears them all.

Watch the **outcome** column, not just the decision: `lost_confirmation` rows mean an agent went silent after approval — the sweep caught it, and something should investigate before anyone retries.

## Posture: the score that cannot be gamed

`/posture` grades the org 0–100 across six dimensions, risk-weighted. Two properties make it trustworthy: a policy only counts once replaying real traffic proves it fires, and drafting a policy never raises the number. Findings come with a prioritized remediation queue; `dashclaw next` prints the single top gap from the terminal, and `dashclaw posture resolve <key>` dispositions a finding (fix, snooze, or accept-risk — every disposition logged).

## The emergency halt

`dashclaw halt on` (or the dashboard control) flips the org kill switch: every guard evaluation returns `block` within ~3 seconds across instances. `dashclaw halt status` reads it; `dashclaw halt off` lifts it. Be precise about what this is: the halt is **absolute at the decision layer**, and execution stops mechanically only on the mechanical surfaces (hooks in enforce mode, gateway plugins, DashClaw-executed capabilities). Cooperative callers receive the block and are expected to stop. Details: [enforcement boundary](./architecture/enforcement-boundary.md), [guard enforcement contract](./guard-enforcement-contract.md).

## Doctor: the first move when anything is off

```bash
npm run doctor        # from a checkout, against the local instance
dashclaw doctor       # from anywhere, against any instance — plus local machine checks
dashclaw doctor --fix # apply safe auto-fixes (migrations, default policy, CORS, …)
```

Report-only by default. The write-path canary proves inserts land using synthetic, self-cleaning rows in an isolated canary org, so a green doctor means the pipeline actually works, not just that pages load. Common findings and their meanings: [troubleshooting](./troubleshooting.md).

## Spend and analytics

`/analytics` prices every action (cost trends, per-agent spend, enforcement counts). `GET /api/finops/spend?lens=fleet|claude-code` is the rollup — also available as `dashclaw cost` from the terminal. Agent-reported costs are clamped server-side; token counts without a cost estimate are priced from the configured pricing table.

## Evidence for auditors

Compliance evidence bundles are produced from real action records — signed, hash-chained exports (Ed25519), re-verifiable by anyone via `POST /api/integrity/verify` against the instance's published JWKS (`/.well-known/jwks.json`), no API key required. What a signature does and does not prove is spelled out in [runtime-api.md](./architecture/runtime-api.md#non-fabrication-policy--signed-evidence).

## The cadence that works

1. **Morning:** the Approvals inbox — anything waiting on you, plus anything `lost_confirmation` in the decisions ledger.
2. **When pinged:** approve/deny from the nearest surface; if a policy pings too often, tune the policy (or let flood control tell you it's too chatty).
3. **Weekly:** skim `/decisions` for the week's blocks and approvals, and review any calibration proposals in `/policies`.
4. **After any incident:** `/replay/:actionId` first, then policy changes — evidence before remediation.
