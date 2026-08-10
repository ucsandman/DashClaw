# Role Constraints ("workbenches") — design

**Date:** 2026-08-10 · **Status:** Approved by owner (Wes) in-session · **Ships as:** +1 guard policy type (`role_constraint`), THESIS amendment 15 → 16

## What

A role is a named, governed authority bundle for top-level agents: this role
gets these action types, this risk ceiling, this path scope — nothing else —
enforced server-side on every guard call. The concept ("workbench") comes from
per-work-type tool bundles in agent platforms; DashClaw ships the governance
half only. Scoped credentials are explicitly out of scope (managed secrets are
on the v5.0.0 kill list in THESIS.md and stay dead).

## Shape

One policy row per role, type `role_constraint`:

- **Role name** = the policy `name` (e.g. "Reviewer", "Deployer").
- **Members** = the existing `agent_ids` scoping (null/empty = all agents;
  composed `parent:child` ids already inherit the parent's targeted policies
  via `loadApplicablePolicies`, so a role covers an agent's subagents free).
- **Rules** (all optional; each only tightens):

```json
{
  "allowed_action_types": ["file_read", "code_review"],
  "blocked_action_types": ["deploy", "db_migration"],
  "max_risk_score": 60,
  "blocked_path_globs": ["infra/**", ".env*"],
  "escalate_action": "require_approval"
}
```

`escalate_action` is `require_approval` (default) or `block`.

## Evaluator

`app/lib/guard/policy.ts`, `role_constraint` entry in `POLICY_EVALUATORS` —
structurally `delegation_constraint` minus the composed-id gate and
`max_depth`:

- Fires for any targeted agent (no `:` requirement; agent targeting is done by
  `agent_ids` row scoping, not inside the evaluator).
- Checks in order: blocked action types → allowed action types (outside-list
  escalates) → `max_risk_score` vs `effectiveRiskScore` (post-predictive) →
  `blocked_path_globs` vs `context.target` + `context.write_paths` (via
  `matchesProtectedPath`).
- Returns `{ action: escalate, reason }` on violation, else `null`.
- Tighten-only: can escalate to `require_approval`/`block`, never grant.
  Joins the decision lattice by max. Outside-the-role attempts escalate rather
  than silently drop, so the operator sees what the agent reached for in the
  Approvals inbox — the intercept → decide → approve → prove loop.

## Human surface (HUMAN-EXPERIENCE compliance)

Existing `/policies` rails, mirroring `delegation_constraint`'s footprint:

- `app/policies/lib/policyFormModel.js` — `role_constraint` form model
  (defaults + serialization).
- `app/policies/components/PolicyRuleBuilderSection.tsx` — form section:
  action-type lists, risk-ceiling input, path globs, escalation choice; agent
  membership uses the existing agent-targeting picker.
- `app/policies/lib/shields.js` + `app/policies/components/Ledger.tsx` —
  ledger rendering.
- Click path: `/policies` → New policy → Role constraint. Verified rendered
  before done. No new pages, routes, tables, MCP tools, or SDK methods.

## Validation

`app/lib/validate.js` gains `role_constraint` rule validation like the other
types: arrays of strings for the three list fields, 0–100 number for
`max_risk_score`, `escalate_action ∈ {require_approval, block}`. Malformed
fields rejected at policy write time; unknown/empty fields no-op at eval time
(fail-open within a tighten-only policy = no false grants).

## Surface budget / thesis

- `contracts/surface-budget.json`: guard policy types 15 → 16.
- `THESIS.md` amendment-log entry in the same commit (the brake's rule):
  no-surface economy, extends the existing evaluator map + `/policies` rails.
- Doc-count sweep for any cited "15 guard policy" counts
  (`scripts/check-doc-counts.mjs --strict`).

## Testing

- `__tests__/unit/guard-role-constraint.test.js` — evaluator: blocked type,
  outside allowlist, ceiling breach, path breach, escalate_action=block,
  non-targeted agent untouched, empty rules no-op.
- Existing coverage suites pick up the new type:
  `validate-policy-new-types.test.js`, `policyFormModel.test.js`,
  `policy-types-coverage.test.js`, `policy-contract.test.ts`.
- Gates: lint, full vitest, typecheck, next build, rendered `/policies` proof.

## Out of scope (recorded decisions)

- Scoped credentials per role — thesis-killed (managed secrets); would need
  its own thesis amendment and security review.
- SDK/MCP wrappers — policy CRUD already covers create/edit; no ceiling bumps.
- `roles` as first-class table/routes/page — platform-shaped regrowth the
  brake exists to stop; the policy row IS the role.
