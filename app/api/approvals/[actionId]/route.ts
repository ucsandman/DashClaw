export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse, after } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId, getOrgRole, getUserId } from '../../../lib/org.js';
import { logActivity } from '../../../lib/audit.js';
import { EVENTS, publishOrgEvent } from '../../../lib/events.js';
import { redactAny } from '../../../lib/security.js';
import { recordApproval, getActionStatus, getActionSummary } from '../../../lib/repositories/actions.repository.js';
import { fireWebhooksForApproval } from '../../../lib/webhooks.js';
import { clearApprovalNotifications } from '../../../lib/approvalNotifications.js';


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
