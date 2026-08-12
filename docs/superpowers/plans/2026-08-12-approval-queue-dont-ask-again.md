# "Allow, don't ask again" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the approval queue a third button that approves an action, writes a target-scoped expiring `allow_grant`, and releases the already-pending actions that match it.

**Architecture:** The `allow_grant` engine already exists and is hardened. This plan adds (a) an enforcement risk ceiling to `applyAllowGrants`, (b) one route that mints a grant from an action id and returns the ids it covers, (c) card UI that fans the release out over the existing per-item approval route via `bulkAction`, and (d) a revoke strip. No new table, no migration.

**Tech Stack:** Next.js 16 App Router, TypeScript, Postgres via repositories, vitest, Tailwind tokens.

**Spec:** `docs/superpowers/specs/2026-08-12-approval-queue-dont-ask-again-design.md`

## Global Constraints

- No direct SQL in `app/api/**/route.ts` — go through repositories. `npm run route-sql:check` blocks increases.
- No hardcoded hex. Use the CSS tokens in `app/globals.css`.
- No hardcoded version numbers. `npm run version:check` fails the build.
- Risk ceiling constant is `RISK_HIGH_MIN` from `app/lib/riskThresholds.ts` (70). Do not introduce a second number.
- Grant TTL menu values in hours: `1 | 24 | 168 | 720`. Default `24`.
- Every changed `.ts` file requires `npm run typecheck` before push.
- Pages under test must stay `.jsx`/`.tsx` per repo test conventions.

## File Structure

| File | Responsibility |
| --- | --- |
| `app/lib/policy-shapes.ts` | Add `GRANT_DEFAULT_MAX_RISK`, `grantMaxRisk()`, `grantCoversRisk()`. Single source for the ceiling predicate. |
| `app/lib/guard/evaluate.ts` | `applyAllowGrants` takes the risk score and honors the ceiling. One function, ~6 lines changed. |
| `app/api/policies/review/verdict/route.ts` | Stamp `max_risk` on grants minted by the `/policies` inbox. |
| `app/api/approvals/[actionId]/grant/route.ts` | **New.** Mint a grant from an action id; return the pending ids it covers. |
| `app/lib/repositories/actions.repository.ts` | **New fn** `listPendingApprovalsForGrant` — pending rows with the fields needed to shape-match. |
| `app/approvals/_components/DontAskAgainPanel.tsx` | **New.** The inline scope + TTL + confirm panel. |
| `app/approvals/_components/ActiveGrantsStrip.tsx` | **New.** "Things you told me to stop asking about" + Revoke. |
| `app/approvals/page.tsx` | Third button, panel wiring, strip mount, `handleGrant`. |

---

### Task 1: Ceiling predicate in `policy-shapes.ts`

**Files:**
- Modify: `app/lib/policy-shapes.ts`
- Test: `__tests__/unit/policy-shapes.test.ts`

**Interfaces:**
- Produces: `GRANT_DEFAULT_MAX_RISK: number`, `grantMaxRisk(rules): number`, `grantCoversRisk(rules, riskScore): boolean`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/unit/policy-shapes.test.ts`:

```ts
import { grantMaxRisk, grantCoversRisk, GRANT_DEFAULT_MAX_RISK } from '../../app/lib/policy-shapes';
import { RISK_HIGH_MIN } from '../../app/lib/riskThresholds';

describe('grant risk ceiling', () => {
  it('defaults a grant with no max_risk to RISK_HIGH_MIN', () => {
    expect(GRANT_DEFAULT_MAX_RISK).toBe(RISK_HIGH_MIN);
    expect(grantMaxRisk({})).toBe(RISK_HIGH_MIN);
  });

  it('honors an explicit max_risk', () => {
    expect(grantMaxRisk({ max_risk: 40 })).toBe(40);
  });

  it('ignores a non-numeric or out-of-range max_risk', () => {
    expect(grantMaxRisk({ max_risk: 'high' })).toBe(RISK_HIGH_MIN);
    expect(grantMaxRisk({ max_risk: -5 })).toBe(RISK_HIGH_MIN);
    expect(grantMaxRisk({ max_risk: 500 })).toBe(RISK_HIGH_MIN);
  });

  it('covers below the ceiling and stops at it', () => {
    expect(grantCoversRisk({}, 69)).toBe(true);
    expect(grantCoversRisk({}, 70)).toBe(false);
    expect(grantCoversRisk({}, 90)).toBe(false);
  });

  it('treats a missing/NaN risk score as 0 (covered)', () => {
    expect(grantCoversRisk({}, null as unknown as number)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- __tests__/unit/policy-shapes.test.ts`
Expected: FAIL — `grantMaxRisk is not a function`.

- [ ] **Step 3: Implement**

Add to `app/lib/policy-shapes.ts`, next to `GRANT_DEFAULT_TTL_DAYS`:

```ts
import { RISK_HIGH_MIN } from './riskThresholds';

/**
 * Default risk ceiling for a grant with no explicit rules.max_risk.
 *
 * Missing means RISK_HIGH_MIN, NOT unlimited. Grants created before the
 * ceiling existed (including every one minted by the /policies review inbox)
 * would otherwise keep downgrading require_approval at ANY risk for the rest
 * of their TTL — the exact hole the ceiling exists to close, left open
 * indefinitely because nothing ever rewrites an old grant's rules.
 *
 * This TIGHTENS existing grants. That is the intended, safe direction, and it
 * is bounded: grants are target-scoped and every legacy one ages out within
 * GRANT_DEFAULT_TTL_DAYS of its created_at.
 */
export const GRANT_DEFAULT_MAX_RISK = RISK_HIGH_MIN;

/** A grant's risk ceiling. Anything not a sane 0-100 number falls back. */
export function grantMaxRisk(rules: { max_risk?: unknown }): number {
  const n = Number(rules?.max_risk);
  if (!Number.isFinite(n) || n < 0 || n > 100) return GRANT_DEFAULT_MAX_RISK;
  return n;
}

/** Does this grant reach an action scored `riskScore`? Ceiling is exclusive. */
export function grantCoversRisk(rules: { max_risk?: unknown }, riskScore: number): boolean {
  return (Number(riskScore) || 0) < grantMaxRisk(rules);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- __tests__/unit/policy-shapes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/policy-shapes.ts __tests__/unit/policy-shapes.test.ts
git commit -m "feat(grants): add risk-ceiling predicate for allow_grant rules"
```

---

### Task 2: Enforce the ceiling in `applyAllowGrants`

**Files:**
- Modify: `app/lib/guard/evaluate.ts` (function at ~line 297, call site ~line 1117)
- Test: `__tests__/unit/guard-allow-grant.test.ts`

**Interfaces:**
- Consumes: `grantCoversRisk`, `grantMaxRisk` from Task 1
- Produces: `applyAllowGrants(policies, context, acc, riskScore: number)`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/unit/guard-allow-grant.test.ts`, matching the fixture style already in that file:

```ts
describe('allow_grant risk ceiling', () => {
  it('downgrades below the ceiling', async () => {
    const res = await evaluateWithGrant({ target_prefix: 'api.stripe.com' }, 69);
    expect(res.decision).toBe('allow');
  });

  it('does NOT downgrade at or above the ceiling', async () => {
    const res = await evaluateWithGrant({ target_prefix: 'api.stripe.com' }, 70);
    expect(res.decision).toBe('require_approval');
  });

  it('explains itself when it declines', async () => {
    const res = await evaluateWithGrant({ target_prefix: 'api.stripe.com' }, 90);
    expect(res.warnings.join(' ')).toMatch(/does not cover risk 90 \(ceiling 70\)/);
  });

  it('honors an explicit lower ceiling', async () => {
    const res = await evaluateWithGrant({ target_prefix: 'api.stripe.com', max_risk: 30 }, 45);
    expect(res.decision).toBe('require_approval');
  });
});
```

Use the file's existing helper for building a grant policy + context; if it has none, add `evaluateWithGrant(rules, riskScore)` that wraps the same setup the neighbouring tests already perform.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- __tests__/unit/guard-allow-grant.test.ts`
Expected: FAIL — grants downgrade at 70 and 90 today.

- [ ] **Step 3: Implement**

In `app/lib/guard/evaluate.ts`, extend the import on line 13:

```ts
import { grantMatches, grantIsExpired, grantCoversRisk, grantMaxRisk } from '../policy-shapes';
```

Change the signature and add the ceiling check inside the match branch:

```ts
function applyAllowGrants(
  policies: PolicyRow[],
  context: GuardEvalContext,
  acc: GuardAccumulator,
  riskScore: number,
): void {
```

Inside the loop, replace the `if (grantMatches(...))` body with:

```ts
    if (grantMatches(rules as { action_type?: unknown; target_prefix?: unknown }, context)) {
      // Risk ceiling: the UI only offers "don't ask again" below RISK_HIGH_MIN,
      // but without this the resulting grant would downgrade a matching action
      // at ANY score for its whole TTL. The skip is announced rather than
      // silent — otherwise the operator reads it as "my grant stopped working"
      // with nothing in the decision record to explain why.
      if (!grantCoversRisk(rules, riskScore)) {
        acc.warnings.push(`${policy.name}: grant does not cover risk ${riskScore} (ceiling ${grantMaxRisk(rules)})`);
        continue;
      }
      acc.warnings.push(`${policy.name}: grant downgraded ${acc.highestDecision} to allow`);
      acc.matchedPolicies.push(policy.id);
      acc.highestDecision = 'allow';
      acc.reasons.length = 0; // gating reasons no longer apply
      return;
    }
```

Note `continue`, not `return`: a later, lower-risk-scoped grant must still get its chance to match.

Update the call site (~line 1117):

```ts
    applyAllowGrants(policies, context, liveAcc, adjustedRiskScore);
```

- [ ] **Step 4: Run the grant tests, then the whole guard suite**

```bash
npm test -- __tests__/unit/guard-allow-grant.test.ts
npm test -- __tests__/unit/guard-containment-promotion.test.js __tests__/unit/inert-policies.test.ts
```

Expected: PASS. Any other test that asserted a downgrade at risk ≥ 70 fails **by design** — re-read each one individually. A test meaning "grants downgrade" keeps its intent at a lower score; a test meaning "grants downgrade anything" is the bug being closed and gets inverted. Do not bulk-edit.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add app/lib/guard/evaluate.ts __tests__/unit/guard-allow-grant.test.ts
git commit -m "feat(guard): allow_grant honors a risk ceiling"
```

---

### Task 3: Stamp `max_risk` on `/policies`-minted grants

**Files:**
- Modify: `app/api/policies/review/verdict/route.ts` (~line 142)
- Test: `__tests__/unit/policies-review.route.test.ts`

**Interfaces:**
- Consumes: `GRANT_DEFAULT_MAX_RISK` from Task 1

- [ ] **Step 1: Write the failing test**

```ts
it('stamps max_risk on an always_allow grant', async () => {
  const res = await postVerdict({ verdict: 'always_allow', shape: { action_type: 'api', target_prefix: 'api.stripe.com' } });
  expect(res.status).toBe(201);
  const rules = JSON.parse(res.body.policy.rules);
  expect(rules.max_risk).toBe(70);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- __tests__/unit/policies-review.route.test.ts`
Expected: FAIL — `max_risk` is `undefined`.

- [ ] **Step 3: Implement**

Extend the import from `policy-shapes` in that route to include `GRANT_DEFAULT_MAX_RISK`, then add one line to the `rules` object:

```ts
        rules: JSON.stringify({
          action_type: shape.action_type,
          target_prefix: prefix,
          // TTL from birth (F1): grants are leases, not permanent law.
          expires_at: new Date(Date.now() + GRANT_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
          // Risk ceiling from birth: both grant-minting surfaces stamp it, so
          // the enforcement default never has to guess for a new grant.
          max_risk: GRANT_DEFAULT_MAX_RISK,
          _grant: true,
        }),
```

- [ ] **Step 4: Run tests**

Run: `npm test -- __tests__/unit/policies-review.route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/policies/review/verdict/route.ts __tests__/unit/policies-review.route.test.ts
git commit -m "feat(grants): stamp max_risk on grants minted from /policies"
```

---

### Task 4: Repository — pending rows for shape matching

**Files:**
- Modify: `app/lib/repositories/actions.repository.ts` (next to `listPendingApprovalIdsByActionTypes`, ~line 2417)

**Interfaces:**
- Produces:
```ts
export async function listPendingApprovalsForGrant(
  sql: SqlClient, orgId: string, actionType: string, limit?: number,
): Promise<Array<{ action_id: string; action_type: string; risk_score: number; context: string | null; guard_decision_id: string | null }>>
```

- [ ] **Step 1: Implement**

```ts
/**
 * Pending approvals of one action_type, with the fields a grant needs to decide
 * coverage: the context (target + write_paths) and the risk score.
 *
 * action_type is filtered in SQL; shape and ceiling matching happen in JS via
 * the SAME predicates the guard uses (grantMatches / grantCoversRisk), so the
 * queue and the guard can never disagree about what a grant covers.
 *
 * Overdue rows are excluded on the same predicate as
 * listPendingApprovalIdsByActionTypes: a sweep must never "approve" an approval
 * whose client already stopped waiting (roadmap v2.3).
 */
export async function listPendingApprovalsForGrant(
  sql: SqlClient,
  orgId: string,
  actionType: string,
  limit = 200,
): Promise<Array<{ action_id: string; action_type: string; risk_score: number; context: string | null; guard_decision_id: string | null }>> {
  if (!actionType) return [];
  const rows = await sql.query(
    `SELECT action_id, action_type, risk_score, context, guard_decision_id
     FROM action_records
     WHERE org_id = $1 AND status = 'pending_approval'
       AND action_type = $2
       AND (approval_expires_at >= NOW()
            OR (approval_expires_at IS NULL AND created_at >= NOW() - interval '24 hours'))
     ORDER BY created_at ASC
     LIMIT $3`,
    [orgId, actionType, Math.min(Math.max(1, limit), 200)],
  );
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    action_id: String(r.action_id),
    action_type: String(r.action_type),
    risk_score: Number(r.risk_score) || 0,
    context: r.context == null ? null : String(r.context),
    guard_decision_id: r.guard_decision_id == null ? null : String(r.guard_decision_id),
  }));
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npm run typecheck
git add app/lib/repositories/actions.repository.ts
git commit -m "feat(repo): list pending approvals for grant coverage matching"
```

---

### Task 5: The grant route

**Files:**
- Create: `app/api/approvals/[actionId]/grant/route.ts`
- Test: `__tests__/unit/approvals-grant-route.test.ts`

**Interfaces:**
- Consumes: Task 1 predicates, Task 4 repository fn
- Produces: `POST /api/approvals/[actionId]/grant`
  - body `{ ttl_hours: 1 | 24 | 168 | 720 }`
  - `201 { ok: true, policy, release_ids: string[] }` — `release_ids[0]` is always this action
  - `400 UNSCOPED_GRANT_REJECTED`, `403 GRANT_RISK_CEILING`, `403 GRANT_REFUSED_BY_POLICY`, `404`, `410 APPROVAL_EXPIRED`

- [ ] **Step 1: Write the failing tests**

```ts
describe('POST /api/approvals/[actionId]/grant', () => {
  it('rejects a non-admin', async () => expect((await post({ role: 'member' })).status).toBe(403));
  it('rejects an unscoped shape', async () => {
    const res = await post({ action: { action_type: 'other', context: '{}' } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNSCOPED_GRANT_REJECTED');
  });
  it('rejects at the risk ceiling', async () => {
    const res = await post({ action: { risk_score: 70 } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('GRANT_RISK_CEILING');
  });
  it('rejects when a gating policy is ungrantable', async () => {
    const res = await post({ gatingUngrantable: true });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('GRANT_REFUSED_BY_POLICY');
  });
  it('rejects an invalid ttl', async () => expect((await post({ body: { ttl_hours: 5 } })).status).toBe(400));
  it('mints the grant and returns this action first', async () => {
    const res = await post({});
    expect(res.status).toBe(201);
    const rules = JSON.parse(res.body.policy.rules);
    expect(rules.max_risk).toBe(70);
    expect(rules.target_prefix).toBeTruthy();
    expect(new Date(rules.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(res.body.release_ids[0]).toBe('act_self');
  });
  it('includes a matching sibling and excludes an above-ceiling one', async () => {
    const res = await post({ siblings: [
      { action_id: 'act_match', risk_score: 20 },
      { action_id: 'act_hot', risk_score: 95 },
    ] });
    expect(res.body.release_ids).toContain('act_match');
    expect(res.body.release_ids).not.toContain('act_hot');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- __tests__/unit/approvals-grant-route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

```ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse, after } from 'next/server';
import { randomUUID } from 'crypto';
import { getSql } from '../../../../lib/db';
import { getOrgId, getOrgRole, getUserId } from '../../../../lib/org';
import { logActivity } from '../../../../lib/audit';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import {
  getActionSummary,
  listPendingApprovalsForGrant,
} from '../../../../lib/repositories/actions.repository';
import { getActivePolicies, insertPolicy, findPolicyByName } from '../../../../lib/repositories/guardrails.repository';
import {
  extractDecisionShape,
  shapeIsGrantable,
  grantMatches,
  grantCoversRisk,
  GRANT_DEFAULT_MAX_RISK,
} from '../../../../lib/policy-shapes';
import { RISK_HIGH_MIN } from '../../../../lib/riskThresholds';

const ALLOWED_TTL_HOURS = [1, 24, 168, 720];

/**
 * POST /api/approvals/[actionId]/grant — mint an allow_grant from an approval
 * card and report which pending approvals it covers.
 *
 * This route does NOT approve anything. The caller fans the returned
 * release_ids out over the existing per-item POST /api/approvals/[actionId],
 * the same way bulk approve already does (app/lib/bulkAction.ts). That keeps
 * one approval path with one audit / webhook / calibration chain, instead of a
 * second copy of it here that would drift.
 */
export async function POST(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const { actionId } = await params;
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'Grants require an attributable principal', code: 'APPROVER_IDENTITY_REQUIRED' },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const ttlHours = Number((body as { ttl_hours?: unknown }).ttl_hours ?? 24);
    if (!ALLOWED_TTL_HOURS.includes(ttlHours)) {
      return NextResponse.json(
        { error: `ttl_hours must be one of ${ALLOWED_TTL_HOURS.join(', ')}`, code: 'INVALID_TTL' },
        { status: 400 },
      );
    }

    const sql = getSql();
    const action = await getActionSummary(sql, orgId, actionId);
    if (!action) return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    if (action.status !== 'pending_approval') {
      return NextResponse.json({ error: 'Action is not pending approval' }, { status: 400 });
    }

    const riskScore = Number(action.risk_score) || 0;
    if (riskScore >= RISK_HIGH_MIN) {
      return NextResponse.json({
        error: `This action scored ${riskScore}. Actions at or above ${RISK_HIGH_MIN} need a human decision every time and cannot be granted away. To change that, loosen the rule on /policies.`,
        code: 'GRANT_RISK_CEILING',
      }, { status: 403 });
    }

    const shape = extractDecisionShape(action as { action_type?: unknown; context?: unknown });
    if (!shapeIsGrantable(shape.target_prefix)) {
      return NextResponse.json({
        error: `"${shape.label}" has no target scope — an unscoped grant would blanket-allow every "${shape.action_type}" action and silently disable any approval rule covering it. Review the individual actions instead.`,
        code: 'UNSCOPED_GRANT_REJECTED',
      }, { status: 400 });
    }

    // Ungrantable gate: mirrors applyAllowGrants. A rule the operator marked
    // ungrantable is never cleared by a grant, so offering to mint one here
    // would sell an authorization the guard will refuse to honor.
    const policies = await getActivePolicies(sql, orgId);
    const ungrantable = policies.find((p: { policy_type?: string; rules?: string; name?: string }) => {
      if (p.policy_type === 'allow_grant') return false;
      try { return JSON.parse(p.rules || '{}').ungrantable === true; } catch { return false; }
    });
    const matchedPolicyIds = new Set(
      (() => { try { return JSON.parse(String(action.matched_policies ?? '[]')) as string[]; } catch { return []; } })(),
    );
    if (ungrantable && matchedPolicyIds.has((ungrantable as { id: string }).id)) {
      return NextResponse.json({
        error: `"${(ungrantable as { name: string }).name}" is marked ungrantable — grants cannot clear it. This one always needs a human.`,
        code: 'GRANT_REFUSED_BY_POLICY',
      }, { status: 403 });
    }

    const rules = {
      action_type: shape.action_type,
      target_prefix: shape.target_prefix,
      expires_at: new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString(),
      max_risk: GRANT_DEFAULT_MAX_RISK,
      _grant: true,
    };

    const name = `[Grant] ${shape.label}`;
    const existing = await findPolicyByName(sql, orgId, name);
    const policy = existing
      ? await reviveGrant(sql, orgId, (existing as { id: string }).id, JSON.stringify(rules))
      : await insertPolicy(sql, orgId, {
          id: `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
          name,
          policyType: 'allow_grant',
          rules: JSON.stringify(rules),
        });

    // Coverage: same predicates the guard uses, so the queue can never claim
    // to release something enforcement would have re-interrupted.
    const siblings = await listPendingApprovalsForGrant(sql, orgId, shape.action_type);
    const releaseIds = [actionId, ...siblings
      .filter((s) => s.action_id !== actionId)
      .filter((s) => grantCoversRisk(rules, s.risk_score))
      .filter((s) => {
        let ctx: Record<string, unknown> = {};
        try { ctx = JSON.parse(s.context || '{}'); } catch { ctx = {}; }
        return grantMatches(rules, { ...ctx, action_type: s.action_type });
      })
      .map((s) => s.action_id)];

    after(() => logActivity({
      orgId, actorId: userId, action: 'policy.grant_created',
      resourceType: 'policy', resourceId: (policy as { id: string })?.id,
      details: { from_action: actionId, shape: shape.key, ttl_hours: ttlHours, covers: releaseIds.length },
      request,
    }, sql));

    return NextResponse.json({ ok: true, policy, release_ids: releaseIds }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, 'APPROVAL GRANT POST');
  }
}
```

If `findPolicyByName` + a revive helper is awkward, lift `insertOrRevivePolicy` out of `app/api/policies/review/verdict/route.ts` into `app/lib/repositories/guardrails.repository.ts` and import it from both routes — do not copy it.

- [ ] **Step 4: Run tests + the SQL gate**

```bash
npm test -- __tests__/unit/approvals-grant-route.test.ts
npm run route-sql:check
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add app/api/approvals/[actionId]/grant/route.ts __tests__/unit/approvals-grant-route.test.ts
git commit -m "feat(approvals): mint a scoped allow_grant from an approval card"
```

---

### Task 6: The card button and panel

**Files:**
- Create: `app/approvals/_components/DontAskAgainPanel.tsx`
- Modify: `app/approvals/page.tsx` (actions panel ~line 617; handlers ~line 237)
- Test: `__tests__/unit/approvals-dont-ask-again.test.jsx`

**Interfaces:**
- Consumes: Task 5 route
- Produces: `<DontAskAgainPanel action ttlHours onTtlChange onConfirm onCancel matchCount busy />`

- [ ] **Step 1: Write the failing component tests**

```jsx
it('hides the button at or above the risk ceiling', () => {
  render(<ApprovalsPage />); // fixture: one action at risk 85
  expect(screen.queryByRole('button', { name: /don't ask again/i })).toBeNull();
  expect(screen.getByText(/needs a human every time/i)).toBeInTheDocument();
});

it('shows the button below the ceiling and opens the panel', async () => {
  render(<ApprovalsPage />); // fixture: one action at risk 65
  await userEvent.click(screen.getByRole('button', { name: /don't ask again/i }));
  expect(screen.getByText(/stop asking about/i)).toBeInTheDocument();
});

it('names the blast radius on the confirm button', async () => {
  // fixture: two identical pending apply actions
  await userEvent.click(screen.getAllByRole('button', { name: /don't ask again/i })[0]);
  expect(screen.getByRole('button', { name: /allow all 2/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- __tests__/unit/approvals-dont-ask-again.test.jsx`

- [ ] **Step 3: Implement the panel**

`DontAskAgainPanel.tsx` renders the scope line (read-only — scope is server-derived, the panel only displays it), the TTL `<select>` (1h / 24h / 7d / 30d, default 24), the match warning when `matchCount > 1`, and Cancel / confirm. Confirm label is `Allow` when `matchCount === 1`, `Allow all {matchCount}` otherwise. Use `border-border`, `bg-surface-tertiary`, `text-secondary` tokens — no hex.

In `page.tsx` add `handleGrant`, which reuses the existing fan-out:

```tsx
  const handleGrant = async (actionId: string, ttlHours: number) => {
    try {
      setProcessingId(actionId);
      setBulkFailure(null);
      const res = await fetch(`/api/approvals/${actionId}/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl_hours: ttlHours }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to create grant');
      // Release over the SAME per-item approval route bulk approve uses, so
      // each released action keeps its full audit / webhook / calibration
      // chain instead of a second, drifting copy inside the grant route.
      const { ok, failed } = await bulkAction(json.release_ids || [actionId], (id) =>
        fetch(`/api/approvals/${id}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'allow' }),
        })
      );
      if (failed.length > 0) setBulkFailure({ verb: 'approve', ok: ok.length, failed: failed.length });
      setGrantingId(null);
      await fetchPending();
      await fetchGrants();
    } catch (err: any) {
      alert(`Couldn't stop the interruptions: ${err.message}`);
    } finally {
      setProcessingId(null);
    }
  };
```

Add the third button between Allow and Deny, gated on the ceiling:

```tsx
{action.risk_score < RISK_HIGH_MIN ? (
  <button
    onClick={() => setGrantingId(grantingId === action.action_id ? null : action.action_id)}
    disabled={!canDecide || isProcessing}
    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-surface-tertiary px-4 py-2.5 text-sm font-semibold text-secondary transition-colors hover:border-success/40 hover:text-success focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
  >
    <BellOff size={16} /> Don&apos;t ask again
  </button>
) : (
  <div className="flex-1 rounded-lg border border-border/60 px-3 py-2 text-center text-[11px] leading-snug text-tertiary">
    Needs a human every time
  </div>
)}
```

The `matchCount` passed to the panel is computed client-side from `pendingActions` with `extractDecisionShape` + `grantCoversRisk`; the server number in `release_ids` is authoritative and wins on confirm.

- [ ] **Step 4: Run tests**

Run: `npm test -- __tests__/unit/approvals-dont-ask-again.test.jsx`

- [ ] **Step 5: Commit**

```bash
git add app/approvals/_components/DontAskAgainPanel.tsx app/approvals/page.tsx __tests__/unit/approvals-dont-ask-again.test.jsx
git commit -m "feat(approvals): add the don't-ask-again button and scope panel"
```

---

### Task 7: Active grants strip with revoke

**Files:**
- Create: `app/approvals/_components/ActiveGrantsStrip.tsx`
- Modify: `app/approvals/page.tsx`
- Test: `__tests__/unit/approvals-grants-strip.test.jsx`

**Interfaces:**
- Consumes: `GET /api/policies` (existing), `PATCH /api/policies` `{ id, active: false }` (existing). No new route.

- [ ] **Step 1: Write the failing tests**

```jsx
it('renders nothing when there are no active grants', () => { /* expect(container).toBeEmptyDOMElement() */ });
it('lists a grant with its remaining time and a revoke button', () => { /* 23h left, Revoke */ });
it('hides an expired grant', () => { /* expires_at in the past → not rendered */ });
it('revokes via PATCH and drops the row', async () => { /* assert fetch called with active:false */ });
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- __tests__/unit/approvals-grants-strip.test.jsx`

- [ ] **Step 3: Implement**

`fetchGrants()` in `page.tsx` GETs `/api/policies`, keeps `policy_type === 'allow_grant' && active`, drops expired via `grantIsExpired(rules, created_at)`, and passes them to the strip. The strip renders one row per grant: shape label, remaining time, `Revoke`. Revoke PATCHes `{ id, active: false }` then calls `onRevoked()`. Returns `null` when the list is empty.

- [ ] **Step 4: Run tests**

Run: `npm test -- __tests__/unit/approvals-grants-strip.test.jsx`

- [ ] **Step 5: Commit**

```bash
git add app/approvals/_components/ActiveGrantsStrip.tsx app/approvals/page.tsx __tests__/unit/approvals-grants-strip.test.jsx
git commit -m "feat(approvals): show and revoke active grants on the queue"
```

---

### Task 8: Demo route, docs, CHANGELOG

**Files:**
- Modify: `app/lib/demo/demoMiddleware.ts` (demo dispatch entry for the new route)
- Modify: `README.md`, `PROJECT_DETAILS.md` if route counts move
- Modify: `CHANGELOG.md`
- Modify: `docs/maintainer-log.md`

- [ ] **Step 1: Add the demo dispatch entry**

A new API route with no demo entry 403s blank in demo mode. Add `/api/approvals/[actionId]/grant` alongside the existing approvals entries.

- [ ] **Step 2: Regenerate derived artifacts**

```bash
npm run api:inventory
npm run openapi:generate
npm run doc:counts:fix
```

- [ ] **Step 3: Write the CHANGELOG entry**

Under a **Changed (behavior)** heading, not just Added:

```md
### Changed
- **Grants now have a risk ceiling.** An `allow_grant` no longer downgrades
  `require_approval` at any risk score. New grants are stamped `max_risk: 70`;
  a grant without one now defaults to 70 instead of unlimited. This TIGHTENS
  existing grants — an action scoring 70+ that a grant previously covered will
  interrupt a human again. Grants remain target-scoped and expiring.

### Added
- **"Allow, don't ask again"** on every approval card below risk 70. Approves the
  action, writes a target-scoped grant (default 24h), and releases the pending
  approvals it covers. Active grants list at the top of `/approvals` with
  one-click revoke.
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: record the grant risk ceiling and the don't-ask-again surface"
```

---

### Task 9: Gates and rendered proof

- [ ] **Step 1: Full gates**

```bash
npm run lint
npm run typecheck
npx vitest run --maxWorkers=2
npx next build
```

Read the output. `--maxWorkers=2` avoids the known vitest OOM.

- [ ] **Step 2: Rendered proof**

Drive `/approvals` and confirm, with eyes on the page: the third button renders below 70 and is replaced above it; the panel opens and shows the scope; the confirm label carries the count; the queue shrinks by that count; the grants strip appears and Revoke clears it.

API tests prove the data exists. Only a rendered page proves a human can use it.

- [ ] **Step 3: Ship**

Run the `dashclaw-ship` skill.

---

## Self-Review

**Spec coverage:** §1 button → Task 6. §2 scope → Task 5 (server-derived) + Task 6 (display). §3 TTL → Tasks 5, 6. §4 guardrails → Tasks 5, 6. §5 sweep → Tasks 4, 5. §6 revoke → Task 7. §7 API → Task 5. §8 ceiling → Tasks 1, 2, 3. Testing → every task + Task 9. Demo route → Task 8.

**Type consistency:** `grantCoversRisk(rules, riskScore)` and `grantMaxRisk(rules)` are used with identical signatures in Tasks 1, 2, 5. `release_ids` is the response field in Task 5 and the consumed field in Task 6. `listPendingApprovalsForGrant` returns the shape Task 5 destructures.

**Known judgment call:** Task 5 returns ids and lets the client fan out rather than approving server-side. The alternative — reimplementing the ~200-line side-effect chain in `app/api/approvals/[actionId]/route.ts` — would duplicate audit, events, notification clearing, calibration ingest, and webhook dispatch, and drift. Fanning out over the existing route is the pattern bulk approve already uses.
