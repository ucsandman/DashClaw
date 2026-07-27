# Preflight Plan Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent submits its intended plan before executing; the server dry-runs every step through the real guard pipeline; the operator reviews ONE approval card; each approved step becomes a single-use act-scoped grant consumed at execution time. RFC: `docs/rfcs/2026-07-06-preflight-plan-authorization.md` (invariants win over incidentals — the RFC predates the v5.0.0 cull).

**Architecture:** Two new tables accessed only through `app/lib/repositories/plans.repository.ts`; two new route files (`/api/plans`, `/api/plans/[planId]`); a `simulate` mode on `evaluateGuard` for side-effect-free dry-runs; a `applyPlanStepGrant` post-pass in the guard pipeline directly after `applyOperatorApprovalGrant` (deny-raise first, then single-use consume); SDK/MCP parity; a Plan Review card on `/approvals`.

**Tech Stack:** Next.js 16 App Router, Postgres via tagged-template `sql`, vitest, existing guard pipeline in `app/lib/guard/evaluate.ts`.

## Global Constraints

- **Tighten-only charter:** a plan grant ONLY downgrades `require_approval` → `allow`. `block` is NEVER downgraded, by anything, ever. Deny-grants only RAISE (to block).
- **Simulate never mutates:** `GuardOptions.simulate === true` must skip guard_decisions persistence, event publish, AND both grant passes (a dry-run must never consume a real grant).
- **route-sql:check:** zero SQL in route files — all SQL in `plans.repository.ts`.
- **Fresh-schema gotcha:** new tables use `TIMESTAMPTZ` (never TEXT timestamps); never compare text-to-timestamp in SQL.
- **Guard tests:** any test touching evaluateGuard calls `__resetGuardCaches()` in `beforeEach` (import from `@/lib/guard.js`).
- **Surface budget:** this feature raises ceilings (apiRoutes 121→123, sdkNodeMethods 31→36, sdkPythonMethods 51→56, mcpTools 15→17). `contracts/surface-budget.json` AND THESIS.md amendment log must change in the SAME commit as the surfaces (Task 10).
- **Counts drift:** `sdk/README.md` + `docs/sdk-parity.md` (31/51), `mcp-server/README.md` (15) carry hardcoded counts — updated in Task 10; `node scripts/check-doc-counts.mjs --strict` must pass before every push.
- **Migration number:** `0062` (0061 = team_tasks is the last).
- **Prefixes:** plan ids `pa_`, step ids `ps_`. Id shape: `pa_${randomUUID().replace(/-/g,'').slice(0,16)}`.
- **UI:** tokens only, never hex; brand orange only on "needs you" cues (`.impeccable.md`); reuse `Card`/`CardContent`/`Badge` from `app/components/ui/`.
- Do NOT touch `.launch/` (untracked marketing drafts) or commit it.

---

### Task 1: Migration 0062 + schema.js entries

**Files:**
- Create: `drizzle/0062_plan_authorizations.sql`
- Modify: `schema/schema.js` (append after the `teamTaskEvents` table)

**Interfaces:**
- Produces: tables `plan_authorizations`, `plan_authorization_steps` with the exact columns below. Every later task depends on these column names.

- [ ] **Step 1: Write the migration**

```sql
-- Preflight Plan Authorization (docs/rfcs/2026-07-06-preflight-plan-authorization.md,
-- governed-autonomy program feature 1 of 3). An agent submits an ordered plan;
-- each step is dry-run through the guard pipeline at submission; the operator
-- reviews one card; approved steps become single-use act-scoped grants the
-- agent draws down. Generalizes the operator-approval grant (v4.64.0).
-- Idempotent and fresh-install-safe: plain TIMESTAMPTZ columns (never the
-- guard_decisions TEXT-created_at pattern).
CREATE TABLE IF NOT EXISTS plan_authorizations (
  plan_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  declared_goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  ttl_minutes INTEGER NOT NULL DEFAULT 60,
  expires_at TIMESTAMPTZ,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_authorizations_org_status
  ON plan_authorizations (org_id, status, created_at);

CREATE TABLE IF NOT EXISTS plan_authorization_steps (
  step_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  step_goal TEXT NOT NULL,
  act JSONB,
  act_content_hash TEXT,
  preview_decision TEXT,
  preview_risk_score INTEGER,
  preview_reasons JSONB,
  grant_status TEXT NOT NULL DEFAULT 'pending',
  grant_used_at TIMESTAMPTZ,
  matched_action_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_authorization_steps_plan
  ON plan_authorization_steps (plan_id, seq);

-- The consumption query's hot filter: org + agent's approved unconsumed steps.
CREATE INDEX IF NOT EXISTS idx_plan_authorization_steps_consume
  ON plan_authorization_steps (org_id, action_type, grant_status)
  WHERE grant_used_at IS NULL;
```

- [ ] **Step 2: Append to `schema/schema.js`** (after `teamTaskEvents`, matching its style):

```js
// @domain governance
export const planAuthorizations = pgTable('plan_authorizations', {
  plan_id: text('plan_id').primaryKey(), // pa_<16hex>
  org_id: text('org_id').notNull(),
  agent_id: text('agent_id').notNull(),
  declared_goal: text('declared_goal').notNull(),
  status: text('status').notNull().default('pending'), // pending|approved|partially_approved|denied|expired|revoked
  ttl_minutes: integer('ttl_minutes').notNull().default(60),
  expires_at: timestamp('expires_at', { withTimezone: true }),
  reviewed_by: text('reviewed_by'),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// @domain governance
export const planAuthorizationSteps = pgTable('plan_authorization_steps', {
  step_id: text('step_id').primaryKey(), // ps_<16hex>
  plan_id: text('plan_id').notNull(),
  org_id: text('org_id').notNull(),
  seq: integer('seq').notNull(),
  action_type: text('action_type').notNull(),
  step_goal: text('step_goal').notNull(),
  act: jsonb('act'),
  act_content_hash: text('act_content_hash'),
  preview_decision: text('preview_decision'),
  preview_risk_score: integer('preview_risk_score'),
  preview_reasons: jsonb('preview_reasons'),
  grant_status: text('grant_status').notNull().default('pending'), // pending|approved|denied
  grant_used_at: timestamp('grant_used_at', { withTimezone: true }),
  matched_action_id: text('matched_action_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

- [ ] **Step 3: Apply and verify idempotency**

Run: `npm run db:migrate` — expect it to apply 0062. Run it AGAIN — expect clean no-op (idempotent).

- [ ] **Step 4: Commit** — `git add drizzle/0062_plan_authorizations.sql schema/schema.js && git commit -m "feat(plans): plan_authorizations schema (migration 0062)"`

---

### Task 2: plans.repository.ts + unit tests

**Files:**
- Create: `app/lib/repositories/plans.repository.ts`
- Test: `__tests__/unit/plans.repository.test.ts`

**Interfaces:**
- Consumes: tables from Task 1; `computeActContentHash` from `app/lib/act-content-hash`.
- Produces (exact signatures — routes and guard use these):
  - `createPlanWithSteps(sql, orgId, { agentId, declaredGoal, ttlMinutes, steps }) → { plan, steps }` (steps carry server-minted `step_id`, `seq`, `act_content_hash`; previews are stamped later via `stampStepPreview`)
  - `stampStepPreview(sql, orgId, stepId, { decision, riskScore, reasons }) → void`
  - `listPlans(sql, orgId, { status?, agentId?, limit? }) → rows`
  - `getPlanWithSteps(sql, orgId, planId) → { plan, steps } | null`
  - `reviewPlan(sql, orgId, planId, { verdict, stepOverrides, reviewedBy, ttlClampMinutes }) → { plan, steps } | null` (verdict: 'approve' | 'deny' | 'revoke'; only transitions from status IN ('pending','approved','partially_approved'))
  - `countPendingPlans(sql, orgId) → number`
  - `consumePlanStepGrant(sql, orgId, { agentId, actionType, declaredGoal, actHash, matchedActionId }) → { step_id, plan_id, seq, reviewed_by, act_content_hash, total_steps } | null`
  - `findDeniedStepMatch(sql, orgId, { agentId, actionType, declaredGoal, actHash }) → { step_id, plan_id, reviewed_by } | null`

- [ ] **Step 1: Write failing tests** in `__tests__/unit/plans.repository.test.ts`. Use `createSqlMock` from `../helpers.js` if it supports scripted results; otherwise follow the mock style of `__tests__/unit/approvals-route.test.js` (mock at the repository consumer level is NOT possible here — this IS the repository, so tests script the sql tag). Minimum cases:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  createPlanWithSteps, reviewPlan, consumePlanStepGrant, findDeniedStepMatch,
} from '../../app/lib/repositories/plans.repository';

function sqlMock(results: unknown[][]) {
  // Tagged-template mock returning scripted result sets in call order.
  let i = 0;
  const fn = (async () => results[i++] ?? []) as unknown as (...a: unknown[]) => Promise<unknown[]>;
  const tag = Object.assign(
    (strings: TemplateStringsArray, ...v: unknown[]) => { tag.calls.push({ strings: strings.join('?'), v }); return fn(); },
    { calls: [] as Array<{ strings: string; v: unknown[] }>, query: async () => results[i++] ?? [] },
  );
  return tag;
}

describe('plans.repository', () => {
  it('createPlanWithSteps mints pa_/ps_ ids, seq from 1, act hash only when act present', async () => {
    const sql = sqlMock([[{ plan_id: 'x' }], [{}], [{}]]);
    const { plan, steps } = await createPlanWithSteps(sql as never, 'org_1', {
      agentId: 'agent-a', declaredGoal: 'ship the feature', ttlMinutes: 60,
      steps: [
        { action_type: 'code_change', step_goal: 'edit file', act: { kind: 'file', file: { path: 'a.ts' } } },
        { action_type: 'deploy', step_goal: 'deploy it' },
      ],
    });
    expect(plan.plan_id).toMatch(/^pa_[0-9a-f]{16}$/);
    expect(steps[0].step_id).toMatch(/^ps_[0-9a-f]{16}$/);
    expect(steps[0].seq).toBe(1);
    expect(steps[1].seq).toBe(2);
    expect(steps[0].act_content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(steps[1].act_content_hash).toBeNull();
  });

  it('reviewPlan clamps ttl_minutes to ttlClampMinutes', async () => {
    const sql = sqlMock([[{ plan_id: 'pa_1', ttl_minutes: 99999, status: 'pending' }], [{ plan_id: 'pa_1', status: 'approved' }], []]);
    await reviewPlan(sql as never, 'org_1', 'pa_1', { verdict: 'approve', stepOverrides: {}, reviewedBy: 'operator', ttlClampMinutes: 480 });
    const update = sql.calls.map((c) => c.strings).find((s) => s.includes('expires_at'));
    expect(update).toBeTruthy();
    // the interval parameter passed must be min(99999, 480) = 480
    const call = sql.calls.find((c) => c.strings.includes('expires_at'));
    expect(call!.v).toContain(480);
  });

  it('consumePlanStepGrant issues a single atomic UPDATE with grant_used_at IS NULL guard', async () => {
    const sql = sqlMock([[{ step_id: 'ps_1', plan_id: 'pa_1', seq: 1, reviewed_by: 'operator', act_content_hash: null, total_steps: 3 }]]);
    const hit = await consumePlanStepGrant(sql as never, 'org_1', {
      agentId: 'agent-a', actionType: 'deploy', declaredGoal: 'deploy it', actHash: null, matchedActionId: 'act_gd_x',
    });
    expect(hit!.step_id).toBe('ps_1');
    const q = sql.calls[0].strings;
    expect(q).toContain('grant_used_at IS NULL');
    expect(q).toContain('UPDATE plan_authorization_steps');
  });

  it('findDeniedStepMatch is a read (no UPDATE)', async () => {
    const sql = sqlMock([[]]);
    await findDeniedStepMatch(sql as never, 'org_1', { agentId: 'a', actionType: 'deploy', declaredGoal: 'g', actHash: null });
    expect(sql.calls[0].strings).not.toContain('UPDATE');
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run __tests__/unit/plans.repository.test.ts` → module not found).

- [ ] **Step 3: Implement `app/lib/repositories/plans.repository.ts`:**

```ts
import { randomUUID } from 'crypto';
import { computeActContentHash } from '../act-content-hash';

type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

// Preflight Plan Authorization (docs/rfcs/2026-07-06-preflight-plan-authorization.md).
// All SQL for the feature lives here — routes must not embed SQL (route-sql:check).
// Grants are single-use: consumption is one atomic UPDATE ... WHERE grant_used_at
// IS NULL RETURNING, the same race-safety shape as applyOperatorApprovalGrant.

export const PLAN_STATUSES = ['pending', 'approved', 'partially_approved', 'denied', 'expired', 'revoked'];
export const STEP_GRANT_STATUSES = ['pending', 'approved', 'denied'];

const mintId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

export interface PlanStepInput {
  action_type: string;
  step_goal: string;
  act?: unknown;
}

export async function createPlanWithSteps(
  sql: SqlClient,
  orgId: string,
  input: { agentId: string; declaredGoal: string; ttlMinutes: number; steps: PlanStepInput[] },
) {
  const planId = mintId('pa');
  const planRows = await sql`
    INSERT INTO plan_authorizations (plan_id, org_id, agent_id, declared_goal, status, ttl_minutes)
    VALUES (${planId}, ${orgId}, ${input.agentId}, ${input.declaredGoal}, 'pending', ${input.ttlMinutes})
    RETURNING *
  `;
  const steps: Record<string, unknown>[] = [];
  let seq = 0;
  for (const step of input.steps) {
    seq += 1;
    const stepId = mintId('ps');
    const actHash = computeActContentHash(step.act);
    const rows = await sql`
      INSERT INTO plan_authorization_steps
        (step_id, plan_id, org_id, seq, action_type, step_goal, act, act_content_hash)
      VALUES
        (${stepId}, ${planId}, ${orgId}, ${seq}, ${step.action_type}, ${step.step_goal},
         ${step.act === undefined ? null : JSON.stringify(step.act)}, ${actHash})
      RETURNING *
    `;
    steps.push(rows[0]);
  }
  return { plan: planRows[0], steps };
}

export async function stampStepPreview(
  sql: SqlClient,
  orgId: string,
  stepId: string,
  preview: { decision: string; riskScore: number; reasons: unknown[] },
) {
  await sql`
    UPDATE plan_authorization_steps
    SET preview_decision = ${preview.decision},
        preview_risk_score = ${preview.riskScore},
        preview_reasons = ${JSON.stringify(preview.reasons)}
    WHERE org_id = ${orgId} AND step_id = ${stepId}
  `;
}

export async function listPlans(
  sql: SqlClient,
  orgId: string,
  filters: { status?: string; agentId?: string; limit?: number } = {},
) {
  const conditions = ['org_id = $1'];
  const params: unknown[] = [orgId];
  let idx = 2;
  if (filters.status) { conditions.push(`status = $${idx}`); params.push(filters.status); idx++; }
  if (filters.agentId) { conditions.push(`agent_id = $${idx}`); params.push(filters.agentId); idx++; }
  return sql.query(
    `SELECT * FROM plan_authorizations WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${idx}`,
    [...params, filters.limit ?? 50],
  );
}

export async function getPlanWithSteps(sql: SqlClient, orgId: string, planId: string) {
  const plans = await sql`
    SELECT * FROM plan_authorizations WHERE org_id = ${orgId} AND plan_id = ${planId}
  `;
  if (!plans[0]) return null;
  const steps = await sql`
    SELECT * FROM plan_authorization_steps WHERE org_id = ${orgId} AND plan_id = ${planId} ORDER BY seq ASC
  `;
  return { plan: plans[0], steps };
}

export async function countPendingPlans(sql: SqlClient, orgId: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM plan_authorizations WHERE org_id = ${orgId} AND status = 'pending'
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Operator verdict. 'approve' honors stepOverrides (step_id -> 'approve'|'deny');
 * unlisted steps inherit 'approve'. Any denied step => plan status
 * 'partially_approved' (all denied => 'denied'). 'deny' denies every step.
 * 'revoke' kills all unconsumed grants immediately (status 'revoked').
 * expires_at = now() + min(ttl_minutes, ttlClampMinutes). Only transitions
 * plans whose status is pending (approve/deny) or approved/partially_approved
 * (revoke). Returns null when the plan is missing or not transitionable.
 */
export async function reviewPlan(
  sql: SqlClient,
  orgId: string,
  planId: string,
  input: { verdict: 'approve' | 'deny' | 'revoke'; stepOverrides?: Record<string, string>; reviewedBy: string; ttlClampMinutes: number },
) {
  const plans = await sql`
    SELECT * FROM plan_authorizations WHERE org_id = ${orgId} AND plan_id = ${planId}
  `;
  const plan = plans[0] as { plan_id: string; status: string; ttl_minutes: number } | undefined;
  if (!plan) return null;

  if (input.verdict === 'revoke') {
    if (!['pending', 'approved', 'partially_approved'].includes(plan.status)) return null;
    await sql`
      UPDATE plan_authorization_steps SET grant_status = 'denied'
      WHERE org_id = ${orgId} AND plan_id = ${planId} AND grant_used_at IS NULL
    `;
    const updated = await sql`
      UPDATE plan_authorizations
      SET status = 'revoked', reviewed_by = ${input.reviewedBy}, reviewed_at = now()
      WHERE org_id = ${orgId} AND plan_id = ${planId}
      RETURNING *
    `;
    const steps = await sql`
      SELECT * FROM plan_authorization_steps WHERE org_id = ${orgId} AND plan_id = ${planId} ORDER BY seq ASC
    `;
    return { plan: updated[0], steps };
  }

  if (plan.status !== 'pending') return null;
  const clampedTtl = Math.min(Number(plan.ttl_minutes) || 60, input.ttlClampMinutes);

  if (input.verdict === 'deny') {
    await sql`
      UPDATE plan_authorization_steps SET grant_status = 'denied'
      WHERE org_id = ${orgId} AND plan_id = ${planId}
    `;
    const updated = await sql`
      UPDATE plan_authorizations
      SET status = 'denied', reviewed_by = ${input.reviewedBy}, reviewed_at = now(),
          expires_at = now() + make_interval(mins => ${clampedTtl})
      WHERE org_id = ${orgId} AND plan_id = ${planId}
      RETURNING *
    `;
    const steps = await sql`
      SELECT * FROM plan_authorization_steps WHERE org_id = ${orgId} AND plan_id = ${planId} ORDER BY seq ASC
    `;
    return { plan: updated[0], steps };
  }

  // approve (with optional per-step overrides)
  const overrides = input.stepOverrides ?? {};
  const stepRows = await sql`
    SELECT step_id FROM plan_authorization_steps WHERE org_id = ${orgId} AND plan_id = ${planId}
  `;
  let denied = 0;
  for (const row of stepRows as Array<{ step_id: string }>) {
    const verdict = overrides[row.step_id] === 'deny' ? 'denied' : 'approved';
    if (verdict === 'denied') denied += 1;
    await sql`
      UPDATE plan_authorization_steps SET grant_status = ${verdict}
      WHERE org_id = ${orgId} AND step_id = ${row.step_id}
    `;
  }
  const status = denied === 0 ? 'approved' : denied === stepRows.length ? 'denied' : 'partially_approved';
  const updated = await sql`
    UPDATE plan_authorizations
    SET status = ${status}, reviewed_by = ${input.reviewedBy}, reviewed_at = now(),
        expires_at = now() + make_interval(mins => ${clampedTtl})
    WHERE org_id = ${orgId} AND plan_id = ${planId}
    RETURNING *
  `;
  const steps = await sql`
    SELECT * FROM plan_authorization_steps WHERE org_id = ${orgId} AND plan_id = ${planId} ORDER BY seq ASC
  `;
  return { plan: updated[0], steps };
}

/**
 * Single-use atomic consumption — the plan-grant twin of the operator-grant
 * UPDATE in evaluate.ts. Matching: org + agent + action_type + live plan
 * (approved/partially_approved, unexpired) + approved unconsumed step + act
 * binding (step hash must equal the live hash when the step is act-bound;
 * hashless steps match on step_goal = live declared_goal instead).
 */
export async function consumePlanStepGrant(
  sql: SqlClient,
  orgId: string,
  input: { agentId: string; actionType: string; declaredGoal: string; actHash: string | null; matchedActionId: string },
) {
  const rows = await sql`
    UPDATE plan_authorization_steps s
    SET grant_used_at = now(), matched_action_id = ${input.matchedActionId}
    WHERE s.step_id = (
      SELECT st.step_id
      FROM plan_authorization_steps st
      JOIN plan_authorizations p ON p.plan_id = st.plan_id AND p.org_id = st.org_id
      WHERE st.org_id = ${orgId}
        AND p.agent_id = ${input.agentId}
        AND st.action_type = ${input.actionType}
        AND p.status IN ('approved', 'partially_approved')
        AND p.expires_at > now()
        AND st.grant_status = 'approved'
        AND st.grant_used_at IS NULL
        AND (
          (st.act_content_hash IS NOT NULL AND st.act_content_hash = ${input.actHash})
          OR (st.act_content_hash IS NULL AND st.step_goal = ${input.declaredGoal})
        )
      ORDER BY st.seq ASC
      LIMIT 1
    )
      AND s.org_id = ${orgId}
      AND s.grant_used_at IS NULL
    RETURNING s.step_id, s.plan_id, s.seq, s.act_content_hash,
      (SELECT reviewed_by FROM plan_authorizations WHERE plan_id = s.plan_id AND org_id = s.org_id) AS reviewed_by,
      (SELECT COUNT(*)::int FROM plan_authorization_steps WHERE plan_id = s.plan_id AND org_id = s.org_id) AS total_steps
  `;
  return (rows[0] as {
    step_id: string; plan_id: string; seq: number; reviewed_by: string | null;
    act_content_hash: string | null; total_steps: number;
  } | undefined) ?? null;
}

/**
 * Deny-grant lookup (read-only; denied steps raise on EVERY match until the
 * plan TTL — they are not consumed). Same matching rule as consumption.
 */
export async function findDeniedStepMatch(
  sql: SqlClient,
  orgId: string,
  input: { agentId: string; actionType: string; declaredGoal: string; actHash: string | null },
) {
  const rows = await sql`
    SELECT st.step_id, st.plan_id, p.reviewed_by
    FROM plan_authorization_steps st
    JOIN plan_authorizations p ON p.plan_id = st.plan_id AND p.org_id = st.org_id
    WHERE st.org_id = ${orgId}
      AND p.agent_id = ${input.agentId}
      AND st.action_type = ${input.actionType}
      AND p.status IN ('approved', 'partially_approved', 'denied')
      AND p.expires_at > now()
      AND st.grant_status = 'denied'
      AND (
        (st.act_content_hash IS NOT NULL AND st.act_content_hash = ${input.actHash})
        OR (st.act_content_hash IS NULL AND st.step_goal = ${input.declaredGoal})
      )
    ORDER BY st.seq ASC
    LIMIT 1
  `;
  return (rows[0] as { step_id: string; plan_id: string; reviewed_by: string | null } | undefined) ?? null;
}
```

- [ ] **Step 4: Run tests — expect PASS.** `npx vitest run __tests__/unit/plans.repository.test.ts`
- [ ] **Step 5: Commit** — `git commit -m "feat(plans): plans repository — CRUD, review, atomic grant consumption"`

---

### Task 3: `GuardOptions.simulate` — side-effect-free dry-run

**Files:**
- Modify: `app/lib/guard/evaluate.ts` (GuardOptions ~line 206; evaluateGuard tail ~lines 824-946)
- Test: `__tests__/unit/guard-simulate.test.js`

**Interfaces:**
- Produces: `evaluateGuard(orgId, context, sql, { simulate: true })` returns the normal result shape plus `simulated: true`, having skipped: `persistGuardDecision`, `publishGuardDecisionEvent`, `applyOperatorApprovalGrant`, `applyPlanStepGrant` (Task 4), and any calibration STATE WRITE inside `runCalibrationController` (inspect it — if it only reads state and raises, nothing to gate; if it persists theta/e updates, gate that write on `!options.simulate`). Everything else (halt check, policy phases, evidence folding, predictive risk, prompt-injection scan, calibration read-only assessment) still runs.

- [ ] **Step 1: Write failing test** `__tests__/unit/guard-simulate.test.js` (copy the mock preamble of `__tests__/unit/guard-engine.test.js` verbatim — the vi.mock block for webhooks/llm/security/predictive-risk/settings — then):

```js
import { evaluateGuard, __resetGuardCaches } from '@/lib/guard.js';
import { createSqlMock } from '../helpers.js';

describe('evaluateGuard simulate mode', () => {
  beforeEach(() => { vi.clearAllMocks(); __resetGuardCaches(); });

  it('returns a decision without persisting guard_decisions', async () => {
    const sql = createSqlMock(); // helper: default empty result sets
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'deploy the thing', risk_score: 90,
    }, sql, { simulate: true });
    expect(result.simulated).toBe(true);
    expect(['allow', 'warn', 'require_approval', 'block']).toContain(result.decision);
    // No INSERT INTO guard_decisions was issued:
    const inserts = sql.calls.filter((c) => /INSERT INTO guard_decisions/i.test(c.text));
    expect(inserts).toHaveLength(0);
  });

  it('never runs the operator-grant consumption UPDATE in simulate mode', async () => {
    const sql = createSqlMock();
    await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'deploy the thing', risk_score: 90,
    }, sql, { simulate: true });
    const grantUpdates = sql.calls.filter((c) => /UPDATE action_records/i.test(c.text) && /approval_grant_used_at/i.test(c.text));
    expect(grantUpdates).toHaveLength(0);
  });
});
```

(Adapt `sql.calls`/`c.text` to `createSqlMock`'s real recording API — read `__tests__/helpers.js` first; if it records differently, assert through its API. If `createSqlMock` cannot list issued queries, wrap it: `const issued = []; const sql = new Proxy(...)` recording the template strings.)

- [ ] **Step 2: Run — expect FAIL** (`simulated` undefined; possibly a persist attempt).
- [ ] **Step 3: Implement.** In `evaluate.ts`:

(a) Extend GuardOptions (line ~206):
```ts
interface GuardOptions {
  includeSignals?: boolean;
  computeSignals?: (orgId: string, agentId: string | null, sql: GuardSql) => Promise<Array<{ type: string; label: string }>>;
  /**
   * Side-effect-free dry-run (preflight plan preview). Skips guard_decisions
   * persistence, event publish, and BOTH grant passes (a dry-run must never
   * consume a real single-use grant). All read/raise phases still run, so the
   * preview verdict is the full-pipeline verdict.
   */
  simulate?: boolean;
}
```

(b) Gate the grant passes inside `runEvaluation` (line ~824):
```ts
    applyAllowGrants(policies, context, liveAcc);
    if (!options.simulate) {
      await timed('grants', () => applyOperatorApprovalGrant(deps, liveAcc));
    }
```

(c) Gate persist/publish at the tail (lines ~942-946). Replace:
```ts
  await persistGuardDecision(sql, buildGuardDecisionRow(input));
  publishGuardDecisionEvent(input);
  return buildGuardResult(input);
```
with:
```ts
  if (options.simulate) {
    // Preview only: the audit trail for a dry-run is the plan row that stores
    // this verdict, not guard_decisions. Never persisted, never published.
    return { ...buildGuardResult(input), simulated: true };
  }
  await persistGuardDecision(sql, buildGuardDecisionRow(input));
  publishGuardDecisionEvent(input);
  return buildGuardResult(input);
```

(d) Read `runCalibrationController` (evaluate.ts ~438-467) — if it calls any repository write (calibration-state persist), wrap that call with `if (!options.simulate)`. `options` is in scope in `runEvaluation`; if the controller is called without options, thread a `simulate` boolean through its deps. If it is read-only (state writes happen in calibration-feedback on adjudication, which is the expected design), change nothing and note that in the commit message.

- [ ] **Step 4: Run — expect PASS.** Also run the full guard suite: `npx vitest run __tests__/unit/guard-engine.test.js __tests__/unit/guard-simulate.test.js`
- [ ] **Step 5: Commit** — `git commit -m "feat(guard): GuardOptions.simulate — side-effect-free full-pipeline dry-run"`

---

### Task 4: `applyPlanStepGrant` — deny-raise + single-use consumption post-pass

**Files:**
- Modify: `app/lib/guard/evaluate.ts` (new function after `applyOperatorApprovalGrant` ~line 371; call site ~line 825; provenance in finalize input ~line 567 area)
- Test: `__tests__/unit/guard-plan-grant.test.js`

**Interfaces:**
- Consumes: `consumePlanStepGrant`, `findDeniedStepMatch` from Task 2 (dynamic import inside the function, matching how caches.ts imports repositories: `await import('../repositories/plans.repository')`).
- Produces: decisions covered by a plan grant carry `matchedPolicies: 'builtin:plan_grant'`, a warning string `Covered by plan pa_x step k/n (approved by <reviewer>, act-bound?) — require_approval downgraded to allow`, and `_plan_grant: { plan_id, step_id, seq }` in the persisted breakdown (same spread pattern as `_calibration` at evaluate.ts:567). Denied-step matches raise to block via `applyBlockOverride` with reason `Plan step ps_x was explicitly denied by <reviewer>`.

- [ ] **Step 1: Write failing tests** (same mock preamble as guard-engine.test.js; script the sql mock so the plans-repository queries return controlled rows):

```js
describe('applyPlanStepGrant (via evaluateGuard)', () => {
  beforeEach(() => { vi.clearAllMocks(); __resetGuardCaches(); });

  it('downgrades require_approval to allow when an approved step matches', async () => { /* seed a require_approval policy via the policies result set; script consumePlanStepGrant's UPDATE to return a row; assert result.decision === 'allow', matched_policies contains 'builtin:plan_grant', warnings mention the plan id */ });

  it('never downgrades block', async () => { /* seed a block policy; assert decision stays 'block' and NO plan_authorization_steps UPDATE was issued */ });

  it('raises to block when a denied step matches, even from allow', async () => { /* no raising policy (decision would be allow); script findDeniedStepMatch to return a row; assert decision === 'block' and reason mentions 'explicitly denied' */ });

  it('does not consume in simulate mode', async () => { /* simulate: true + require_approval policy; assert no UPDATE plan_authorization_steps issued */ });

  it('fails soft: a throwing plans lookup leaves require_approval intact', async () => { /* make the plans query reject; assert decision === 'require_approval' and no crash */ });
});
```

Write the five bodies out fully in the test file — each needs: a policies result set that produces the starting decision (copy how guard-engine.test.js seeds a require_approval policy row), scripted results for the plan queries in the order the implementation issues them (denied-check SELECT first, then consume UPDATE), and assertions as commented.

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement in `evaluate.ts`** (after `applyOperatorApprovalGrant`, before `scanPromptInjection`):

```ts
/**
 * Preflight plan-authorization post-pass (RFC 2026-07-06, feature 1 of the
 * governed-autonomy program). Two checks, in tighten-first order:
 *
 *  1. Deny-grant: a step the operator EXPLICITLY denied raises any non-block
 *     decision to block on match (applyBlockOverride) for the plan's TTL.
 *     Runs regardless of the current decision — an operator "no" outranks a
 *     policy "yes". Read-only: denied steps are never consumed.
 *  2. Consumption: when the decision is require_approval, an approved,
 *     unconsumed, unexpired, act-or-goal-bound step is consumed atomically
 *     (single UPDATE ... WHERE grant_used_at IS NULL RETURNING — the same
 *     race shape as the operator grant above) and the decision downgrades to
 *     allow. Operator grants run FIRST (more specific; they win).
 *
 * Never touches block. Never runs in simulate mode (gated at the call site).
 * Fail-soft: any error leaves the decision unchanged (require_approval fails
 * closed), identical posture to applyOperatorApprovalGrant.
 */
async function applyPlanStepGrant(deps: GuardPhaseDeps, acc: GuardAccumulator): Promise<{ plan_id: string; step_id: string; seq: number } | null> {
  const { context, sql, orgId } = deps;
  if (!context.agent_id || !context.declared_goal || !context.action_type) return null;
  if (acc.highestDecision === 'block') return null;
  try {
    const { consumePlanStepGrant, findDeniedStepMatch } = await import('../repositories/plans.repository');
    const actHash = computeActContentHash(context.act);
    const match = {
      agentId: context.agent_id,
      actionType: context.action_type,
      declaredGoal: context.declared_goal,
      actHash,
    };

    const denied = await findDeniedStepMatch(sql as never, orgId, match);
    if (denied) {
      applyBlockOverride(acc, `Plan step ${denied.step_id} was explicitly denied by ${denied.reviewed_by || 'operator'}`);
      acc.matchedPolicies.push('builtin:plan_deny');
      return null;
    }

    if (acc.highestDecision !== 'require_approval') return null;

    const grant = await consumePlanStepGrant(sql as never, orgId, {
      ...match,
      matchedActionId: context.action_id ? String(context.action_id) : '',
    });
    if (!grant) return null;
    acc.warnings.push(
      `Covered by plan ${grant.plan_id} step ${grant.seq}/${grant.total_steps} (approved by ${grant.reviewed_by || 'operator'}${grant.act_content_hash ? ', act-bound' : ''}) — require_approval downgraded to allow`,
    );
    acc.matchedPolicies.push('builtin:plan_grant');
    acc.highestDecision = 'allow';
    acc.reasons.length = 0; // gating reasons no longer apply
    return { plan_id: grant.plan_id, step_id: grant.step_id, seq: grant.seq };
  } catch (err) {
    console.warn('[Guard] plan-grant lookup failed:', (err as Error).message);
    return null;
  }
}
```

Call site (replacing the Task 3 block at ~825; `planGrant` must be declared alongside `calibration` in the outer scope so the finalize input can see it):
```ts
    applyAllowGrants(policies, context, liveAcc);
    if (!options.simulate) {
      await timed('grants', () => applyOperatorApprovalGrant(deps, liveAcc));
      planGrant = await timed('plan_grant', () => applyPlanStepGrant(deps, liveAcc));
    }
```
Outer declaration (next to `let calibration: CalibrationAssessment | null = null;`):
```ts
  let planGrant: { plan_id: string; step_id: string; seq: number } | null = null;
```
Provenance: add `planGrant` to `GuardFinalizeInput` and spread it where `_calibration` is spread (evaluate.ts:567):
```ts
      ...(input.calibration ? { _calibration: input.calibration } : {}),
      ...(input.planGrant ? { _plan_grant: input.planGrant } : {}),
```
and add `planGrant` to the `input` object built at ~line 936.

- [ ] **Step 4: Run — expect PASS**, then the full guard family: `npx vitest run __tests__/unit/ --silent -t guard` (or the whole unit dir if -t is unreliable).
- [ ] **Step 5: Commit** — `git commit -m "feat(guard): applyPlanStepGrant — deny-raise + single-use plan grant consumption"`

---

### Task 5: `POST|GET /api/plans` (submit + list)

**Files:**
- Create: `app/api/plans/route.ts`
- Test: `__tests__/unit/plans-route.test.ts`

**Interfaces:**
- Consumes: Task 2 repository; `evaluateGuard(..., { simulate: true })` from Task 3; `getOrgId` from `app/lib/org`; `resolveAgentIdentity` from `app/lib/identity-resolution`; `getSettings` from settings.repository; `publishOrgEvent`/`EVENTS` from `app/lib/events`; `apiErrorResponse` from `app/lib/apiErrors`.
- Produces: `POST /api/plans` body `{ agent_id, declared_goal, ttl_minutes?, steps: [{ action_type, step_goal, act? }] }` → 201 `{ plan, steps }` with previews stamped. `GET /api/plans?status=&agent_id=&limit=` → `{ plans }`.

- [ ] **Step 1: Write failing route tests** (mock style copied from `__tests__/unit/approvals-route.test.js`: mock `app/lib/db.js`, `app/lib/org.js`, `app/lib/identity-resolution`, the plans repository module, `app/lib/guard.js` (evaluateGuard), `app/lib/events`). Cases: 400 on missing steps/empty steps/step missing action_type or step_goal; 400 when steps.length > PLAN_MAX_STEPS (mock getSettings returning the key); 429-style 409 when countPendingPlans ≥ 10; 201 happy path calls evaluateGuard once per step with `{ simulate: true }` and stamps previews; GET returns listPlans result.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `app/api/plans/route.ts`:**

```ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { apiErrorResponse } from '../../lib/apiErrors';
import { EVENTS, publishOrgEvent } from '../../lib/events';
import { resolveAgentIdentity } from '../../lib/identity-resolution';
import { evaluateGuard } from '../../lib/guard';
import { getSettings } from '../../lib/repositories/settings.repository';
import {
  createPlanWithSteps, stampStepPreview, listPlans, countPendingPlans,
} from '../../lib/repositories/plans.repository';

const DEFAULT_MAX_STEPS = 25;
const MAX_PENDING_PLANS = 10;

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const identity = await resolveAgentIdentity(request, { agentId: body.agent_id });
    const agentId = identity.agent_id;
    if (!agentId) {
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });
    }
    if (!body.declared_goal || typeof body.declared_goal !== 'string') {
      return NextResponse.json({ error: 'declared_goal is required' }, { status: 400 });
    }
    const steps = Array.isArray(body.steps) ? body.steps : [];
    if (steps.length === 0) {
      return NextResponse.json({ error: 'steps must be a non-empty array' }, { status: 400 });
    }
    for (const [i, step] of steps.entries()) {
      if (!step || typeof step.action_type !== 'string' || !step.action_type
        || typeof step.step_goal !== 'string' || !step.step_goal) {
        return NextResponse.json({ error: `steps[${i}] requires action_type and step_goal` }, { status: 400 });
      }
    }

    const settings = await getSettings(sql, orgId, { category: 'general' });
    const maxSteps = parseInt(String(settings.find((s) => s.key === 'PLAN_MAX_STEPS')?.value ?? ''), 10) || DEFAULT_MAX_STEPS;
    if (steps.length > maxSteps) {
      return NextResponse.json({ error: `Plan exceeds the ${maxSteps}-step cap (PLAN_MAX_STEPS)` }, { status: 400 });
    }
    const pending = await countPendingPlans(sql, orgId);
    if (pending >= MAX_PENDING_PLANS) {
      return NextResponse.json({ error: `Too many pending plans (${pending}); resolve or revoke existing plans first` }, { status: 409 });
    }

    const ttlMinutes = Number.isFinite(Number(body.ttl_minutes)) && Number(body.ttl_minutes) > 0
      ? Math.floor(Number(body.ttl_minutes)) : 60;

    const created = await createPlanWithSteps(sql, orgId, {
      agentId, declaredGoal: body.declared_goal, ttlMinutes, steps,
    });

    // Dry-run every step through the REAL pipeline, side-effect-free. The
    // preview verdict is advisory: conditions change between review and
    // execution — a grant only matters when the LIVE evaluation lands on
    // require_approval.
    const previewedSteps = [];
    for (const step of created.steps as Array<Record<string, unknown>>) {
      const preview = await evaluateGuard(orgId, {
        agent_id: agentId,
        action_type: String(step.action_type),
        declared_goal: String(step.step_goal),
        ...(step.act ? { act: typeof step.act === 'string' ? JSON.parse(String(step.act)) : step.act } : {}),
      }, sql, { simulate: true });
      await stampStepPreview(sql, orgId, String(step.step_id), {
        decision: preview.decision,
        riskScore: Number(preview.risk_score ?? preview.adjusted_risk_score ?? 0),
        reasons: preview.reasons ?? [],
      });
      previewedSteps.push({ ...step, preview_decision: preview.decision, preview_risk_score: preview.risk_score, preview_reasons: preview.reasons });
    }

    void publishOrgEvent(EVENTS.ACTION_UPDATED, { orgId, plan: created.plan });

    return NextResponse.json({ plan: created.plan, steps: previewedSteps }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, 'PLANS POST');
  }
}

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const url = new URL(request.url);
    const plans = await listPlans(sql, orgId, {
      status: url.searchParams.get('status') || undefined,
      agentId: url.searchParams.get('agent_id') || undefined,
      limit: Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200),
    });
    return NextResponse.json({ plans });
  } catch (error) {
    return apiErrorResponse(error, 'PLANS GET');
  }
}
```

Check `evaluateGuard`'s actual result field names before finalizing (`decision`, `risk_score`, `reasons` — read `buildGuardResult` in evaluate.ts and use its real keys; the route test pins them). Verify `EVENTS.ACTION_UPDATED` exists in `app/lib/events` — if there is a more precise event (or a generic publish), use that; the /approvals page already refetches on `action.created|action.updated|guard.decision.created`, so reusing ACTION_UPDATED gives live inbox updates with zero UI plumbing.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Middleware check:** confirm `/api/plans` is NOT in `PUBLIC_ROUTES` (middleware.js) — it must require auth. No middleware change expected (default = authenticated). Run `npx vitest run __tests__/unit/plans-route.test.ts`.
- [ ] **Step 6: Commit** — `git commit -m "feat(plans): POST/GET /api/plans — submit with full-pipeline dry-run previews"`

---

### Task 6: `GET|POST /api/plans/[planId]` (detail + operator verdict)

**Files:**
- Create: `app/api/plans/[planId]/route.ts`
- Test: `__tests__/unit/plans-review-route.test.ts`

**Interfaces:**
- Consumes: `getPlanWithSteps`, `reviewPlan` from Task 2; auth trio `getOrgId/getOrgRole/getUserId` from `app/lib/org`; `logActivity` from `app/lib/audit`; `publishOrgEvent`.
- Produces: `GET /api/plans/[planId]` → `{ plan, steps }` (agent polls this). `POST /api/plans/[planId]` body `{ verdict: 'approve'|'deny'|'revoke', step_overrides? }` → `{ plan, steps }`; admin + attributable principal required (mirrors `app/api/approvals/[actionId]/route.ts`).

- [ ] **Step 1: Write failing tests.** Mirror `__tests__/unit/approvals-route.test.js` mock setup exactly (db/org mocks + repository mocks). Cases: GET 404 unknown; GET returns plan+steps; POST 403 non-admin; POST 403 when `getUserId` null (code `APPROVER_IDENTITY_REQUIRED`); POST 400 invalid verdict; POST 404 when reviewPlan returns null; POST happy approve passes `ttlClampMinutes` from settings (`PLAN_GRANT_TTL_MAX_MINUTES`, default 480) and returns updated plan; POST verdict publishes org event and logs activity.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `app/api/plans/[planId]/route.ts`:**

```ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse, after } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getOrgRole, getUserId } from '../../../lib/org';
import { logActivity } from '../../../lib/audit';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { EVENTS, publishOrgEvent } from '../../../lib/events';
import { getSettings } from '../../../lib/repositories/settings.repository';
import { getPlanWithSteps, reviewPlan } from '../../../lib/repositories/plans.repository';

const DEFAULT_TTL_CLAMP_MINUTES = 480;

export async function GET(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const { planId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const result = await getPlanWithSteps(sql, orgId, planId);
    if (!result) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, 'PLAN GET');
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const { planId } = await params;
    const orgId = getOrgId(request);
    const role = getOrgRole(request);
    const userId = getUserId(request);

    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required for plan review' }, { status: 403 });
    }
    if (!userId) {
      return NextResponse.json(
        { error: 'Plan review requires an attributable principal', code: 'APPROVER_IDENTITY_REQUIRED' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { verdict, step_overrides: stepOverrides } = body;
    if (!['approve', 'deny', 'revoke'].includes(verdict)) {
      return NextResponse.json({ error: 'Invalid verdict. Must be approve, deny, or revoke.' }, { status: 400 });
    }

    const sql = getSql();
    const settings = await getSettings(sql, orgId, { category: 'general' });
    const ttlClampMinutes = parseInt(String(settings.find((s) => s.key === 'PLAN_GRANT_TTL_MAX_MINUTES')?.value ?? ''), 10) || DEFAULT_TTL_CLAMP_MINUTES;

    const result = await reviewPlan(sql, orgId, planId, {
      verdict, stepOverrides: stepOverrides ?? {}, reviewedBy: userId, ttlClampMinutes,
    });
    if (!result) {
      return NextResponse.json({ error: 'Plan not found or not reviewable in its current status' }, { status: 404 });
    }

    after(() => logActivity({
      orgId, actorId: userId, action: `plan.${verdict}d`,
      resourceType: 'plan', resourceId: planId,
      details: { verdict, step_overrides: stepOverrides ?? {} }, request,
    }, sql));
    void publishOrgEvent(EVENTS.ACTION_UPDATED, { orgId, plan: result.plan });

    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, 'PLAN REVIEW POST');
  }
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Settings allowlist.** In `app/lib/repositories/settings.repository.ts`, add to `VALID_SETTING_KEYS` (before the closing `];`, after the LOCAL_ADMIN_LOGIN_GUARD block):

```ts
  // Preflight plan authorization (governed-autonomy feature 1). TTL_MAX is
  // the server clamp on agent-requested plan TTLs (minutes); MAX_STEPS caps
  // steps per submitted plan. Read by the /api/plans routes (NOT on the
  // guard hot path — the consumption query needs no settings).
  'PLAN_GRANT_TTL_MAX_MINUTES',
  'PLAN_MAX_STEPS',
```

- [ ] **Step 6: Run FULL unit suite** (`npx vitest run`) — settings allowlist tests pin the key list; update any pinned-count test the addition breaks (read the failure, extend the expected list).
- [ ] **Step 7: Commit** — `git commit -m "feat(plans): plan detail + operator verdict route; PLAN_* settings keys"`

---

### Task 7: SDK parity — Node + Python (+5 methods each)

**Files:**
- Modify: `sdk/dashclaw.js` (before the closing brace of `class DashClaw`, near `createTeamTask`)
- Modify: `sdk-python/dashclaw/client.py`
- Test: `__tests__/unit/sdk-plans.test.js` (Node); Python tests via the existing unittest harness under `sdk-python/tests/` (follow the naming of the existing client tests there)

**Interfaces:**
- Produces (Node): `submitPlan(plan)`, `getPlan(planId)`, `listPlans(opts)`, `resolvePlan(planId, verdict, opts)`, `waitForPlanReview(planId, opts)`.
- Produces (Python): `submit_plan`, `get_plan`, `list_plans`, `resolve_plan`, `wait_for_plan_review`.

- [ ] **Step 1: Failing Node test** (follow the existing SDK unit-test file style in `__tests__/unit/` — find the file testing `createTeamTask` or `waitForApproval` and copy its fetch-mock harness). Cases: submitPlan POSTs `/api/plans` with agent_id defaulted from the client's agentId; waitForPlanReview polls GET `/api/plans/:id` until status leaves 'pending', returns the plan, throws on 'denied' only if `opts.throwOnDeny` — no: keep it simple, it RESOLVES with the final plan whatever the verdict (caller inspects status); times out with an error after `timeout`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement in `sdk/dashclaw.js`** (2-space class-method indent — the method counter regex demands it):

```js
  /**
   * POST /api/plans — Submit a preflight plan for operator review. Each step
   * is dry-run through the guard pipeline server-side; approved steps become
   * single-use grants consumed automatically when the matching action runs.
   * @param {object} plan - { declared_goal, ttl_minutes?, steps: [{ action_type, step_goal, act? }] }
   */
  async submitPlan(plan) {
    return this._post('/api/plans', { agent_id: this.agentId, ...plan });
  }

  /** GET /api/plans/:planId — Plan detail with per-step grant status. */
  async getPlan(planId) {
    return this._get(`/api/plans/${encodeURIComponent(planId)}`);
  }

  /**
   * GET /api/plans — List plans.
   * @param {object} [opts] - { status?, agent_id?, limit? }
   */
  async listPlans(opts = {}) {
    const qs = new URLSearchParams(Object.entries(opts).filter(([, v]) => v != null));
    const suffix = qs.toString() ? `?${qs}` : '';
    return this._get(`/api/plans${suffix}`);
  }

  /**
   * POST /api/plans/:planId — Operator verdict (admin credential required).
   * @param {string} planId
   * @param {'approve'|'deny'|'revoke'} verdict
   * @param {object} [opts] - { step_overrides? }
   */
  async resolvePlan(planId, verdict, opts = {}) {
    return this._post(`/api/plans/${encodeURIComponent(planId)}`, { verdict, ...opts });
  }

  /**
   * Poll GET /api/plans/:planId until the operator reviews it (status leaves
   * 'pending') or the timeout elapses. Resolves with the final plan+steps —
   * the caller inspects plan.status. Same polling shape as waitForApproval.
   * @param {string} planId
   * @param {object} [opts] - { timeout = 300000, interval = 5000 }
   */
  async waitForPlanReview(planId, { timeout = 300000, interval = 5000 } = {}) {
    const startTime = Date.now();
    for (;;) {
      const result = await this.getPlan(planId);
      if (result?.plan?.status && result.plan.status !== 'pending') return result;
      if (Date.now() - startTime >= timeout) {
        throw new Error(`Plan ${planId} was not reviewed within ${timeout}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
```

(Confirm `_get`/`_post` are the file's real private helpers — read two existing methods; if the file uses `_request(path, opts)`, use that instead, matching `createTeamTask`'s exact call shape.)

- [ ] **Step 4: Implement Python mirrors in `sdk-python/dashclaw/client.py`** (snake_case, single-line docstrings, same `_request` helper as `create_session`):

```python
    def submit_plan(self, declared_goal, steps, ttl_minutes=None):
        """Submit a preflight plan for operator review; steps are dry-run server-side."""
        payload = {"agent_id": self.agent_id, "declared_goal": declared_goal, "steps": steps}
        if ttl_minutes is not None:
            payload["ttl_minutes"] = ttl_minutes
        return self._request("/api/plans", "POST", json=payload)

    def get_plan(self, plan_id):
        """Fetch a plan with per-step grant status."""
        return self._request(f"/api/plans/{plan_id}", "GET")

    def list_plans(self, status=None, agent_id=None, limit=None):
        """List submitted plans."""
        params = {k: v for k, v in {"status": status, "agent_id": agent_id, "limit": limit}.items() if v is not None}
        return self._request("/api/plans", "GET", params=params)

    def resolve_plan(self, plan_id, verdict, step_overrides=None):
        """Operator verdict on a plan: approve, deny, or revoke (admin credential)."""
        payload = {"verdict": verdict}
        if step_overrides:
            payload["step_overrides"] = step_overrides
        return self._request(f"/api/plans/{plan_id}", "POST", json=payload)

    def wait_for_plan_review(self, plan_id, timeout=300, interval=5):
        """Poll until the operator reviews the plan (status leaves 'pending')."""
        deadline = time.time() + timeout
        while True:
            result = self.get_plan(plan_id)
            plan = (result or {}).get("plan") or {}
            if plan.get("status") and plan.get("status") != "pending":
                return result
            if time.time() >= deadline:
                raise TimeoutError(f"Plan {plan_id} was not reviewed within {timeout}s")
            time.sleep(interval)
```

(Match `_request`'s real signature — read `create_session` and `wait_for_approval` first; if GET params ride differently, follow the file's convention.)

- [ ] **Step 5: Run** Node tests + `npm run sdk:integration:python` (the Python unittest runner). Expect PASS.
- [ ] **Step 6: Verify counts move as predicted:** `npm run sdk:count` → Node 36, Python 56. (Docs updated in Task 10.)
- [ ] **Step 7: Commit** — `git commit -m "feat(sdk): plan authorization methods — Node + Python parity"`

---

### Task 8: MCP tools — `dashclaw_plan_submit`, `dashclaw_plan_status`

**Files:**
- Modify: `mcp-server/src/tools.ts` (TOOL_DEFINITIONS array + createToolHandlers)
- Test: mcp-server's own suite (`cd mcp-server && npx vitest run`) — add cases to the existing tools test file there (find the file asserting on TOOL_DEFINITIONS; extend its expected tool list)

**Interfaces:**
- Consumes: routes from Tasks 5–6 via the MCP server's `client.post`/`client.get`.
- Produces: two tools; every hardcoded count (mcp-server/README.md "15") moves to 17 in Task 10.

- [ ] **Step 1: Extend the mcp-server tools test** with the two new names in its expected list — run, expect FAIL.
- [ ] **Step 2: Implement.** Append to `TOOL_DEFINITIONS` (matching `dashclaw_task_create`'s shape):

```ts
  {
    name: 'dashclaw_plan_submit',
    description:
      'Submit a preflight plan — an ordered list of intended steps — for one-card operator ' +
      'review BEFORE executing. Each step is dry-run through the guard pipeline server-side; ' +
      'approved steps become single-use grants that auto-cover the matching guarded actions, ' +
      'so a reviewed plan runs without mid-run approval interruptions. Off-plan actions fall ' +
      'back to normal per-action governance.',
    inputSchema: {
      type: 'object',
      properties: {
        declared_goal: { type: 'string', description: 'The mission-level goal of the plan (required)' },
        steps: {
          type: 'array',
          description: 'Ordered steps: [{ action_type, step_goal, act? }] (required)',
          items: {
            type: 'object',
            properties: {
              action_type: { type: 'string', description: 'Action category, e.g. deploy, code_change (required)' },
              step_goal: { type: 'string', description: 'What this step accomplishes (required)' },
              act: { type: 'object', description: 'Optional literal act ({ kind: shell|http|sql|file, ... }) — act-binds the grant to exactly this act' },
            },
            required: ['action_type', 'step_goal'],
          },
        },
        ttl_minutes: { type: 'integer', description: 'Requested grant TTL after approval (server-clamped; default 60)' },
      },
      required: ['declared_goal', 'steps'],
    },
  },
  {
    name: 'dashclaw_plan_status',
    description:
      'Check a submitted plan: overall status (pending | approved | partially_approved | denied | ' +
      'expired | revoked) and per-step grant status (approved / denied / consumed). Poll this ' +
      'after dashclaw_plan_submit to learn the operator verdict before executing.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: 'Plan id from dashclaw_plan_submit, e.g. pa_1234... (required)' },
      },
      required: ['plan_id'],
    },
  },
```

And in `createToolHandlers`:

```ts
    async dashclaw_plan_submit(input: any) {
      const result = await client.post('/api/plans', {
        declared_goal: input.declared_goal,
        steps: input.steps,
        ttl_minutes: input.ttl_minutes,
      }, { timeout: 30000 });
      return JSON.stringify(result);
    },
    async dashclaw_plan_status(input: any) {
      const result = await client.get(`/api/plans/${encodeURIComponent(input.plan_id)}`, { timeout: 10000 });
      return JSON.stringify(result);
    },
```

(Confirm `client.get` exists — read an existing GET handler, e.g. `dashclaw_status`/`dashclaw_decisions_recent`, and copy its exact client call shape. The dry-run POST covers up to 25 guard evaluations, hence the 30s timeout.)

- [ ] **Step 3: Run mcp-server suite + typecheck + build:** `cd mcp-server && npx vitest run && npm run typecheck && npm run build`. The route-drift test (`test/route-drift.test.ts`) may pin the route list — extend it with `/api/plans` routes if it fails.
- [ ] **Step 4: Commit** — `git commit -m "feat(mcp): dashclaw_plan_submit + dashclaw_plan_status"`

---

### Task 9: /approvals Plan Review card + provenance rendering

**Files:**
- Create: `app/approvals/_components/PlanReviewCard.tsx`
- Modify: `app/approvals/page.tsx` (fetch pending plans; render cards above the pending-actions list)
- Test: frontend-verify (Step 5) — no vitest for JSX here unless the repo has an existing pattern for this page (it does not; `reference_testable_pages_must_be_jsx` applies to pages converted for tests — do NOT rename this .tsx page)

**Interfaces:**
- Consumes: `GET /api/plans?status=pending`, `POST /api/plans/[planId]` (Task 6); `Card`/`CardContent` + `Badge` from `app/components/ui/`.
- Produces: operator can approve/deny/revoke a plan and toggle per-step overrides entirely by clicking.

- [ ] **Step 1: Implement `PlanReviewCard.tsx`:**

```tsx
'use client';

import { useState } from 'react';
import { Check, X, ListChecks } from 'lucide-react';
import Card, { CardContent } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';

const PREVIEW_VARIANT: Record<string, string> = {
  allow: 'success', warn: 'warning', require_approval: 'warning', block: 'error',
};

interface PlanStep {
  step_id: string; seq: number; action_type: string; step_goal: string;
  preview_decision: string | null; preview_risk_score: number | null;
  act_content_hash: string | null; grant_status: string;
}
interface Plan {
  plan_id: string; agent_id: string; declared_goal: string; status: string;
  ttl_minutes: number; created_at: string;
}

export default function PlanReviewCard({ plan, steps, onResolved }: {
  plan: Plan; steps: PlanStep[]; onResolved: () => void;
}) {
  const [overrides, setOverrides] = useState<Record<string, 'approve' | 'deny'>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleStep = (stepId: string) => {
    setOverrides((prev) => ({ ...prev, [stepId]: prev[stepId] === 'deny' ? 'approve' : 'deny' }));
  };

  const submit = async (verdict: 'approve' | 'deny') => {
    try {
      setBusy(true);
      setError(null);
      const res = await fetch(`/api/plans/${plan.plan_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verdict === 'approve' ? { verdict, step_overrides: overrides } : { verdict }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Plan verdict failed (${res.status})`);
      }
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Plan verdict failed');
    } finally {
      setBusy(false);
    }
  };

  const deniedCount = Object.values(overrides).filter((v) => v === 'deny').length;

  return (
    <Card data-entity-type="plan" data-entity-id={plan.plan_id} data-entity-status={plan.status} hover={false}>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 mb-1">
          <ListChecks size={16} className="text-brand" />
          <Badge variant="brand">Plan review</Badge>
          <span className="text-xs text-tertiary">{plan.agent_id}</span>
          <span className="text-xs text-tertiary">· TTL {plan.ttl_minutes}m after approval</span>
        </div>
        <h3 className="text-lg font-semibold text-white mb-3">{plan.declared_goal}</h3>

        <div className="rounded-lg border border-border overflow-hidden mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-tertiary uppercase tracking-wider bg-white/5">
                <th className="px-3 py-2 w-10">#</th>
                <th className="px-3 py-2">Step</th>
                <th className="px-3 py-2 w-36">Type</th>
                <th className="px-3 py-2 w-40">Preview</th>
                <th className="px-3 py-2 w-28 text-right">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step) => {
                const denied = overrides[step.step_id] === 'deny';
                return (
                  <tr key={step.step_id} className="border-t border-border">
                    <td className="px-3 py-2 tabular-nums text-tertiary">{step.seq}</td>
                    <td className="px-3 py-2 text-white">
                      {step.step_goal}
                      {step.act_content_hash && (
                        <span className="ml-2"><Badge variant="info" size="xs">Act-bound</Badge></span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-secondary">{step.action_type}</td>
                    <td className="px-3 py-2">
                      {step.preview_decision ? (
                        <span title="Advisory: conditions can change between review and execution">
                          <Badge variant={PREVIEW_VARIANT[step.preview_decision] ?? 'default'} size="xs">
                            {step.preview_decision}
                            {step.preview_risk_score != null ? ` · ${step.preview_risk_score}` : ''}
                          </Badge>
                        </span>
                      ) : (
                        <Badge size="xs">no preview</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => toggleStep(step.step_id)}
                        disabled={busy}
                        className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
                          denied
                            ? 'border-error/20 bg-error-subtle text-error'
                            : 'border-success/20 bg-success-subtle text-success'
                        }`}
                      >
                        {denied ? 'Denied' : 'Approved'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-tertiary mb-3">
          Previews are advisory — a grant only applies when the live evaluation still requires approval.
          Denied steps are blocked outright for the plan&apos;s TTL.
        </p>
        {error && <p className="text-xs text-error mb-3">{error}</p>}

        <div className="flex items-center gap-2">
          <button
            onClick={() => submit('approve')}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-success/20 bg-success-subtle px-3 py-1.5 text-sm font-medium text-success transition-colors hover:bg-success/10 disabled:opacity-50"
          >
            <Check size={16} /> {deniedCount > 0 ? `Approve ${steps.length - deniedCount} of ${steps.length} steps` : 'Approve plan'}
          </button>
          <button
            onClick={() => submit('deny')}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-error/20 bg-error-subtle px-3 py-1.5 text-sm font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
          >
            <X size={16} /> Deny plan
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
```

(Verify `Card`'s default vs named exports and the exact `text-brand`/`text-secondary`/`border-border` token names against a neighboring page before finalizing — tokens only, no hex. If `Badge` lacks a `brand` variant fallback to `info`.)

- [ ] **Step 2: Wire into `app/approvals/page.tsx`.** Add alongside the existing pending fetch:

```tsx
const [pendingPlans, setPendingPlans] = useState<Array<{ plan: any; steps: any[] }>>([]);

const fetchPendingPlans = useCallback(async () => {
  try {
    const res = await fetch('/api/plans?status=pending', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const detailed = await Promise.all(
      (data.plans ?? []).map(async (p: any) => {
        const d = await fetch(`/api/plans/${p.plan_id}`, { cache: 'no-store' });
        return d.ok ? d.json() : null;
      }),
    );
    setPendingPlans(detailed.filter(Boolean));
  } catch { /* pending plans are additive; the actions inbox must not break on this */ }
}, []);
```

Call `fetchPendingPlans()` wherever `fetchPending()` is called (initial effect, 10s poll, realtime handler). Render above the pending-actions list:

```tsx
{pendingPlans.map(({ plan, steps }) => (
  <PlanReviewCard key={plan.plan_id} plan={plan} steps={steps} onResolved={() => { fetchPendingPlans(); fetchPending({ silent: true }); }} />
))}
```

- [ ] **Step 3: Decisions provenance.** No code needed for the detail tab (`PoliciesTab` already renders `matched_policies`, which now includes `builtin:plan_grant`) — VERIFY this renders by reading PoliciesTab once more; additionally the plan/step ids persist in the breakdown as `_plan_grant` (Task 4). The RFC's list-row badge is an incidental — the detail-tab provenance satisfies the invariant (visible, clickable path: /decisions → decision → Policies tab). Record this narrowing in the ship summary.
- [ ] **Step 4: Build:** `npx next build` — expect clean.
- [ ] **Step 5: Rendered proof (frontend-verify skill).** Start the app (`npx next build && npx next start -p 3001` per the dev-server-panic memory), seed a pending plan via `POST /api/plans` with the operator key, drive `/approvals`, assert the Plan review card renders with the step table, toggle one step to Denied, click Approve plan, and confirm the card clears and `GET /api/plans/[id]` shows `partially_approved` with the toggled step `denied`. Keep console clean.
- [ ] **Step 6: Commit** — `git commit -m "feat(approvals): plan review card — one-card preflight review with per-step overrides"`

---

### Task 10: Surface budget amendment + doc counts + runtime-api docs

**Files:**
- Modify: `contracts/surface-budget.json`, `THESIS.md` (ceilings table + amendment log), `docs/sdk-parity.md`, `sdk/README.md`, `mcp-server/README.md`, `docs/architecture/runtime-api.md`, `README.md` + `PROJECT_DETAILS.md` (wherever counts are cited — grep first)

- [ ] **Step 1: Amend `contracts/surface-budget.json`** — raise with reasons (same commit as the surfaces per the gate; since tasks commit separately, do this BEFORE pushing — the gate runs in CI, not per-commit locally; verify with `npm run surface:check`):
  - `apiRoutes`: 121 → 123, reason: `"2026-07-26: +2 (/api/plans, /api/plans/[planId]) — Preflight Plan Authorization (governed-autonomy RFC 2026-07-06, feature 1): one upfront human review amortizes N mid-run approval interruptions; approved steps become single-use act-scoped grants. On the thesis loop (intercept → decide → approve → prove) by construction."`
  - `mcpTools`: 15 → 17, reason: `"2026-07-26: +2 (dashclaw_plan_submit, dashclaw_plan_status) — thin wrappers over the two plan routes."`
  - `sdkNodeMethods`: 31 → 36, reason: `"2026-07-26: +5 plan-authorization methods (submitPlan, getPlan, listPlans, resolvePlan, waitForPlanReview)."`
  - `sdkPythonMethods`: 51 → 56, reason: `"2026-07-26: +5 snake_case parity for the plan-authorization methods."`
- [ ] **Step 2: Amend THESIS.md** — update the four numbers in the ceilings table AND append to the Amendment log:

```markdown
- **2026-07-26 — Preflight Plan Authorization (governed-autonomy feature 1).**
  Active API routes 121 → 123, MCP tools 15 → 17, Node SDK methods 31 → 36,
  Python SDK methods 51 → 56. The thesis's forward bet (governed autonomy)
  begins shipping: an agent submits its intended plan, the operator reviews
  one card, approved steps become single-use act-scoped grants — N mid-run
  interruptions become one upfront review with MORE context, not less. Every
  new surface sits directly on the loop: plans are intercepted intent,
  reviewed by a human, provable in the decision ledger (`builtin:plan_grant`
  provenance). RFC: docs/rfcs/2026-07-06-preflight-plan-authorization.md.
```

- [ ] **Step 3: Update counts.** `docs/sdk-parity.md` (31→36, 51→56 on lines 16-18, 29-30), `sdk/README.md:346` (31/51→36/56), `mcp-server/README.md` (15→17 on lines 3, 75, 86 — and add the two tools to its tool table under a new "Plans" grouping). Then grep: `grep -rn "31 methods\|51 methods\|15 governance tools\|121" README.md PROJECT_DETAILS.md docs/ --include=*.md` and fix any other citation.
- [ ] **Step 4: `docs/architecture/runtime-api.md`** — add a "Plan authorization (preflight)" subsection after the 4-step loop section:

```markdown
## Plan authorization (preflight)

Long-horizon runs amortize approvals: `POST /api/plans` submits an ordered
step list; every step is dry-run through the full guard pipeline
(side-effect-free) and stored with its preview verdict; the operator reviews
one card on /approvals (per-step overrides included). Approved steps become
single-use, act-or-goal-bound, TTL-bound grants: when the agent later
performs a matching action that evaluates to `require_approval`, the grant
is consumed atomically and the decision downgrades to `allow` with
`builtin:plan_grant` provenance. Explicitly denied steps are raised to
`block` on match for the plan's TTL. A plan grant never downgrades `block`,
nothing auto-approves, and revocation (`POST /api/plans/:id` verdict
`revoke`) is instant — the consumption path is uncached.
```

- [ ] **Step 5: Verify:** `npm run surface:check && node scripts/check-doc-counts.mjs --strict && npm run version:sync:check` — all green.
- [ ] **Step 6: Commit** — `git commit -m "docs(plans): surface-budget amendment + count realignment + runtime-api section"`

---

### Task 11: policy-smoke live section AF + full gates

**Files:**
- Modify: `scripts/policy-smoke.mjs` (new section AF before the cleanup block)

- [ ] **Step 1: Add section AF** (inline block before `cleanup`, using the file's `api`/`check`/`agentFor` helpers):

```js
  // ---------------------------------------------------------------- AF ----
  // Preflight plan authorization (governed-autonomy feature 1). Live proof:
  // submit -> approve -> a matching guarded call consumes the grant (allow)
  // -> the identical second call interrupts again (single-use proven live).
  console.log('\nAF. preflight plan authorization...');
  {
    const agent = agentFor('plan');
    const goal = `plan-smoke deploy ${RUN}`;
    // A high-risk action_type that reliably lands require_approval under the
    // Production Safety template: risk_score 90 + action_type deploy.
    const submit = await api('POST', '/api/plans', {
      agent_id: agent,
      declared_goal: `plan-smoke mission ${RUN}`,
      ttl_minutes: 10,
      steps: [{ action_type: 'deploy', step_goal: goal }],
    });
    check('AF1', 'plan submits with a preview verdict on the step',
      submit.status === 201 && submit.json?.plan?.plan_id?.startsWith('pa_')
        && typeof submit.json?.steps?.[0]?.preview_decision === 'string',
      `status=${submit.status} preview=${submit.json?.steps?.[0]?.preview_decision}`);

    const planId = submit.json?.plan?.plan_id;
    const approve = await api('POST', `/api/plans/${planId}`, { verdict: 'approve' });
    check('AF2', 'operator approves the plan (expires_at set)',
      approve.status === 200 && approve.json?.plan?.status === 'approved' && !!approve.json?.plan?.expires_at,
      `status=${approve.status} plan=${approve.json?.plan?.status}`);

    const first = await api('POST', '/api/guard', {
      agent_id: agent, action_type: 'deploy', declared_goal: goal, risk_score: 90,
    });
    check('AF3', 'matching call consumes the plan grant (allow + builtin:plan_grant)',
      first.json?.decision === 'allow'
        && JSON.stringify(first.json?.matched_policies || []).includes('builtin:plan_grant'),
      `decision=${first.json?.decision} matched=${JSON.stringify(first.json?.matched_policies)}`);

    const second = await api('POST', '/api/guard', {
      agent_id: agent, action_type: 'deploy', declared_goal: goal, risk_score: 90,
    });
    check('AF4', 'identical second call interrupts again (grant was single-use)',
      second.json?.decision === 'require_approval',
      `decision=${second.json?.decision}`);

    const revoked = await api('POST', `/api/plans/${planId}`, { verdict: 'revoke' });
    check('AF5', 'revoke kills the plan',
      revoked.status === 200 && revoked.json?.plan?.status === 'revoked',
      `status=${revoked.status} plan=${revoked.json?.plan?.status}`);
  }
```

CAVEAT for the implementer: AF3 requires the smoke org to actually land `require_approval` for `deploy` at risk 90 — the smoke harness runs against a live instance with the Production Safety template. Read section-A/B of the file to see how existing sections force a require_approval (they may create a temporary policy; if so, copy that pattern: create policy → run the pair → delete policy in cleanup). The section MUST be self-contained and leave no policy residue (register created policy ids in the file's cleanup list). Also note the smoke agent id uses the `smoke-` prefix → synthetic-excluded from analytics, which is correct and intentional.

- [ ] **Step 2: Live-prove it:** kill anything on :3000 first (smoke/dev conflict memory), then `npx next build && npx next start -p 3000` with `.env.local`, run `node scripts/policy-smoke.mjs`, and READ the AF section output — all five checks PASS.
- [ ] **Step 3: Full gates:** `npm run lint && npx vitest run && npx next build && npm run typecheck && npm run db:migrate` (second run idempotent) `&& node scripts/check-doc-counts.mjs --strict && npm run surface:check`. ALL green, output read, before any push.
- [ ] **Step 4: Commit** — `git commit -m "test(plans): policy-smoke AF — live single-use plan grant proof"`

---

### Task 12: Plugin capability mirrors + ship

- [ ] **Step 1: Plugin parity.** The hand-authored source is `public/downloads/dashclaw-governance/SKILL.md` (governance skill) — add a short "Preflight plans" section teaching the protocol (submit → wait_for_plan_review → execute; off-plan actions govern normally). Then `npm run bundles:refresh` regenerates `plugins/dashclaw/` mirrors and zips (pre-commit does this too when hooks/ or the skill source change). Do NOT hand-edit `plugins/dashclaw/`.
- [ ] **Step 2: HUMAN-EXPERIENCE answers in the ship summary** (required): SEE = /approvals Plan review card; DISCOVERABLE = arrives in the inbox the operator already watches (realtime); CLICKS = approve/deny/revoke/per-step toggles are buttons, zero terminal; RENDERED PROOF = Task 9 Step 5 frontend-verify run.
- [ ] **Step 3: Run the `dashclaw-preship-sweep` skill** (gates + drift audit + security review in parallel). The diff touches the guard hot path and grant semantics — the security pass is not optional.
- [ ] **Step 4: Run the `dashclaw-ship` skill** — version bump (minor: new feature ⇒ 5.4.0), CHANGELOG, maintainer log, marketing blurb, GitHub release, push. SDK publish (`npm run release:sdks`) is Wes's credential-gated tail — flag it, never attempt.

## Self-review notes (already applied)

- RFC's `/mission-control` mentions dropped — page was culled in v5.0.0; the invariant (visible where the operator already looks) is satisfied by /approvals + realtime. Recorded as a deliberate narrowing in the ship summary.
- RFC's Telegram/Discord plan-summary bridge deferred (open question 2 leaned dashboard-only anyway); v1 notification = realtime inbox update via publishOrgEvent. Recorded in ship summary.
- RFC open question 1 resolved: `/api/policies/simulate` is single-policy-vs-history only → `GuardOptions.simulate` added (Task 3).
- RFC open question 3 resolved: deny-check lives inside `applyPlanStepGrant` at the grants slot — it must run on any non-block decision (an operator "no" outranks a policy "allow"), which the 933-line sync override slot cannot do (needs a DB read). Block-override ordering semantics preserved: `applyBlockOverride` is still the raise mechanism.
- Route-file count is +2 (not the RFC's "+4 endpoints" — two files carry four handlers); budget numbers above are the file counts the gate measures.
