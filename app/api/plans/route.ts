export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Preflight Plan Authorization (docs/rfcs/2026-07-06-preflight-plan-authorization.md).
// POST submits a plan of steps and dry-runs each through the real guard
// pipeline (simulate:true — side-effect-free, no persistence, no grant
// consumption) so the operator reviews a genuine preview verdict. GET lists
// plans for the /plans review surface.

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

    const ttlMinutes = Number.isFinite(Number(body.ttl_minutes)) && Number(body.ttl_minutes) > 0
      ? Math.floor(Number(body.ttl_minutes)) : 60;

    const created = await createPlanWithSteps(sql, orgId, {
      agentId, declaredGoal: body.declared_goal, ttlMinutes, maxPending: MAX_PENDING_PLANS,
      steps: steps.map((s) => ({ action_type: String(s.action_type), step_goal: String(s.step_goal), act: s.act })),
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
    const previewedSteps: Array<Record<string, unknown>> = [];
    for (const step of created.steps as Array<Record<string, unknown>>) {
      const preview = await evaluateGuard(orgId, {
        agent_id: agentId,
        action_type: String(step.action_type),
        declared_goal: String(step.step_goal),
        ...(step.act ? { act: step.act } : {}),
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
      // R4: floor at 1 as well as ceiling at 200 — a negative/zero limit must
      // not reach the SQL LIMIT clause (Postgres rejects LIMIT < 0).
      limit: Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200),
    });
    return NextResponse.json({ plans });
  } catch (error) {
    return apiErrorResponse(error, 'PLANS GET');
  }
}
