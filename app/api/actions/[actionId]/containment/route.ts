export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Containment Verdicts (RFC 2026-07-06, drizzle/0064) — operator resolve
// route. Auth pattern mirrors app/api/approvals/[actionId]/route.ts (admin +
// attributable principal + separation-of-duties) applied to the
// contained -> awaiting_promotion -> promoted|discarded lifecycle.

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId, getOrgRole, getUserId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import {
  getActionStatus,
  getActionRecord,
  resolveContainment,
  createActionRecord,
  stampPromotionApproval,
  findUnconsumedPromotionGrant,
} from '../../../../lib/repositories/actions.repository';
import { listArtifacts } from '../../../../lib/repositories/artifacts.repository';
import { getGuardDecisionById } from '../../../../lib/repositories/guardrails.repository';
import { buildPromotionGoal, buildPromotionAct, isDbContainmentRef } from '../../../../lib/guard/containment';
import { computeActContentHash } from '../../../../lib/act-content-hash';

/** guard_decisions.context is a TEXT column (JSON) — object on some drivers. */
function parseDecisionContext(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/actions/[actionId]/containment
 * Operator verdict on a contained action awaiting promotion.
 *
 * Body: { verdict: 'promote' | 'discard' }
 *
 * promote: flips containment_status -> promoted, then raises a synthetic
 * `containment_promote` grant row (born 'running', pre-approved by this
 * verdict, claim protocol 1, parent-linked to the contained action) whose act
 * is the canonical `git merge --no-ff <containment_ref>`
 * for a file ref, or the action's ORIGINAL recorded act for a
 * `dashclaw/contained-db-` ref (RFC 2026-09-04-database-containment: the
 * replay against production IS the promotion) — the same act shape the
 * agent's retry must present for the act-content-hash grant match to bind it
 * (see docs/rfcs/2026-07-06-containment-verdicts.md).
 * discard: flips containment_status -> discarded. No grant row is created.
 */
export async function POST(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const { actionId } = await params;
    const orgId = getOrgId(request);
    const role = getOrgRole(request);
    const userId = getUserId(request);

    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required for containment resolution' }, { status: 403 });
    }

    // SECURITY: same attributable-principal requirement as the approvals
    // route — an empty userId would let the promotion grant be stamped to
    // nobody.
    if (!userId) {
      return NextResponse.json(
        { error: 'Containment resolution requires an attributable principal', code: 'APPROVER_IDENTITY_REQUIRED' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { verdict } = body;
    if (!['promote', 'discard'].includes(verdict)) {
      return NextResponse.json({ error: 'Invalid verdict. Must be promote or discard.' }, { status: 400 });
    }

    const sql = getSql();

    const action = await getActionStatus(sql, orgId, actionId);
    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    // CRITICAL 1 (final fix wave, 2026-07-27): re-promoting an ALREADY
    // promoted action is legal. The first promote's synthetic grant expires
    // in 15 minutes and is single-use — with no re-issue path, every
    // promote-to-merge gap wider than that window (or a merge conflict that
    // already consumed the grant) left the ledger stuck at 'promoted' with
    // nothing able to ever merge: resolveContainment's WHERE-gate only
    // matches 'awaiting_promotion', so every further verdict 409ed forever.
    const isReissue = verdict === 'promote' && action.containment_status === 'promoted';
    if (action.containment_status !== 'awaiting_promotion' && !isReissue) {
      return NextResponse.json({ error: 'CONTAINMENT_NOT_AWAITING' }, { status: 409 });
    }

    // SECURITY: separation of duties (drizzle/0055 precedent) — the
    // credential that created the contained action may not resolve its own
    // verdict. 'operator' is exempt (single-admin self-host root
    // credential); NULL created_by (legacy/system rows) is unenforceable and
    // stays resolvable. Applies identically to a re-issue.
    if (userId !== 'operator' && action.created_by && action.created_by === userId) {
      return NextResponse.json(
        {
          error: 'The credential that created this action cannot resolve its containment verdict. Resolve from the dashboard, or use a different admin credential.',
          code: 'SELF_APPROVAL_FORBIDDEN',
        },
        { status: 403 }
      );
    }

    // SECURITY/CORRECTNESS: promote (first-time or re-issue) mints/re-stamps
    // a pre-approved grant row whose act is built from containment_ref — a
    // ref-less row (the stop/PATCH-side flip does not require a ref) must
    // not reach resolveContainment for promote, or the row is left
    // 'promoted' with no valid grant ever created (String(null) would
    // silently persist the literal act `git merge --no-ff null`, hashed and
    // running). Checked BEFORE any mutation — same unpromotable-state class
    // as CONTAINMENT_NOT_AWAITING; discard has no such requirement.
    const containmentRef = action.containment_ref;
    if (verdict === 'promote' && (typeof containmentRef !== 'string' || containmentRef.length === 0)) {
      return NextResponse.json({ error: 'CONTAINMENT_REF_MISSING' }, { status: 409 });
    }

    // SECURITY (2026-07-27): bind the promoted ref to the REVIEWED evidence.
    // Without this, containment_ref (the merge target) and the patch artifact
    // (what the operator actually read before clicking Promote) are
    // independent — an org-key holder could flip a DIFFERENT agent's action
    // and stamp a containment_ref that the reviewed diff never described.
    // The patch artifact's `content_json.ref` is written by the honest
    // PostToolUse hook at capture time, so requiring it to match
    // action.containment_ref binds the grant to what was actually reviewed.
    // No artifact at all is the same "capture failure must never yield a
    // promotable action" class as CONTAINMENT_REF_MISSING above, so it also
    // refuses promotion (409 CONTAINMENT_NO_EVIDENCE) rather than silently
    // promoting unreviewed work. Applies to both the first-promote path and
    // the re-issue path below (this check runs before either); discard is
    // deliberately exempt — an operator must always be able to throw work
    // away regardless of evidence state.
    if (verdict === 'promote') {
      const { artifacts: patchArtifacts } = await listArtifacts(sql, orgId, {
        action_id: actionId,
        artifact_type: 'patch',
        limit: 1,
      });
      const patchArtifact = patchArtifacts[0] as Record<string, unknown> | undefined;
      if (!patchArtifact) {
        return NextResponse.json({ error: 'CONTAINMENT_NO_EVIDENCE' }, { status: 409 });
      }
      const patchContent = patchArtifact.content as { ref?: string } | null | undefined;
      const evidenceRef = patchContent && typeof patchContent === 'object' ? patchContent.ref : undefined;
      if (evidenceRef !== containmentRef) {
        return NextResponse.json(
          {
            error: 'CONTAINMENT_REF_MISMATCH',
            message: "The reviewed diff describes a different branch than this action's merge target.",
          },
          { status: 409 }
        );
      }
    }

    // Database containment (RFC 2026-09-04): a db ref promotes by REPLAYING
    // the action's original recorded act against production, not by merging a
    // branch. `action_records` stores only the act's content hash, so the act
    // itself comes from the guard decision the row was created from
    // (guard_decision_id -> guard_decisions.context.act) — the same field
    // `dashclaw contained apply` reads, so both sides hash identically and the
    // single-use grant binds. Resolved BEFORE any mutation, same
    // unpromotable-state class as CONTAINMENT_REF_MISSING: a db ref whose act
    // cannot be recovered must never fall through to `git merge --no-ff` on a
    // branch that does not exist. Discard is exempt.
    let promotionAct: unknown;
    // The file path's constant: merging a reviewed diff is a 20. A db replay
    // IS the risky act, so it carries the original action's score.
    let promotionRiskScore = 20;
    // Merging a reviewed diff is reversible (git revert). Replaying a database
    // statement on production is not — recording it as reversible would be a
    // ledger lie about the one act this feature exists to make deliberate.
    let promotionReversible = true;
    if (verdict === 'promote' && isDbContainmentRef(containmentRef)) {
      promotionReversible = false;
      const fullRow = await getActionRecord(sql, orgId, actionId);
      const decisionId = fullRow?.guard_decision_id;
      const decision = typeof decisionId === 'string' && decisionId
        ? await getGuardDecisionById(sql, orgId, decisionId)
        : null;
      const recordedAct = parseDecisionContext(decision?.context)?.act;
      if (!recordedAct || typeof recordedAct !== 'object' || Array.isArray(recordedAct)) {
        return NextResponse.json(
          {
            error: 'CONTAINMENT_ACT_MISSING',
            message: 'This database containment has no recorded act to replay — the guard decision that staged it is gone or carried no act.',
          },
          { status: 409 }
        );
      }
      promotionAct = recordedAct;
      // `!= null` on purpose: Number(null) is 0, which would silently record a
      // high-risk replay as a zero-risk one.
      const recordedRisk = fullRow?.risk_score != null ? Number(fullRow.risk_score) : NaN;
      if (Number.isFinite(recordedRisk)) promotionRiskScore = Math.max(0, Math.min(Math.round(recordedRisk), 100));
    }

    // Shared by the first-promote path and the re-issue-after-consumed path:
    // raise the synthetic grant row — same insert shape as POST
    // /api/actions / guard's ?record=true. Born 'running' (never
    // pending_approval): the operator's promote verdict IS the approval,
    // stamped explicitly below because createActionRecord's insert path
    // never accepts approved fields.
    const mintPromotionGrant = async (reasoning: string): Promise<string> => {
      const promotionActionId = `act_${crypto.randomUUID()}`;
      await createActionRecord(sql, {
        orgId,
        action_id: promotionActionId,
        data: {
          agent_id: action.agent_id as string | null | undefined,
          parent_action_id: actionId,
          action_type: 'containment_promote',
          declared_goal: buildPromotionGoal(actionId),
          act: buildPromotionAct(containmentRef as string, promotionAct),
          client_capabilities: ['execution_claims'],
          risk_score: promotionRiskScore,
          reversible: promotionReversible,
          reasoning,
        },
        actionStatus: 'running',
        signature: null,
        verified: false,
        timestamp_start: new Date().toISOString(),
        createdBy: userId,
      });
      await stampPromotionApproval(sql, orgId, promotionActionId, userId);
      return promotionActionId;
    };

    if (isReissue) {
      // Already 'promoted' — resolveContainment's WHERE-gate only matches
      // awaiting_promotion, so this branch never calls it; containment_status
      // is left exactly as-is (still 'promoted').
      //
      // Response-shape consistency: the other verdict paths return the full
      // row resolveContainment's RETURNING * produces; `action` here is the
      // 9-column getActionStatus subset, so re-fetch the full row (falling
      // back to the subset only if the row vanished mid-request).
      const fullAction = (await getActionRecord(sql, orgId, actionId)) ?? action;
      const existingGrant = await findUnconsumedPromotionGrant(
        sql,
        orgId,
        actionId,
        action.agent_id as string | null | undefined,
        computeActContentHash(buildPromotionAct(containmentRef as string, promotionAct)),
      );
      if (existingGrant) {
        // Grant was never consumed (merge never ran, or a prior merge is
        // still in flight) — re-stamp its 15-minute approval window instead
        // of minting a second grant row for the same containment_ref.
        await stampPromotionApproval(sql, orgId, String(existingGrant.action_id), userId);
        return NextResponse.json({ action: fullAction, promotion_action_id: existingGrant.action_id, reissued: true });
      }
      // Grant was consumed (a merge attempt ran — succeeded, or hit a
      // conflict and needs re-authorization) — mint a fresh grant, same as
      // the first-promote path.
      const promotionActionId = await mintPromotionGrant(
        `Operator re-promoted contained action ${actionId} (prior grant consumed)`
      );
      return NextResponse.json({ action: fullAction, promotion_action_id: promotionActionId, reissued: true });
    }

    const updated = await resolveContainment(sql, orgId, actionId, { verdict, resolvedBy: userId });
    // Zero-row return — another operator resolved it between our read above
    // and this UPDATE (same race shape as approvals' recordApproval).
    if (!updated) {
      return NextResponse.json({ error: 'CONTAINMENT_NOT_AWAITING' }, { status: 409 });
    }

    if (verdict === 'discard') {
      return NextResponse.json({ action: updated });
    }

    const promotionActionId = await mintPromotionGrant(`Operator promoted contained action ${actionId}`);

    return NextResponse.json({ action: updated, promotion_action_id: promotionActionId });
  } catch (error) {
    return apiErrorResponse(error, 'CONTAINMENT POST');
  }
}
