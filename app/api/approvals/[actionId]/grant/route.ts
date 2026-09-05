export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse, after } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSql } from '../../../../lib/db';
import { getOrgId, getOrgRole, getUserId } from '../../../../lib/org';
import { logActivity } from '../../../../lib/audit';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import {
  createApprovalGrant,
  getActionForGrant,
  isApprovalOverdue,
  listPendingApprovalsForGrant,
} from '../../../../lib/repositories/actions.repository';
import {
  getActivePolicies,
  getGuardDecisionById,
} from '../../../../lib/repositories/guardrails.repository';
import {
  extractDecisionShape,
  shapeIsGrantable,
  grantMatches,
  grantCoversRisk,
  GRANT_DEFAULT_MAX_RISK,
} from '../../../../lib/policy-shapes';
import { RISK_HIGH_MIN } from '../../../../lib/riskThresholds';

/** Hours the operator may pick. 1h / 24h / 7d / 30d. */
const ALLOWED_TTL_HOURS = [1, 24, 168, 720];
const GRANT_PREVIEW_LIMIT = 200;

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseIdArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string' && raw.startsWith('[')) {
    try { return (JSON.parse(raw) as unknown[]).map(String); } catch { return []; }
  }
  return [];
}

function ttlFromRequest(request: Request, body?: Record<string, unknown>): number | null {
  const urlTtl = new URL(request.url).searchParams.get('ttl_hours');
  const raw = body?.ttl_hours ?? urlTtl ?? 24;
  const ttl = Number(raw);
  return ALLOWED_TTL_HOURS.includes(ttl) ? ttl : null;
}

async function prepareGrant(sql: ReturnType<typeof getSql>, orgId: string, actionId: string, userId: string, ttlHours: number) {
  const action = await getActionForGrant(sql, orgId, actionId);
  if (!action) return { error: 'Action not found', code: 'NOT_FOUND', status: 404 } as const;
  if (action.status === 'expired' || isApprovalOverdue(action)) {
    return { error: 'Approval expired', code: 'APPROVAL_EXPIRED', status: 410 } as const;
  }
  if (action.status !== 'pending_approval') {
    return { error: 'Action is not pending approval', code: 'NOT_PENDING', status: 400 } as const;
  }
  if (userId !== 'operator' && action.created_by === userId) {
    return { error: 'The credential that created this action cannot grant it.', code: 'SELF_APPROVAL_FORBIDDEN', status: 403 } as const;
  }
  if (action.risk_score >= RISK_HIGH_MIN) {
    return { error: `This action scored ${action.risk_score}. Anything at or above ${RISK_HIGH_MIN} needs a human decision every time and cannot be granted away. To change that, loosen the rule on /policies.`, code: 'GRANT_RISK_CEILING', status: 403 } as const;
  }

  const shape = extractDecisionShape({ action_type: action.action_type, context: action.context });
  if (!shapeIsGrantable(shape.target_prefix)) {
    return { error: `"${shape.label}" has no target scope — an unscoped grant would blanket-allow every "${shape.action_type}" action and silently disable any approval rule covering it. Review these individually instead.`, code: 'UNSCOPED_GRANT_REJECTED', status: 400 } as const;
  }

  const decision = action.guard_decision_id
    ? await getGuardDecisionById(sql, orgId, action.guard_decision_id)
    : null;
  const matchedIds = new Set(parseIdArray((decision as { matched_policies?: unknown } | null)?.matched_policies));
  if (matchedIds.size > 0) {
    const policies = await getActivePolicies(sql, orgId);
    const blocker = policies.find((p) => p.policy_type !== 'allow_grant' && matchedIds.has(String(p.id)) && parseJsonObject(p.rules).ungrantable === true);
    if (blocker) return { error: `"${String(blocker.name)}" is marked ungrantable — grants cannot clear it, so this one always needs a human.`, code: 'GRANT_REFUSED_BY_POLICY', status: 403 } as const;
  }

  const createdAt = new Date().toISOString();
  const rules = {
    action_type: shape.action_type,
    target_prefix: shape.target_prefix,
    expires_at: new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString(),
    max_risk: GRANT_DEFAULT_MAX_RISK,
    _grant: true,
    _provenance: { source_action_id: actionId, actor_id: userId, created_at: createdAt },
  };
  // Read siblings before POST mutates policy state. GET and POST share this exact calculation.
  const candidates = await listPendingApprovalsForGrant(sql, orgId, shape.action_type);
  const allReleaseIds = [actionId, ...candidates.rows
    .filter((candidate) => candidate.action_id !== actionId)
    .filter((candidate) => userId === 'operator' || candidate.created_by !== userId)
    .filter((candidate) => grantCoversRisk(rules, candidate.risk_score))
    .filter((candidate) => grantMatches(rules, { ...parseJsonObject(candidate.context), action_type: candidate.action_type }))
    .map((candidate) => candidate.action_id)];
  const releaseIds = allReleaseIds.slice(0, GRANT_PREVIEW_LIMIT);
  return {
    action,
    shape,
    rules,
    preview: {
      scope: shape.action_type,
      target: shape.target_prefix,
      matching_count: releaseIds.length,
      release_ids: releaseIds,
      truncated: candidates.truncated || allReleaseIds.length > GRANT_PREVIEW_LIMIT,
    },
  } as const;
}

function authError(request: Request) {
  if (getOrgRole(request) !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  if (!getUserId(request)) return NextResponse.json({ error: 'Grants require an attributable principal', code: 'APPROVER_IDENTITY_REQUIRED' }, { status: 403 });
  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const denied = authError(request);
    if (denied) return denied;
    const ttlHours = ttlFromRequest(request);
    if (ttlHours == null) return NextResponse.json({ error: `ttl_hours must be one of ${ALLOWED_TTL_HOURS.join(', ')}`, code: 'INVALID_TTL' }, { status: 400 });
    const { actionId } = await params;
    const prepared = await prepareGrant(getSql(), getOrgId(request), actionId, getUserId(request)! , ttlHours);
    if ('error' in prepared) return NextResponse.json({ error: prepared.error, code: prepared.code }, { status: prepared.status });
    return NextResponse.json(prepared.preview);
  } catch (error) {
    return apiErrorResponse(error, 'APPROVAL GRANT GET');
  }
}

/**
 * POST /api/approvals/[actionId]/grant — mint an allow_grant from an approval
 * card and report which pending approvals it covers.
 *
 * This route deliberately does NOT approve anything. The caller fans the
 * returned release_ids out over the existing per-item
 * POST /api/approvals/[actionId], exactly the way bulk approve already does
 * (app/lib/bulkAction.ts). That keeps ONE approval path carrying one audit,
 * event, notification-clearing, calibration and webhook chain. A second copy
 * of that ~150-line chain inside this route would drift from it silently, and
 * the drift would be invisible until an operator's ledger went wrong.
 *
 * Body: { ttl_hours?: 1 | 24 | 168 | 720 }  (default 24)
 */
export async function POST(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const { actionId } = await params;
    const orgId = getOrgId(request);
    const denied = authError(request);
    if (denied) return denied;
    const userId = getUserId(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const ttlHours = ttlFromRequest(request, body);
    if (ttlHours == null) return NextResponse.json({ error: `ttl_hours must be one of ${ALLOWED_TTL_HOURS.join(', ')}`, code: 'INVALID_TTL' }, { status: 400 });

    const sql = getSql();
    const prepared = await prepareGrant(sql, orgId, actionId, userId!, ttlHours);
    if ('error' in prepared) return NextResponse.json({ error: prepared.error, code: prepared.code }, { status: prepared.status });
    const policy = await createApprovalGrant(sql, orgId, actionId, userId!, {
      id: `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      name: `[Grant] ${prepared.shape.label}`,
      rules: JSON.stringify(prepared.rules),
    });
    if (!policy) return NextResponse.json({ error: 'Action is no longer eligible for a grant', code: 'GRANT_SOURCE_CHANGED' }, { status: 409 });

    after(() => logActivity({
      orgId,
      actorId: userId,
      action: 'policy.grant_created',
      resourceType: 'policy',
      resourceId: (policy as { id?: string } | null)?.id,
      details: { from_action: actionId, shape: prepared.shape.key, ttl_hours: ttlHours, covers: prepared.preview.matching_count },
      request,
    }, sql));

    return NextResponse.json({ ok: true, policy, ...prepared.preview }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, 'APPROVAL GRANT POST');
  }
}
