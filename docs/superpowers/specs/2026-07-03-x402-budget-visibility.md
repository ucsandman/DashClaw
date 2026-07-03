# v2.6c — x402 budget consumption visibility (2026-07-03)

Roadmap: docs/plans/owner-roadmap.md §v2.6c (HUMAN-EXPERIENCE.md debt, from the
era retro-audit docs/plans/2026-07-02-human-experience-retro-audit.md).

## Problem

The cumulative budget gate (`x402BudgetDecision`, app/lib/guard.ts) computes
window spend on every governed purchase, but nothing renders the state it
computes. An operator cannot see "this agent is at $43 of $50 this window"
until a purchase interrupts. `sumWindowSpend` (x402.repository.ts:315) is
guard-only.

## Decisions

1. **Read API — `GET /api/x402/budget`** (org-scoped, same `getOrgId` auth as
   sibling x402 routes). For every **active** `x402_spend_limit` policy with a
   budget tier (`budget_usd` or `budget_approval_threshold` present) it
   returns one entry:
   - `policy_id`, `policy_name`, `agent_ids` (targeting, parsed array)
   - config: `budget_usd`, `budget_approval_threshold`,
     `budget_window_days`, `budget_scope` (normalized via the same
     clamping as the guard's `x402BudgetWindow` — ONE definition)
   - `window_start` (ISO)
   - `scope: 'org'` → `window_spend_usd` (reuses `sumWindowSpend`, so the
     meter and the gate share ONE spend predicate)
   - `scope: 'agent'` → `families: [{ agent_id, window_spend_usd }]` — per
     identity-family spend via new repository fn `sumWindowSpendByFamily`
     (GROUP BY `split_part(agent_id, ':', 1)`, same status predicate,
     `agent_id IS NOT NULL`; unattributed rows can't belong to a family and
     the guard already fail-closes them on agent scope).
   - `?agent_id=` query param filters agent-scoped families to that identity
     family (normalized with `baseAgentId`); org-scoped entries unaffected.
   - No caching: same reasoning as `sumWindowSpend` — spend moves with every
     purchase; the aggregates are cheap and indexed (0038).
2. **Meter on /spend/x402**: a "Budgets" section above the purchases table.
   One card per budget entry; org cards render a single bar, agent cards a
   bar per family with window spend (honoring the page's agent filter).
   Bar = spend / budget_usd (clamped); tick at the approval threshold.
   Tone: default → warning at/over the approval threshold (or ≥80% of the
   hard budget when no approval tier) → error at/over the hard budget.
   CSS tokens only. Section hidden when no budget policies exist.
3. **Policy card (/policies → Custom rules list)**: x402 rows with a budget
   tier get a live consumption suffix ("$43.20 of $50 · 30d org") + inline
   mini-bar, from one `GET /api/x402/budget` fetch mapped by `policy_id`.
4. **Demo**: `demoMiddleware` gains a `/api/x402/budget` handler with a
   near-threshold scenario so the demo instance shows a hot meter.
5. **Punch-list ride-along** (retro-audit "minor"): risk-composition hint on
   /decisions LIST rows — only if the list payload already carries the data.

## Not doing

- No new tables, no snapshots — computed on read (the v2.6b pattern).
- No per-provider budget breakdown (no policy field exists for it).
- No SSE/live push; the page's existing load/refresh model is enough.

## Acceptance (from the roadmap)

- A seeded near-budget scenario renders the meter live (headless-browser
  rendered proof, HUMAN-EXPERIENCE.md clause 4).
- Smoke extended: budget read API agrees with recorded purchases.
- Docs/counts updated in the same ship (route count 325 → 326).
