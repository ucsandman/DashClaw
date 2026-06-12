# W3 — Push-Value Surfaces: Interruption Budget + Fleet Digest

**Date:** 2026-06-11
**Status:** Draft (pending owner review)
**Sprint:** Close-the-loop (docs/superpowers/specs/2026-06-11-close-the-loop-design.md), workstream 3 of 4.

## Problem

DashClaw's value today is pull-only: the operator must open Mission Control or `/policies` to learn anything. Two consequences observed this sprint:

1. **Approval floods are unbounded.** A single mis-scoped `require_approval` policy (the "&1" tighten verdict) routed every routine fleet action into approval, generating hundreds of interruptions. The same failure plausibly caused the Jun 8 plugin disable — when governance becomes spam, operators turn governance off. No mechanism caps, collapses, or even detects this.
2. **Nothing comes to the operator.** Pending approvals, decision-mix shifts, attribution-coverage drops, and spend changes are invisible until a dashboard visit. The SessionStart digest hook (v4.12.0) was step one; it covers learning/handoffs only.

## Goals

- **G1 (hard requirement):** No single policy or condition can generate unbounded approval interruptions. Cap + collapse + one actionable event instead of per-action prompts.
- **G2:** A periodic fleet digest pushed through the existing notification adapters, so routine awareness requires zero dashboard visits.
- **G3:** Flood and coverage anomalies become first-class signals (push-able, dedup-able) rather than dashboard-only artifacts.

## Non-goals

- Replacing per-action approval prompts in the normal regime. Approvals block waiting agents (`dashclaw_wait_for_approval`, 300s default); latency is the product. Batching applies **only above the flood threshold**.
- Auto-approving or auto-denying anything. The flood guard collapses *notifications*, never decisions. Actions stay `pending_approval` until a human (or explicit bulk action) resolves them.
- A new in-app notification center / bell rework.
- New delivery channels. We ship through the six existing adapters (Slack, Discord, email, Telegram, Linear, GitHub) plus the Discord/Telegram approval bridges.

## Decision: threshold, not replacement

> Q (from the W2 handoff): should batching/digest replace per-action prompts everywhere, or only above a rate threshold?

**Only above a threshold.** Two regimes with opposite needs:

| Regime | Volume | Right behavior |
|---|---|---|
| Normal | a few approvals/day, each consequential | Immediate per-action prompt (agent is blocked waiting) |
| Flood | one policy emits tens–hundreds/hour | One collapsed event + bulk resolution; per-action pings are spam that destroys trust |

A flood almost always means a mis-compiled rule, not N genuinely risky actions — so the flood event centers on the **policy**, with "pause rule" and bulk-resolve as the primary actions.

## Design

### 1. Interruption budget / flood guard (G1)

**Detection.** New module `app/lib/approval-flood.ts`. A policy is *flooding* when it produces more than `DASHCLAW_INTERRUPT_BUDGET` (org setting, default **10**) `require_approval` decisions within `DASHCLAW_INTERRUPT_WINDOW_MIN` (default **15** minutes). Data source: `guard_decisions` (`decision = 'require_approval'`, `matched_policies` unnested), same query family as `getDecisionCountsByPolicy()`. A fleet-wide budget (default **30**/window, any mix of policies) catches multi-policy floods.

**State.** Flood state is derived, not stored as a table: a settings-key marker per org (`APPROVAL_FLOOD_STATE`, JSON `{ policy_id → { tripped_at, count, notified_at } }`) mirrors the drift-tick marker pattern. Cleared when the rate falls below half the budget for one full window (hysteresis), or when the operator resolves/pauses the rule.

**Where it hooks.** The check runs inline on the same code path that fires per-action approval notifications (`fireDiscordApproval` / `fireTelegramApproval` call sites), *before* sending:

- Not flooding → behavior unchanged (per-action prompt).
- Newly tripped → send **one** flood notification (see payload below) through the approval bridges *and* `deliverNativeNotifications()`, mark `notified_at`, and **suppress** further per-action prompts for that policy while tripped.
- Already tripped → suppress silently (the pending approval still exists and is still listed everywhere).

The inline check must be cheap and fail-open: one indexed count query with the settings-marker short-circuit; on any error, fall back to per-action notification (worst case is today's behavior, never silence).

**Flood notification payload** (one message):

> ⚠ Approval flood: policy "[Tightened] other" routed **47** actions into approval in the last 15m (fleet normal: ~3/day). Per-action pings are paused. Review: `<base>/approvals?policy=gp_…` — pause the rule, or bulk-resolve.

**Operator resolution.**

- `GET /api/approvals/floods` — current flood state (per policy: count, window, sample actions).
- `POST /api/approvals/bulk` — admin-only: `{ decision: 'allow'|'deny', filter: { policy_id } , limit?: number }`. Resolves matching `pending_approval` actions through the same `recordApproval()` path (audit trail per action, "clears everywhere" per action). Hard cap 500 per call; returns counts.
- **Flood banner** on `/approvals` and `/policies` (status-warning tinted, not alarm-red): names the policy, count, and offers three buttons — *Pause rule* (PATCH policy `active: 0`), *Approve all N*, *Deny all N* — each with the same two-step confirm pattern shipped for the review-feed verdicts.
- Pausing or deleting the policy clears the flood state and resumes normal per-action behavior.

### 2. Fleet digest (G2)

**Content** (compact, evidence-first, one message): decision mix last 24h (allow/warn/require_approval/block counts vs prior 24h), pending approvals count + oldest age, interrupts consumed vs budget, attribution coverage % (W1 metric) when below warning, spend last 24h vs prior, top 3 active signals. Skip any section that is zero/unchanged; if everything is quiet the digest is one line ("Fleet quiet: 1,204 actions, 0 interrupts, $4.10").

**Computation.** `app/lib/fleet-digest.ts` — pure read aggregation reusing `getGuardDecisionStats`, the friction/fired_7d queries (re-windowed to 24h), `getCostAggregation`, and `computeSignals` output. Exposed as `GET /api/digest/fleet` (admin) for the UI/hook to reuse.

**Delivery cadence (free tier, no cron).** Drift-tick pattern: `digest-tick` marker (`DIGEST_TICK_LAST_RUN_AT`), min interval = `DASHCLAW_DIGEST_INTERVAL_HOURS` (org setting, default **24**, `0` = off). Trigger piggybacks on existing operator/agent request traffic (same hook point family as drift-tick; the marker is claimed before work, ~4s budget). Delivery goes through `deliverNativeNotifications()` with a new payload kind `digest` (adapters render it as a single formatted message rather than a signals list). Optional kicker for traffic-quiet orgs: a documented GitHub Actions workflow that curls the digest endpoint daily (same pattern as Active Integrations refresh) — documentation only, not required.

**SessionStart hook addition.** `dashclaw_session_digest.py` gains two lines when applicable: `N approvals pending (oldest 3h)` and `⚠ approval flood active: <policy>`. Same fail-silent, ~1.4s-per-request constraints; reuses the existing `/api/learning` call budget by adding one call to `/api/digest/fleet?lite=1`.

### 3. New signal types (G3)

Two additions to `computeSignals` (16 → 18):

- `approval_flood` (red): mirrors flood state — fires while tripped, dedup hash on policy id + window start.
- `coverage_drop` (amber): attribution coverage (W1) fell below 90% having been above it in the prior window — dedup on day bucket.

Both flow automatically into the existing adapter delivery and the digest's "top signals" section. The decision-mix shift (the 00:07 require_approval spike) is covered by `approval_flood`; a generic decision-mix anomaly detector is **out of scope** (YAGNI until a real miss shows up).

## Error handling

- Flood check: fail-open to per-action notifications; never throw into the guard/actions path.
- Bulk resolve: per-action failures don't abort the batch; response reports `{ resolved, failed }`; admin + audit-logged like single approvals.
- Digest tick: claimed-marker prevents thundering herd; budget-bounded; a failed send logs `console.warn` with context and re-arms (marker NOT advanced on total failure, advanced on partial success to avoid spam loops).

## Testing

- Unit: flood detection thresholds + hysteresis (fixture guard_decisions), suppress/notify state machine, bulk endpoint (cap, admin gate, per-action audit), digest composer (quiet fleet, busy fleet, sections skipped), new signal types (fire + dedup), tick debounce (marker claimed before run).
- Component: flood banner render + two-step confirms on `/approvals` and `/policies`.
- The full `npx vitest run` suite, lint, typecheck, `npx next build` gate every phase.

## Implementation phases (one plan, three phases)

1. **Flood guard** — detection module + notification collapse + flood signal + bulk endpoint + banners. (Ships G1; the incident can't recur.)
2. **Fleet digest** — composer + endpoint + digest-tick + adapter payload kind + SessionStart hook lines.
3. **Docs + counts** — README/PROJECT_DETAILS/docs surfaces, route-count and signal-count drift (`scripts/check-doc-counts.mjs --strict`), `.env.example` for any new env knobs, livingcode refresh via pre-commit hook.

## Open questions for owner review

1. Defaults: budget 10 interrupts / 15 min per policy, 30 fleet-wide — feel right for your fleet (~280 actions/hr from claude-code alone)?
2. Digest default-on at 24h cadence, or default-off (opt-in via setting)? Proposed: **on** for orgs that already have adapter credentials configured, off otherwise (no new noise channel without an explicit setup step).
3. Should *Pause rule* in the flood banner also bulk-deny the already-pending actions, or leave them to expire/be resolved manually? Proposed: leave them pending and let the agent-side wait timeout handle expiry (no silent mass-deny).
