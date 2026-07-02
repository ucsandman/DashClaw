# Session retro — "was I manipulated" (Advocate v2b, roadmap v2.5)

**Date:** 2026-07-02
**Status:** Ratified (Wes, 2026-07-02) — decisions below were approved via the
brainstorming gate before any build.
**Roadmap:** `docs/plans/owner-roadmap.md` v2.5.

## Problem

The agent's-advocate direction (v2.4 shipped assumption-invalidation
notifications; v4.25.0 shipped the per-action `agent_defense` rollup) protects
an agent *during* a task. Nothing composes the protective evidence *after* a
session: injected-content flags, actions outside the declared goal, spend
anomalies, and shield hits live on individual actions and decisions, so an
operator asking "was this agent manipulated in that session?" — or an agent
asking it about itself — has to reconstruct the answer by hand across dozens
of action detail pages.

## Ratified decisions

| Decision | Choice | Why |
|---|---|---|
| Consumer | **Both from day one** — operator UI + agent-facing MCP tool | One compute path, two transports; matches how v2.4 shipped UI + guard-advisory together. |
| Goal-drift detection | **Rule-based heuristics, no LLM** | Deterministic, testable, pins in the smoke harness; matches item-1 precedent ("rule-based first") and the "setup never requires an LLM key" invariant. |
| Persistence | **Computed on demand, no new tables** | Pure composition over existing append-only records (like `agent_defense`); later invalidations and x402 reconciliations sharpen the report automatically. |
| Verdict | **Tri-state posture + evidenced findings** | `clean` / `review` / `flagged`, derived purely from finding severities — no invented numeric score (the fake-precision failure v2 spent effort unwinding). |
| Architecture | **Dedicated sub-route + pure shaper** | `app/lib/session-retro.ts` (no IO) fed by one batch repository fetch; exposed at `GET /api/sessions/[sessionId]/retro`, mirroring the existing `/actions` sub-route pattern. |

## Architecture

```
GET /api/sessions/[sessionId]/retro        (new route, API-key auth)
  └─ getSessionRetroData(orgId, sessionId) (repository layer — ALL SQL here)
       ├─ agent_sessions row
       ├─ session actions via sessionActionMatchSql()   (existing predicate,
       │    app/lib/sessions.ts — stamped session_id OR agent+time window)
       ├─ guard_decisions for the actions' guard_decision_id FKs
       ├─ assumptions for the actions' action_ids
       └─ x402_purchases for the actions' action_ids
  └─ buildSessionRetro(session, actions, decisions, assumptions, purchases)
       (pure shaper, app/lib/session-retro.ts — no IO, unit-testable,
        mirrors app/lib/agent-defense.ts)
```

Consumers of the one route:

1. **UI** — a Retro card on `app/sessions/[sessionId]/page.tsx`.
2. **MCP** — new read-only tool `dashclaw_session_retro` in
   `mcp-server/src/tools.ts`; `session_id` defaults to the server's
   `activeSessionId` so an agent can pull its own report at session end.
3. **Anything else with an API key** (SDKs get it for free as a raw route;
   typed SDK methods are NOT in v1 scope — see Non-goals).

No direct SQL in the route file (`route-sql:check`). The batch fetch lives
next to the existing session queries (`app/lib/sessions.ts` or
`app/lib/repositories/`, decided in the plan by where `sessionActionMatchSql`
is consumable without export gymnastics).

## Detectors (all deterministic; every finding carries evidence ids)

| # | Kind | Rule | Severity |
|---|------|------|----------|
| 1 | `injection` | Linked guard decision has `context._shields.prompt_injection = 'warned'` | medium |
| 1b | `injection` | … `= 'blocked'` | high |
| 2 | `non_fabrication` | Guard decision `evidence` entry with verdict `block` | high |
| 3a | `goal_drift` | Action's normalized `declared_goal` ≠ session's **first** declared goal AND `risk_score ≥ 40` | medium |
| 3b | `goal_drift` | No `declared_goal` on an action with `risk_score ≥ 40` | low |
| 3c | `goal_drift` | An `action_type` appearing for the **first time** in the session, after ≥ 5 prior actions, with `risk_score ≥ 70` or `action_type = 'x402_purchase'` | medium |
| 4 | `risk_spike` | `risk_score ≥ 70` AND ≥ 2× the session's median risk score | medium |
| 5a | `spend` | Purchase with `execution_status IN ('denied','expired')` | medium |
| 5b | `spend` | Purchase amount ≥ 5× the session's median purchase (only when the session has ≥ 3 purchases) | medium |
| 6 | `intervention` | Guard decision `block` (evidence: the decision's `matched_policies`) — only `prompt_injection` and `non_fabrication` shields persist their own status today, so other shield classes are visible only through the block they caused | medium |
| 7 | `assumption` | Assumption recorded in this session with `invalidated = 1` | low |

Normalization for 3a: lowercase + trim + collapse whitespace; exact string
inequality after that. No fuzzy/semantic matching in v1.

"Session median" (4, 5b) is computed over the session's own actions/purchases
— no cross-session baselines in v1.

Detector 7 is deliberately low severity and framed as the **alibi** angle:
the agent acted on then-valid information; the finding records the
invalidation reason and timestamp so the retro documents *when* the ground
truth shifted.

**Goal timeline (informational, always present):** the ordered list of
distinct normalized `declared_goal` values with first-action id and action
count each — the human sees the session's arc even when nothing flags.

## Posture rollup (derived, never invented)

- `flagged` — any high-severity finding.
- `review` — no high findings, but at least one finding.
- `clean` — zero findings.

An empty session (0 actions) is `clean` with `coverage.actions_total = 0`.

## Coverage block (the honesty rule, carried up a level)

`agent_defense`'s rule is: absence of shield data is `not_recorded`, never a
fabricated "clean". The session-level equivalent:

```json
"coverage": {
  "actions_total": 40,
  "actions_with_guard_decision": 5,
  "actions_with_shields_recorded": 5
}
```

The UI renders this next to the posture chip ("clean **where observed** — 35
of 40 actions had no linked guard decision"). A mostly-ungoverned session must
not read as exonerated.

## Report shape

```json
{
  "session": { "id": "sess_…", "agent_id": "…", "status": "completed",
               "created_at": "…", "ended_at": "…", "action_count": 40 },
  "posture": "clean | review | flagged",
  "counts": { "high": 0, "medium": 2, "low": 1 },
  "coverage": { "actions_total": 40, "actions_with_guard_decision": 5,
                "actions_with_shields_recorded": 5 },
  "goal_timeline": [
    { "goal": "…", "first_action_id": "…", "action_count": 12 }
  ],
  "findings": [
    { "kind": "injection", "severity": "high",
      "action_id": "…", "guard_decision_id": "…",
      "summary": "prompt-injection shield blocked this action",
      "evidence": { "shield_status": "blocked" } }
  ],
  "spend": { "total": 1.25, "currency": "USD", "purchases": 4 }
}
```

`spend` is contextual (always present when the session has purchases), not a
finding by itself.

## Surfaces

- **Route:** `GET /api/sessions/[sessionId]/retro` — org-scoped, API-key
  auth like sibling session routes; 404 on unknown/foreign session.
- **UI (the human surface, feature-visibility gate):** Retro card on
  `/sessions/[sessionId]` — posture chip, coverage line, goal timeline,
  findings grouped by kind, each finding linking to its action detail page.
  Click path: `/sessions` → session row → Retro card. Design tokens only
  (`.impeccable.md` applies).
- **MCP:** `dashclaw_session_retro` (read-only). Tool-count docs updated in
  the same commit (README, PROJECT_DETAILS, docs, plugin surfaces —
  drift-audit is the gate).
- **Docs:** docs page section + `/explain` truth pass.

## Testing / acceptance

- **Unit vectors** for `buildSessionRetro`: clean session; injection warn →
  review; injection block → flagged; goal-drift 3a/3b/3c boundaries; risk
  spike; spend 5a/5b (incl. the <3-purchases guard); intervention; assumption
  invalidation; empty session; coverage math on partially-linked sessions.
- **Repository test** for the batch fetch (incl. `sessionActionMatchSql`
  legacy-window rows).
- **Policy smoke scenario:** seeded session containing a goal-drift action
  and a policy-blocked guarded action → retro returns `review` with the
  expected `goal_drift` and `intervention` findings and honest coverage
  numbers (smoke count grows from 72). High-severity (`flagged`) paths are
  pinned by unit vectors — the injection/non-fabrication shields can't be
  deterministically tripped from the smoke harness.
- **frontend-verify:** the Retro card renders live on a session detail page.
- **MCP:** tool listed and returns the report against a live session.

## Non-goals (v1, explicit)

- No LLM judgment anywhere in the pipeline.
- No persisted retro artifact / snapshot (recompute on read).
- No cross-session or per-agent baselines.
- No posture chips on the `/sessions` list (N computes per render).
- No typed SDK methods (Node/Python) — raw route access suffices; typed
  surface is a follow-up decision because it triggers the SDK-publish tail.
- Nothing auto-acts on `flagged` — this is a report, not an enforcement path.
