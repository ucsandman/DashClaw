export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId, getOrgRole, getUserId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { logActivity } from '../../../lib/audit';
import { ingestApprovalAdjudication } from '../../../lib/guard/calibration-feedback';

const MAX_REASON_LENGTH = 500;
/** A miss is only meaningful for actions the guard actually let through. */
const MISSABLE_DECISIONS = new Set(['allow', 'warn']);

/**
 * POST /api/calibration/misses — file a "should-have-held" verdict (admin only).
 *
 * Body: { action_id: string, label: 'dangerous'|'benign', reason?: string }
 *
 * The calibration controller learned only from interruptions: benign
 * approvals loosened θ, denials tightened it, and actions the guard waved
 * through were never labeled at all — so allowed false negatives were
 * invisible and θ ratcheted to its ceiling (2026-09-08: θ 101.8, at which
 * point no score could interrupt). A miss is the tightening counterpart the
 * controller was missing: a human (or probe) verdict on a SPECIFIC allowed
 * action that should have been held.
 *
 *  - label 'dangerous': the miss is real — folds at weight 1, owns the
 *    action's agent, and tightens θ.
 *  - label 'benign': no miss occurred — recorded for the ledger, θ unmoved.
 */
export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const userId = getUserId(request);
    const body = (await request.json().catch(() => null)) as {
      action_id?: unknown;
      label?: unknown;
      reason?: unknown;
    } | null;

    const actionId = body?.action_id;
    if (typeof actionId !== 'string' || !actionId) {
      return NextResponse.json({ error: 'action_id is required' }, { status: 400 });
    }
    const label = body?.label;
    if (label !== 'dangerous' && label !== 'benign') {
      return NextResponse.json({ error: "label must be 'dangerous'|'benign'" }, { status: 400 });
    }
    const reason =
      typeof body?.reason === 'string' ? body.reason.slice(0, MAX_REASON_LENGTH) : null;

    const sql = getSql();
    const rows = (await sql.query(
      `SELECT ar.action_id, ar.risk_score, ar.agent_id, ar.declared_goal,
              gd.decision AS guard_decision
       FROM action_records ar
       LEFT JOIN guard_decisions gd
         ON gd.id = ar.guard_decision_id AND gd.org_id = ar.org_id
       WHERE ar.org_id = $1 AND ar.action_id = $2
       LIMIT 1`,
      [orgId, actionId],
    )) as Array<{
      action_id: string;
      risk_score: unknown;
      agent_id: string | null;
      declared_goal: string | null;
      guard_decision: string | null;
    }>;
    const row = rows[0];
    if (!row) {
      return NextResponse.json({ error: 'action not found' }, { status: 404 });
    }
    // A miss is only meaningful for actions the guard actually let through —
    // anything already held, denied, or blocked has no false negative to fix.
    if (row.guard_decision && !MISSABLE_DECISIONS.has(row.guard_decision)) {
      return NextResponse.json(
        {
          error: `action was '${row.guard_decision}' — misses apply only to actions the guard let through (allow/warn)`,
          code: 'NOT_MISSABLE',
        },
        { status: 409 },
      );
    }
    const riskScore = Number(row.risk_score);
    if (!Number.isFinite(riskScore)) {
      return NextResponse.json({ error: 'action has no persisted risk score' }, { status: 400 });
    }

    const outcome = await ingestApprovalAdjudication(sql, orgId, {
      actionId,
      agentId: row.agent_id ?? null,
      riskScore,
      approved: label !== 'dangerous',
      source: 'miss_review',
    });
    if (!outcome) {
      return NextResponse.json({ error: 'adjudication ingest failed' }, { status: 503 });
    }

    logActivity(
      {
        orgId,
        actorId: userId || 'unknown',
        action: 'calibration.miss_filed',
        resourceType: 'action_record',
        resourceId: actionId,
        details: {
          label,
          reason,
          risk_score: riskScore,
          guard_decision: row.guard_decision,
          declared_goal: row.declared_goal,
          theta_before: outcome.thetaBefore,
          theta_after: outcome.thetaAfter,
        },
        request,
      },
      sql,
    );

    return NextResponse.json({
      ok: true,
      action_id: actionId,
      label,
      risk_score: riskScore,
      theta_before: outcome.thetaBefore,
      theta_after: outcome.thetaAfter,
      labeled_total: outcome.state.labeledTotal,
    });
  } catch (err) {
    return apiErrorResponse(err, 'CALIBRATION_MISS_FILE');
  }
}
