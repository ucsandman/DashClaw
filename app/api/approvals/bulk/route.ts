export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

import { NextResponse, after } from 'next/server';
import { getOrgId, getOrgRole, getUserId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { logActivity } from '../../../lib/audit';
import { listPendingApprovalIdsByPolicy, recordBulkApprovals, sweepExpiredApprovals, listActionApprovalFacts } from '../../../lib/repositories/actions.repository';
import { ingestApprovalAdjudicationBatch } from '../../../lib/guard/calibration-feedback';
import { getPolicyById } from '../../../lib/repositories/guardrails.repository';
import { clearApprovalNotifications } from '../../../lib/approvalNotifications';
import { EVENTS, publishOrgEvent } from '../../../lib/events';

const MAX_BULK = 500;

/**
 * POST /api/approvals/bulk — admin-only bulk resolution for approval floods.
 * Body: { decision: 'allow'|'deny', filter: { policy_id }, limit? }
 *
 * Matches the pending_approval actions THIS policy actually held, resolved
 * through their guard decision's matched_policies, in the last 24h. All matches
 * resolve in ONE batched UPDATE (recordBulkApprovals)
 * with the same per-row pending_approval race guard as recordApproval; rows
 * lost to a concurrent resolution are reported as failed, never re-resolved.
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
    // SECURITY: same attribution gate as the single-approval route — a bulk
    // resolution attributed to nobody must not exist (see APPROVER_IDENTITY_REQUIRED there).
    if (!userId) {
      return NextResponse.json(
        { error: 'Approvals require an attributable principal', code: 'APPROVER_IDENTITY_REQUIRED' },
        { status: 403 }
      );
    }
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
    // No policy-shape gate here any more. Matching now runs through the guard
    // decision that actually held each approval, so every policy type resolves
    // the same way — including the two that used to dead-end: protected_path
    // (rules carry `paths`, never `action_types`) and rate_limit (matches on
    // frequency, so it has no action_type to declare at all). Both reached the
    // operator as a flood banner whose only button returned 400.

    // Lazy expiry sweep (roadmap v2.3): bulk resolution must not resolve
    // approvals whose clients already stopped waiting. The lister also
    // excludes overdue rows; the sweep keeps the queue itself truthful.
    await sweepExpiredApprovals(sql as never, orgId).catch((err: unknown) => {
      console.warn('[APPROVALS_BULK] approval expiry sweep failed:', (err as Error)?.message);
    });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const ids = await listPendingApprovalIdsByPolicy(
      sql as never,
      orgId,
      policyId,
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

    // One aggregate event (not N) so live dashboards refresh after a bulk
    // resolution without a per-action publish storm.
    if (resolved > 0) {
      void publishOrgEvent(EVENTS.ACTION_UPDATED, {
        orgId,
        bulk: { decision, resolved, policy_id: policyId, action_ids: resolvedIds },
      });
    }

    after(async () => {
      for (const actionId of resolvedIds) {
        await clearApprovalNotifications(sql, {
          orgId, actionId, decision, resolvedBy: userId, resolvedVia: 'dashboard',
        });
      }
    });

    // Calibration feedback: every bulk-resolved interruption is a labeled
    // adjudication (allow → benign, deny → dangerous). Batched — one state
    // fold — and best-effort by contract (the batch ingest never throws).
    if (resolvedIds.length > 0) {
      after(async () => {
        const facts = await listActionApprovalFacts(sql as never, orgId, resolvedIds)
          .catch((err: unknown) => {
            console.warn('[APPROVALS_BULK] calibration fact lookup failed:', (err as Error)?.message);
            return [];
          });
        await ingestApprovalAdjudicationBatch(sql, orgId, facts.map((f) => ({
          actionId: f.action_id,
          agentId: f.agent_id,
          riskScore: f.risk_score,
          approved: decision === 'allow',
          source: 'bulk_approval' as const,
        })));
      });
    }

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
