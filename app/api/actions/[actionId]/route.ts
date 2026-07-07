export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql as getDbSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { validateActionOutcome } from '../../../lib/validate.js';
import { getOrgId } from '../../../lib/org';
import { EVENTS, publishOrgEvent } from '../../../lib/events';
import { redactAny } from '../../../lib/security';
import { estimateCost } from '../../../lib/billing';
import { getModelPricing } from '../../../lib/repositories/settings.repository';
import { maybeFireCostAlert } from '../../../lib/cost-alerts';
import {
  getActionStatus,
  getActionWithRelations,
  updateActionOutcome,
  isApprovalOverdue,
  expireOverdueApproval,
} from '../../../lib/repositories/actions.repository';

// Fleet attribution (v4.3): the ONE outcome_metadata key the server persists —
// the spawned subagent instance uuid the posttool extracts from an Agent/Task
// tool_response. String 1–200 chars, else null (the repository re-applies the
// same bound as the authoritative gate). Every other outcome_metadata key
// stays dropped, exactly as before.
function extractSpawnedAgentUuid(body: Record<string, unknown>): string | null {
  const meta = body.outcome_metadata;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const value = (meta as Record<string, unknown>).spawned_agent_uuid;
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
}


export async function GET(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const sql = getDbSql();
    const orgId = getOrgId(request);
    const { actionId } = await params;

    const result = await getActionWithRelations(sql, orgId, actionId);
    if (!result) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    // Lazy expiry self-heal (roadmap v2.3, pairing-flow precedent): checked in
    // JS first so the common poll path pays nothing; the flip's WHERE clause
    // re-checks status + overdue, so a racing approval wins cleanly (x402
    // reconcile rides inside the flip).
    if (result.action?.status === 'pending_approval' && isApprovalOverdue(result.action)) {
      const expired = await expireOverdueApproval(sql, orgId, actionId);
      if (expired) {
        void publishOrgEvent(EVENTS.ACTION_UPDATED, { orgId, action: expired });
        result.action = { ...result.action, ...expired };
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, 'ACTION_GET');
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const sql = getDbSql();
    const orgId = getOrgId(request);
    const { actionId } = await params;
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    // A literal `null` (or non-object) JSON body would otherwise crash on the
    // body.close_if_running read below and surface as a 500; return the normal
    // 400 validation response instead.
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Validation failed', details: ['request body must be a JSON object'] }, { status: 400 });
    }

    // Stop-hook contract — see dashclaw_stop.py. When true, the request's close
    // fields (status/output_summary/timestamp_end) are applied atomically only
    // if the row is still `running`; token fields always apply. This prevents
    // a late Stop hook from clobbering a terminal state PostToolUse just wrote.
    const closeIfRunning = body.close_if_running === true;

    const { valid, data, errors } = validateActionOutcome(body);
    if (!valid) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    // SECURITY: clamp token/cost to reasonable bounds and auto-derive cost
    // when tokens are reported without an explicit cost_estimate. Matches the
    // POST path so hooks reporting tokens after the fact get priced the same.
    const MAX_TOKENS = 10_000_000;
    const MAX_COST_USD = 10_000;
    if (data.tokens_in !== undefined) data.tokens_in = Math.max(0, Math.min(Number(data.tokens_in) || 0, MAX_TOKENS));
    if (data.tokens_out !== undefined) data.tokens_out = Math.max(0, Math.min(Number(data.tokens_out) || 0, MAX_TOKENS));
    if (data.cost_estimate !== undefined) data.cost_estimate = Math.max(0, Math.min(Number(data.cost_estimate) || 0, MAX_COST_USD));
    if ((data.tokens_in || data.tokens_out) && data.cost_estimate === undefined) {
      const customPricing = await getModelPricing(sql, orgId);
      // Hooks may report tokens without a model; fall back to the stored
      // row's model (set at create time) so those tokens don't price at $0.
      let pricingModel = data.model;
      if (!pricingModel) {
        const existing = await getActionStatus(sql, orgId, actionId);
        pricingModel = existing?.model || null;
      }
      data.cost_estimate = estimateCost(data.tokens_in || 0, data.tokens_out || 0, pricingModel, customPricing as Parameters<typeof estimateCost>[3]);
    }

    // SECURITY: redact likely secrets before storing the outcome fields.
    const dlpFindings: Array<{ severity?: string; category?: string }> = [];
    for (const k of ['output_summary', 'error_message']) {
      if (data[k] != null) data[k] = redactAny(data[k], dlpFindings);
    }
    if (data.side_effects != null) data.side_effects = redactAny(data.side_effects, dlpFindings);
    if (data.artifacts_created != null) data.artifacts_created = redactAny(data.artifacts_created, dlpFindings);

    // Split into (close fields) and (everything else). Close fields only
    // apply via a status='running' gate so a late PATCH cannot rewrite a
    // terminal ledger row; other fields apply unconditionally so late
    // tokens/cost/model land even after the action is closed. The
    // close_if_running flag is retained for the Stop-hook contract but the
    // gate now always applies to prevent terminal-state overwrites.
    const CLOSE_FIELDS = new Set(['status', 'output_summary', 'timestamp_end']);
    const closeData: Record<string, unknown> = {};
    const otherData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (CLOSE_FIELDS.has(k)) closeData[k] = v;
      else otherData[k] = v;
    }

    // When only close-fields are being updated, pass through the
    // un-gated path if the caller has no token/cost/model data AND has not
    // opted into the Stop-hook contract. This preserves the historical
    // "404 when action not found" semantics for the common completion PATCH
    // while still blocking terminal-state overwrites when close_if_running
    // is set (the Stop-hook case).
    let updatedAction;
    const hasCloseFields = Object.keys(closeData).length > 0;
    const hasOtherFields = Object.keys(otherData).length > 0;

    // Fleet attribution (v4.3): persist ONLY outcome_metadata.spawned_agent_uuid
    // (merged into outcome_progress). Rides the UNGATED write in both branches —
    // a sync spawn's patch may land after Stop auto-closed the spawn row, and
    // the lineage stamp must still land (it is not a close field).
    const spawnedAgentUuid = extractSpawnedAgentUuid(body);
    const hasUngatedWrite = hasOtherFields || spawnedAgentUuid != null;
    const ungatedOptions = spawnedAgentUuid != null ? { spawnedAgentUuid } : undefined;

    if (closeIfRunning) {
      let closeResult = null;
      if (hasCloseFields) {
        // Stop-hook close: stamp closure provenance 'stop_autoclose' (v4.2).
        closeResult = await updateActionOutcome(sql, orgId, actionId, closeData, { gateStatus: 'running', closeSource: 'stop_autoclose' });
      }
      let tokenResult = null;
      if (hasUngatedWrite) {
        tokenResult = await updateActionOutcome(sql, orgId, actionId, otherData, ungatedOptions);
      }
      updatedAction = tokenResult || closeResult;
      if (!updatedAction) {
        // Gate failed AND no non-close data — re-fetch to return the current row.
        const rel = await getActionWithRelations(sql, orgId, actionId);
        if (!rel) {
          return NextResponse.json({ error: 'Action not found' }, { status: 404 });
        }
        updatedAction = rel.action;
      }
    } else {
      // Non-Stop-hook PATCH. Gate close-fields against terminal statuses to
      // prevent rewriting the ledger; allow token/cost/model through always.
      // If neither close-path nor other-path matches, action does not exist.
      let closeResult = null;
      if (hasCloseFields) {
        // Normal completion PATCH: stamp closure provenance 'outcome' (v4.2).
        closeResult = await updateActionOutcome(sql, orgId, actionId, closeData, { gateStatus: 'running', closeSource: 'outcome' });
      }
      let tokenResult = null;
      if (hasUngatedWrite) {
        tokenResult = await updateActionOutcome(sql, orgId, actionId, otherData, ungatedOptions);
      }
      updatedAction = tokenResult || closeResult;
      if (!updatedAction) {
        // If no close fields were submitted, null from updateActionOutcome
        // definitively means the action does not exist (no gate was applied).
        if (!hasCloseFields) {
          return NextResponse.json({ error: 'Action not found' }, { status: 404 });
        }
        // Close-fields path returned null — either not found OR terminal row.
        // Lightweight repository lookup distinguishes the two.
        const current = await getActionStatus(sql, orgId, actionId);
        if (!current) {
          return NextResponse.json({ error: 'Action not found' }, { status: 404 });
        }
        return NextResponse.json(
          { error: 'Action is in a terminal state and cannot be modified', status: current.status },
          { status: 409 },
        );
      }
    }

    // Emit real-time event
    void publishOrgEvent(EVENTS.ACTION_UPDATED, {
      orgId,
      action: updatedAction,
    });

    // Cost alert — fires webhooks + native notifications if this action
    // crossed the configured per-action cost threshold. Awaited briefly so
    // the HTTP response carries accurate {alert: ...} metadata, but the
    // delivery itself is fire-and-forget inside maybeFireCostAlert.
    const costAlert = await maybeFireCostAlert(sql, orgId, updatedAction);

    return NextResponse.json({
      action: updatedAction,
      security: {
        clean: dlpFindings.length === 0,
        findings_count: dlpFindings.length,
        critical_count: dlpFindings.filter(f => f.severity === 'critical').length,
        categories: [...new Set(dlpFindings.map(f => f.category))],
      },
      ...(costAlert.fired ? { cost_alert: { threshold: costAlert.threshold, severity: (costAlert.signal as { severity?: string } | undefined)?.severity } } : {}),
    });
  } catch (error) {
    return apiErrorResponse(error, 'ACTION_PATCH');
  }
}
