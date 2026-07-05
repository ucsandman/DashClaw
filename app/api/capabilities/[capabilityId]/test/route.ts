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
  executeCapabilityInvocation,
  prepareCapabilityInvocation,
} from '../../../../lib/capability-runtime';
import { updateCapability } from '../../../../lib/repositories/capabilities.repository';
import {
  createActionRecord,
  createBlockedActionRecord,
  updateActionOutcome,
} from '../../../../lib/repositories/actions.repository';

function mapPreparationError(capabilityId: string, err: unknown) {
  const message = (err as Error).message;
  const code = (err as { code?: string }).code;
  if (message === `Capability not found: ${capabilityId}`) {
    return NextResponse.json({ success: false, error: 'capability_not_found' }, { status: 404 });
  }

  if (message === `Capability ${capabilityId} is not an http_api type`) {
    return NextResponse.json(
      { success: false, error: 'not_invocable', message: 'Capability is not invocable via HTTP' },
      { status: 400 },
    );
  }

  if (code === 'auth_not_configured' || code === 'endpoint_not_configured' || code === 'capability_contract_invalid') {
    return NextResponse.json(
      { success: false, error: code, message },
      { status: 400 },
    );
  }

  return null;
}

function mapExecutionStatus(errorCode: string) {
  if (errorCode === 'capability_input_invalid') return 400;
  if (errorCode === 'capability_timeout') return 504;
  return 502;
}

export async function POST(request: Request, { params }: { params: Promise<{ capabilityId: string }> }) {
  try {
    const { capabilityId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    let prepared;
    try {
      prepared = await prepareCapabilityInvocation(sql, orgId, capabilityId);
    } catch (err) {
      const response = mapPreparationError(capabilityId, err);
      if (response) return response;
      throw err;
    }

    const { capability } = prepared;
    const actionId = `act_${crypto.randomUUID()}`;
    const timestampStart = new Date().toISOString();
    const agentId = body.agent_id || 'anonymous';
    const declaredGoal = body.declared_goal || `Test capability: ${capability.name}`;

    // A "test" fires the identical governed side-effect as an invoke — it calls
    // the org's real capability endpoint with the org's real credentials. It
    // must therefore run through policy evaluation, or a blocked action type, a
    // protected path, a spend limit, or the org kill-switch (which surfaces as a
    // `block`) could be reproduced here to bypass the guard entirely. Mirror the
    // invoke route: block → 403, require_approval → 202, before any real call.
    const guardData = {
      agent_id: agentId,
      action_type: 'capability_test',
      declared_goal: declaredGoal,
      systems_touched: [`capability:${capability.slug}`],
      reversible: true,
      risk_score: 5,
      confidence: 100,
      input_summary: JSON.stringify(body).slice(0, 500),
      trigger: 'capability:test',
    };

    const guardDecision = await evaluateGuard(
      orgId,
      {
        action_type: 'capability_test',
        risk_score: 5,
        agent_id: agentId === 'anonymous' ? null : agentId,
        systems_touched: [`capability:${capability.slug}`],
        reversible: true,
        declared_goal: declaredGoal,
      },
      sql,
    );

    if (guardDecision.decision === 'block') {
      await createBlockedActionRecord(sql, {
        orgId,
        action_id: actionId,
        data: guardData,
        guardDecision,
        signature: null,
        verified: false,
        timestamp_start: timestampStart,
      });
      return NextResponse.json(
        {
          success: false,
          tested: false,
          error: 'blocked_by_policy',
          test_action_id: actionId,
          guard_decision: {
            decision: guardDecision.decision,
            reasons: guardDecision.reasons || [],
            matched_policies: guardDecision.matched_policies || [],
          },
        },
        { status: 403 },
      );
    }

    if (guardDecision.decision === 'require_approval') {
      const createdAction = await createActionRecord(sql, {
        orgId,
        action_id: actionId,
        data: { ...guardData, status: 'pending_approval' },
        actionStatus: 'pending_approval',
        costEstimate: 0,
        signature: null,
        verified: false,
        timestamp_start: timestampStart,
        // Separation of duties (drizzle/0055): trusted middleware principal.
        createdBy: getUserId(request) || null,
      });
      fireApprovalSurfaces(createdAction as Record<string, unknown>, sql, orgId, guardDecision);
      return NextResponse.json(
        {
          success: false,
          tested: false,
          error: 'pending_approval',
          test_action_id: actionId,
          message: `Capability test requires human approval. Poll GET /api/actions/${actionId} for status.`,
        },
        { status: 202 },
      );
    }

    await createActionRecord(sql, {
      orgId,
      action_id: actionId,
      data: guardData,
      actionStatus: 'running',
      costEstimate: 0,
      signature: null,
      verified: false,
      timestamp_start: timestampStart,
      createdBy: getUserId(request) || null,
    });

    const result = (await executeCapabilityInvocation({
      endpoint: prepared.endpoint,
      authHeaders: prepared.authHeaders,
      schema: prepared.schema,
      body,
    })) as Record<string, any>;

    const nextHealthStatus = result.success ? 'healthy' : 'failing';
    const nextCertificationStatus = result.success ? 'certified' : 'failed';
    const timestampEnd = new Date().toISOString();
    const retryPrefix = result.retry_metadata?.retried
      ? `[retried: ${result.retry_metadata.total_attempts} attempts] `
      : '';
    const outputSummary = result.success
      ? retryPrefix + JSON.stringify(result.data).slice(0, 500 - retryPrefix.length)
      : retryPrefix + (result.message || result.error);

    await updateActionOutcome(sql, orgId, actionId, {
      status: result.success ? 'completed' : 'failed',
      output_summary: outputSummary,
      error_message: result.success ? null : result.message || result.error,
      timestamp_end: timestampEnd,
      duration_ms: result.elapsed_ms || 0,
    });

    await updateCapability(sql, orgId, capabilityId, { health_status: nextHealthStatus });

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          tested: true,
          capability_id: capabilityId,
          test_action_id: actionId,
          error: result.error,
          message: result.message,
          elapsed_ms: result.elapsed_ms,
          health_status: nextHealthStatus,
          certification_status: nextCertificationStatus,
          retry_metadata: result.retry_metadata || undefined,
        },
        { status: mapExecutionStatus(result.error) },
      );
    }

    return NextResponse.json({
      success: true,
      tested: true,
      capability_id: capabilityId,
      test_action_id: actionId,
      result: result.data,
      elapsed_ms: result.elapsed_ms,
      health_status: nextHealthStatus,
      certification_status: nextCertificationStatus,
      retry_metadata: result.retry_metadata || undefined,
    });
  } catch (error) {
    return apiErrorResponse(error, 'CAPABILITY_TEST');
  }
}
