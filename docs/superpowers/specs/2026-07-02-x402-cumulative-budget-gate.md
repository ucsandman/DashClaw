# Cumulative x402 budget gate — spec (owner roadmap item 2)

Maintainer spec under MAINTAINER.md. Extends the existing `x402_spend_limit`
policy type with per-window budget rules. No new policy type, no new route,
no new SDK/MCP surface — the whole change is new optional fields on an
existing rules object plus their enforcement, validation, authoring UI,
tests, and docs.

## Goal

Today `x402_spend_limit` caps only the single purchase (`max_spend_usd`,
`approval_threshold`). Real cost harm is cumulative: an agent making 500
purchases of $0.90 sails under a $1 per-purchase cap while draining $450.
Add guard-time enforcement of cumulative spend over a rolling window, so a
budget breach interrupts the purchase *before* the money moves — protecting
the org from runaway cost and the agent from bankrupting itself
(MAINTAINER.md thesis: protection in both directions).

## Design decisions (settles the roadmap's in-build questions)

### D1 — Rolling window, not calendar month

`budget_window_days` (integer, 1–365, default 30). Rationale:

- Codebase convention: `rate_limit` uses rolling minutes; the FinOps
  aggregation (`getX402SpendAggregation`) uses rolling day periods.
- A calendar month has a reset cliff (full budget available again at
  midnight on the 1st) and timezone ambiguity. A rolling window degrades
  smoothly: old spend falls out of the sum continuously.

### D2 — Scope: `budget_scope: 'org' | 'agent'`, default `'org'`

- `'org'` (default): the window sum covers all of the org's x402 purchases.
  This matches the harm model — cumulative cost accrues to the org's wallet.
- `'agent'`: the window sum filters to the incoming purchase's `agent_id`.
- An org-level AND per-agent budget together = two policies; the guard
  already composes multiple matched policies by raising to the most severe
  decision.
- **Unattributed purchase under an agent-scoped budget** (no `agent_id` in
  context): the sum cannot be attributed, so the check cannot be verified.
  Fail closed: `require_approval` with an explicit reason. Skipping (the
  `rate_limit` convention) would make "omit agent_id" a budget bypass —
  acceptable for rate limiting, not for money.

### D3 — Coexistence with the per-purchase cap: same rules object, mirrored two-tier semantics

New optional fields alongside the existing ones, mirroring their operators
exactly so the mental model transfers:

| Field | Tier | Operator | Result |
|---|---|---|---|
| `approval_threshold` (existing) | per-purchase | `spend >= t` | require_approval |
| `max_spend_usd` (existing) | per-purchase | `spend > max` | block |
| `budget_approval_threshold` (new) | window sum + incoming | `sum >= t` | require_approval |
| `budget_usd` (new) | window sum + incoming | `sum > max` | block |

- All four are optional; absent = Infinity (existing convention). `0` is
  valid (`budget_usd: 0` = hard spend freeze).
- The evaluator returns the **most severe** of the per-purchase and budget
  results (block > require_approval). Today's `provider ?? spend`
  first-non-null return is kept for the provider tier (block-only, already
  maximal) but per-purchase vs budget must not let a per-purchase
  require_approval shadow a budget block.
- The budget tier runs ONLY when a budget field is present — existing
  per-purchase-only policies gain zero DB queries (guard hot-path
  discipline).

### D4 — Fail-closed on sum-query failure

Reuse the guard's documented degradation contract
(`resolveDegradedAction`): per-policy `rules.on_failure` →
`DASHCLAW_GUARD_FALLBACK` env → fail-closed default `require_approval`,
with `allow` as the explicit self-hoster escape hatch. Identical precedence
to `webhook_check.on_timeout` and `semantic_check.fallback`. The reason
string names the failure:
`x402 budget check failed — degraded decision (require_approval)`.
The `allow` path passes through but records
`x402 budget check failed — skipped (on_failure: allow)` as a warning on the
persisted decision (security review 2026-07-02, LOW: the skip must be
visible in the decisions ledger, not just the server log).

The query failure is caught inside the evaluator; it never throws through
`evaluateGuard` (which would 500 the purchase request with no recorded
decision — the worst outcome: no decision, no audit row).

## What counts toward the sum

`SUM(spend_amount)` over `x402_purchases` in the window WHERE
`execution_status <> 'failed'` — the **same predicate the FinOps rollup
uses** (operator decision 2026-06-05: a failed x402 call means no money
moved). One definition of "spend" across the product. Consequences, stated
deliberately:

- **Pending purchases count** (reserved spend awaiting approval). An agent
  cannot *sequentially* queue N purchases that each individually fit the
  budget — each one raises the sum the next one is checked against.
- **Concurrent bursts are caught post-insert** (security review 2026-07-02,
  MEDIUM). The guard reads the window sum before the purchase row exists, so
  N truly concurrent purchases would each pass against the same pre-insert
  sum (Neon HTTP has no transactions or session advisory locks to serialize
  the read+insert). The purchases route therefore re-verifies the hard
  budget AFTER the row commits — the sum then includes the caller's own row
  and any concurrent winners — and compensates on breach before the agent
  executes payment: purchase → `failed` (excluded from future sums), action
  → `blocked` (audit trail preserved), response → 403. Residual exposure is
  bounded to near-simultaneous commits inside the re-read window (ms), not
  the full guard→insert span. Only `budget_usd` is re-verified; the approval
  tier already produced its interruption. The re-check is best-effort (a
  transient failure logs and passes — the pre-insert gate already ran
  fail-closed; failing every allowed purchase would be a new outage mode).
- **Blocked purchases never count** — the purchase row is only created for
  non-blocked decisions (`createBlockedActionRecord` writes no x402 row).
- **Denied approvals**: nothing today flips a denied purchase's
  `execution_status` (only the agent-reported outcome route does, mapping
  completed/partial/failed). A denied purchase therefore keeps counting
  until it rolls out of the window. Conservative in the protective
  direction; the rolling window is the relief valve. Documented, not
  hidden.
- **No double count**: guard evaluates BEFORE `createPurchase`, so the
  incoming purchase's own row does not exist yet; the check is
  `windowSum + incomingAmount` vs the budget.
- **Currency**: `spend_amount` is summed as USD-equivalent regardless of
  `currency`, matching `total_spend_usd` in the FinOps aggregation.
  Multi-currency normalization is out of scope.
- **Scope of visibility**: the budget governs x402 purchases only — spend
  recorded through `/api/x402/purchases` (or guard calls with
  `action_type: 'x402_purchase'` never materialize rows and therefore
  never accrue). The B2-NEG smoke check already documents that generic
  `payment.create` actions are not spend-gated; the docs for budget say the
  same.

## Implementation

### Migration — `drizzle/0036_x402_purchases_org_created_idx.sql`

```sql
CREATE INDEX IF NOT EXISTS "idx_x402_purchases_org_created"
  ON "x402_purchases" ("org_id", "created_at");
```

The only index today is `(org_id, provider_id, created_at)`; the budget sum
filters by `(org_id, created_at)` [+ optional agent_id] on the guard hot
path. Purchases per org stay small, but the index makes the hot-path cost
independent of that assumption.

### Repository — `app/lib/repositories/x402.repository.ts`

New `sumWindowSpend(sql, orgId, { sinceIso, agentId? })` → `number`.
Mirrors `getX402SpendAggregation`'s totals query (COALESCE SUM ::real,
`execution_status <> 'failed'`, conditional agent fragment, `Number()`
coercion for the Neon string-numeric driver behavior). NOT cached — spend
changes with every purchase; a 30s-TTL cache would let over-budget
purchases slip through on the stale read.

### Guard — `app/lib/guard.ts`

- `evaluateX402SpendLimitPolicy` becomes async and uses `sql`/`orgId`
  (already on `PolicyEvalArgs`).
- Order: provider decision (block-only, return immediately) → per-purchase
  decision + budget decision (only if a budget field present) → return the
  more severe; tie → per-purchase (more specific reason, no behavior
  change for existing policies).
- Budget reasons carry evidence:
  `Cumulative x402 spend $12.00 over 30d (incl. this $4.00 purchase) >= budget approval threshold $10`.
- Degradation per D4; `console.warn` with org/agent identifiers, mirroring
  the deadline path's log shape.

### Validation — `app/lib/validate.js` (x402_spend_limit case)

- `budget_usd`, `budget_approval_threshold`: finite non-negative when
  present (`isFiniteNonNegative` — 0 allowed).
- `budget_window_days`: integer 1–365 when present.
- `budget_scope`: `'org' | 'agent'` when present.
- `on_failure`: `'allow' | 'block' | 'require_approval'` when present.

### Types — `app/lib/types/governance.ts`

Extend the `x402_spend_limit` member of the typed-rules union with the five
new optional fields.

### Authoring UI — `app/policies/lib/policyFormModel.js` + `PolicyRuleBuilderSection.tsx`

Budget fields in the x402 builder section (budget USD, approval threshold,
window days, scope), compile/parse/summary parity so `/policies` can author
and re-edit budget policies without raw JSON. Read `.impeccable.md` before
the UI edit. Update the type-picker desc line to mention the window budget.

### Policy modes — out of scope (deliberate)

The mode catalog (`app/lib/policy-modes/compile.ts`) emits per-purchase
x402 rules only. Adding budgets to modes is a product decision about each
mode's intent — a candidate for a later pass, not smuggled in here. The
friction preview's x402 summary is checked for truthfulness if a
budget-only policy renders oddly.

## Acceptance (live proof + tests)

- **Evaluator golden vectors** (`__tests__/unit/x402-guard-policy.test.js`,
  repository mocked): under budget → null; at approval threshold →
  require_approval; over budget → block; budget block beats per-purchase
  require_approval; agent scope filters the sum; agent scope without
  agent_id → require_approval; sum failure → require_approval by default,
  honors `on_failure: 'allow'` (warning path) and `DASHCLAW_GUARD_FALLBACK`;
  no budget fields → no repository call.
- **Validation vectors** (`validate-x402.test.js`): each new field's
  reject/accept cases, 0 accepted for budget_usd, 1–365 bounds, scope and
  on_failure enums.
- **Form model** (`policyFormModel.test.js`): compile/parse round-trip with
  budget fields; summary mentions the budget.
- **Policy smoke harness** (`scripts/policy-smoke.mjs`, runs live in CI
  every push — this is the live proof): new section with a per-run agent
  and an agent-scoped budget policy
  (`budget_approval_threshold: 10, budget_usd: 20, budget_scope: 'agent'`):
  sequential purchases $4 → allow, $4 (sum 8) → allow, $4 (sum 12 ≥ 10) →
  require_approval, $10 (sum 22 > 20) → block. Agent scope + per-run agent
  id keeps the check deterministic across runs sharing the smoke org.
- **Docs stay truthful**: /explain playground caption grows to mention the
  window budget; cited smoke-check counts re-grepped;
  `check-doc-counts --strict` green.
- **NOTHING about this feature auto-applies policy changes** — budgets are
  authored by humans (constitution §3); the tuning engine does not propose
  budget edits (its rules touch `risk_threshold` thresholds only).

## Security notes (for the adversarial review)

- Tenant boundary: every sum query is org-scoped; `evaluateGuard` already
  hard-fails on missing orgId.
- Bypass surfaces considered: omitted `agent_id` under agent scope (fails
  closed, D2); `cost_estimate` understatement (the recorded purchase row
  carries the same `spend_amount` the guard saw — lying about the amount
  lies to the ledger the NEXT purchase is summed from, so the window
  self-corrects at the declared values; verifying declared-vs-settled
  amounts is the outcome route's domain, out of scope here);
  budget evaluated before row insert (no self-count); blocked rows never
  accrue.
- The sum failure path never fails open silently — `allow` requires an
  explicit per-policy or env opt-in and records a warning on the persisted
  decision.
- Reviewed 2026-07-02 (adversarial, guard/spend scope): PASS — 0 critical,
  0 high; the 1 MEDIUM (concurrency TOCTOU) and 1 LOW (allow-path audit
  trail) were fixed in the same ship (post-insert re-verification +
  ledger warning above).

## Out of scope (v1)

- Calendar-month windows, multi-currency normalization, per-provider
  budgets (provider lists + a scoped policy approximate this), budget
  proposals from the tuning engine, mode-catalog budgets, /spend UI budget
  visualizations, settled-vs-declared amount reconciliation.
