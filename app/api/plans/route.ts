export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Preflight Plan Authorization (docs/rfcs/2026-07-06-preflight-plan-authorization.md).
// POST submits a plan of steps and dry-runs each through the real guard
// pipeline (simulate:true — side-effect-free, no persistence, no grant
// consumption) so the operator reviews a genuine preview verdict. GET lists
// plans for the /plans review surface.

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId, getUserId } from '../../lib/org';
import { apiErrorResponse } from '../../lib/apiErrors';
import { EVENTS, publishOrgEvent } from '../../lib/events';
import { resolveAgentIdentity } from '../../lib/identity-resolution';
import { evaluateGuard } from '../../lib/guard';
import { getSettings } from '../../lib/repositories/settings.repository';
import {
  createPlanWithSteps, stampStepPreview, listPlans, countPendingPlans, markPlanPending, reviewPlan,
} from '../../lib/repositories/plans.repository';

const DEFAULT_MAX_STEPS = 25;
const MAX_PENDING_PLANS = 10;
// U5: same hard ceiling as DEFAULT_TTL_CLAMP_MINUTES in
// app/api/plans/[planId]/route.ts — ttl_minutes is stored in an int4 column
// and also bounds a grant's live window, so an unclamped value (e.g. 3e9)
// must never reach the DB or become the org's effective grant lifetime.
const DEFAULT_TTL_CLAMP = 480;
// V6: bounds the preview dry-run loop's wall clock, not just each step's
// guard-evaluation deadline (3500ms/step, see evaluate.ts) — a plan with
// many steps could otherwise run the whole request well past what the
// platform (and a client's HTTP timeout) tolerates. Once spent, remaining
// steps ship with no preview — the review card already renders a "no
// preview" badge for that case.
const PREVIEW_BUDGET_MS = 20000;

interface PlanStepBody {
  action_type?: unknown;
  step_goal?: unknown;
  act?: unknown;
}

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
    const steps: PlanStepBody[] = Array.isArray(body.steps) ? body.steps : [];
    if (steps.length === 0) {
      return NextResponse.json({ error: 'steps must be a non-empty array' }, { status: 400 });
    }
    for (const [i, step] of steps.entries()) {
      if (!step || typeof step.action_type !== 'string' || !step.action_type) {
        return NextResponse.json({ error: `steps[${i}] requires action_type` }, { status: 400 });
      }
      if (typeof step.step_goal !== 'string' || !step.step_goal) {
        return NextResponse.json({ error: `steps[${i}] requires step_goal` }, { status: 400 });
      }
      if (step.act !== undefined && (typeof step.act !== 'object' || step.act === null || Array.isArray(step.act))) {
        return NextResponse.json({ error: `steps[${i}].act must be an object ({ kind: ... })` }, { status: 400 });
      }
    }

    const settings = await getSettings(sql, orgId, { category: 'general' });
    const configuredMaxSteps = parseInt(
      String((settings.find((s) => s.key === 'PLAN_MAX_STEPS') as { value?: string } | undefined)?.value ?? ''),
      10,
    ) || DEFAULT_MAX_STEPS;
    // S3: the org setting may only tighten the cap, never widen it — each
    // step costs a full guard evaluation, so a misconfigured/tampered
    // setting must not raise the fan-out ceiling above the hard code
    // constant.
    const maxSteps = Math.min(configuredMaxSteps, DEFAULT_MAX_STEPS);
    if (steps.length > maxSteps) {
      return NextResponse.json(
        { error: `Plan exceeds the ${maxSteps}-step cap (PLAN_MAX_STEPS)` }, { status: 400 },
      );
    }
    const pending = await countPendingPlans(sql, orgId);
    if (pending >= MAX_PENDING_PLANS) {
      return NextResponse.json(
        { error: `Too many pending plans (${pending}); resolve or revoke existing plans first` }, { status: 409 },
      );
    }

    // U5: clamp at parse — Math.floor(NaN) is NaN, which is falsy, so a
    // non-numeric or absent ttl_minutes still falls back to 60 before the
    // 1..DEFAULT_TTL_CLAMP range clamp runs.
    const ttlMinutes = Math.min(Math.max(Math.floor(Number(body.ttl_minutes)) || 60, 1), DEFAULT_TTL_CLAMP);

    const created = await createPlanWithSteps(sql, orgId, {
      agentId, declaredGoal: body.declared_goal, ttlMinutes, maxPending: MAX_PENDING_PLANS,
      steps: steps.map((s) => ({ action_type: String(s.action_type), step_goal: String(s.step_goal), act: s.act })),
      // SoD (drizzle/0063): trusted middleware principal, never the body —
      // the review route rejects reviewer === created_by.
      createdBy: getUserId(request) || null,
    });
    if (!created) {
      // R3: the countPendingPlans read above is a courtesy fast-path; this is
      // the authoritative SQL-enforced cap catching a race the pre-read missed.
      return NextResponse.json(
        { error: `Too many pending plans (${MAX_PENDING_PLANS}); resolve or revoke existing plans first` }, { status: 409 },
      );
    }

    // Dry-run every step through the REAL guard pipeline, side-effect-free
    // (evaluateGuard's simulate:true skips persistence, event publish, and
    // BOTH grant passes). The preview verdict is advisory: conditions change
    // between review and execution — a grant only matters when the LIVE
    // evaluation lands on require_approval. Preview contexts stay plain —
    // agent_id/action_type/declared_goal(+act) only, never signature/jwt/jti
    // (see GuardOptions.simulate in guard/evaluate.ts).
    const planId = String((created.plan as { plan_id: string }).plan_id);
    const previewedSteps: Array<Record<string, unknown>> = [];
    let plan: unknown;
    // V4: the preview loop + the flip to 'pending' are wrapped together — a
    // plan that dies mid-loop (a step's evaluateGuard call throws, the DB
    // drops mid-transaction, etc.) must not sit forever in 'previewing',
    // silently holding a pending-plan cap slot (countPendingPlans counts
    // both statuses) until PENDING_PLAN_CAP_WINDOW_MINUTES ages it out. On
    // failure, best-effort revoke the plan (system-attributed — there is no
    // human reviewer at this point) before rethrowing so the operator still
    // sees the real 500, not a silently orphaned hold.
    try {
      const previewStartedAt = Date.now();
      for (const [i, step] of (created.steps as Array<Record<string, unknown>>).entries()) {
        // V6: once the whole-loop budget is spent, stop previewing further
        // steps — they ship with preview_decision left unset, which the
        // review card already renders as a "no preview" badge.
        if (Date.now() - previewStartedAt > PREVIEW_BUDGET_MS) {
          previewedSteps.push({ ...step });
          continue;
        }
        // T4: preview against the RAW act as submitted (steps[i], index-aligned
        // — createPlanWithSteps preserves submission order via seq), never
        // `step.act`, which is the REDACTED display copy persisted by S2 in
        // createPlanWithSteps. Grading the redacted copy would hide the exact
        // content (e.g. a secret-bearing shell command) a policy needs to see,
        // producing a preview softer than the live evaluation the agent will
        // actually face. The stored/displayed step.act stays redacted, and the
        // act_content_hash the operator's approval binds to is already
        // computed over the raw act — only this preview call was reading the
        // wrong copy.
        const rawAct = steps[i]?.act;
        const preview = await evaluateGuard(orgId, {
          agent_id: agentId,
          action_type: String(step.action_type),
          declared_goal: String(step.step_goal),
          ...(rawAct !== undefined ? { act: rawAct } : {}),
        }, sql, { simulate: true });
        await stampStepPreview(sql, orgId, String(step.step_id), {
          decision: String(preview.decision),
          riskScore: Number(preview.risk_score ?? 0),
          reasons: preview.reasons ?? [],
        });
        previewedSteps.push({
          ...step,
          preview_decision: preview.decision,
          preview_risk_score: preview.risk_score,
          preview_reasons: preview.reasons,
        });
      }

      // U4: the plan was inserted as 'previewing' — flip it to 'pending' now
      // that every step has a stamped preview verdict (or was skipped by the
      // V6 budget). Only then is it reviewable (reviewPlan requires
      // status='pending') and visible on /approvals (which fetches
      // ?status=pending only). Guarded in SQL on status='previewing', so a
      // concurrent revoke wins gracefully — fall back to created.plan (still
      // status 'previewing') rather than fabricate a 'pending' row that was
      // never actually reachable.
      const pendingPlan = await markPlanPending(sql, orgId, planId);
      plan = pendingPlan ?? created.plan;
    } catch (previewErr) {
      try {
        await reviewPlan(sql, orgId, planId, {
          verdict: 'revoke', reviewedBy: 'system:preview-failure', ttlClampMinutes: DEFAULT_TTL_CLAMP,
        });
      } catch (revokeErr) {
        console.warn('[Plans] best-effort preview-failure revoke failed:', (revokeErr as Error).message);
      }
      throw previewErr;
    }

    void publishOrgEvent(EVENTS.ACTION_UPDATED, { orgId, plan });

    return NextResponse.json({ plan, steps: previewedSteps }, { status: 201 });
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
      // R4: floor at 1 as well as ceiling at 200 — a negative/zero limit must
      // not reach the SQL LIMIT clause (Postgres rejects LIMIT < 0).
      limit: Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200),
    });
    // V7: created_by is a reviewer/creator principal — never leak it to an
    // agent-facing GET. reviewed_by stays (it's displayed as approver
    // attribution in the UI, which is intentional provenance).
    const sanitized = (plans as Array<Record<string, unknown>>).map(({ created_by: _createdBy, ...rest }) => rest);
    return NextResponse.json({ plans: sanitized });
  } catch (error) {
    return apiErrorResponse(error, 'PLANS GET');
  }
}
