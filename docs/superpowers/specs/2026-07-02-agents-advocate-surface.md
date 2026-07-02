# Agent's-advocate surface — spec (owner roadmap item 4)

Maintainer spec under MAINTAINER.md. Reframes DashClaw's protective features
as protection FOR the agent — the assumption ledger as the agent's alibi
(evidence of reasonable action on known information), prompt-injection +
non-fabrication shields as protection from weaponization, x402 spend gates
as protection from bankrupting mistakes — and makes that protection visible
per action.

## Goal

Today the product's framing is one-directional: DashClaw protects the world
from agents. The MAINTAINER.md thesis is explicitly bidirectional. The data
that proves an agent acted reasonably already exists (declared goal,
assumption ledger, guard decision, shield evidence) but is scattered across
tabs and one of its joins is fake: the action detail pages find "their"
guard decision by matching action_type + a 60-second timestamp window
(`app/decisions/[actionId]/page.tsx:138-151`) even though the exact FK
(`action_records.guard_decision_id`, stamped since the item-1 ship) sits
unused in the row they already fetched.

Deliverables (the roadmap's "concrete first step", nothing more):

1. An `agent_defense` rollup computed server-side on the existing
   `GET /api/actions/{actionId}` response, joined by the real FK.
2. An "Agent defense" section in the action detail views and a compressed
   badge row on `/replay/{actionId}`.
3. A "DashClaw protects the agent too" section on `/explain`, with its
   claims added to the claims ledger and pinned by the smoke harness.
4. Docs positioning copy in the same protective-direction voice.

## Design decisions

### D1 — Join by FK, not heuristic; no new route

- New repository function `getGuardDecisionById(sql, orgId, id)`
  (`app/lib/repositories/guardrails.repository.ts` — nothing today fetches
  a single decision).
- `getActionWithRelations` fetches the linked decision when
  `action.guard_decision_id` is set (second query, only when present) and
  the route response gains two additive keys: `guard_decision` (the linked
  row, context/matched_policies parsed) and `agent_defense` (the rollup).
- **No new API route.** Additive keys on an existing GET keep the route
  count, SDK method count, and MCP tool count all unchanged — the drift
  surface of this ship is near zero — and every SDK/MCP consumer of
  "get action" gets the defense rollup for free.
- Actions with no `guard_decision_id` (pre-item-1 history, ungoverned
  writes) get `agent_defense.decision.linked: false` — shown honestly as
  "no decision linked", never silently backfilled by the old heuristic.
  The heuristic stays where it is for now (it feeds the legacy Policies
  tab render for old rows); new UI uses only the FK data.

### D2 — The rollup shape (pure function, unit-tested)

New `app/lib/agent-defense.ts` exporting
`buildAgentDefense(action, guardDecision, assumptions)` — pure shaping, no
IO, so golden-vector tests need no DB. Shape:

```jsonc
{
  "declared": {            // what the agent said it was doing, up front
    "goal": "...",         // action.declared_goal
    "reasoning": "...",
    "authorization_scope": "...",
    "trigger": "..."
  },
  "assumed": {             // the alibi: knowledge state at decision time
    "total": 3, "validated": 1, "invalidated": 1, "open": 1
  },
  "decision": {            // what governance concluded, exactly linked
    "linked": true,        // false when guard_decision_id is null
    "id": "act_gd_...",
    "decision": "allow",
    "reason": null,
    "matched_policies": ["..."],
    "risk_score": 25,
    "risk_breakdown": { }  // context._risk_breakdown passthrough, if present
  },
  "shields": {             // what stood between the agent and weaponization
    "prompt_injection": { "status": "clean" },   // see D3
    "non_fabrication":  { "evaluated": true, "verdict": "pass",
                           "violations": 0, "receipt": true },
    "spend":            { "evaluated": false }    // x402 actions only
  }
}
```

- `shields.prompt_injection.status`: `clean | warned | blocked |
  not_recorded` (D3). `not_recorded` for rows persisted before this ship —
  the advocate surface must not fabricate its own evidence.
- `shields.non_fabrication` derives from the decision's `evidence` column
  (the only place it lives): evaluated/verdict/violation count/receipt
  presence. Violation details stay in the Policies/Evidence tabs.
- `shields.spend` is `evaluated: true` only for `action_type ===
  'x402_purchase'` with the outcome (`within_limits | required_approval |
  blocked`) derived from the decision. Deliberately narrow — claims-audit
  B2 taught that implying generic spend protection is an overpromise.
- No `decision.linked` → `shields` are all `not_recorded`/`evaluated:
  false`: without the decision row there is no shield evidence to report.

### D3 — Persist shield outcomes structurally (`_shields` in context)

Warn-level injection catches go only into `acc.warnings`, which is **not
persisted** (`buildGuardDecisionRow` persists `reason` = reasons only), and
"the scan ran and found nothing" is recorded nowhere. Fix at the source,
following the `_risk_breakdown` precedent (additive underscore-prefixed key
inside the persisted context JSON, no migration):

- The accumulator tracks `shields.prompt_injection` = `clean` (scan ran,
  no finding) | `warned` | `blocked` | `disabled`
  (`DISABLE_PROMPT_INJECTION_SCAN=true`).
- `buildGuardDecisionRow` persists `_shields` alongside `_risk_breakdown`.
- Historical rows without `_shields` → `not_recorded` in the rollup.
- Hot-path cost: a few object writes; zero queries.

### D4 — UI: sidebar card in detail views, badge row on replay

Read `.impeccable.md` before the UI edits (standing rule).

- `app/decisions/[actionId]/page.tsx` and `app/actions/[actionId]/page.tsx`
  each get an **"Agent defense" sidebar card** (pattern: the Identity card)
  rendering the rollup at a glance — declared goal presence, assumption
  counts (validated/invalidated/open), linked decision + risk score, shield
  statuses. It reframes data the tabs already hold; the card links into the
  Policies/Assumptions tabs for detail. A shared
  `app/components/AgentDefenseCard.tsx` keeps the two pages identical.
- The two detail pages are near-duplicates (958 vs 1319 lines); merging
  them is a real refactor and **out of scope** — the shared card component
  is the anti-drift measure this ship takes instead.
- `app/replay/[actionId]/page.tsx` (the shareable/embeddable story card)
  gets a compressed badge row: **counts and statuses only, never assumption
  or reasoning text** — replay screenshots travel further than the
  authenticated page does.

### D5 — /explain section + claims discipline

New `<section id="advocate">` in `public/explain/index.html` (static
HTML/vanilla-JS pattern like every other section), placed after `#loop` —
it is framing, and it lands before the reader reaches the simulator. Three
short cards mirroring the thesis:

- **The alibi** — every action records what the agent declared and assumed
  *before* acting; when something goes wrong, the ledger shows the agent
  acted reasonably on what it knew.
- **Protection from weaponization** — prompt-injection scanning on declared
  goals and non-fabrication verification with signed receipts mean a
  manipulated or misquoted agent has evidence, not just a denial.
- **Protection from bankrupting mistakes** — x402 per-purchase caps and
  cumulative window budgets interrupt runaway spend before the money moves.
  Copy stays x402-scoped (claims-audit B2 lesson: never imply generic
  spend gating).

Claims discipline: each assertion gets a claim ID appended to
`docs/plans/2026-07-01-explain-claims-audit.md` (new section, H-series),
and the live-provable core gets a smoke check (below). Copy that cannot be
proven live is either cut or worded as design intent, per the audit method.

### D6 — Docs positioning

- `app/docs/page.tsx`: document the additive `guard_decision` +
  `agent_defense` response keys where the action GET is documented, plus a
  short protective-direction paragraph in the intro region. No new page,
  no new sidebar section unless the copy genuinely needs one.
- README / PROJECT_DETAILS: one positioning line each if they describe the
  action detail surface; counts re-grepped (`check-doc-counts --strict`).

## Acceptance (live proof + tests)

- **Rollup golden vectors** (`__tests__/unit/agent-defense.test.js`):
  linked decision with `_shields` → full rollup; legacy decision without
  `_shields` → `not_recorded`; no `guard_decision_id` → `linked: false` and
  no shield claims; non-fab evidence → verdict/violations/receipt;
  x402 action → spend evaluated with correct outcome; assumption counts
  (validated/invalidated/open) sum to total; malformed context/evidence
  JSON → degrades to `not_recorded`, never throws.
- **Repository**: `getGuardDecisionById` returns null across orgs
  (tenant boundary test).
- **Guard**: unit vectors asserting `_shields.prompt_injection` persists as
  `clean` on a benign goal, `blocked` on an injection-bearing goal, and
  `disabled` under the env opt-out.
- **Policy smoke harness** (`scripts/policy-smoke.mjs` — the live proof,
  H-series checks): drive a guarded action via `?record=true`, GET the
  action, assert `agent_defense` present, `decision.linked === true`, the
  decision id equals the row's `guard_decision_id`, and
  `shields.prompt_injection.status === 'clean'`; record an assumption
  against the action and assert the rollup counts it.
- **Gates**: lint, full vitest, `next build` (app/** changed),
  `npm run typecheck` (.ts changed), contract checks, doc counts.
- **UI verified live** on the dev server (detail card, replay badges,
  /explain section) before push.

## Security notes (for review)

- `getGuardDecisionById` is org-scoped in the WHERE clause; the FK value
  on the action row was already validated org-local at write time
  (`app/api/actions/route.ts:111-121`).
- `agent_defense` exposes no field class the org couldn't already read via
  `GET /api/guard` + the action response — it is a join and a reframe, not
  a new disclosure. The replay surface deliberately gets counts only.
- Read-path feature; the only write change is the additive `_shields` key
  inside a JSON column the guard already owns.
- Advocate honesty rule: absence of evidence renders as "not recorded" —
  the surface never asserts protection it cannot point to in a persisted
  row. An advocate that fabricates its client's alibi is worse than none.

## Out of scope (v1 — spec first if promoted)

- Assumption-invalidation notifications to the agent mid-task, and the
  "was I manipulated" session retro view (the roadmap's "bigger
  candidates").
- Detail-page dedup (`app/actions/[actionId]` vs `app/decisions/[actionId]`).
- Backfilling `_shields` or `guard_decision_id` onto historical rows.
- New SDK convenience methods (the richer existing response is the SDK
  story).
