export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId, getOrgRole, getUserId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { logActivity } from '../../../lib/audit';
import { redactAny } from '../../../lib/security';
import { clampInt } from '../../../lib/policy-tuning/engine';
import {
  isSyntheticEvent,
  mineOverScoredBenign,
  mineUnderScoredDanger,
  mineRepeatedApprovals,
  buildProposals,
} from '../../../lib/calibration-mining.js';
import {
  loadDecisionEventsForOrg,
  loadUploadedSampleEventsForOrg,
  getProposalDecisions,
  upsertProposalDecision,
  deleteProposalDecision,
  markProposalForged,
  type CalibrationDecisionRow,
} from '../../../lib/repositories/calibration.repository';

const PROPOSAL_ID_RE = /^cv_[a-f0-9]{16}$/;
const KEBAB_RE = /^[a-z0-9][a-z0-9-]*$/;
const RULES = new Set(['over_scored_benign', 'under_scored_danger', 'repeated_approvals']);
const STATUSES = new Set(['pending', 'ratified', 'dismissed', 'forged']);
const MAX_REASON_LENGTH = 500;

type ProposalStatus = 'pending' | 'ratified' | 'dismissed' | 'forged';

function statusOf(row: CalibrationDecisionRow | undefined): ProposalStatus {
  if (!row) return 'pending';
  if (row.decision === 'dismissed') return 'dismissed';
  return row.forged_at ? 'forged' : 'ratified';
}

function decisionSummary(row: CalibrationDecisionRow) {
  return {
    decision: row.decision,
    reason: row.reason ?? null,
    decided_by: row.decided_by ?? null,
    decided_at: row.decided_at,
    forged_at: row.forged_at ?? null,
    vector_name: row.vector_name ?? null,
  };
}

/**
 * GET /api/calibration/proposals — calibration-vector proposals computed on
 * read from the org's ledger (owner roadmap v2.6b; spec
 * docs/superpowers/specs/2026-07-02-calibration-proposals-human-surface-design.md).
 *
 * Same pure pipeline as the weekly miner (scripts/mine-calibration-candidates
 * .mjs), org-scoped, synthetic filter always on. Persisted human decisions
 * join by the content-stable cv_ id; ratified-not-forged decisions whose
 * shape aged out of the window still surface from their stored snapshot
 * (`from_snapshot: true`) so the maintainer queue never silently drops.
 *
 * Query: ?days=30 (7–90) · ?status=pending|ratified|dismissed|forged.
 */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const { searchParams } = new URL(request.url);
    const days = clampInt(searchParams.get('days'), 7, 90, 30);
    const statusFilter = searchParams.get('status');
    if (statusFilter !== null && !STATUSES.has(statusFilter)) {
      return NextResponse.json(
        { error: 'status must be pending|ratified|dismissed|forged' },
        { status: 400 },
      );
    }

    const [{ events: decisionEvents, truncated }, uploadedEvents, decisions] = await Promise.all([
      loadDecisionEventsForOrg(sql, orgId, days),
      loadUploadedSampleEventsForOrg(sql, orgId, days),
      getProposalDecisions(sql, orgId),
    ]);

    const allEvents = decisionEvents.concat(uploadedEvents);
    const events = allEvents.filter((e) => !isSyntheticEvent(e));

    const candidates = {
      over_scored_benign: mineOverScoredBenign(events),
      under_scored_danger: mineUnderScoredDanger(events),
      repeated_approvals: mineRepeatedApprovals(events),
    };
    const mined = buildProposals(candidates, {
      windowDays: days,
      generatedAt: new Date().toISOString(),
      topPerRule: 15,
    }) as Array<Record<string, unknown> & { candidate_id: string }>;

    const decisionById = new Map(decisions.map((d) => [d.proposal_id, d]));
    const minedIds = new Set(mined.map((p) => p.candidate_id));

    const proposals: Array<Record<string, unknown> & { status: ProposalStatus }> = mined.map(
      (p) => {
        const row = decisionById.get(p.candidate_id);
        return {
          ...p,
          // Same scrub the POST path applies before persisting: a ledger
          // declared_goal/command can embed a secret, and this echoes to the UI.
          representative: p.representative ? redactAny(p.representative, []) : null,
          status: statusOf(row),
          decision: row ? decisionSummary(row) : null,
        };
      },
    );

    // Ratified-but-not-forged decisions whose shape no longer mines in this
    // window: the human already judged them, the maintainer still owes the
    // forge — synthesize from the stored snapshot instead of dropping them.
    for (const row of decisions) {
      if (minedIds.has(row.proposal_id)) continue;
      if (row.decision !== 'ratified' || row.forged_at) continue;
      proposals.push({
        candidate_id: row.proposal_id,
        rule: row.rule,
        suggested_label: row.suggested_label,
        suggested_name: row.suggested_name,
        evidence_tier: null,
        count: null,
        risk_min: null,
        risk_max: null,
        event_ids: [],
        representative: row.representative ?? null,
        provenance: row.provenance,
        ratify_command: row.ratify_command,
        needs_manual_context: !row.ratify_command,
        from_snapshot: true,
        status: 'ratified' as ProposalStatus,
        decision: decisionSummary(row),
      });
    }

    const counts = { pending: 0, ratified: 0, dismissed: 0, forged: 0 };
    for (const p of proposals) counts[p.status as ProposalStatus] += 1;

    return NextResponse.json({
      window_days: days,
      inputs: {
        decisions: decisionEvents.length,
        decisions_truncated_at_limit: truncated,
        uploaded_samples: uploadedEvents.length,
        synthetic_excluded: allEvents.length - events.length,
      },
      proposals: statusFilter ? proposals.filter((p) => p.status === statusFilter) : proposals,
      counts,
    });
  } catch (err) {
    return apiErrorResponse(err, 'CALIBRATION_PROPOSALS GET');
  }
}

/** Validates the client-sent proposal snapshot for ratify/dismiss. Returns an error string or null. */
function validateSnapshot(p: Record<string, unknown> | null | undefined): string | null {
  if (!p || typeof p !== 'object') return 'proposal snapshot is required';
  if (typeof p.rule !== 'string' || !RULES.has(p.rule)) {
    return 'proposal.rule must be one of over_scored_benign|under_scored_danger|repeated_approvals';
  }
  if (p.suggested_label !== 'benign' && p.suggested_label !== 'risky') {
    return 'proposal.suggested_label must be benign|risky';
  }
  if (
    typeof p.suggested_name !== 'string' ||
    p.suggested_name.length > 64 ||
    !KEBAB_RE.test(p.suggested_name)
  ) {
    return 'proposal.suggested_name must be kebab-case (max 64 chars)';
  }
  if (typeof p.provenance !== 'string' || !p.provenance || p.provenance.length > 500) {
    return 'proposal.provenance is required (1-500 chars)';
  }
  if (
    p.ratify_command != null &&
    (typeof p.ratify_command !== 'string' || p.ratify_command.length > 1000)
  ) {
    return 'proposal.ratify_command must be a string (max 1000 chars) or null';
  }
  if (p.representative != null && typeof p.representative !== 'object') {
    return 'proposal.representative must be an object';
  }
  return null;
}

/**
 * POST /api/calibration/proposals — record the human's judgment. Admin-only.
 * Body: { action: 'ratify'|'dismiss', proposal_id, proposal, reason? }
 *       { action: 'undo', proposal_id }   (deletes the judgment; audit-logged)
 *       { action: 'mark_forged', proposal_id, vector_name }  (maintainer closes the loop)
 *
 * The snapshot is validated by shape only (id-format precedent from tuning
 * dismissals): this is an admin judgment ledger, and recomputing the whole
 * mine to verify existence on every click buys nothing. Constitution §3: the
 * corpus commit itself stays with the maintainer session — nothing here
 * touches the fixture.
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

    if (
      action !== 'ratify' &&
      action !== 'dismiss' &&
      action !== 'undo' &&
      action !== 'mark_forged'
    ) {
      return NextResponse.json(
        { error: 'action must be ratify, dismiss, undo, or mark_forged' },
        { status: 400 },
      );
    }
    if (typeof proposalId !== 'string' || !PROPOSAL_ID_RE.test(proposalId)) {
      return NextResponse.json({ error: 'proposal_id must match cv_<16 hex>' }, { status: 400 });
    }

    const sql = getSql();

    if (action === 'ratify' || action === 'dismiss') {
      const snapshot = body?.proposal as Record<string, unknown> | undefined;
      let reason: string | null = null;
      if (action === 'dismiss') {
        const raw = typeof body?.reason === 'string' ? body.reason.trim() : '';
        if (!raw || raw.length > MAX_REASON_LENGTH) {
          return NextResponse.json(
            { error: `reason is required (1-${MAX_REASON_LENGTH} chars)` },
            { status: 400 },
          );
        }
        // SECURITY: redact likely secrets before storing human reasoning —
        // same convention as the approvals + tuning routes.
        reason = redactAny(raw, []) as string;
      }
      const snapshotError = validateSnapshot(snapshot);
      if (snapshotError) {
        return NextResponse.json({ error: snapshotError }, { status: 400 });
      }
      const s = snapshot as Record<string, unknown>;
      const representative =
        s.representative == null
          ? null
          : (redactAny(s.representative, []) as Record<string, unknown>);

      const row = await upsertProposalDecision(sql, orgId, {
        proposalId,
        rule: s.rule as string,
        decision: action === 'ratify' ? 'ratified' : 'dismissed',
        suggestedLabel: s.suggested_label as string,
        suggestedName: s.suggested_name as string,
        provenance: s.provenance as string,
        ratifyCommand: (s.ratify_command as string | null) ?? null,
        representative,
        reason,
        decidedBy: userId,
      });
      logActivity(
        {
          orgId,
          actorId: userId,
          action: `calibration_proposal.${action === 'ratify' ? 'ratified' : 'dismissed'}`,
          resourceType: 'calibration_proposal',
          resourceId: proposalId,
          details: { rule: s.rule, suggested_name: s.suggested_name, ...(reason ? { reason } : {}) },
          request,
        },
        sql,
      );
      return NextResponse.json({ ok: true, proposal_id: proposalId, decision: row ?? null });
    }

    if (action === 'undo') {
      const removed = await deleteProposalDecision(sql, orgId, proposalId);
      if (!removed) {
        return NextResponse.json({ error: 'No decision recorded for this proposal' }, { status: 404 });
      }
      logActivity(
        {
          orgId,
          actorId: userId,
          action: 'calibration_proposal.undone',
          resourceType: 'calibration_proposal',
          resourceId: proposalId,
          details: {},
          request,
        },
        sql,
      );
      return NextResponse.json({ ok: true, proposal_id: proposalId, removed: true });
    }

    // mark_forged
    const vectorName = body?.vector_name;
    if (typeof vectorName !== 'string' || vectorName.length > 64 || !KEBAB_RE.test(vectorName)) {
      return NextResponse.json(
        { error: 'vector_name must be kebab-case (max 64 chars)' },
        { status: 400 },
      );
    }
    const result = await markProposalForged(sql, orgId, proposalId, vectorName);
    if (result === 'not_found') {
      return NextResponse.json({ error: 'No decision recorded for this proposal' }, { status: 404 });
    }
    if (result === 'not_ratified') {
      return NextResponse.json(
        { error: 'Only a ratified proposal can be marked forged' },
        { status: 409 },
      );
    }
    logActivity(
      {
        orgId,
        actorId: userId,
        action: 'calibration_proposal.forged',
        resourceType: 'calibration_proposal',
        resourceId: proposalId,
        details: { vector_name: vectorName },
        request,
      },
      sql,
    );
    return NextResponse.json({ ok: true, proposal_id: proposalId, forged: true });
  } catch (err) {
    return apiErrorResponse(err, 'CALIBRATION_PROPOSALS POST');
  }
}
