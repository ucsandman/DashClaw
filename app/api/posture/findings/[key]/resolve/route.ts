export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSql } from '../../../../../lib/db';
import { getOrgId, getUserId } from '../../../../../lib/org';
import { apiErrorResponse } from '../../../../../lib/apiErrors';
import { computePosturePayload } from '../../../../../lib/posture/signals';
import { setFindingState } from '../../../../../lib/repositories/posture.repository';
import { insertPolicy } from '../../../../../lib/repositories/guardrails.repository';
import { validatePolicy } from '../../../../../lib/validate.js';
import { EVENTS, publishOrgEvent } from '../../../../../lib/events';
import type { PostureFinding } from '../../../../../lib/posture/types';

type ResolveAction = 'create_draft' | 'snooze' | 'accept_risk';
const VALID_ACTIONS = new Set<ResolveAction>(['create_draft', 'snooze', 'accept_risk']);

/**
 * POST /api/posture/findings/[key]/resolve
 *
 * Body: { action: 'create_draft' | 'snooze' | 'accept_risk', note?: string }
 *
 * - create_draft → insert an INACTIVE guard_policies row (active=0) from the
 *   finding's prefilled fix, and mark the finding `drafted` (NOT `resolved`).
 *   THE HONESTY PROPERTY: drafting never raises the score. The draft is inert
 *   until a human activates it at /policies; only then — and only once a rescan
 *   proves it fires — does coverage (and the score) rise. The score engine only
 *   replays active policies, so an inactive draft cannot change the number.
 * - snooze / accept_risk → record state + actor + note; the finding leaves the
 *   open queue and appears in the risk-accepted ledger (audit trail).
 *
 * Resolve is DRAFT-ONLY: this route can never activate enforcement. (CLI/MCP
 * callers inherit the same ceiling — an agent can prepare a fix, never enable it.)
 */
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const actor = getUserId(request) || null; // getUserId returns '' (not null) when unattributed → store a clean NULL

    const body = await request.json().catch(() => ({})) as { action?: string; note?: string };
    const action = body.action as ResolveAction | undefined;
    const note = typeof body.note === 'string' ? body.note : null;

    if (!action || !VALID_ACTIONS.has(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${[...VALID_ACTIONS].join(', ')}` },
        { status: 400 },
      );
    }

    // snooze / accept_risk: pure state record (the finding may no longer derive
    // if its gap has since closed — recording the operator's decision is still
    // valid and keeps it out of the queue / in the ledger).
    if (action === 'snooze' || action === 'accept_risk') {
      const status = action === 'snooze' ? 'snoozed' : 'accepted_risk';
      const state = await setFindingState(sql, orgId, key, status, actor, note);
      return NextResponse.json({ resolved: true, action, status, state });
    }

    // create_draft: needs the finding's prefilled fix → recompute and locate it.
    const { findings } = await computePosturePayload(sql, orgId);
    const finding = findings.find((f: PostureFinding) => f.key === key);
    if (!finding) {
      return NextResponse.json({ error: 'Finding not found' }, { status: 404 });
    }
    if (finding.fix.type !== 'create_policy_draft') {
      return NextResponse.json(
        { error: `Finding fix type "${finding.fix.type}" cannot be resolved via create_draft` },
        { status: 400 },
      );
    }

    const { policyType, rules } = finding.fix;
    const name = `Posture: ${finding.title}`.slice(0, 256);
    const rulesJson = JSON.stringify(rules);

    // The draft is org-wide (agent_ids null) and INACTIVE (active=0).
    const validation = validatePolicy({
      name, policy_type: policyType, rules: rulesJson, active: 0,
    }) as { valid: boolean; errors: string[] };
    if (!validation.valid) {
      return NextResponse.json({ error: 'Invalid policy draft', details: validation.errors }, { status: 400 });
    }

    const id = `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const policy = await insertPolicy(sql, orgId, {
      id, name, policyType, rules: rulesJson, agentIds: null, active: 0,
    });

    // Mark the finding `drafted` (NOT `resolved`) — the gap is still open until
    // the policy is activated and proven to fire.
    const state = await setFindingState(sql, orgId, key, 'drafted', actor, note);

    // Best-effort feed event so the draft surfaces on /policies; never fail the
    // resolve on a publish error.
    try {
      if (EVENTS?.POLICY_UPDATED) {
        void publishOrgEvent(EVENTS.POLICY_UPDATED, {
          orgId, change_type: 'created', policy_id: id, source: 'posture',
        });
      }
    } catch { /* non-fatal */ }

    return NextResponse.json({
      resolved: true,
      action,
      status: 'drafted',
      policy,
      state,
      finding: { ...finding, status: 'drafted' },
      note: 'Created as an INACTIVE draft (active=0). Drafting does not raise the posture score — activate it at /policies and rescan to prove it fires.',
    });
  } catch (error) {
    return apiErrorResponse(error, 'POSTURE RESOLVE');
  }
}
