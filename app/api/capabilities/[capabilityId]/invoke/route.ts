export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSql } from '../../../../lib/db';
import { getOrgId, getUserId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { evaluateGuard } from '../../../../lib/guard';
import { fireApprovalSurfaces } from '../../../../lib/approvalSurfaces';
import {
  createActionRecord,
  createBlockedActionRecord,
} from '../../../../lib/repositories/actions.repository';
import { redactAny } from '../../../../lib/security';
import { RISK_SCORE_MAP } from '../../../../lib/capability-invoke';
import {
  executeCapabilityInvocation,
  prepareCapabilityInvocation,
} from '../../../../lib/capability-runtime';
import { checkCircuitBreaker } from '../../../../lib/capability-health';
import { updateCapability } from '../../../../lib/repositories/capabilities.repository';
import { evaluateAccess } from '../../../../lib/repositories/capability-access.repository';
import { resolveAgentIdentity } from '../../../../lib/identity-resolution';


export async function POST(request: Request, { params }: { params: Promise<{ capabilityId: string }> }) {
  try {
    const { capabilityId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    // 1. Load and resolve capability runtime config
    let prepared;
    try {
      prepared = await prepareCapabilityInvocation(sql, orgId, capabilityId);
    } catch (err) {
      const message = (err as Error).message;
      const code = (err as { code?: string }).code;
      if (message === `Capability not found: ${capabilityId}`) {
        return NextResponse.json(
          { success: false, error: 'capability_not_found' },
          { status: 404 },
        );
      }

      if (message === `Capability ${capabilityId} is not an http_api type`) {
        return NextResponse.json(
          { success: false, error: 'not_invocable', message: 'Capability is not invocable via HTTP' },
          { status: 400 },
        );
      }

      if (code === 'auth_not_configured') {
        return NextResponse.json(
          { success: false, error: 'auth_not_configured', message },
          { status: 400 },
        );
      }

      if (code === 'endpoint_not_configured') {
        return NextResponse.json(
          { success: false, error: 'endpoint_not_configured', message },
          { status: 400 },
        );
      }

      if (code === 'capability_contract_invalid') {
        return NextResponse.json(
          { success: false, error: 'capability_contract_invalid', message },
          { status: 400 },
        );
      }

      throw err;
    }

    const { capability, schema } = prepared;
    if (!capability) {
      return NextResponse.json(
        { success: false, error: 'capability_not_found' },
        { status: 404 },
      );
    }
    const action_id = `act_${crypto.randomUUID()}`;
    const timestamp_start = new Date().toISOString();

    // Shared identity contract (same as /api/guard, /api/actions):
    // a JWKS-verified JWT's sub overrides the body agent_id; otherwise identity
    // is explicitly self-asserted (unverified).
    // The verification result gates per-agent access rules below (D1,
    // docs/architecture/trust-and-failure-model.md).
    const identity = await resolveAgentIdentity(request, { agentId: body.agent_id || null, agentName: body.agent_name || null });

    // 2. Guard evaluation
    const riskScore = (RISK_SCORE_MAP as Record<string, number>)[(capability as Record<string, any>).risk_level] || 50;
    const guardDecision = await evaluateGuard(
      orgId,
      {
        action_type: 'capability_invoke',
        risk_score: riskScore,
        agent_id: identity.agent_id || null,
        verification_status: identity.verification_status,
        systems_touched: [`capability:${capability.slug}`],
        reversible: true,
        declared_goal: body.declared_goal || `Invoke capability: ${capability.name}`,
      },
      sql,
    );

    // 3. DLP scan on input
    const dlpFindings: any[] = [];
    const inputSummary = redactAny(
      JSON.stringify(body).slice(0, 500),
      dlpFindings,
    ) as string;

    const actionData = {
      agent_id: identity.agent_id || 'anonymous',
      action_type: 'capability_invoke',
      declared_goal: body.declared_goal || `Invoke capability: ${capability.name}`,
      systems_touched: [`capability:${capability.slug}`],
      reversible: true,
      risk_score: riskScore,
      confidence: 50,
      input_summary: inputSummary,
    };

    // 4. Handle guard blocked
    if (guardDecision.decision === 'block') {
      await createBlockedActionRecord(sql, {
        orgId,
        action_id,
        data: actionData,
        guardDecision,
        signature: null,
        verified: identity.verified,
        timestamp_start,
      });

      return NextResponse.json(
        {
          success: false,
          error: 'blocked_by_policy',
          guard_decision: {
            decision: guardDecision.decision,
            reasons: guardDecision.reasons || [],
            matched_policies: guardDecision.matched_policies || [],
          },
        },
        { status: 403 },
      );
    }

    // 5. Handle require_approval
    if (guardDecision.decision === 'require_approval' || capability.requires_approval) {
      const createdAction = await createActionRecord(sql, {
        orgId,
        action_id,
        data: { ...actionData, status: 'pending_approval' },
        actionStatus: 'pending_approval',
        costEstimate: 0,
        signature: null,
        verified: identity.verified,
        timestamp_start,
        // Separation of duties (drizzle/0055): trusted middleware principal.
        createdBy: getUserId(request) || null,
      });

      // Notify operators (Telegram/Discord/webhook) like POST /api/actions does.
      fireApprovalSurfaces(createdAction as Record<string, unknown>, sql, orgId, guardDecision);

      return NextResponse.json(
        {
          success: false,
          error: 'pending_approval',
          action_id,
          message: `Invocation requires human approval. Poll GET /api/actions/${action_id} for status.`,
        },
        { status: 202 },
      );
    }

    // Circuit breaker check
    // `capability` is the runtime CapabilityRow; checkCircuitBreaker wants its
    // own structurally-compatible Capability shape (slug etc. present at runtime).
    const circuitStatus = await checkCircuitBreaker(sql, orgId, capability as unknown as Parameters<typeof checkCircuitBreaker>[2]);
    if (circuitStatus.open) {
      return NextResponse.json(
        {
          success: false,
          error: 'circuit_breaker_open',
          message: `Capability circuit breaker is open after ${circuitStatus.consecutive_failures} consecutive failures. Run a test to reset.`,
          consecutive_failures: circuitStatus.consecutive_failures,
        },
        { status: 503 },
      );
    }

    // Access control check — identity-gated (D1): per-agent allowances only
    // apply to verified identities; unverified callers get the org default.
    const agentId = identity.agent_id || 'anonymous';
    const accessResult = await evaluateAccess(sql, orgId, capabilityId, agentId, { verified: identity.verified });
    if (accessResult.access === 'deny') {
      return NextResponse.json({
        success: false,
        error: 'access_denied',
        code: 'CAPABILITY_ACCESS_DENIED',
        reason: accessResult.identity_downgrade?.reason || accessResult.rule?.reason || 'Agent does not have access to this capability.',
        ...(accessResult.identity_downgrade ? { identity_downgrade: accessResult.identity_downgrade } : {}),
        capability_id: capabilityId,
        agent_id: agentId,
      }, { status: 403 });
    }
    if (accessResult.access === 'require_approval') {
      const createdAction = await createActionRecord(sql, {
        orgId,
        action_id,
        data: { ...actionData, status: 'pending_approval' },
        actionStatus: 'pending_approval',
        costEstimate: 0,
        signature: null,
        verified: identity.verified,
        timestamp_start,
        createdBy: getUserId(request) || null,
      });

      // Notify operators (Telegram/Discord/webhook) like POST /api/actions does.
      fireApprovalSurfaces(createdAction as Record<string, unknown>, sql, orgId, guardDecision);

      return NextResponse.json(
        {
          success: false,
          error: 'pending_approval',
          action_id,
          message: `Invocation requires human approval. Poll GET /api/actions/${action_id} for status.`,
          reason: accessResult.rule?.reason || null,
        },
        { status: 202 },
      );
    }

    // 6. Create running action record
    await createActionRecord(sql, {
      orgId,
      action_id,
      data: actionData,
      actionStatus: 'running',
      costEstimate: (capability as Record<string, any>).pricing?.estimated_cost_usd || 0,
      signature: null,
      verified: identity.verified,
      timestamp_start,
      createdBy: getUserId(request) || null,
    });

    // 7. Invoke the capability
    const result = (await executeCapabilityInvocation({
      endpoint: prepared.endpoint,
      authHeaders: prepared.authHeaders,
      schema,
      body,
    })) as Record<string, any>;

    // 8. Update action outcome
    const timestamp_end = new Date().toISOString();
    const retryPrefix = result.retry_metadata?.retried
      ? `[retried: ${result.retry_metadata.total_attempts} attempts] `
      : '';
    const outputSummary = result.success
      ? retryPrefix + JSON.stringify(result.data).slice(0, 500 - retryPrefix.length)
      : retryPrefix + (result.message || result.error);

    await sql`
      UPDATE action_records
      SET status = ${result.success ? 'completed' : 'failed'},
          output_summary = ${outputSummary},
          error_message = ${result.success ? null : result.message || result.error},
          timestamp_end = ${timestamp_end},
          duration_ms = ${result.elapsed_ms || 0}
      WHERE action_id = ${action_id} AND org_id = ${orgId}
    `;

    // Keep health_status in step with the invocation outcome so checkCircuitBreaker
    // can actually count consecutive failures — without this, the 'healthy' short-circuit
    // in capability-health.js prevents the breaker from ever opening.
    {
      const nextHealth = result.success ? 'healthy' : 'degraded';
      void updateCapability(sql, orgId, capabilityId, { health_status: nextHealth })
        .catch((err) => console.warn('[API] Health status update failed:', err.message));
    }

    // 9. Return response
    if (!result.success) {
      const statusCode = result.error === 'capability_timeout'
        ? 504
        : result.error === 'capability_input_invalid'
          ? 400
          : 502;
      return NextResponse.json(
        {
          success: false,
          action_id,
          error: result.error,
          message: result.message,
          elapsed_ms: result.elapsed_ms,
          governed: true,
          retry_metadata: result.retry_metadata || undefined,
        },
        { status: statusCode },
      );
    }

    return NextResponse.json({
      success: true,
      action_id,
      result: result.data,
      elapsed_ms: result.elapsed_ms,
      governed: true,
      retry_metadata: result.retry_metadata || undefined,
      security: {
        clean: dlpFindings.length === 0,
        findings_count: dlpFindings.length,
        critical_count: dlpFindings.filter((f) => f.severity === 'critical').length,
        categories: [...new Set(dlpFindings.map((f) => f.category))],
      },
    });
  } catch (error) {
    return apiErrorResponse(error, 'CAPABILITY_INVOKE');
  }
}
