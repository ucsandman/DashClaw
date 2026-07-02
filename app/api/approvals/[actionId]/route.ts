export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse, after } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getOrgRole, getUserId } from '../../../lib/org';
import { logActivity } from '../../../lib/audit';
import { EVENTS, publishOrgEvent } from '../../../lib/events';
import { redactAny } from '../../../lib/security';
import {
  recordApproval,
  getActionStatus,
  getActionSummary,
  isApprovalOverdue,
  expireOverdueApproval,
} from '../../../lib/repositories/actions.repository';
import { reconcileStalePurchases } from '../../../lib/repositories/x402.repository';
import { fireWebhooksForApproval } from '../../../lib/webhooks';
import { clearApprovalNotifications } from '../../../lib/approvalNotifications';

// Truthful response for acting on a dead approval (roadmap v2.3): the
// requesting client stopped polling long ago, so flipping the row to
// running would release nothing and report nothing.
const APPROVAL_EXPIRED_RESPONSE = {
  error: 'Approval expired: the requesting agent stopped waiting for this decision, so approving it can no longer release anything. If the action is still wanted, have the agent retry it — a fresh approval request will be created.',
  code: 'APPROVAL_EXPIRED',
};


/**
 * POST /api/actions/[actionId]/approve
 * Human-in-the-loop approval handler.
 *
 * Body: { decision: 'allow' | 'deny', reasoning?: string }
 */
export async function POST(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const { actionId } = await params;
    const orgId = getOrgId(request);
    const role = getOrgRole(request);
    const userId = getUserId(request);

    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required for approvals' }, { status: 403 });
    }

    const body = await request.json();
    const { decision, reasoning } = body;

    if (!['allow', 'deny'].includes(decision)) {
      return NextResponse.json({ error: 'Invalid decision. Must be allow or deny.' }, { status: 400 });
    }

    const sql = getSql();

    // Verify action is in pending_approval state
    const action = await getActionStatus(sql, orgId, actionId);

    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    // Lazy expiry (roadmap v2.3, pairing-flow precedent): a pending row whose
    // client stopped waiting flips to expired here — self-healing — and the
    // operator gets the truth instead of a fake success. The UPDATE re-checks
    // status + overdue, so a concurrent approve wins cleanly (null return).
    if (action.status === 'pending_approval' && isApprovalOverdue(action)) {
      const expired = await expireOverdueApproval(sql, orgId, actionId);
      if (expired) {
        void publishOrgEvent(EVENTS.ACTION_UPDATED, { orgId, action: expired });
        after(() => clearApprovalNotifications(sql, {
          orgId, actionId, decision: 'expire', resolvedBy: 'system:expiry', resolvedVia: 'expiry',
        }));
        return NextResponse.json({ ...APPROVAL_EXPIRED_RESPONSE, action: expired }, { status: 410 });
      }
      // Raced with another resolver between our read and the flip: re-read so
      // the status checks below report the real terminal state.
      const reread = await getActionStatus(sql, orgId, actionId);
      if (reread) action.status = reread.status;
    }

    if (action.status === 'expired') {
      return NextResponse.json(APPROVAL_EXPIRED_RESPONSE, { status: 410 });
    }

    if (action.status !== 'pending_approval') {
      return NextResponse.json({ error: 'Action is not pending approval' }, { status: 400 });
    }

    // SECURITY: redact likely secrets before storing human reasoning.
    const dlpFindings: Array<{ severity?: string; category?: string }> = [];
    const safeReasoning = reasoning ? redactAny(reasoning, dlpFindings) : reasoning;

    const newStatus = decision === 'allow' ? 'running' : 'failed';
    const errorMessage = decision === 'deny' ? (safeReasoning || 'Denied by human operator') : null;

    const updatedAction = await recordApproval(sql, orgId, actionId, {
      newStatus,
      errorMessage,
      decision,
      userId,
      safeReasoning
    });

    // Zero-row return — another caller resolved the action between the
    // getActionStatus read and our UPDATE (Fix C1 caller).
    if (!updatedAction) {
      return NextResponse.json(
        { error: 'Action was already resolved by another approver' },
        { status: 409 }
      );
    }

    // x402 lifecycle ride-along (roadmap v2.3): a denied purchase must leave
    // execution_status='pending' too, or it reserves budget forever (the
    // spend predicates count pending rows as reserved spend).
    if (decision === 'deny' && action.action_type === 'x402_purchase') {
      await reconcileStalePurchases(sql, orgId, [actionId], 'denied', errorMessage || 'Denied by human operator')
        .catch((err: unknown) => console.error('[APPROVAL] x402 deny reconcile failed:', (err as Error)?.message));
    }

    logActivity({
      orgId, actorId: userId, action: `action.${decision}ed`,
      resourceType: 'action', resourceId: actionId,
      details: { decision, reasoning }, request,
    }, sql);

    // Emit event for real-time updates
    void publishOrgEvent(EVENTS.ACTION_UPDATED, {
      orgId,
      action: updatedAction
    });

    // Clear the approval message in every external channel (Discord/Telegram)
    // so a resolution here doesn't leave a stale "approve me" message elsewhere.
    after(() => clearApprovalNotifications(sql, {
      orgId, actionId, decision, resolvedBy: userId, resolvedVia: 'dashboard',
    }));

    // Fetch full action for webhook payload (getActionStatus only returns status + agent_id)
    const fullAction = await getActionSummary(sql, orgId, actionId);
    const approvalEvent = decision === 'allow' ? 'approval_granted' : 'approval_denied';
    if (fullAction) {
      fireWebhooksForApproval(orgId, approvalEvent, {
        ...fullAction,
        status: decision === 'allow' ? 'running' : 'failed',
      }, sql).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      action: updatedAction,
      security: {
        clean: dlpFindings.length === 0,
        findings_count: dlpFindings.length,
        critical_count: dlpFindings.filter(f => f.severity === 'critical').length,
        categories: [...new Set(dlpFindings.map(f => f.category))],
      },
    });

  } catch (error) {
    console.error('[APPROVAL] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
