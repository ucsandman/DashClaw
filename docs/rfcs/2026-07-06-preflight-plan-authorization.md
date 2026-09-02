# RFC: Preflight Plan Authorization

- **Status:** PROPOSED (program: governed-autonomy, build order 1 of 3 — see `docs/plans/2026-07-06-governed-autonomy-program.md`)
- **Date:** 2026-07-06
- **Depends on:** the calibrated interruption controller (currently uncommitted WIP: `app/lib/guard/calibration.ts`, `drizzle/0059_calibration_controller.sql`) MUST be committed/landed before this builds — both features modify `app/lib/guard/evaluate.ts` and the approvals routes.
- **Precedent this generalizes:** the single-use operator-approval grant (`applyOperatorApprovalGrant`, `app/lib/guard/evaluate.ts`; act-content binding shipped v4.64.0).

## Summary

An agent submits its intended plan — an ordered list of structured steps — *before* executing. The server dry-runs every step through the real guard pipeline, the operator reviews **one** approval card, and each approved step becomes a single-use, act-scoped grant the agent draws down as it executes. Any off-plan action falls back to normal per-action governance unchanged.

This converts N mid-run interruptions (each a 30s poll + a human context switch, possibly at 2am) into one upfront review, while *increasing* scrutiny: the human sees intent as a coherent plan, not as decontextualized fragments.

## Motivation

- Approval latency is the tax that makes long-horizon autonomy miserable. The hook's `require_approval` path polls 3s×`APPROVAL_TIMEOUT` and then blocks — a 6-hour Fable-class run that hits three approvals while the operator sleeps effectively fails.
- The calibration controller (in flight) reduces **wrong** interruptions. Preflight amortizes **right** ones. Together they attack the whole interruption cost.
- The mechanism already exists in embryo: `applyOperatorApprovalGrant` proves grant-downgrade semantics (require_approval → allow, single-use, 15-min window, act-hash-bound). This RFC generalizes "the identical retried action" to "a reviewed plan of actions."

## Non-goals (v1)

- No plan-vs-actual divergence detection or trajectory scoring (future: Trajectory Anomaly Engine consumes plan data).
- No auto-generation of plans from transcripts.
- No multi-agent shared plans — one plan belongs to one `agent_id`.
- No changes to `block` semantics anywhere. A grant can never downgrade `block`.

## Design

### Data model

Two new tables (new migration — take the **next free** drizzle number at build time; `0059` is claimed by the calibration controller). Follow `schema/schema.js` conventions (snake_case columns, `org_id` scoping, TEXT ids with prefix). Access ONLY through a new `app/lib/repositories/plans.repository.ts` (route-sql:check forbids SQL in routes).

**`plan_authorizations`** — the plan header.

| column | type | notes |
|---|---|---|
| `plan_id` | text PK | prefix `pa_` |
| `org_id` | text, indexed | |
| `agent_id` | text | submitter; composed fleet ids valid |
| `declared_goal` | text | the mission-level goal |
| `status` | text | `pending` → `approved` \| `partially_approved` \| `denied` \| `expired` \| `revoked` |
| `ttl_minutes` | int | requested by agent, server-clamped by org setting (below) |
| `expires_at` | timestamptz | set at review time, not submit time |
| `reviewed_by` / `reviewed_at` | text / timestamptz | |
| `created_at` | timestamptz | **Fresh-schema gotcha:** `guard_decisions.created_at` is TEXT on fresh schemas — do not copy that pattern; use timestamptz and never compare text-to-timestamp in SQL |

**`plan_authorization_steps`** — one row per step.

| column | type | notes |
|---|---|---|
| `step_id` | text PK | prefix `ps_` |
| `plan_id` | text FK-by-convention (no FK, matches repo norm) | |
| `org_id` | text | denormalized for scoped queries |
| `seq` | int | display order; consumption is NOT order-enforced in v1 |
| `action_type` | text | required |
| `step_goal` | text | required; the step's declared_goal |
| `act` | jsonb nullable | optional literal act (shell/HTTP/SQL/file-write) |
| `act_content_hash` | text nullable | computed server-side via the same `computeActContentHash` used by operator grants |
| `preview_decision` | text | dry-run verdict at submission (`allow`/`warn`/`require_approval`/`block`) |
| `preview_risk_score` | int | |
| `preview_reasons` | jsonb | |
| `grant_status` | text | `pending` → `approved` \| `denied` |
| `grant_used_at` | timestamptz nullable | single-use consumption stamp |
| `matched_action_id` | text nullable | the action that consumed it |

### API surface (all through the repository; guard-authenticated like existing routes)

- `POST /api/plans` — submit. Body: `{ agent_id, declared_goal, ttl_minutes?, steps: [{ action_type, step_goal, act? }] }`. Server dry-runs each step through the guard pipeline (see "Dry-run" below), persists header + steps with preview verdicts, notifies the approvals surface. Caps: max 25 steps/plan (org setting), max 10 pending plans/org. Returns the full plan with previews.
- `GET /api/plans?status=&agent_id=` — list.
- `GET /api/plans/[planId]` — detail (agent polls this; add `waitForPlanReview`-style long-poll only if the existing `waitForApproval` helper pattern transfers cleanly).
- `POST /api/plans/[planId]` — operator verdict (dashboard-session/admin-authenticated, mirroring `app/api/approvals/[actionId]/route.ts` auth): `{ verdict: 'approve' | 'deny' | 'revoke', step_overrides?: { [step_id]: 'approve' | 'deny' } }`. `approve` with overrides yields `partially_approved`. `revoke` immediately kills all unconsumed grants. Sets `expires_at = now() + ttl`.

**Denied steps are deny-grants.** A step explicitly denied by the operator creates an act-scoped *raise*: a later guard call matching that step (same matching rule as consumption, below) is raised to `block` with reason `Plan step ps_x was explicitly denied by <reviewer>` for the plan's TTL. Tighten-only, so charter-compliant.

### Attest before you act (added v5.28.0, drizzle/0075)

Steps are pinned by `act_content_hash`, but v1 pinned nothing at the level of
the plan and gave an unattended runner nowhere to ask, at wake, whether the
authority it is about to spend is still live. Two additions close that:

- **`plan_hash`** — `sha256` over the canonical JSON
  `{ agent_id, declared_goal, steps: [{ seq, action_type, act_content_hash }] }`
  (keys in that order, steps sorted by `seq`). Computed at submission, before
  the header INSERT, because that is where every input is final: nothing later
  rewrites a step's `act_content_hash`, and `seq`/`action_type` are assigned
  right there. Returned by `POST /api/plans`, `GET /api/plans` and
  `GET /api/plans/[planId]`.
- **`POST /api/plans/[planId]/attest`** — agent-facing (the same org-scoped
  credential the detail GET uses, *not* the operator verdict's admin auth).
  Body `{ plan_hash }`. Returns
  `{ ok: true, plan_id, plan_hash, expires_at, steps_remaining }`, or
  `{ ok: false, reason }` with `reason` one of
  `not_found | not_approved | expired | revoked | hash_mismatch`.
  `404` for `not_found`, `403` for everything else, `200` for ok.

The contract is fail-closed: a runner calls this at run start and does not make
its first model call until it gets `ok: true`. Anything ambiguous resolves to
`ok: false` — a `NULL` stored hash (a row predating the migration) is a
mismatch, a missing `expires_at` on an approved plan is expired, and any status
outside `approved`/`partially_approved` is `not_approved` rather than
interpreted. An explicit operator "no" (`revoked`/`denied`) is reported before
liveness or content so the runner learns it was stopped, not merely stale. The
stored hash is never echoed on a mismatch — returning it would hand a caller
holding a drifted plan the exact digest needed to forge a passing attestation.

Every call that finds the plan in the org is journaled on the row
(`attest_count`, `attested_at`, `last_attest_result`) whether it passed or
failed, and writes an activity row; the approvals surface renders the short
hash and an "Attested N× · last … · result" line. Amendments via
`amend_plan` deliberately do **not** re-pin: the hash attests to the plan the
operator reviewed, and an amendment is its own recorded act.

### Dry-run at submission

Reuse before forking: check whether `/api/policies/simulate` already runs the full `evaluateGuard` pipeline side-effect-free. If yes, factor and reuse. If it is policy-scoped only, add `GuardOptions.simulate: true` to `evaluateGuard` (`app/lib/guard/evaluate.ts:709`) which MUST skip: guard_decisions persistence, rate-limit counting, calibration feedback/state writes, SSE event publish (`publishGuardDecisionEvent`), and x402 side effects — and MUST still run: halt check, all policy phases, evidence folding, predictive risk, calibration **assessment** (shadow-style read-only), prompt-injection scan. The preview decision stored on the step is the full-pipeline verdict.

Preview verdicts are **advisory**, and the review card must say so: conditions change between review and execution (calibration θ moves, rate limits fill, halt flips). A grant only matters when the *live* evaluation lands on `require_approval`.

### Guard integration — the consumption post-pass

New function `applyPlanStepGrant(deps, acc)` in `evaluate.ts`, called immediately **after** `applyOperatorApprovalGrant` (operator grants are more specific; they win first). Same guard clauses:

- Runs only when `acc.highestDecision === 'require_approval'`. Never touches `block`. Never runs in simulate mode.
- Matching rule, in one atomic `UPDATE … WHERE step_id = (SELECT …) RETURNING` exactly like the operator-grant SQL shape (single-use race safety): org + agent_id + `action_type` equal + plan `status IN ('approved','partially_approved')` + `expires_at > now()` + `grant_status='approved'` + `grant_used_at IS NULL` + act binding: if the step has `act_content_hash`, the live call's recomputed act hash must equal it; if the step has no hash, the live call matches on `action_type` + `step_goal` equal to the live `declared_goal`.
- On match: stamp `grant_used_at`/`matched_action_id`, `acc.highestDecision = 'allow'`, clear gating reasons, push warning `Covered by plan ${plan_id} step ${seq}/${n} (approved by ${reviewed_by}${act-bound?}) — require_approval downgraded to allow`, push `'builtin:plan_grant'` to `matchedPolicies`.
- The deny-grant check (raise to block on denied-step match) runs earlier, alongside the other block-override checks, and uses `applyBlockOverride`.
- Record `_plan_grant` provenance in the decision row breakdown so `/replay` explains it (mirror how `_calibration` is embedded).
- Fail-soft on its own errors (`console.warn`, continue) — identical posture to `applyOperatorApprovalGrant`.

**GitNexus mandate:** run `impact({target: "evaluateGuard", direction: "upstream"})` and on `applyOperatorApprovalGrant` before editing; report blast radius.

### Settings

Add to `VALID_SETTING_KEYS` (see how `CALIBRATION_CONTROLLER_MODE` was added in the calibration WIP): `PLAN_GRANT_TTL_MAX_MINUTES` (default 480), `PLAN_MAX_STEPS` (default 25). Read through the existing settings cache in `app/lib/guard/caches.ts` if the guard hot path needs them; the consumption query itself needs no new cache (it fires only on `require_approval`-bound calls — low volume; revocation is therefore instant).

### SDK / MCP / plugin parity (all in the same ship)

- **Node SDK** (`sdk/dashclaw.js`): `submitPlan(plan)`, `getPlan(planId)`, `listPlans(opts)`, `resolvePlan(planId, verdict)` (operator-side), `waitForPlanReview(planId, opts)` following the `waitForApproval` polling shape.
- **Python SDK**: snake_case parity (`submit_plan`, `get_plan`, `list_plans`, `resolve_plan`, `wait_for_plan_review`).
- **MCP server**: two tools — `dashclaw_plan_submit`, `dashclaw_plan_status`. (MCP tool count changes: update every documented count — see Documentation contract.)
- **Plugins**: mirror the capability description for Claude Code, Codex, and Hermes (`plugins/`); parity gaps have been flagged before.
- **Hooks**: no pretool changes required in v1 — plan submission is agent-initiated via SDK/MCP, and consumption is entirely server-side (the hook's existing guard call just starts coming back `allow` with the grant warning attached).

### UI surface (HUMAN-EXPERIENCE.md — answered in writing)

1. **Where does a human SEE it?** `/approvals` gains a **Plan review card**: plan goal, agent, TTL, and the step table (seq, action_type, step_goal, preview verdict chip, per-step approve/deny toggle) with `Approve plan` / `Deny plan` primary actions. `/mission-control`'s intervention queue lists pending plans beside pending approvals. `/decisions` rows covered by a plan grant show a `plan pa_… step k/n` badge linking to the plan detail drawer.
2. **Discoverable?** It arrives in the approvals inbox the operator already watches, plus the same notification bridges approvals use today (Telegram/Discord get the summary + approve-all/deny; per-step overrides are dashboard-only).
3. **Every human step a CLICK?** Yes: approve/deny/revoke and per-step overrides are buttons. Zero terminal.
4. **Verified rendered?** frontend-verify drives `/approvals` with a seeded pending plan and asserts the card renders and the verdict buttons mutate state.

Design per `.impeccable.md`: tokens only, orange only on the "needs you" cue, preview verdict chips use `status-*` tokens, tabular-nums on the step table.

## Invariants (charter compliance)

1. A plan grant can ONLY downgrade `require_approval` → `allow`. Never `block` → anything. (Same law as operator grants.)
2. Every grant is single-use, act-or-goal-bound, TTL-bound, org-scoped, agent-scoped, and its consumption is stamped and visible in the decision breakdown.
3. Deny verdicts only ever tighten (raise to block on match).
4. Humans ratify; nothing auto-approves. Revocation is instant (no cache on the consumption path).
5. Failure of the plan-grant machinery never blocks or breaks a guard call (fail-soft, like every grant post-pass).

## Testing & verification gates

- Unit (vitest): repository CRUD; consumption matching matrix (act-bound hit/miss, goal-bound hit/miss, expired, revoked, already-used, wrong agent, wrong org, denied-step block raise, block never downgraded, simulate mode never consumes); TTL clamp; step cap. Use `__resetGuardCaches()` in guard tests (see `reference_dashclaw_guard_hotpath_caches`).
- Route tests for all four endpoints incl. auth split (agent key vs operator session).
- `scripts/policy-smoke.mjs`: add a live section — submit plan → approve → guarded call consumes grant → second identical call interrupts again (single-use proven live).
- Full gates before push: `npm run lint`, `npx vitest run` (full), `npx next build`, `npm run typecheck`, `npm run db:migrate` idempotency on a scratch DB, `scripts/check-doc-counts.mjs --strict`.
- frontend-verify on `/approvals`, `/mission-control`, `/decisions`.

## Documentation contract (same ship)

Routes +4, SDK methods +5 (Node) / +5 (Python), MCP tools +2 — grep and update every cited count (`README.md`, `PROJECT_DETAILS.md`, `docs/`, spec files). OpenAPI/api-inventory regenerate via pre-commit. `docs/architecture/runtime-api.md` gains a "Plan authorization" subsection. Marketing site: feature blurb in the same ship (HUMAN-EXPERIENCE clause 4). Version bump via `npm run version:set` (dashclaw-ship handles the tail).

## Open questions (resolve at build time, do not guess)

1. Does `/api/policies/simulate` already run the full pipeline? Read it before adding `GuardOptions.simulate`.
2. Should Telegram/Discord approve-all require a second confirmation for plans containing any `block`-previewed step? (Recommend: yes, dashboard-only for those.)
3. Exact placement of the deny-grant check among the existing block overrides in `evaluateGuard` — pick the slot that keeps `applyBlockOverride` ordering semantics intact and document it in the code comment.
