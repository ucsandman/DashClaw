export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse, after } from 'next/server';
import { getSql } from '../../lib/db';
import { validateActionRecord, boundedIdField } from '../../lib/validate.js';
import { getOrgId, getOrgRole, getUserId } from '../../lib/org';
import { logActivityStrict } from '../../lib/audit';
import { apiErrorResponse } from '../../lib/apiErrors';
import { verifyAgentSignature } from '../../lib/identity';
import { resolveAgentIdentity } from '../../lib/identity-resolution';
import { estimateCost } from '../../lib/billing';
import { EVENTS, publishOrgEvent } from '../../lib/events';
import { evaluateGuard } from '../../lib/guard';
import { fireActionAlert } from '../../lib/actionAlerts';
import { fireNewConnectAlert } from '../../lib/notification-adapters/discord';
import { fireApprovalSurfaces } from '../../lib/approvalSurfaces';
import { redactAny } from '../../lib/security';
import { incrementTrialActionCount } from '../../lib/repositories/hosted-workspace.repository';
import {
  createActionRecord,
  createBlockedActionRecord,
  deleteActionsByIds,
  getActionByIdempotencyKey,
  hasAgentAction,
  isFirstActionForOrg,
  listActionIdsByFilter,
  listActions,
  maybeSweepLostOutcomes,
  sweepExpiredApprovals,
} from '../../lib/repositories/actions.repository';
import { getModelPricing, getSettings } from '../../lib/repositories/settings.repository';
import { guardDecisionExists } from '../../lib/repositories/guard.repository';
import crypto from 'crypto';

const GUARD_DECISION_ID_RE = /^act_gd_[a-f0-9]{16}$/;



export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const agent_id = searchParams.get('agent_id') || undefined;
    const swarm_id = searchParams.get('swarm_id') || undefined;
    const status = searchParams.get('status') || undefined;
    const exclude_status = searchParams.get('exclude_status') || undefined;
    const action_type = searchParams.get('action_type') || undefined;
    const risk_min = searchParams.get('risk_min') || undefined;
    const outcome_status = searchParams.get('outcome_status') || undefined;
    // Optional rolling window (1-365 days). Scopes the returned `total` and
    // `stats` too — the activity narrative reads that windowed total instead
    // of a LIMIT-capped buffer length.
    const days = searchParams.get('days') || undefined;
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Lazy zombie reconciliation: flip stale running/pending rows whose
    // outcome timed out to status='unknown' before listing, so the ledger
    // stops implying work is in flight. Throttled per org (10 min) inside the
    // helper; the cron outcome-sweep remains the primary reconciler where a
    // scheduler exists. Best-effort — a failure never blocks the list.
    const reconciled = await maybeSweepLostOutcomes(sql, orgId).catch((err: unknown) => {
      console.warn('[ACTIONS GET] lazy outcome sweep failed:', (err as Error)?.message);
      return [] as Awaited<ReturnType<typeof maybeSweepLostOutcomes>>;
    });
    if (reconciled.length > 0) {
      void publishOrgEvent(EVENTS.ACTION_UPDATED, {
        orgId,
        bulk: { decision: 'lost_confirmation', resolved: reconciled.length, action_ids: reconciled.map((r) => String(r.action_id)) },
      });
    }

    // Lazy expiry sweep (roadmap v2.3): the approval queue is exactly where a
    // dead pending row would be mistaken for an approvable one, so flip
    // overdue rows before listing (x402 reconcile rides inside the sweep).
    // No cron on the free tier — this piggybacks on the page load that would
    // otherwise show the lie.
    if (status === 'pending_approval') {
      const swept = await sweepExpiredApprovals(sql, orgId).catch((err: unknown) => {
        console.warn('[ACTIONS GET] approval expiry sweep failed:', (err as Error)?.message);
        return [] as Awaited<ReturnType<typeof sweepExpiredApprovals>>;
      });
      if (swept.length > 0) {
        // One aggregate event (not N): dashboards refresh, and since a second
        // sweep flips nothing, this cannot loop with the realtime refetch.
        void publishOrgEvent(EVENTS.ACTION_UPDATED, {
          orgId,
          bulk: { decision: 'expire', resolved: swept.length, action_ids: swept.map((r) => String(r.action_id)) },
        });
      }
    }

    // Expired-section cursor ("Clear expired" on /approvals): hide rows whose
    // wait window ended at/before the org's cleared-at watermark. View state
    // only — the ledger rows are untouched. Best-effort: no setting, or a
    // failed read, means no filter.
    let expired_after: string | undefined;
    if (status === 'expired') {
      const cursor = await getSettings(sql, orgId, { key: 'approvals_expired_cleared_at' })
        .catch((err: unknown) => {
          console.warn('[ACTIONS GET] expired-cleared cursor read failed:', (err as Error)?.message);
          return [];
        });
      const value = cursor[0]?.value;
      if (typeof value === 'string' && value) expired_after = value;
    }

    const result = await listActions(sql, orgId, {
      agent_id,
      swarm_id,
      status,
      exclude_status,
      action_type,
      risk_min,
      outcome_status,
      days,
      expired_after,
      limit,
      offset,
    });

    return NextResponse.json({
      actions: result.actions,
      total: result.total,
      stats: result.stats,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    return apiErrorResponse(error, 'ACTIONS GET');
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const { valid, data, errors } = validateActionRecord(body);
    if (!valid) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    // Fleet attribution (v4.3): the pretool hook stamps the harness session uuid
    // (fan-out grouping key) on every record, and the subagent instance uuid on
    // a leaf call. Threaded through the validator's field bag so both the normal
    // and blocked create paths persist them; sanitize to ≤ 200 chars (else null).
    data.harness_session_id = boundedIdField(body.harness_session_id);
    data.subagent_uuid = boundedIdField(body.subagent_uuid);

    // Idempotency short-circuit. If the caller supplied an idempotency_key and
    // we already have a row for (org_id, idempotency_key), return that row
    // instead of doing duplicate work. Safe because the unique index on
    // action_records (org_id, idempotency_key) prevents a race-condition
    // double-insert even if two requests hit this code path simultaneously
    // — the second INSERT will fail and a retry resolves through this read.
    // Idempotency stays a SERIAL gate: a replayed key must return the
    // existing row without doing any other work (pinned by the route test),
    // so the batched reads below must not have started yet.
    const existingIdem = data.idempotency_key
      ? await getActionByIdempotencyKey(sql, orgId, data.idempotency_key)
      : null;

    if (data.idempotency_key) {
      const existing = existingIdem;
      if (existing) {
        return NextResponse.json({
          action: existing,
          // Top-level convenience alias, matching the fresh-create response —
          // without it, clients reading response.action_id break only on the
          // replay path (the SDKs auto-send idempotency keys, so any retried
          // goal hit this).
          action_id: (existing as Record<string, unknown>).action_id,
          idempotent_replay: true,
        });
      }
    }

    // Independent gate reads, batched (hot-path latency): guard-decision
    // validation, the agent-known probe, and the signature-enforcement setting
    // all depend only on the request payload. Running them concurrently
    // collapses serial round trips into one wait; the results are applied below
    // in the exact order the serial code checked them.
    const gdidRaw = data.guard_decision_id != null ? String(data.guard_decision_id) : null;
    const [gdValid, agentKnown, enforcementSettings] = await Promise.all([
      gdidRaw
        ? (GUARD_DECISION_ID_RE.test(gdidRaw) ? guardDecisionExists(sql, orgId, gdidRaw) : Promise.resolve(false))
        : Promise.resolve(true),
      data.agent_id ? hasAgentAction(sql, orgId, data.agent_id) : Promise.resolve(false),
      getSettings(sql, orgId, { key: 'ENFORCE_AGENT_SIGNATURES' }).catch(() => null),
    ]);

    // SECURITY: a client-supplied guard_decision_id must be exactly the
    // server's decision-id format AND resolve to a same-org guard decision —
    // otherwise policy-tuning evidence could be pointed at foreign or
    // nonexistent decisions (2026-07-01 security review, LOW). The
    // ?record=true guard path stamps this server-side and never trusts the
    // client value.
    if (!gdValid) {
      return NextResponse.json(
        { error: 'guard_decision_id does not match a guard decision in this org' },
        { status: 400 },
      );
    }

    // SECURITY (R3): shared identity contract. A JWKS-verified JWT's `sub`
    // overrides the self-asserted body agent_id (cryptographic proof beats
    // self-assertion); without a verified token the identity stays self-asserted
    // and is NOT marked verified. Same resolver /api/guard and /api/x402 use, so
    // identity semantics are consistent across every action-creating route.
    const identity = await resolveAgentIdentity(request, { agentId: data.agent_id, agentName: data.agent_name });
    data.agent_id = identity.agent_id;
    if (identity.agent_name != null) data.agent_name = identity.agent_name;
    // Record verification status in the guard context so the guard_decisions
    // audit row agrees with the action's persisted `verified` flag.
    data.verification_status = identity.verification_status;

    // SECURITY: redact likely secrets before storing the action record.
    // Signature verification is performed against the original payload below, not the redacted copy.
    const dlpFindings: Array<{ severity?: string; category?: string }> = [];
    for (const k of [
      'agent_name',
      'declared_goal',
      'reasoning',
      'authorization_scope',
      'trigger',
      'input_summary',
      'output_summary',
      'error_message',
    ]) {
      if (data[k] != null) data[k] = redactAny(data[k], dlpFindings);
    }
    if (data.systems_touched != null) data.systems_touched = redactAny(data.systems_touched, dlpFindings);
    if (data.side_effects != null) data.side_effects = redactAny(data.side_effects, dlpFindings);
    if (data.artifacts_created != null) data.artifacts_created = redactAny(data.artifacts_created, dlpFindings);

    // Agent enrollment check: closed-enrollment mode rejects unknown agent_ids.
    let isNewAgent = false;
    if (data.agent_id) {
      isNewAgent = !agentKnown;

      // SECURITY: Closed enrollment mode — reject unknown agent_ids
      if (isNewAgent && process.env.DASHCLAW_CLOSED_ENROLLMENT === 'true') {
        return NextResponse.json(
          { error: 'Agent not registered. Enable open enrollment or pre-register this agent.', code: 'AGENT_NOT_REGISTERED' },
          { status: 403 }
        );
      }
    }

    // Generate action_id if not provided
    const action_id = data.action_id || `act_${crypto.randomUUID()}`;
    const timestamp_start = data.timestamp_start || new Date().toISOString();

    // Identity Verification
    const signature = body._signature || null;
    // Seed from the shared resolver: a JWKS-verified JWT already established
    // verified identity above. The optional RSA signature path can also set it.
    let verified = identity.verified;
    // Opt-in: set ENFORCE_AGENT_SIGNATURES=true to require signed agent actions.
    // Default OFF — signatures are an advanced feature, not a setup prerequisite.
    // Check DB setting first (runtime-toggleable), fall back to env var
    let enforceSignatures = process.env.ENFORCE_AGENT_SIGNATURES === 'true';
    // Setting read in the batch above; a failed read (settings table may not
    // exist yet) resolved null — the env var fallback applies, as before.
    if (enforcementSettings && enforcementSettings.length > 0) {
      enforceSignatures = enforcementSettings[0]?.value === 'true';
    }

    if (enforceSignatures && !signature) {
      return NextResponse.json(
        { error: 'Signature required', code: 'SIGNATURE_REQUIRED' },
        { status: 401 }
      );
    }

    if (signature && data.agent_id) {
      // verify against the exact payload received (minus signature)
      const { _signature: s, ...payload } = body;
      const sigVerified = await verifyAgentSignature(orgId, data.agent_id, payload, signature, sql);
      // Either a verified JWT or a valid signature counts as verified identity.
      verified = verified || sigVerified;

      if (!sigVerified && enforceSignatures) {
        return NextResponse.json(
          { error: 'Invalid agent signature', code: 'INVALID_AGENT_SIGNATURE' },
          { status: 401 }
        );
      }
    }

    // BEHAVIOR GUARD EVALUATION
    const guardContext: Record<string, unknown> = {
      ...data,
      agent_id: data.agent_id
    };
    const guardDecision = await evaluateGuard(orgId, guardContext, sql);
    // The evidence-first fold may swap the evaluation onto the evidence-
    // derived action_type. Persist THAT type — it keeps the ledger consistent
    // with guard_decisions AND with the guard?record=true path (which mutates
    // its context in place), so the operator-approval grant finds this row on
    // retry: the retry re-runs the same fold and looks up the swapped type.
    if (typeof guardContext.action_type === 'string' && guardContext.action_type !== data.action_type) {
      data.action_type = guardContext.action_type;
    }

    // SECURITY (R1): persist the SAME authoritative risk the guard decided on, so
    // action_records is consistent with guard_decisions (plan §3.3). The client's
    // contribution is already folded in by the engine (effectiveRiskScore =
    // max(server, client)), so we store guardDecision.risk_score verbatim — never
    // the forgeable raw `data.risk_score`. Fall back to the clamped client value
    // only if the guard somehow omitted a score.
    const clientRisk = Math.max(0, Math.min(Math.round(Number(data.risk_score) || 0), 100));
    const authoritativeRisk = guardDecision?.risk_score != null
      ? Math.max(0, Math.min(Math.round(Number(guardDecision.risk_score) || 0), 100))
      : clientRisk;

    if (guardDecision.decision === 'block') {
      // Create a blocked action record for ledger visibility
      // This ensures blocked decisions appear in Decisions Ledger and contribute to agent discovery
      const blockedAction = await createBlockedActionRecord(sql, {
        orgId,
        action_id,
        data: data as { action_type: string } & Record<string, unknown>,
        guardDecision,
        signature,
        verified,
        timestamp_start,
        riskScore: authoritativeRisk,
      });

      // Emit real-time event so Mission Control feed shows the blocked decision
      void publishOrgEvent(EVENTS.ACTION_CREATED, {
        orgId,
        action: blockedAction,
      });

      fireActionAlert('blocked', blockedAction as Record<string, unknown>, sql, orgId);

      return NextResponse.json({
        error: 'Action blocked by policy',
        action: blockedAction,
        decision: guardDecision
      }, { status: 403 });
    }

    const isPendingApproval = guardDecision.decision === 'require_approval';
    const actionStatus = isPendingApproval ? 'pending_approval' : (data.status || 'running');

    // Auto-calculate cost if tokens are provided
    // SECURITY: Clamp agent-reported cost/token values to reasonable bounds
    const MAX_TOKENS = 10_000_000;
    const MAX_COST_USD = 10_000;
    if (data.tokens_in !== undefined) data.tokens_in = Math.max(0, Math.min(Number(data.tokens_in) || 0, MAX_TOKENS));
    if (data.tokens_out !== undefined) data.tokens_out = Math.max(0, Math.min(Number(data.tokens_out) || 0, MAX_TOKENS));
    if (data.cost_estimate !== undefined) data.cost_estimate = Math.max(0, Math.min(Number(data.cost_estimate) || 0, MAX_COST_USD));

    let costEstimate = data.cost_estimate || 0;
    if ((data.tokens_in || data.tokens_out) && !data.cost_estimate) {
      const customPricing = await getModelPricing(sql, orgId);
      costEstimate = estimateCost(data.tokens_in || 0, data.tokens_out || 0, data.model, customPricing as Parameters<typeof estimateCost>[3]);
    }

    const createdAction = await createActionRecord(sql, {
      orgId,
      action_id,
      data: data as { action_type: string } & Record<string, unknown>,
      actionStatus,
      costEstimate,
      signature,
      verified,
      timestamp_start,
      riskScore: authoritativeRisk,
      // Separation of duties (drizzle/0055): trusted middleware principal,
      // never the body — approvals reject approver === created_by.
      createdBy: getUserId(request) || null,
    });

    // Hosted-trial counter: no-ops silently for non-hosted orgs via WHERE hosted_mode = TRUE.
    // after() keeps the lambda alive until the write settles — un-awaited writes
    // get killed when the response ends on Vercel.
    after(() => incrementTrialActionCount(sql, orgId).catch((err: unknown) => {
      console.warn('[HOSTED] trial counter increment failed:', (err as Error).message);
    }));

    const response = NextResponse.json({
      action: createdAction,
      action_id,
      decision: guardDecision,
      security: {
        clean: dlpFindings.length === 0,
        findings_count: dlpFindings.length,
        critical_count: dlpFindings.filter(f => f.severity === 'critical').length,
        categories: [...new Set(dlpFindings.map(f => f.category))],
      },
    }, { status: isPendingApproval ? 202 : 201 });

    // Emit real-time event
    void publishOrgEvent(EVENTS.ACTION_CREATED, {
      orgId,
      action: createdAction,
    });

    // Real-time Discord alerts for notable actions — use after() so work
    // continues after the response is sent (Vercel freezes the lambda once
    // the response returns unless after() is used).
    if (isPendingApproval) {
      after(() => fireActionAlert('pending_approval', createdAction as Record<string, unknown>, sql, orgId));
    } else {
      after(() => fireActionAlert('high_risk', createdAction as Record<string, unknown>, sql, orgId));
    }

    fireApprovalSurfaces(createdAction as Record<string, unknown>, sql, orgId, guardDecision as Record<string, unknown> | null);

    // Launch-window new-connect alert (DOG-04 telemetry).
    // Fires only if this is the org's first action_record AND the webhook
    // env var is configured. Fire-and-forget: never awaits, never blocks
    // the response. Repository helper keeps route-SQL guardrail clean.
    if (process.env.DASHCLAW_NEW_CONNECT_WEBHOOK) {
      after(() => {
        isFirstActionForOrg(sql, orgId, action_id)
          .then((isFirst: boolean) => {
            return isFirst ? fireNewConnectAlert({ orgId, agentId: data.agent_id }) : undefined;
          })
          .catch((err: unknown) => {
            console.warn('[NewConnectAlert] probe failed:', (err as { message?: string })?.message || err);
          });
      });
    }

    return response;
  } catch (error) {
    if ((error as Error).message?.includes('unique') || (error as Error).message?.includes('duplicate')) {
      return NextResponse.json({ error: 'Action with this action_id already exists' }, { status: 409 });
    }
    return apiErrorResponse(error, 'ACTIONS POST');
  }
}

/**
 * DELETE /api/actions — Delete actions by filter (admin only).
 *
 * Query params (at least one required):
 *   ?before=2026-02-01   — delete actions with timestamp_start before this date
 *   ?agent_id=X          — scope to a specific agent
 *   ?status=completed    — scope to a specific status
 *   ?action_id=act_xxx   — delete a single action by ID
 */
export async function DELETE(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const role = getOrgRole(request);
    const userId = getUserId(request);

    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const before = searchParams.get('before');
    const agentId = searchParams.get('agent_id');
    const status = searchParams.get('status');
    const actionId = searchParams.get('action_id');

    const actionIds = searchParams.get('action_ids');

    // Deleting governed-action rows removes history from the decision ledger, so
    // the erasure must itself be an append-only audit event (who, how many,
    // which filter). WRITE-AHEAD and AWAITED: the audit row lands before any
    // row is deleted, and if it cannot be written the deletion fails closed —
    // a fire-and-forget audit here previously meant an erasure could complete
    // with its only forensic trace silently dropped.
    const auditDeletion = (targetIds: string[], filter: Record<string, unknown>) =>
      logActivityStrict({
        orgId, actorId: userId || 'unknown', action: 'action.deleted',
        resourceType: 'action', resourceId: targetIds.length === 1 ? targetIds[0] : undefined,
        details: { deleted_count: targetIds.length, action_ids: targetIds.slice(0, 100), filter }, request,
      }, sql);

    // Bulk delete by specific IDs: ?action_ids=act_1,act_2,act_3
    if (actionIds) {
      const idList = actionIds.split(',').map(id => id.trim()).filter(Boolean);
      if (idList.length === 0) {
        return NextResponse.json({ error: 'No valid ids provided' }, { status: 400 });
      }
      await auditDeletion(idList, { action_ids: idList });
      const result = await deleteActionsByIds(sql, orgId, idList);
      const deletedIds = result.map((r: Record<string, any>) => r.action_id);
      return NextResponse.json({ deleted: result.length, action_ids: deletedIds });
    }

    // Single action deletion
    if (actionId) {
      await auditDeletion([actionId], { action_id: actionId });
      const result = await deleteActionsByIds(sql, orgId, [actionId]);
      const deletedIds = result.map((r: Record<string, any>) => r.action_id);
      return NextResponse.json({ deleted: result.length, action_ids: deletedIds });
    }

    // Bulk deletion requires at least one filter to prevent accidental wipe
    if (!before && !agentId && !status) {
      return NextResponse.json({ error: 'At least one filter required: before, agent_id, or status' }, { status: 400 });
    }

    let paramIdx = 1;
    const conditions = [`org_id = $${paramIdx++}`];
    const params: unknown[] = [orgId];

    if (before) {
      conditions.push(`timestamp_start::timestamptz < $${paramIdx++}::timestamptz`);
      params.push(before);
    }
    if (agentId) {
      conditions.push(`agent_id = $${paramIdx++}`);
      params.push(agentId);
    }
    if (status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(status);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const filter = { before: before || undefined, agent_id: agentId || undefined, status: status || undefined };

    // Resolve the target set first so the write-ahead audit row can name the
    // ids being erased. A row inserted between this read and the DELETE below
    // survives (the audit names what was requested at decision time).
    const targetIds = await listActionIdsByFilter(sql, orgId, { before, agentId, status });
    await auditDeletion(targetIds, filter);

    // Clean up related loops + assumptions first
    await sql.query(
      `DELETE FROM open_loops WHERE org_id = $1 AND action_id IN (SELECT action_id FROM action_records ${where})`,
      params
    );
    await sql.query(
      `DELETE FROM assumptions WHERE org_id = $1 AND action_id IN (SELECT action_id FROM action_records ${where})`,
      params
    );

    const result = await sql.query(
      `DELETE FROM action_records ${where} RETURNING action_id`,
      params
    );

    return NextResponse.json({ deleted: result.length });
  } catch (error) {
    return apiErrorResponse(error, 'ACTIONS DELETE');
  }
}
