import crypto from 'node:crypto';
import { after } from 'next/server';
import { getSql } from '../db';
import { redactAny } from '../security';
import { createActionRecord, createBlockedActionRecord, getActionIdByIdempotencyKey } from '../repositories/actions.repository';
import { incrementTrialActionCount } from '../repositories/hosted-workspace.repository';
import { fireActionAlert } from '../actionAlerts';
import { fireApprovalSurfaces } from '../approvalSurfaces';
import { EVENTS, publishOrgEvent } from '../events';
import { buildContainmentRef, isContainableAct } from './containment';
import { getAssumptionAlerts } from '../assumption-notify';

export type GuardSql = ReturnType<typeof getSql>;
export type GuardData = Record<string, unknown> & { agent_id?: string; agent_name?: string; declared_goal?: string; verification_status?: string; confidence?: number };
export type GuardResult = { decision: string; risk_score?: number; decision_id?: string; reason?: string | null; reasons?: string[]; matched_policies?: string[]; containment?: { status: string; basis: string; ref: string } | null };

/**
 * Stated confidence (5.30.0): the agent's own 0-100 odds that this action
 * completes without a human stepping in, declared BEFORE the act so
 * /decisions can score the prediction against the real outcome. Advisory
 * only — it is stored on the action record and never read by evaluation,
 * risk_score, containment, buildReplayBinding or the idempotency key.
 *
 * Deliberately NOT in GUARD_INPUT_SCHEMA: a schema entry would 400 the guard
 * hot path on a bad value, and an optional advisory field must never gain the
 * power to refuse a governed call. A junk value is dropped instead, leaving
 * the column default (50) to read as "unstated".
 */
export function statedConfidence(value: unknown): number | undefined {
  const n = typeof value === 'number'
    ? value
    : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : undefined;
}


/**
 * ?record=true support: create the action record in-request (the same insert
 * POST /api/actions performs, via the shared repository functions — running/
 * pending for allow-ish verdicts, blocked for a block) so a governed hook
 * needs ONE HTTP call instead of guard + record. Additive — the response
 * without the param is unchanged.
 */
/**
 * The record path's idempotency read depends only on the request payload —
 * never on the guard decision — so the route starts it concurrently with the
 * evaluation and passes the settled result in.
 */
export interface PreparedRecordReads {
  existing: Record<string, unknown> | null;
}

export async function prepareRecordReads(sql: GuardSql, orgId: string, data: GuardData): Promise<PreparedRecordReads> {
  const existing = typeof data.idempotency_key === 'string' && data.idempotency_key
    ? await getActionIdByIdempotencyKey(sql, orgId, data.idempotency_key)
    : null;
  return { existing: existing as Record<string, unknown> | null };
}

/**
 * Two concurrent requests carrying
 * the SAME idempotency_key can both pass recordRunningAction's pre-insert
 * `reads.existing` lookup (neither has landed yet) and then race the
 * createActionRecord/createBlockedActionRecord INSERT. The DB's unique index
 * (drizzle/0004 action_records_idempotency_idx) lets exactly one insert win;
 * the loser used to surface as a bare recorded:false — a false negative,
 * since the action WAS recorded, by the winner. Same 23505-recovery shape as
 * invites.repository.ts createInvite: re-query by key and treat a found row
 * as success. Returns null (caller rethrows) for a non-recoverable error.
 */
export async function recoverIdempotentInsertRace(
  sql: GuardSql,
  orgId: string,
  idempotencyKey: unknown,
  err: unknown,
): Promise<Record<string, unknown> | null> {
  if ((err as { code?: string } | undefined)?.code !== '23505') return null;
  if (typeof idempotencyKey !== 'string' || !idempotencyKey) return null;
  return (await getActionIdByIdempotencyKey(sql, orgId, idempotencyKey)) as Record<string, unknown> | null;
}

export async function recordRunningAction(
  sql: GuardSql,
  orgId: string,
  data: GuardData,
  result: GuardResult,
  createdBy: string | null,
  prepared?: Promise<PreparedRecordReads | null> | null,
): Promise<{ recorded: boolean; action_id?: string; reason?: string; security?: Record<string, unknown> }> {
  if (!data.agent_id || !data.declared_goal) {
    return { recorded: false, reason: 'agent_id and declared_goal are required to record an action' };
  }

  const reads = (prepared ? await prepared : null) ?? await prepareRecordReads(sql, orgId, data);

  // Idempotency short-circuit, mirroring POST /api/actions: a retried call
  // returns the existing row instead of inserting a duplicate.
  if (reads.existing) {
    return { recorded: true, action_id: String(reads.existing.action_id ?? reads.existing.id) };
  }

  // Same redaction POST /api/actions applies before persisting.
  const record: Record<string, unknown> = { ...data };
  const dlpFindings: Array<{ severity?: string; category?: string }> = [];
  for (const k of ['agent_name', 'declared_goal', 'reasoning', 'authorization_scope', 'trigger', 'input_summary']) {
    if (record[k] != null) record[k] = redactAny(record[k], dlpFindings);
  }
  if (record.systems_touched != null) record.systems_touched = redactAny(record.systems_touched, dlpFindings);

  // FIX B1 (2026-08-14 adversarial review): mirror POST /api/actions'
  // `security` response field — dlpFindings was collected above and then
  // never read, so a hook could never learn ?record=true had redacted a
  // secret out of its payload.
  const security = {
    clean: dlpFindings.length === 0,
    findings_count: dlpFindings.length,
    critical_count: dlpFindings.filter((f) => f.severity === 'critical').length,
    categories: [...new Set(dlpFindings.map((f) => f.category))],
  };

  // Server-side stamp: links this record to the guard decision that produced
  // it so approval outcomes join back to matched_policies (policy-tuning
  // proposal loop, drizzle/0035). Overrides any client-supplied value.
  record.guard_decision_id = typeof result.decision_id === 'string' ? result.decision_id : null;

  // Blocked verdict: create the blocked action record in-request, reusing THIS
  // evaluation. The pre-5.10.1 contract returned recorded:false here and the
  // hook fell back to POST /api/actions, whose unconditional re-evaluation
  // wrote a second guard_decisions row — every block appeared twice in the
  // ledger. Same insert + side effects as the actions route's blocked path
  // (no trial-count increment: a blocked action never ran).
  if (result.decision === 'block') {
    const blocked_action_id = `act_${crypto.randomUUID()}`;
    let blockedAction: Record<string, unknown> | null;
    try {
      blockedAction = await createBlockedActionRecord(sql, {
        orgId,
        action_id: blocked_action_id,
        data: record as Parameters<typeof createBlockedActionRecord>[1]['data'],
        guardDecision: result,
        signature: null,
        verified: data.verification_status === 'verified',
        timestamp_start: new Date().toISOString(),
        riskScore: result.risk_score ?? null,
      }) as Record<string, unknown> | null;
    } catch (err) {
      const recovered = await recoverIdempotentInsertRace(sql, orgId, record.idempotency_key, err);
      if (recovered) return { recorded: true, action_id: String(recovered.action_id ?? recovered.id), security };
      throw err;
    }
    // after() keeps the invocation alive only until the value the callback
    // RETURNS settles: the earlier `void` on both calls made this callback
    // return undefined, so it resolved instantly and Vercel froze the function
    // mid-flight — the operator's "your agent was blocked" Discord alert
    // (settings read + decrypt + outbound POST) was dropped, which is the
    // exact failure after() is here to prevent (see the record path below).
    after(() => Promise.allSettled([
      publishOrgEvent(EVENTS.ACTION_CREATED, { orgId, action: blockedAction }),
      fireActionAlert('blocked', blockedAction as Record<string, unknown>, sql, orgId),
    ]));
    return { recorded: true, action_id: blocked_action_id, security };
  }

  // Containment Verdicts (drizzle/0064): a negotiated+eligible allow_contained
  // verdict starts the row's staged-effect lifecycle at 'contained'. Every
  // other decision leaves containment_status NULL (createActionRecord's
  // default passthrough). The merge target (containment_ref) is stamped HERE,
  // server-derived from the payload's harness_session_id (security follow-up,
  // RFC 2026-07-06) — the later awaiting_promotion flip can no longer supply
  // an attacker-controllable ref for a row that carries this stamp.
  // The basis rides with the ref: a `db_branch` verdict (RFC 2026-09-04)
  // stamps `dashclaw/contained-db-…` so the route, CLI and card all know the
  // staging medium was a database branch, not a worktree. The fallback
  // re-derives the basis from the same act the evaluator graded rather than
  // silently stamping a file-shaped ref onto a db verdict.
  if (result.decision === 'allow_contained') {
    record.containment_status = 'contained';
    record.containment_ref = result.containment?.ref
      ?? buildContainmentRef(
        data.harness_session_id,
        data.containment_instance,
        result.containment?.basis ?? isContainableAct({ act: data.act } as Parameters<typeof isContainableAct>[0]).basis,
      );
  }

  const action_id = `act_${crypto.randomUUID()}`;
  let createdAction: Record<string, unknown> | null;
  try {
    createdAction = await createActionRecord(sql, {
      orgId,
      action_id,
      data: record as Parameters<typeof createActionRecord>[1]['data'],
      actionStatus: result.decision === 'require_approval' ? 'pending_approval' : 'running',
      costEstimate: Math.max(0, Number(record.cost_estimate) || 0),
      signature: null,
      verified: data.verification_status === 'verified',
      timestamp_start: new Date().toISOString(),
      riskScore: result.risk_score ?? null,
      // Separation of duties (drizzle/0055): trusted middleware principal.
      createdBy,
    }) as Record<string, unknown> | null;
  } catch (err) {
    const recovered = await recoverIdempotentInsertRace(sql, orgId, record.idempotency_key, err);
    if (recovered) return { recorded: true, action_id: String(recovered.action_id ?? recovered.id), security };
    throw err;
  }

  // Same post-response side effects as POST /api/actions (event for the live
  // decision stream, hosted-trial action count). after() — not a bare
  // fire-and-forget promise — because on Vercel the function can freeze the
  // moment the response returns, dropping the increment.
  after(() => Promise.allSettled([
    publishOrgEvent(EVENTS.ACTION_CREATED, { orgId, action: createdAction }),
    incrementTrialActionCount(sql, orgId).catch((err: unknown) => {
      console.warn('[Guard] record=true background updates failed:', (err as Error).message);
    }),
  ]));

  // A require_approval verdict must notify operators the same way POST
  // /api/actions does — fireApprovalSurfaces (Telegram / Discord / webhook,
  // flood-budgeted) plus the pending_approval action alert. Without this the
  // single-call hook path parks approvals on /approvals silently.
  if (result.decision === 'require_approval' && createdAction) {
    fireApprovalSurfaces(createdAction as Record<string, unknown>, sql, orgId, {
      matched_policies: result.matched_policies ?? [],
      reason: result.reason ?? null,
    });
    after(() => fireActionAlert('pending_approval', createdAction as Record<string, unknown>, sql, orgId));
  }

  return { recorded: true, action_id, security };
}

/**
 * Advocate v2a advisory — rides on the response until acknowledged; never
 * changes the decision. Attached on both the replay path and the fresh
 * evaluation path.
 */
export async function attachAssumptionAlerts(
  sql: GuardSql,
  orgId: string,
  data: GuardData,
  target: Record<string, unknown>,
): Promise<void> {
  const alertAgent = typeof data.agent_id === 'string' && data.agent_id ? data.agent_id : null;
  if (alertAgent) {
    const alerts = await getAssumptionAlerts(sql, orgId, alertAgent);
    if (alerts && alerts.length) target.assumption_alerts = alerts;
  }
}
