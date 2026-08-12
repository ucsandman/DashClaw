export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse, after } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSql } from '../../../../lib/db';
import { getOrgId, getOrgRole, getUserId } from '../../../../lib/org';
import { logActivity } from '../../../../lib/audit';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import {
  getActionForGrant,
  listPendingApprovalsForGrant,
} from '../../../../lib/repositories/actions.repository';
import {
  getActivePolicies,
  getGuardDecisionById,
  insertOrRevivePolicy,
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

    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // SECURITY: mirrors the approval route. A grant is standing authorization,
    // so it must be attributable to someone for the same reason a single
    // approval must be.
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'Grants require an attributable principal', code: 'APPROVER_IDENTITY_REQUIRED' },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const rawTtl = (body as { ttl_hours?: unknown }).ttl_hours;
    const ttlHours = rawTtl === undefined ? 24 : Number(rawTtl);
    if (!ALLOWED_TTL_HOURS.includes(ttlHours)) {
      return NextResponse.json(
        { error: `ttl_hours must be one of ${ALLOWED_TTL_HOURS.join(', ')}`, code: 'INVALID_TTL' },
        { status: 400 },
      );
    }

    const sql = getSql();
    const action = await getActionForGrant(sql, orgId, actionId);
    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }
    if (action.status !== 'pending_approval') {
      return NextResponse.json({ error: 'Action is not pending approval' }, { status: 400 });
    }

    // Ceiling. The card hides the button above this, but the route is the
    // authority — a client that posts here anyway gets the same answer.
    if (action.risk_score >= RISK_HIGH_MIN) {
      return NextResponse.json({
        error: `This action scored ${action.risk_score}. Anything at or above ${RISK_HIGH_MIN} needs a human decision every time and cannot be granted away. To change that, loosen the rule on /policies.`,
        code: 'GRANT_RISK_CEILING',
      }, { status: 403 });
    }

    const shape = extractDecisionShape({ action_type: action.action_type, context: action.context });

    // F1 (governance gap audit 2026-08-05): an unscoped grant blanket-allows
    // every action of its type and silently disables any approval rule
    // covering it. Same predicate the /policies verdict route enforces, so
    // neither surface can offer a scope the other would reject.
    if (!shapeIsGrantable(shape.target_prefix)) {
      return NextResponse.json({
        error: `"${shape.label}" has no target scope — an unscoped grant would blanket-allow every "${shape.action_type}" action and silently disable any approval rule covering it. Review these individually instead.`,
        code: 'UNSCOPED_GRANT_REJECTED',
      }, { status: 400 });
    }

    // Ungrantable gate: mirrors applyAllowGrants. A verdict raised by a rule
    // the operator marked ungrantable is never cleared by a grant, so minting
    // one here would sell an authorization the guard refuses to honor — the
    // operator would click "don't ask again" and keep being asked.
    const decision = action.guard_decision_id
      ? await getGuardDecisionById(sql, orgId, action.guard_decision_id)
      : null;
    const matchedIds = new Set(parseIdArray((decision as { matched_policies?: unknown } | null)?.matched_policies));
    if (matchedIds.size > 0) {
      const policies = await getActivePolicies(sql, orgId);
      const blocker = policies.find((p) => {
        if (p.policy_type === 'allow_grant') return false;
        if (!matchedIds.has(String(p.id))) return false;
        return parseJsonObject(p.rules).ungrantable === true;
      });
      if (blocker) {
        return NextResponse.json({
          error: `"${String(blocker.name)}" is marked ungrantable — grants cannot clear it, so this one always needs a human.`,
          code: 'GRANT_REFUSED_BY_POLICY',
        }, { status: 403 });
      }
    }

    const rules = {
      action_type: shape.action_type,
      target_prefix: shape.target_prefix,
      // Grants are leases, not permanent law (F1).
      expires_at: new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString(),
      max_risk: GRANT_DEFAULT_MAX_RISK,
      _grant: true,
    };

    const policy = await insertOrRevivePolicy(sql, orgId, {
      id: `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      name: `[Grant] ${shape.label}`,
      policyType: 'allow_grant',
      rules: JSON.stringify(rules),
    });

    // Coverage, computed with the SAME predicates the guard uses so the queue
    // can never claim to release something enforcement would re-interrupt.
    // This action leads the list: it is the one the operator clicked.
    const siblings = await listPendingApprovalsForGrant(sql, orgId, shape.action_type);
    const releaseIds = [
      actionId,
      ...siblings
        .filter((s) => s.action_id !== actionId)
        .filter((s) => grantCoversRisk(rules, s.risk_score))
        .filter((s) => grantMatches(rules, { ...parseJsonObject(s.context), action_type: s.action_type }))
        .map((s) => s.action_id),
    ];

    after(() => logActivity({
      orgId,
      actorId: userId,
      action: 'policy.grant_created',
      resourceType: 'policy',
      resourceId: (policy as { id?: string } | null)?.id,
      details: { from_action: actionId, shape: shape.key, ttl_hours: ttlHours, covers: releaseIds.length },
      request,
    }, sql));

    return NextResponse.json({ ok: true, policy, release_ids: releaseIds }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, 'APPROVAL GRANT POST');
  }
}
