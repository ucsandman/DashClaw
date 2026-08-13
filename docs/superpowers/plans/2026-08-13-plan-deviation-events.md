# Plan Deviation Events — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the plan-vs-actual diff durable, classified, and policy-visible: record `plan_deviations` rows on every governed action that diverges from its live approved plan, feed them into the decision lattice via a new tighten-only `deviation_response` policy type, and surface them on `/approvals`, `/decisions/[actionId]`, `/policies`, and the session retro.

**Architecture:** A new fail-soft guard phase `runDeviationCheck` after the grant passes classifies the live action against the agent's live plan steps (server-derived, never agent-suppressible). The finding is attached to the accumulator, evaluated against `deviation_response` policies in the same evaluation, echoed into `guard_decisions.breakdown` as `_plan_deviation`, and persisted as a `plan_deviations` row (modelled on `assumptions`) after the decision row lands, with a `PLAN_DEVIATION_DETECTED` SSE event. Detection is skipped entirely under `options.simulate`. No new routes, pages, MCP tools, or SDK methods; the one budget line is `guardPolicyTypes` 16 → 17 with a THESIS.md amendment in the same commit.

**Tech Stack:** Next.js 16 App Router, Postgres via hand-authored `drizzle/*.sql` + parallel `schema/schema.js`, vitest, existing guard evaluator map.

**Spec:** `docs/rfcs/2026-08-11-plan-deviation-events.md` (invariants D1/D2/D3 govern every task).

## Global Constraints

- **D1:** Deviation recording is unconditional — never gated by policy outcome.
- **D2:** No `deviation_response` policy row is installed by default; shipped consequence is nothing (row recorded, rendered, consequence-free).
- **D3:** Detector fails soft — a broken deviation computation never blocks, delays, or fails a guard call. Wrap like `runSignalChecks` (evaluate.ts:731-746).
- Simulate mode records nothing (plan dry-run must not deviate against itself).
- Tighten-only: the policy evaluator can raise to `warn`/`require_approval`/`block` via `raiseDecision` max-join; never lowers.
- `_plan_deviation` is a **sibling** breakdown key, never inside the hashed score vector (score-provenance rule).
- `declared`/`observed` payloads pass through `redactAny` before persist.
- No direct SQL in route files — all through repositories.
- CSS tokens only; brand orange only for "needs operator" cues; severity chips use the existing `success/warning/error/info` Badge variants + the `severityStyle` low/medium/high mapping precedent (`SessionRetroCard.tsx:18-22`).
- ID convention: `dv_<16hex>` via the local `mintId('dv')` pattern (plans.repository.ts:24).
- Both count sources updated together: `app/lib/validate.js` `POLICY_TYPES` (line ~409) AND `app/lib/guard/policy.ts` `POLICY_EVALUATORS` (2-space-indented key — the surface-budget regex requires exactly 2 spaces).

## Design decisions (RFC open questions resolved)

- **OQ1 (goal similarity):** normalized string equality (lowercase, collapse whitespace) + `match_confidence` heuristic: 100 act-hash match, 90 type+goal match, 60 type-only nearest step, 0 no match. Grant consumption matching stays exact and untouched.
- **OQ2 (sequence_break):** deferred — classifier ships six kinds (`unplanned_action`, `goal_drift`, `act_substitution`, `scope_escape`, `step_abandoned`, `budget_overrun`). `sequence_break` waits for real data, per the RFC's own recommendation.
- **OQ4 (retro reconciliation):** same ship. Retro consumes derived deviations as a new `'deviation'` finding kind; the session-first-goal heuristic (3a/3b) is **suppressed only for actions that have a deviation row**, not retired wholesale — retiring it entirely would regress goal-drift coverage for the majority of sessions that have no plan. This refines the RFC's "retire" to "suppress on overlap"; recorded here as a deliberate deviation from the RFC text, honoring its actual goal (no double reporting).
- **OQ5 (accept ≠ approval):** resolving a deviation never releases a pending approval. `accepted` + optional `amend_plan: true` appends the observed action as a new approved step (operator-authored, so operator-approved by construction) for **future** matches only.
- **OQ3 (latency):** `hasLivePlan(orgId, agentId)` behind a 30s-TTL cache in `caches.ts` (GUARD_CACHE_TTL_MS), keyed `${orgId}:${agentId}`, cleared by `__resetGuardCaches()`. Stale-false = up to 30s of missed detection after plan approval — coverage loss only, acceptable for an observation (D3 spirit). Measure guard latency before push (Task 10).
- **Detection/persist split:** classification runs in-evaluation (so the policy can react in the same call), but the row insert + event publish happen after `persistGuardDecision` so `guard_decision_id` and final `policy_outcome` are real. Recording happens for all four decisions (D1); only simulate skips.
- **Priority when several kinds could apply:** `act_substitution` > `scope_escape` > `goal_drift` > `budget_overrun`; one deviation per action in v1.
- **Severity:** base per kind (RFC §5 table), bumped one level when the observed side touches a system/path outside the step's `declared_systems`/`declared_paths` (when declared).
- **Self-report:** `plan_step_id`/`deviation_note` on record create a separate `detector: 'agent_reported'` row, severity capped `low`, never merged with or suppressing derived rows.

---

### Task 1: Schema — `plan_deviations` table + step scope columns

**Files:**
- Create: `drizzle/0073_plan_deviations.sql`
- Modify: `schema/schema.js` (after `planAuthorizationSteps`, ~line 1508)

**Interfaces produced:** table `plan_deviations` (columns below), `plan_authorization_steps.declared_paths jsonb`, `.declared_systems jsonb`.

- [ ] **Step 1: Write migration `drizzle/0073_plan_deviations.sql`**

```sql
-- Plan deviation events (RFC docs/rfcs/2026-08-11-plan-deviation-events.md).
-- The durable else-branch of consumePlanStepGrant: what the agent did vs what
-- the approved plan said it would do. Recording is unconditional (D1).
CREATE TABLE IF NOT EXISTS plan_deviations (
  deviation_id text PRIMARY KEY,            -- dv_<16hex>
  org_id text NOT NULL,
  agent_id text NOT NULL,
  session_id text,
  action_id text,
  guard_decision_id text,
  plan_id text NOT NULL,
  step_id text,                             -- null for unplanned_action
  kind text NOT NULL,                       -- unplanned_action|goal_drift|act_substitution|scope_escape|step_abandoned|budget_overrun
  dimension text NOT NULL,                  -- existence|goal|act|path|system
  severity text NOT NULL,                   -- info|low|medium|high
  declared jsonb,
  observed jsonb,
  detector text NOT NULL DEFAULT 'server_derived',  -- server_derived|agent_reported
  match_confidence integer,
  agent_note text,
  policy_outcome text NOT NULL DEFAULT 'none',
  status text NOT NULL DEFAULT 'open',      -- open|acknowledged|accepted|rejected
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_deviations_org_plan
  ON plan_deviations (org_id, plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_deviations_org_action
  ON plan_deviations (org_id, action_id) WHERE action_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_plan_deviations_org_status
  ON plan_deviations (org_id, status, created_at DESC);
-- step_abandoned sweep idempotency: one abandonment per step, ever.
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_deviations_step_abandoned
  ON plan_deviations (step_id) WHERE kind = 'step_abandoned';

-- Optional widened declared scope on plan steps (RFC §7) — additive, both optional.
ALTER TABLE plan_authorization_steps ADD COLUMN IF NOT EXISTS declared_paths jsonb;
ALTER TABLE plan_authorization_steps ADD COLUMN IF NOT EXISTS declared_systems jsonb;
```

- [ ] **Step 2: Mirror into `schema/schema.js`** — add `planDeviations` pgTable (snake_case column names as in `planAuthorizations`) and add `declared_paths: jsonb('declared_paths')`, `declared_systems: jsonb('declared_systems')` to `planAuthorizationSteps`.
- [ ] **Step 3: Run `npm run db:migrate` twice** (idempotency) against local DB; READ output both times.
- [ ] **Step 4: Commit** `feat(schema): plan_deviations table + step declared scope columns`

### Task 2: `plan-deviations.repository.ts`

**Files:**
- Create: `app/lib/repositories/plan-deviations.repository.ts`
- Test: `__tests__/unit/plan-deviations.repository.test.ts`

**Interfaces produced (consumed by Tasks 3–8):**

```ts
export type DeviationKind = 'unplanned_action' | 'goal_drift' | 'act_substitution' | 'scope_escape' | 'step_abandoned' | 'budget_overrun';
export type DeviationSeverity = 'info' | 'low' | 'medium' | 'high';
export interface PlanDeviationInsert {
  orgId: string; agentId: string; sessionId?: string | null; actionId?: string | null;
  guardDecisionId?: string | null; planId: string; stepId?: string | null;
  kind: DeviationKind; dimension: string; severity: DeviationSeverity;
  declared?: unknown; observed?: unknown;
  detector?: 'server_derived' | 'agent_reported';
  matchConfidence?: number | null; agentNote?: string | null; policyOutcome?: string;
}
export async function insertPlanDeviation(sql, orgId, input: PlanDeviationInsert): Promise<{ deviation_id: string } | null>  // ON CONFLICT DO NOTHING for step_abandoned dupes → null
export async function listDeviationsForPlan(sql, orgId, planId): Promise<Record<string, unknown>[]>
export async function listDeviationsForAction(sql, orgId, actionId): Promise<Record<string, unknown>[]>
export async function listDeviationsForSession(sql, orgId, sessionId): Promise<Record<string, unknown>[]>
export async function resolveDeviation(sql, orgId, deviationId, input: { resolution: 'acknowledged'|'accepted'|'rejected'; resolvedBy: string }): Promise<Record<string, unknown> | null>  // only from status='open'
export async function sweepAbandonedSteps(sql, orgId, planId): Promise<number>  // approved, unconsumed steps of a terminal plan → step_abandoned rows (unique index makes it idempotent)
```

Pattern: sql-as-first-param, named exports, no try/catch (routes handle errors) — match `plans.repository.ts`. `mintId('dv')` local helper.

- [ ] Step 1: failing unit tests (insert returns dv_ id; resolve only from open; sweep idempotent via ON CONFLICT; list scoping by org). Use `createSqlMock` from `../helpers.js` as in `plans.repository.test.ts`.
- [ ] Step 2: implement; run `npm test -- __tests__/unit/plan-deviations.repository.test.ts`.
- [ ] Step 3: Commit `feat(repo): plan-deviations repository`

### Task 3: Pure classifier — `app/lib/guard/deviation.ts`

**Files:**
- Create: `app/lib/guard/deviation.ts`
- Test: `__tests__/unit/guard-deviation-classify.test.ts`

**Interfaces produced:**

```ts
export interface DeviationFinding {
  kind: DeviationKind; dimension: string; severity: DeviationSeverity;
  plan_id: string; step_id: string | null; match_confidence: number;
  declared: Record<string, unknown>; observed: Record<string, unknown>;
}
export interface LivePlanStep { step_id: string; seq: number; action_type: string; step_goal: string;
  act_content_hash: string | null; grant_status: string; grant_used_at: string | null;
  declared_paths: string[] | null; declared_systems: string[] | null; }
export function classifyDeviation(input: {
  planId: string;
  steps: LivePlanStep[];
  observed: { action_type: string | null; declared_goal: string | null; act_hash: string | null;
    target: string | null; write_paths: string[]; systems_touched: string[];
    act_summary: string | null };
  grantedStepId: string | null;   // step consumed by applyPlanStepGrant this evaluation, if any
}): DeviationFinding | null
export function normalizeGoal(s: unknown): string | null   // lowercase, trim, collapse whitespace
```

Classification order (first match wins): granted step → scope check only; else exact type+goal match → hash mismatch = `act_substitution` (high, conf 90) / consumed step = `budget_overrun` (low) / scope out = `scope_escape` (high) / clean = null; else type-only match → `goal_drift` (low, conf 60); else → `unplanned_action` (medium, conf 0). Severity bump one level (`low→medium→high`, info floor stays) when observed systems/paths fall outside declared (only when the step declared them). `declared`/`observed` built as parallel objects per RFC §4.

- [ ] Step 1: failing tests — full matrix: each of the six kinds, the granted-step clean path, the no-steps null path, severity bump, confidence values, normalization (case/whitespace).
- [ ] Step 2: implement pure function (no IO, no imports from evaluate.ts).
- [ ] Step 3: tests pass; commit `feat(guard): pure plan-deviation classifier`

### Task 4: Guard integration — cache, phase, persist, event

**Files:**
- Modify: `app/lib/guard/caches.ts` (add `hasLivePlanCache` + `getHasLivePlan(sql, orgId, agentId)` + clear in `__resetGuardCaches`)
- Modify: `app/lib/guard/evaluate.ts`:
  - `GuardAccumulator` gains `planDeviation: DeviationFinding | null` (init null in `newAccumulator`)
  - new `runDeviationCheck(deps, options, acc, policies, grantedStepId)` called inside `runEvaluation` after the grant-pass block (line ~1169), before `runSignalChecks`; guarded `if (!options.simulate)`; whole body in try/catch (D3), `timed('deviation', ...)`
  - fetch live plan + steps only when `getHasLivePlan` true (query via `plans.repository` helper `getLivePlanForAgent` — add it there: latest approved/partially_approved unexpired plan + steps for agent)
  - policy pass: filter already-loaded `policies` for `policy_type === 'deviation_response'`, call `evaluatePolicy` with the finding stashed as a transient arg (see Task 5), mirror `runLocalPolicies` bookkeeping exactly (raiseDecision + reasons + matchedPolicies + gatingPolicies), record `policy_outcome`
  - warning line pushed to `acc.warnings`: `Plan deviation: <kind> (<severity>) vs plan <plan_id>` — the agent's channel (RFC §7)
  - `buildGuardDecisionRow`: add `...(input.planDeviation ? { _plan_deviation: input.planDeviation } : {})`
  - after `persistGuardDecision` (~line 1302): fail-soft `insertPlanDeviation` with `guardDecisionId: decisionId`, then `void publishOrgEvent(EVENTS.PLAN_DEVIATION_DETECTED, {...})`
- Modify: `app/lib/events.ts` — `PLAN_DEVIATION_DETECTED: 'plan.deviation.detected'`
- Modify: `app/lib/repositories/plans.repository.ts` — add `getLivePlanForAgent(sql, orgId, agentId)`; call `sweepAbandonedSteps` from `reviewPlan` on `revoke`, and from `getPlanWithSteps` when derived status is `expired` (fail-soft, best-effort)
- Test: `__tests__/unit/guard-plan-deviation.test.ts`

**Consumes:** `classifyDeviation` (Task 3), `insertPlanDeviation` (Task 2).

- [ ] Step 1: failing guard tests (pattern: `guard-allow-grant.test.ts`, `beforeEach(__resetGuardCaches)`): simulate skips detection; no live plan → no query, no row; deviation recorded on `allow` decision (D1); detector exception → decision unaffected (D3); `_plan_deviation` present in persisted context; warning line present; granted-step action → no deviation.
- [ ] Step 2: implement; run the new test file, then the full guard test set.
- [ ] Step 3: Commit `feat(guard): plan-deviation detection phase (fail-soft, simulate-skipped)`

### Task 5: `deviation_response` policy type (the 16 → 17 line)

**Files:**
- Modify: `app/lib/guard/policy.ts` — new `deviation_response` key in `POLICY_EVALUATORS` (exactly 2-space indent). Evaluator reads the finding from `args.context._plan_deviation_finding` (stashed by `runDeviationCheck` just before the targeted `evaluatePolicy` call and deleted immediately after — verify `safeContextForLog` is computed before or redacts it; if computed later, delete before persist). Rules: `{ on_kind?: Record<kind, 'warn'|'require_approval'|'block'>, min_severity?: 'info'|'low'|'medium'|'high', escalate_action?: 'warn'|'require_approval'|'block' }`. Consequence = `on_kind[kind]` clamped to the `escalate_action` ceiling (default ceiling `require_approval`; `block` requires explicit opt-in). Below `min_severity` → null. No finding → null (no-op for planless agents).
- Modify: `app/lib/validate.js` — `POLICY_TYPES` + a `deviation_response` rules validator in the validator Map (valid kinds, valid actions, valid severities).
- Modify: `app/lib/types/governance.ts` — `GuardPolicyType` union + `GuardPolicy` arm.
- Modify: `app/lib/policy-modes/contract.ts` — `case 'deviation_response':` plain-English sentence.
- Test: extend `__tests__/unit/guard-plan-deviation.test.ts` + `__tests__/unit/validate.test.*` (find existing validate test file).

- [ ] Step 1: failing tests — on_kind raise to require_approval; min_severity filter; block requires escalate_action:'block'; tighten-only (never lowers an existing block); absent policy → outcome 'none' (D2).
- [ ] Step 2: implement all four files; run tests.
- [ ] Step 3: `npm run surface:check` — expect FAIL (17 > 16). That failure is the gate working; Task 9 amends the budget. Do not amend here.
- [ ] Step 4: Commit `feat(policy): deviation_response evaluator + validation (budget amended in docs commit)` — NOTE: if pre-commit runs surface:check and blocks, fold Task 9's budget/THESIS amendment into this commit instead (same-commit rule is the contract anyway).

### Task 6: Route + API extensions

**Files:**
- Modify: `app/api/plans/[planId]/route.ts` — GET: attach `deviations` (listDeviationsForPlan) as sibling of `plan`/`steps`. POST: accept `verdict: 'resolve_deviation'` with `{ deviation_id, resolution, amend_plan? }`; reuse existing admin + SoD auth block; `amend_plan` only with `resolution: 'accepted'` → insert new approved step from the deviation's `observed` (repository fn `amendPlanFromDeviation` in plans.repository — INSERT step with `grant_status 'approved'`, seq = max+1); `logActivity('plan.deviation_resolved')`.
- Modify: `app/api/actions/[actionId]/route.ts` — GET: `result.deviations = await listDeviationsForAction(...)` before respond.
- Modify: POST `/api/actions` create path (actions route/repository) — accept optional `plan_step_id`, `deviation_note`; when `deviation_note` present, fail-soft insert `detector: 'agent_reported'`, severity `'low'`, kind `'goal_drift'` dimension `'goal'` if no better info, `policy_outcome 'none'` (a claim, not a finding).
- Modify: POST `/api/plans` submit path — accept optional `declared_paths`, `declared_systems` per step (validate: arrays of strings), persist to new columns (`createPlanWithSteps` + `PlanStepInput`).
- Modify: `app/api/sessions/[sessionId]/retro/route.ts` feed — `getSessionRetroData` (`app/lib/sessions.ts:473`) gains a deviations fetch; `buildSessionRetro` (Task 7).
- Tests: extend `__tests__/unit/plans-route.test.ts`, `plans-review-route.test.ts`, actions route test — resolve verb happy path + SoD 403 + invalid resolution 400 + amend appends approved step; GET payloads carry `deviations`.

- [ ] Step 1: failing route tests.
- [ ] Step 2: implement; run those test files.
- [ ] Step 3: Commit `feat(api): deviations on plan/action payloads, resolve verb, self-report + declared-scope fields`

### Task 7: Session retro reconciliation

**Files:**
- Modify: `app/lib/session-retro.ts` — `RetroFinding.kind` union += `'deviation'`; `SessionRetroData` += `deviations`; in `buildSessionRetro`: map each derived deviation to a finding (`kind: 'deviation'`, severity mapped info→low, summary `plan deviation: <kind> — <act_summary or goal>`, evidence carries kind/plan_id/step_id/match_confidence); suppress 3a/3b goal-drift checks for `action_id`s that have a deviation row.
- Modify: `app/lib/sessions.ts` `getSessionRetroData` — include `listDeviationsForSession`.
- Modify: `app/components/SessionRetroCard.tsx` — `kindLabel.deviation = 'Plan deviations'`.
- Test: extend the session-retro unit test (find `session-retro` test file): deviation findings appear; an action with both a deviation row and a divergent goal yields ONE finding (no double report); plan-less session keeps heuristic findings.

- [ ] Step 1: failing tests. Step 2: implement + run. Step 3: Commit `feat(retro): consume plan deviations, suppress overlapping goal-drift heuristic`

### Task 8: MCP fields + UI surfaces + demo fixtures

**Files:**
- Modify: `mcp-server/src/tools.ts` — `dashclaw_plan_submit` step schema += `declared_paths` (array of strings, optional), `declared_systems` (optional); `dashclaw_record` += `plan_step_id`, `deviation_note` (optional, pass through to POST /api/actions). Rebuild `mcp-server/lib` the way the repo does (check its build script). Tool COUNT unchanged (17).
- Modify: `app/approvals/_components/LivePlansSection.tsx` — per live plan row: deviation count chip (`Badge variant="warning"`, brand orange ONLY if an open high-severity deviation needs the operator) + expandable deviation list: severity chip (severityStyle precedent), declared vs observed side-by-side (`tabular-nums`), buttons Acknowledge / Accept / Reject / "Accept & amend plan" POSTing `verdict: 'resolve_deviation'`; buttons gated on `canDecide`.
- Modify: `app/approvals/page.tsx` — pass fetched detail `deviations` through to `LivePlansSection` (detail fetch already returns them after Task 6).
- Modify: `app/decisions/[actionId]/_components/PoliciesTab.tsx` — beside the `_plan_grant` badge: when `guardDecision.context?._plan_deviation`, render `Badge variant="warning"` `Deviation: <kind>` + a declared-vs-observed two-column block.
- Modify: `app/policies/lib/policyFormModel.js` — `POLICY_TYPE_OPTIONS` entry `{ value: 'deviation_response', label: 'Deviation Response', desc: 'Consequence per plan-deviation kind — warn, require approval, or block when an agent departs from its approved plan' }`; DEFAULT_FORM_STATE fields (`deviationOnKind` map defaults 'ignore', `deviationMinSeverity`, `escalateAction` reused); `POLICY_TYPE_HANDLERS.deviation_response` compile/summary.
- Modify: `app/policies/components/PolicyRuleBuilderSection.tsx` — `DeviationResponseFields` (per-kind `<select>` ignore/warn/require_approval/block for the four guard-time kinds + min-severity select + escalate ceiling select, aria-labels, shared `inputClass`/`selectClass`) + dispatch line `{form.type === 'deviation_response' && ...}`.
- Modify: `app/lib/demo/demoMiddleware.ts` — `demoPlanDetail` returns `deviations: [...]` (one open `act_substitution` example, complete fields — every field the card reads must be present).
- Tests: component test for LivePlansSection deviations (new or extend `approvals.page.test.jsx` pattern with `.jsx`-suffixed dynamic import); policyFormModel compile unit test.

- [ ] Step 1: failing UI/component tests. Step 2: implement. Step 3: run tests + `npm run lint`. Step 4: Commit `feat(ui+mcp): deviation surfaces on approvals/decisions/policies, MCP step-scope + self-report fields`

### Task 9: Contracts, THESIS amendment, docs, smoke

**Files:**
- Modify: `contracts/surface-budget.json` — `guardPolicyTypes.ceiling: 17`, reason: `"2026-08-13: 16 -> 17 deviation_response — per-kind consequence for plan-vs-actual deviation (RFC docs/rfcs/2026-08-11-plan-deviation-events.md). Detection is unconditional and policy-free; this type only maps kind -> warn/require_approval/block, tighten-only, no default row installed. No new tables budgeted, no routes, no pages, no MCP tools, no SDK methods. (Prior: 2026-08-10 15 -> 16 role_constraint.)"`
- Modify: `THESIS.md` — ceilings table row `Guard policy types | 17` (fix the stale table row; note other rows are stale from prior amendments — fix the whole table to live values since we're touching it, citing surface-budget.json) + amendment-log entry in the `role_constraint` format, dated 2026-08-13, citing the RFC path.
- Modify: `docs/architecture/runtime-api.md` — deviation subsection under "Plan authorization (preflight)": what is recorded, D1/D2/D3, the warning line, the resolve verb, honest claims-vs-ground-truth limitation (RFC §9).
- Modify: `scripts/policy-smoke.mjs` — new live section: submit plan → approve → guard a substituted act (same type+goal, different act) → assert deviation recorded + `deviation_response` policy raises `require_approval` → resolve via POST verdict.
- Run: `npm run doc:counts:fix` (updates `docs/policy-modes.md` "the N live policy_type values", `docs/monetization-plan.md` "all N policy types", and friends from source).
- [ ] Step 1: edits; Step 2: `npm run surface:check` green at 17/17; `node scripts/check-doc-counts.mjs --strict` green. Step 3: Commit `docs(contracts): guardPolicyTypes 16→17 amendment, runtime-api deviation subsection, smoke section`

### Task 10: Full gates + rendered proof

- [ ] `npm run lint` — read output.
- [ ] `npm run typecheck` — read output.
- [ ] `npx vitest run` (full suite, `--maxWorkers=2` per memory) — read output.
- [ ] `npx next build` — read output (rtk fake-summary trap: verify real route table, not "1 routes").
- [ ] Guard latency: time 20 sequential `/api/guard` calls for a planless agent before/after (hot-path cost must be ~0 for the no-plan case; report numbers).
- [ ] `frontend-verify` on `/approvals`, `/decisions`, `/policies`, a session detail — assert deviation strip renders on demo plan detail, resolve buttons exist, new policy type appears in the New-rule picker (§12.4 rendered-proof gate).
- [ ] Ship via `dashclaw-ship` (version bump, remaining doc realignment, push, READ remote CI).

## Self-review notes
- RFC §7 route/page/tool zero-cost claims all verified against live counters by scouts (regexes confirmed).
- `total_steps` absent from `PlanGrantInfo` — deviation badge does not promise k/n; uses kind + severity instead.
- Known risk: `evaluatePolicy` transient context stash — verify `safeContextForLog`/`redactContextForLog` ordering during Task 5 and delete the stash before persist.
- Known risk: pre-commit hook may run surface:check per commit — if so, Tasks 5 and 9 merge into one commit (the same-commit rule is the actual contract).
