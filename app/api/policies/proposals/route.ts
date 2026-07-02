export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId, getOrgRole, getUserId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { logActivity } from '../../../lib/audit';
import { redactAny } from '../../../lib/security';
import {
  getActivePolicies,
  getDecisionCountsByPolicy,
} from '../../../lib/repositories/guardrails.repository';
import {
  getDecisionMixByPolicy,
  getApprovalOutcomesByPolicy,
  getDegradationStats,
  getTuningDismissals,
  recordTuningDismissal,
  removeTuningDismissal,
} from '../../../lib/repositories/policy-tuning.repository';
import {
  buildTuningStats,
  deriveProposals,
  clampInt,
  TUNING_DEFAULTS,
} from '../../../lib/policy-tuning/engine';

const PROPOSAL_ID_RE = /^ptp_[a-f0-9]{16}$/;
const MAX_REASON_LENGTH = 500;

/**
 * GET /api/policies/proposals — per-policy interruption stats over a rolling
 * window plus rule-based tuning proposals (owner roadmap item 1; spec
 * docs/superpowers/specs/2026-07-01-policy-tuning-proposal-loop.md).
 *
 * Read-only computation: the engine PROPOSES; a human admin applies via the
 * existing PATCH /api/policies (constitution §3 — nothing auto-applies).
 *
 * Query: ?days=30 (7–90) · ?min_fired= / ?min_resolved= (1–100; primarily
 * for the policy smoke harness to exercise the loop with small seeded
 * volumes — production callers use the defaults).
 */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const { searchParams } = new URL(request.url);

    const days = clampInt(searchParams.get('days'), 7, 90, 30);
    const minFired = clampInt(searchParams.get('min_fired'), 1, 100, TUNING_DEFAULTS.minFired);
    const minResolved = clampInt(
      searchParams.get('min_resolved'),
      1,
      100,
      TUNING_DEFAULTS.minResolved,
    );

    const [policies, mixRows, outcomeRows, fired60, dismissed, degradation] = await Promise.all([
      getActivePolicies(sql, orgId),
      getDecisionMixByPolicy(sql, orgId, days),
      getApprovalOutcomesByPolicy(sql, orgId, days),
      getDecisionCountsByPolicy(sql, orgId, TUNING_DEFAULTS.deadPolicyDays),
      getTuningDismissals(sql, orgId),
      // Same window as the evidence queries: the rate shown next to the
      // proposals describes exactly the rows those proposals excluded.
      getDegradationStats(sql, orgId, days),
    ]);

    const stats = buildTuningStats(policies, mixRows, outcomeRows, fired60, days);
    const proposals = deriveProposals(stats, { minFired, minResolved });
    const visible = proposals.filter((p) => !(p.id in dismissed));

    return NextResponse.json({
      window_days: days,
      policies: stats.map((s) => ({
        policy_id: s.policy_id,
        name: s.name,
        policy_type: s.policy_type,
        active: s.active,
        updated_at: s.updated_at,
        window_started_at: s.window_started_at,
        fired: s.fired,
        approvals: s.approvals,
        override_rate: s.override_rate,
        approved_risk_scores: s.approved_risk_scores,
        last_fired_at: s.last_fired_at,
      })),
      proposals: visible,
      dismissed_count: proposals.length - visible.length,
      degradation,
    });
  } catch (err) {
    return apiErrorResponse(err, 'POLICY_PROPOSALS GET');
  }
}

/**
 * POST /api/policies/proposals — record (or undo) a proposal dismissal.
 * Body: { action: 'dismiss', proposal_id, reason } — reason required, ≤500.
 *       { action: 'undismiss', proposal_id }
 * Admin-only. Accepting a proposal is NOT handled here — the UI PATCHes the
 * policy through the existing /api/policies route.
 */
export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const userId = getUserId(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = body?.action;
    const proposalId = body?.proposal_id;

    if (action !== 'dismiss' && action !== 'undismiss') {
      return NextResponse.json({ error: 'action must be dismiss or undismiss' }, { status: 400 });
    }
    if (typeof proposalId !== 'string' || !PROPOSAL_ID_RE.test(proposalId)) {
      return NextResponse.json({ error: 'proposal_id must match ptp_<16 hex>' }, { status: 400 });
    }

    const sql = getSql();

    if (action === 'dismiss') {
      const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
      if (!reason || reason.length > MAX_REASON_LENGTH) {
        return NextResponse.json(
          { error: `reason is required (1-${MAX_REASON_LENGTH} chars)` },
          { status: 400 },
        );
      }
      // SECURITY: redact likely secrets before storing human reasoning —
      // same convention as the approvals route (2026-07-01 security review).
      const dlpFindings: unknown[] = [];
      const safeReason = redactAny(reason, dlpFindings) as string;
      await recordTuningDismissal(sql, orgId, proposalId, {
        reason: safeReason,
        by: userId,
        at: new Date().toISOString(),
      });
      logActivity(
        {
          orgId,
          actorId: userId,
          action: 'policy_proposal.dismissed',
          resourceType: 'policy_proposal',
          resourceId: proposalId,
          details: { reason: safeReason },
          request,
        },
        sql,
      );
      return NextResponse.json({ ok: true, proposal_id: proposalId, dismissed: true });
    }

    const removed = await removeTuningDismissal(sql, orgId, proposalId);
    if (!removed) {
      return NextResponse.json({ error: 'Proposal is not dismissed' }, { status: 404 });
    }
    logActivity(
      {
        orgId,
        actorId: userId,
        action: 'policy_proposal.undismissed',
        resourceType: 'policy_proposal',
        resourceId: proposalId,
        details: {},
        request,
      },
      sql,
    );
    return NextResponse.json({ ok: true, proposal_id: proposalId, dismissed: false });
  } catch (err) {
    return apiErrorResponse(err, 'POLICY_PROPOSALS POST');
  }
}
