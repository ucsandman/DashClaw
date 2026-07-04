export const dynamic = 'force-dynamic';
export const revalidate = 0;

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { evaluateGuard, verifyX402BudgetAfterInsert } from '../../../lib/guard';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { validateX402Purchase } from '../../../lib/validate.js';
import { resolveAgentIdentity } from '../../../lib/identity-resolution';
import { redactAny } from '../../../lib/security';
import { createActionRecord, createBlockedActionRecord, deleteActionsByIds, getActionSummary, markActionBlocked } from '../../../lib/repositories/actions.repository';
import { createPurchase, listPurchases, getProvider, getEndpoint, getPurchaseByIdempotencyKey, resolveProviderByName, setPurchaseOutcome } from '../../../lib/repositories/x402.repository';

/**
 * Mask a wallet/payment reference for storage and responses. We keep only the
 * last 4 characters for reconciliation; the rest is never persisted or echoed.
 * (R9) These are sensitive identifiers — unlike /api/actions, the x402 path
 * previously stored and echoed them raw, and scanSensitiveData does not match
 * crypto wallet formats.
 */
function maskReference(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v);
  return s.length <= 4 ? '****' : `****${s.slice(-4)}`;
}

/** Shape of the validated purchase data returned by validateX402Purchase. */
interface ValidatedPurchase {
  agent_id?: string;
  provider_id?: string;
  endpoint_id?: string;
  provider?: string;
  declared_goal?: string;
  purchase_reason?: string;
  context_gap?: string;
  expected_value?: string;
  alternatives_considered?: string;
  spend_amount?: number;
  currency?: string;
  payment_method?: string;
  wallet_reference?: string;
  payment_reference?: string;
  risk_score?: number;
  confidence_score?: number;
  idempotency_key?: string;
  [k: string]: unknown;
}

/** GET /api/x402/purchases — list governed purchases (org-scoped). */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const params = new URL(request.url).searchParams;
    const providerId = params.get('provider_id') || undefined;
    // agent_id is nullable on x402_purchases — filtering excludes unattributed rows.
    const agentId = params.get('agent_id') || undefined;
    const purchases = await listPurchases(sql, orgId, { providerId, agentId });
    return NextResponse.json({ purchases });
  } catch (err) {
    return apiErrorResponse(err, 'X402/PURCHASES GET');
  }
}

/**
 * POST /api/x402/purchases — govern + record a paid acquisition.
 * Governance boundary: DashClaw evaluates, blocks, holds-for-approval, and
 * records the purchase; the AGENT executes the actual x402 call + payment and
 * later reports outcome via POST /api/actions/[actionId]/outcome. DashClaw never
 * holds wallet credentials or executes payment.
 */
export async function POST(request: Request) {
  let orgId;
  let sql;
  let createdActionId: string | null = null;
  try {
    orgId = getOrgId(request);
    sql = getSql();
    const body = await request.json().catch(() => ({}));

    // (R4) Strict validation: rejects missing rationale, negative/NaN/Infinity
    // spend, malformed currency, and oversized free text BEFORE any work.
    const { valid, data, errors } = validateX402Purchase(body);
    if (!valid) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }
    const v = data as ValidatedPurchase;

    // Idempotency short-circuit (v3.7 5d). /api/actions and /api/guard already
    // short-circuit duplicate (org_id, idempotency_key) submissions; x402
    // purchases — the money route — was the one sibling without it, so a
    // client retry minted two action ids and two purchase rows, both counted
    // toward spend. Safe because the unique partial index on x402_purchases
    // (org_id, idempotency_key) (drizzle/0047) prevents a race-condition
    // double-insert even if two requests hit this code path simultaneously.
    if (v.idempotency_key) {
      const existingPurchase = await getPurchaseByIdempotencyKey(sql, orgId, v.idempotency_key);
      if (existingPurchase) {
        const existingAction = await getActionSummary(sql, orgId, existingPurchase.action_id);
        return NextResponse.json({
          action: existingAction,
          purchase: existingPurchase,
          idempotent_replay: true,
        });
      }
    }

    // (R3) Shared identity contract: a JWKS-verified JWT overrides the body
    // agent_id; otherwise identity is explicitly self-asserted (unverified).
    const identity = await resolveAgentIdentity(request, { agentId: v.agent_id, agentName: body.agent_name });
    const agentId = identity.agent_id;

    // (R5) Provider / endpoint integrity. Validate ONLY when an id is supplied.
    let providerRow = null;
    let endpointRow = null;
    if (v.provider_id) {
      providerRow = await getProvider(sql, orgId, v.provider_id);
      if (!providerRow) {
        return NextResponse.json({ error: 'Unknown provider_id for this organization' }, { status: 404 });
      }
      if (providerRow.status && providerRow.status !== 'active') {
        return NextResponse.json({ error: `Provider is not active (status: ${providerRow.status})` }, { status: 400 });
      }
    }
    if (v.endpoint_id) {
      endpointRow = await getEndpoint(sql, orgId, v.endpoint_id);
      if (!endpointRow) {
        return NextResponse.json({ error: 'Unknown endpoint_id for this organization' }, { status: 404 });
      }
      const endpointEnabled = endpointRow.enabled === 1 || (endpointRow.enabled as unknown) === true;
      if (!endpointEnabled) {
        return NextResponse.json({ error: 'Endpoint is disabled' }, { status: 400 });
      }
      if (v.provider_id && endpointRow.provider_id !== v.provider_id) {
        return NextResponse.json({ error: 'endpoint_id does not belong to the given provider_id' }, { status: 400 });
      }
      // R5 gap fix: an endpoint_id supplied WITHOUT a provider_id must still
      // enforce that the endpoint's parent provider is active.
      if (!providerRow && endpointRow.provider_id) {
        providerRow = await getProvider(sql, orgId, endpointRow.provider_id);
        if (providerRow && providerRow.status && providerRow.status !== 'active') {
          return NextResponse.json({ error: `Provider is not active (status: ${providerRow.status})` }, { status: 400 });
        }
      }
    }

    // (R6+) Resolve a provider_id for the purchase. Done before guard so
    // x402_spend_limit policies keyed by provider_id match name-only callers too.
    // Non-fatal: a governed purchase must never fail over an attribution nicety.
    let resolvedProviderId = v.provider_id || providerRow?.provider_id || null;
    if (!resolvedProviderId && v.provider) {
      try {
        const resolved = await resolveProviderByName(sql, orgId, v.provider);
        if (resolved) {
          providerRow = resolved;
          resolvedProviderId = resolved.provider_id;
        }
      } catch (provErr) {
        console.warn('[X402/PURCHASES] provider auto-resolve failed:', (provErr as Error)?.message || provErr);
      }
    }

    const action_id = `act_${crypto.randomUUID()}`;
    const timestamp_start = new Date().toISOString();

    // (D1 clamp — docs/architecture/trust-and-failure-model.md) Enforced
    // spend = max(declared, resolved endpoint price). Declared spend is an
    // attestation; when the org's own registry prices the endpoint, a lower
    // declaration must not walk under the spend gates. The declared figure
    // rides the audited guard context, and window sums store the enforced
    // amount so budgets count what the purchase can actually cost.
    const declaredSpend = Number(v.spend_amount ?? 0);
    const endpointPrice = endpointRow?.default_price != null ? Number(endpointRow.default_price) : null;
    const enforcedSpend = endpointPrice != null && Number.isFinite(endpointPrice) && endpointPrice > declaredSpend
      ? endpointPrice
      : declaredSpend;
    const spendClamped = enforcedSpend !== declaredSpend;

    // (R6) Pass BOTH the provider display name and the provider_id into the guard
    // context so x402_spend_limit allow/block lists match name- or id-keyed lists.
    const guardContext = {
      action_type: 'x402_purchase',
      agent_id: agentId,
      verification_status: identity.verification_status,
      provider: providerRow?.name || v.provider,
      provider_id: resolvedProviderId,
      declared_goal: v.declared_goal,
      cost_estimate: enforcedSpend,
      declared_spend_amount: declaredSpend,
      risk_score: v.risk_score ?? 0,
    };

    const guardDecision = await evaluateGuard(orgId, guardContext, sql);

    // (R1) Authoritative risk: store the SAME score the guard decided on.
    const clientRisk = Math.max(0, Math.min(Math.round(Number(v.risk_score) || 0), 100));
    const authoritativeRisk = guardDecision?.risk_score != null
      ? Math.max(0, Math.min(Math.round(Number(guardDecision.risk_score) || 0), 100))
      : clientRisk;

    // (F2/R9) DLP-redact ALL stored free text before persistence.
    const dlp: unknown[] = [];
    const declared_goal = redactAny(v.declared_goal, dlp) as string | null;
    const reasoning = redactAny(v.purchase_reason, dlp) as string | null;
    const input_summary = redactAny(v.context_gap, dlp) as string | null;
    const expectedValue = (v.expected_value != null ? redactAny(v.expected_value, dlp) : null) as string | null;
    const alternativesConsidered = (v.alternatives_considered != null ? redactAny(v.alternatives_considered, dlp) : null) as string | null;
    const agentName = (identity.agent_name != null ? redactAny(identity.agent_name, dlp) : null) as string | null;

    if (guardDecision.decision === 'block') {
      const blocked = await createBlockedActionRecord(sql, {
        orgId, action_id,
        data: {
          agent_id: agentId, agent_name: agentName, action_type: 'x402_purchase',
          declared_goal, reasoning, input_summary, risk_score: clientRisk,
        },
        guardDecision, signature: null, verified: identity.verified, timestamp_start,
        riskScore: authoritativeRisk,
      });
      return NextResponse.json({ action: blocked, decision: guardDecision }, { status: 403 });
    }

    const isPending = guardDecision.decision === 'require_approval';
    const actionStatus = isPending ? 'pending_approval' : 'running';

    const action = await createActionRecord(sql, {
      orgId, action_id,
      data: {
        agent_id: agentId,
        agent_name: agentName,
        action_type: 'x402_purchase',
        declared_goal,
        reasoning,
        input_summary,
        risk_score: clientRisk,
        // Approvals lifecycle (drizzle/0039): stamps approval_expires_at when
        // the guard decides require_approval.
        approval_wait_seconds: typeof v.approval_wait_seconds === 'number' ? v.approval_wait_seconds : null,
      },
      actionStatus,
      costEstimate: enforcedSpend,
      signature: null,
      verified: identity.verified,
      timestamp_start,
      riskScore: authoritativeRisk,
    });
    createdActionId = action_id;

    // (R7) Partial-write compensation: Neon HTTP has no multi-statement
    // transaction, so if the purchase-detail insert fails we delete the orphan
    // action rather than leaving an x402_purchase action_record with no detail.
    let purchase;
    try {
      purchase = await createPurchase(sql, orgId, action_id, {
        provider_id: resolvedProviderId,
        endpoint_id: v.endpoint_id,
        agent_id: agentId,
        spend_amount: enforcedSpend,
        currency: v.currency,
        payment_method: v.payment_method,
        wallet_reference: maskReference(v.wallet_reference),     // (R9)
        payment_reference: maskReference(v.payment_reference),   // (R9)
        purchase_reason: reasoning as string | null,
        context_gap: input_summary as string | null,
        alternatives_considered: alternativesConsidered as string | null,
        expected_value: expectedValue as string | null,
        confidence_score: v.confidence_score,
        execution_status: isPending ? 'pending' : 'approved',
        idempotency_key: v.idempotency_key || null,
      });
    } catch (purchaseErr) {
      await deleteActionsByIds(sql, orgId, [action_id]).catch((err: unknown) => {
        console.error('[X402] Compensation delete failed for action', action_id, ':', (err as Error)?.message);
      });
      createdActionId = null; // already compensated; don't double-delete in outer catch
      throw purchaseErr;
    }
    // Purchase detail committed: action + purchase are now consistent.
    createdActionId = null;

    // (R11) Budget TOCTOU close-out (security review 2026-07-02): the guard's
    // budget check ran BEFORE this purchase row existed, so N concurrent
    // purchases can each pass against the same pre-insert window sum. Re-verify
    // the hard budget now that the row is committed — the sum includes our own
    // row and any concurrent winners. On breach, compensate BEFORE the agent
    // executes payment: the purchase flips to failed (excluded from future
    // sums), the action flips to blocked (audit trail preserved), and the
    // request returns 403.
    const breach = await verifyX402BudgetAfterInsert(orgId, guardContext, sql);
    if (breach) {
      await setPurchaseOutcome(sql, orgId, action_id, {
        execution_status: 'failed',
        failure_reason: breach.reason,
        result_summary: 'Blocked by post-insert cumulative-budget re-verification',
      }).catch((err: unknown) => {
        console.error('[X402] budget re-verify: purchase flip failed for', action_id, ':', (err as Error)?.message);
      });
      const blockedAction = await markActionBlocked(sql, orgId, action_id, breach.reason).catch((err: unknown) => {
        console.error('[X402] budget re-verify: action flip failed for', action_id, ':', (err as Error)?.message);
        return null;
      });
      return NextResponse.json({
        action: blockedAction ?? { ...action, status: 'blocked' },
        decision: { ...guardDecision, decision: 'block', reasons: [...(guardDecision.reasons || []), breach.reason] },
      }, { status: 403 });
    }

    return NextResponse.json({
      action,
      purchase,
      decision: guardDecision,
      // (D1) The agent learns what was enforced, not just what it declared.
      spend_enforcement: { declared: declaredSpend, enforced: enforcedSpend, clamped: spendClamped },
    }, { status: isPending ? 202 : 201 });
  } catch (err) {
    // Best-effort compensation if we threw after creating the action.
    if (createdActionId && sql && orgId) {
      const orphanId = createdActionId;
      await deleteActionsByIds(sql, orgId, [orphanId]).catch((cleanupErr: unknown) => {
        console.error('[X402] Cleanup failed for action', orphanId, ':', (cleanupErr as Error)?.message);
      });
    }
    return apiErrorResponse(err, 'X402/PURCHASES POST');
  }
}
