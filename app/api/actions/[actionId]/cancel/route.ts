export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId, getOrgRole, getUserId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { logActivity } from '../../../../lib/audit';
import { EVENTS, publishOrgEvent } from '../../../../lib/events';
import { scanSensitiveData } from '../../../../lib/security';
import {
  cancelAction,
  getActionCancelFacts,
} from '../../../../lib/repositories/actions.repository.execution';

const MAX_REASON_LEN = 4000;

/**
 * POST /api/actions/:actionId/cancel — deliberately close an action that was
 * recorded but never executed, without inventing an outcome.
 *
 * Body: { reason: string } (required — the reason is the audit trail).
 *
 * A cancel is only valid while the action is still in its pre-execution
 * state (status 'running', outcome pending, execution never claimed). Once an
 * execution claim exists the row must report its real outcome instead. The
 * lost-outcome sweep and the outcome route both treat status 'cancelled' as
 * terminal, so a cancelled row is never reconciled to lost_confirmation and
 * never accepts a later agent-reported outcome.
 *
 * Auth: org admin, or the agent that owns the action.
 */
export async function POST(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { actionId } = await params;

    const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      return NextResponse.json({ error: 'reason is required' }, { status: 400 });
    }

    const facts = await getActionCancelFacts(sql, orgId, actionId);
    if (!facts) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    const role = getOrgRole(request);
    const userId = getUserId(request);
    const isAdmin = role === 'admin';
    const isOwner = !!userId && !!facts.agent_id && userId === facts.agent_id;
    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: 'Not authorized to cancel this action' }, { status: 403 });
    }

    const scan = scanSensitiveData(reason);
    const cleanReason = (scan.redacted ?? reason).slice(0, MAX_REASON_LEN);

    const result = await cancelAction(sql, { orgId, actionId, reason: cleanReason });
    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        return NextResponse.json({ error: 'Action not found' }, { status: 404 });
      }
      return NextResponse.json(
        {
          error: 'Action is no longer cancellable: it has already executed, been claimed, or reached a terminal state',
          code: 'NOT_CANCELLABLE',
          current_status: result.status,
          outcome_status: result.outcome_status,
          execution_claimed: result.claimed,
        },
        { status: 409 },
      );
    }

    logActivity(
      {
        orgId,
        actorId: userId || 'unknown',
        action: 'action.cancelled',
        resourceType: 'action_record',
        resourceId: actionId,
        details: { reason: cleanReason, agent_id: result.agent_id },
        request,
      },
      sql,
    );

    void publishOrgEvent(EVENTS.ACTION_UPDATED, {
      orgId,
      action: { action_id: actionId, status: 'cancelled', close_source: 'direct' },
    });

    return NextResponse.json({
      ok: true,
      action_id: actionId,
      status: 'cancelled',
      security: { clean: scan.clean, findings_count: scan.findings?.length ?? 0 },
    });
  } catch (error) {
    return apiErrorResponse(error, 'ACTION_CANCEL_POST');
  }
}
