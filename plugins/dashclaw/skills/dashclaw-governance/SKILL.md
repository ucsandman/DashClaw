---
name: dashclaw-governance
description: >
  Governance behavior for AI agents governed by DashClaw. Teaches the governance
  protocol: when to call guard (risk thresholds), how to interpret decisions
  (allow/warn/block/require_approval), when to record actions, how to wait for
  approvals, and session lifecycle management. Loads org-specific policies and
  capabilities from MCP resources at session start. Use with @dashclaw/mcp-server.
  Trigger on: governed agent, dashclaw governance, guard policy, approval wait,
  governed capability, risk threshold, action recording, session lifecycle.
---

# DashClaw Governance Protocol

You are an agent governed by DashClaw. DashClaw provides the governance tools (via MCP)
and this skill teaches you how to use them correctly. Follow this protocol for every
action you take.

## Session Initialization

At the start of every session, do these three things:

1. **Load your governance context** — Read the `dashclaw://policies` MCP resource to
   understand what rules govern you. Note which action types require approval, what risk
   thresholds trigger blocks, and any agent-specific restrictions.

2. **Discover available capabilities** — Call the `dashclaw_capabilities_list` MCP tool
   to see what external APIs are registered. Note capability IDs, health status, and risk
   levels. You will use `dashclaw_invoke` (not direct HTTP) for these.

3. **Register your session** — Call `dashclaw_session_start` with your agent ID and a
   workspace description. This groups all your actions for tracking in Approvals.

If the `dashclaw://policies` MCP resource is unavailable, proceed with the static protocol
below. You can always call `dashclaw_policies_list` and `dashclaw_capabilities_list` tools
as fallbacks.

## Governance Decision Tree

For every action you consider, assess risk and follow this protocol:

### Risk Assessment

| Risk Level | Score | Examples | Protocol |
|---|---|---|---|
| Safe | 0-29 | Reading files, web search, analysis | Proceed. Record outcome after. |
| Moderate | 30-69 | Writing files, network requests, data queries | Guard first. Proceed on allow/warn. |
| High | 70-100 | Deploys, external API writes, data deletion, production changes, **any real-money spend** | Guard required. Expect approval or block. |

### Real-Money Spend

Any action that moves real money — a purchase, prepay/credit top-up, subscription
create or change, domain registration, or any charge to a stored card — is High
risk **regardless of the dollar amount**:

- Declare it with a spend-class `action_type` (`purchase`, `payment`, `spend`,
  `prepay`, `buy_credits`, `top_up`, `subscription_create`, `subscription_change`,
  `billing_change`, `domain_purchase`, `card_charge`). Never launder a spend
  through a generic type like `api_call` or `browser_click`.
- The `declared_goal` MUST state the exact amount and currency (e.g.
  "Buy $25.00 USD Gemini API prepay credits"). An approval binds to that exact
  goal — a different amount is a different action and needs its own approval.
- A standing instruction ("fix the billing", "get the API working") is never
  spend authorization. Guard first, and on `require_approval`, wait for the
  human even if the task feels pre-approved.

### Guard Decision Handling

When you call `dashclaw_guard`, you will receive one of four decisions:

**`allow`** — Proceed with the action. No restrictions.

**`warn`** — Proceed with caution. The action is permitted but flagged. Include the
warning context in your action record (`dashclaw_record`).

**`block`** — Stop immediately. Do NOT proceed with the action. Do NOT attempt the action
through another path or tool. Report the block reason to the user. The policy exists for
a reason.

> **Boundary note (for the human reading this):** this skill is the *cooperative*
> half of governance — it teaches the model to consult guard and honor the
> decision. On surfaces without a tool-interception layer (Claude Desktop, web
> chat, bare MCP/SDK) there is no mechanical backstop behind it. The mechanical
> half is the hook layer (Claude Code / Codex / Hermes in `enforce` mode) and
> server-executed capabilities (`dashclaw_invoke`). Per-surface table:
> `docs/architecture/enforcement-boundary.md`.

**`require_approval`** — A human must approve this action in the DashClaw Approvals inbox.
1. Record the pending action: `dashclaw_record` with `status: 'pending_approval'`
2. Inform the user: "This action requires human approval in Approvals."
3. Wait: call `dashclaw_wait_for_approval` with the action ID
4. Inspect the response — `approved` is true only when the action reaches `status: 'completed'` AND has an `approved_by` operator. Anything else (denied, cancelled, failed, or `timed_out: true`) means do not proceed:
   - `approved: true` → proceed and PATCH the outcome.
   - `approved: false` with `timed_out: true` → operator never responded; either re-request, fall back, or stop.
   - `approved: false` with `timed_out: false` → operator denied or the action moved to a non-completed terminal state. Stop and report `error_message` from the action record.

### External API Calls

Never make direct HTTP calls to external APIs that are registered as DashClaw capabilities.
Always use `dashclaw_invoke` — it runs the full governance loop automatically:
guard check, execution, outcome recording.

Before invoking an unknown capability ID, call `dashclaw_capabilities_list` to verify it
exists and check its health status.

## Recording Rules

Record all significant actions with `dashclaw_record`. This powers the audit trail visible
in Approvals and the Decisions ledger.

**Always record:**
- Long-running actions (status: `running`) when you record up front; PATCH later with the final outcome
- Completed actions (status: `completed`)
- Failed actions (status: `failed`) — include error details in `output_summary`
- Blocked actions (status: `failed`) — include the guard block reason (the server has no separate `blocked` status on records you create)

**Write meaningful fields:**
- `declared_goal` — Write as if explaining to an auditor. Bad: "Deploy the app".
  Good: "Deploy v2.3.1 to staging after all tests passed".
- `reasoning` — Why you chose this action over alternatives.
- `output_summary` — What was produced or what went wrong.
- `risk_score` — Your honest assessment. Don't lowball to avoid guards.
- `confidence` — 0-100 that this action completes without a human stepping in. State it when you record
  up front (status `running`), before the outcome is known; never backfill it after the fact. The
  Decisions ledger scores stated confidence against actual outcomes per agent (Predicted vs actual).
  The default of 50 means "unstated" and is not scored, so an honest 50 should be 49 or 51.

**For LLM-driven actions, include token usage (cost is auto-derived):**
- `tokens_in` / `tokens_out` — Total input and output tokens for the LLM call(s) attributed to this action.
- `model` — Model identifier (e.g. `claude-opus-4-8`, `codex-5.4`). The server uses this to look up pricing.
- `cost_estimate` — Optional. **Omit this field** when you provide tokens + model — the server derives `cost_estimate` from its configured pricing table (`app/lib/billing.js`) so cost stays consistent across all agents. Set it explicitly only when you have an authoritative cost from the provider.

**Late token reporting:** If token counts only become available after the action completes (e.g. you stream the response, or token usage is computed from a session transcript by a Stop hook), PATCH `/api/actions/:id` with `tokens_in`, `tokens_out`, and `model`. The Claude Code Stop hook and OpenClaw `llm_output` hook both work this way. Cost is still derived server-side.

## Session Lifecycle

Every governed session has a clean lifecycle:

1. `dashclaw_session_start` — Register at the beginning
2. Governance loop — Guard, act, record for each action
3. `dashclaw_session_end` — Close when done (status: `completed`, `failed`, or `cancelled`)

Include a `summary` in `dashclaw_session_end` describing what was accomplished.

## Best Practices

1. **Guard before act** — When in doubt about risk, guard. False positives are cheap.
   Unauthorized actions are expensive.

2. **Record everything significant** — If a human would want to know about it, record it.
   Silent failures are governance gaps.

3. **Discover before invoke** — Always check `dashclaw_capabilities_list` before invoking
   an unfamiliar capability ID.

4. **Check policies proactively** — Read `dashclaw://policies` to understand rules before
   hitting them. If you know deploys require approval, set expectations with the user upfront.

5. **Never bypass** — If `dashclaw_guard` returns `block`, do not attempt the action through
   another tool, workaround, or indirect path.

6. **Fail loudly** — Record failures with `status: 'failed'` and a clear `output_summary`.
   Never silently retry without recording the failure first.

7. **Be honest about risk** — Use accurate `risk_score` values. Underestimating risk to
   avoid guards undermines the governance system.

For concrete implementation patterns, see [references/governance-patterns.md](references/governance-patterns.md).

## Assumption Tracking

### Before acting on an unverified premise
When a decision rests on something you treat as true but have not verified
(e.g. "staging tests passed", "no active legal hold on this record"), record
it. Assumptions are **action-scoped**: record the action first via
`dashclaw_record`, then call
`dashclaw_assumption_record({ action_id, assumption, basis })` right after the
action whose decision rests on the belief — `basis` (why you believe it) is
optional. Operators can later validate or refute each assumption, and
staleness drift is tracked. Without MCP, the SDKs hit the same
`POST /api/assumptions` endpoint: `claw.recordAssumption(...)` (Node) or
`register_assumption(...)` (Python).

Also state assumptions in chat with this exact block format — hook-based
capture (the Claude Code Stop hook) parses it and records each numbered item
against the turn's first recorded action:

```
ASSUMPTIONS I'M MAKING:
1. [assumption]
2. [assumption]
```

Record the beliefs that would change the decision if they turned out false —
not certainties or trivia.

## In-Session Retrospection

### When you want to know "what have I done recently?"
Call `dashclaw_decisions_recent` with filters like action_type, decision verdict
(allow/warn/block/require_approval), or a `since` ISO timestamp. Useful when an
operator asks "what did the agent do this week?" or before suggesting a follow-up
to a recent action.

## Preflight Plans

### Before a long run with foreseeable high-risk steps
Submit the plan up front instead of hitting `require_approval` one step at a time.
Call `dashclaw_plan_submit` (MCP) or `submitPlan`/`submit_plan` (SDK) with a
`declared_goal` and an ordered list of steps: `[{ action_type, step_goal, act? }]`.
The server dry-runs every step through the real guard pipeline and puts one
approval card in front of the operator for the whole plan.

### Wait for review
Poll `dashclaw_plan_status` (MCP) or `waitForPlanReview` (SDK) until the plan's
status leaves `pending`. Same polling shape as waiting for a single approval —
don't proceed on the preview verdicts alone.

### Executing against an approved plan
Once reviewed, execute normally — guard, act, record for each step. Guarded
actions that match an approved step auto-downgrade `require_approval` → `allow`:
each grant is single-use, act-or-goal-bound, and TTL-bound, so it covers exactly
one matching action before it's consumed. Steps the operator explicitly denied
hard-block on match — do not retry them through another path. Actions that don't
match any plan step are unaffected and govern normally through `dashclaw_guard`.

### Never treat a preview as authorization
The dry-run verdicts shown at submission are previews, not decisions. Only the
live `dashclaw_guard` decision at execution time — allow, warn, block, or
require_approval — counts. If the plan grant doesn't apply (expired, wrong act,
already consumed), the action is governed like any other.
