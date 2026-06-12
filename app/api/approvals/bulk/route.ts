export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

import { NextResponse, after } from 'next/server';
import { getOrgId, getOrgRole, getUserId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { logActivity } from '../../../lib/audit';
import { listPendingApprovalIdsByActionTypes, recordBulkApprovals } from '../../../lib/repositories/actions.repository';
import { getPolicyById } from '../../../lib/repositories/guardrails.repository';
import { clearApprovalNotifications } from '../../../lib/approvalNotifications';

const MAX_BULK = 500;

/**
 * POST /api/approvals/bulk — admin-only bulk resolution for approval floods.
 * Body: { decision: 'allow'|'deny', filter: { policy_id }, limit? }
 *
 * Matches pending_approval actions by the policy's compiled action_types in
 * the last 24h. Each action resolves through recordApproval (full audit
 * trail); per-action failures don't abort the batch.
 *
 * Webhooks intentionally skipped in bulk — a per-action webhook fan-out
 * would stampede the destination; the audit log entry carries the record.
 *
 * NEVER auto-invoked — operator-driven only via the flood-resolution banner.
 */
export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const userId = getUserId(request);
    const body = await request.json().catch(() => ({})) as {
      decision?: string; filter?: { policy_id?: string }; limit?: number;
    };
    if (!['allow', 'deny'].includes(body.decision ?? '')) {
      return NextResponse.json({ error: 'decision must be allow or deny' }, { status: 400 });
    }
    const policyId = body.filter?.policy_id;
    if (!policyId || typeof policyId !== 'string') {
      return NextResponse.json({ error: 'filter.policy_id is required' }, { status: 400 });
    }

    const sql = getSql();
    const policy = await getPolicyById(sql as never, orgId, policyId);
    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }
    if (policy.policy_type === 'protected_path') {
      return NextResponse.json(
        { error: 'Bulk resolution does not support protected_path policies — resolve from /approvals' },
        { status: 400 },
      );
    }
    let actionTypes: string[] = [];
    try {
      const rules = JSON.parse(policy.rules || '{}');
      if (Array.isArray(rules.action_types)) actionTypes = rules.action_types.map(String);
    } catch { /* fall through to the 400 below */ }
    if (!actionTypes.length) {
      return NextResponse.json({ error: 'Policy has no action_types to match' }, { status: 400 });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const ids = await listPendingApprovalIdsByActionTypes(
      sql as never,
      orgId,
      actionTypes,
      since,
      Math.min(body.limit ?? MAX_BULK, MAX_BULK),
    );

    const decision = body.decision as 'allow' | 'deny';
    const newStatus = decision === 'allow' ? 'running' : 'failed';
    const reasoning = `Bulk ${decision} via approval-flood resolution (policy ${policy.name ?? policyId})`;

    const resolvedIds = await recordBulkApprovals(sql as never, orgId, ids, {
      newStatus,
      errorMessage: decision === 'deny' ? reasoning : null,
      decision,
      userId,
      safeReasoning: reasoning,
    });
    const resolved = resolvedIds.length;
    const failed = ids.length - resolved;

    after(async () => {
      for (const actionId of resolvedIds) {
        await clearApprovalNotifications(sql, {
          orgId, actionId, decision, resolvedBy: userId, resolvedVia: 'dashboard',
        });
      }
    });

    logActivity({
      orgId, actorId: userId, action: `approvals.bulk_${decision}`,
      resourceType: 'policy', resourceId: policyId,
      details: { resolved, failed, matched: ids.length }, request,
    }, sql);

    return NextResponse.json({ resolved, failed, matched: ids.length });
  } catch (err) {
    return apiErrorResponse(err, 'APPROVALS_BULK POST');
  }
}
