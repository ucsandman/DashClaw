export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse, after } from 'next/server';
import crypto from 'crypto';
import { getSql } from '../../../../lib/db';
import { getOrgId, getUserId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { evaluateGuard } from '../../../../lib/guard';
import { fireApprovalSurfaces } from '../../../../lib/approvalSurfaces';
import {
  createActionRecord,
  createBlockedActionRecord,
  updateActionOutcome,
} from '../../../../lib/repositories/actions.repository';
import { redactAny } from '../../../../lib/security';
import { RISK_SCORE_MAP } from '../../../../lib/capability-invoke';
import { mapRequest, resolveInputPlaceholders, resolveSettingsInMapping } from '../../../../lib/mapping';
import { assertPayloadMatchesSchema } from '../../../../lib/capability-contracts';
import {
  executeCapabilityInvocation,
  prepareCapabilityInvocation,
} from '../../../../lib/capability-runtime';
import { checkCircuitBreaker } from '../../../../lib/capability-health';
import { updateCapability } from '../../../../lib/repositories/capabilities.repository';
import { evaluateAccess } from '../../../../lib/repositories/capability-access.repository';
import { resolveAgentIdentity } from '../../../../lib/identity-resolution';
import { authorizeActionExecution } from '../../../../lib/guard/execution';
import { digestJson } from '../../../../lib/integrity/canonicalize';

const SERVER_SETTING_PLACEHOLDER = '[server-setting]';
const URL_QUERY_PLACEHOLDER = '[query-value]';
const URL_FRAGMENT_PLACEHOLDER = '[fragment]';
const OPAQUE_GOVERNANCE_URL = 'https://redacted.invalid/[server-setting]';

function maskServerSettingsInMapping(mapping: unknown): unknown {
  if (typeof mapping === 'string') {
    return mapping.startsWith('$settings.') ? SERVER_SETTING_PLACEHOLDER : mapping;
  }
  if (Array.isArray(mapping)) return mapping.map(maskServerSettingsInMapping);
  if (mapping && typeof mapping === 'object') {
    return Object.fromEntries(Object.entries(mapping as Record<string, unknown>)
      .map(([key, value]) => [key, maskServerSettingsInMapping(value)]));
  }
  return mapping;
}

function collectServerSettingNames(value: unknown, names = new Set<string>()): Set<string> {
  if (typeof value === 'string' && value.startsWith('$settings.')) {
    names.add(value.slice('$settings.'.length));
  } else if (Array.isArray(value)) {
    for (const item of value) collectServerSettingNames(item, names);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectServerSettingNames(item, names);
    }
  }
  return names;
}

function safeMappedBodyExcerpt(body: Record<string, unknown>, mapping: unknown): string {
  const safeMapping = maskServerSettingsInMapping(mapping);
  return JSON.stringify(mapRequest(body, safeMapping)).slice(0, 4096);
}

function sanitizeParsedUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.username || parsed.password) {
      parsed.username = 'server-setting';
      parsed.password = '';
    }
    const safeSearch = new URLSearchParams();
    for (const [key, value] of parsed.searchParams.entries()) {
      safeSearch.append(key, value === SERVER_SETTING_PLACEHOLDER
        ? SERVER_SETTING_PLACEHOLDER
        : URL_QUERY_PLACEHOLDER);
    }
    parsed.search = safeSearch.toString();
    if (parsed.hash) parsed.hash = URL_FRAGMENT_PLACEHOLDER;
    return parsed.toString();
  } catch {
    return null;
  }
}

function safeBaseUrlSetting(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.username || parsed.password) {
      parsed.username = 'server-setting';
      parsed.password = '';
    }
    if (parsed.pathname !== '/') parsed.pathname = `/${SERVER_SETTING_PLACEHOLDER}`;
    if (parsed.search) parsed.search = `server-setting=${SERVER_SETTING_PLACEHOLDER}`;
    if (parsed.hash) parsed.hash = URL_FRAGMENT_PLACEHOLDER;
    const safe = parsed.toString();
    return value.endsWith('/') ? safe : safe.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function safeEndpointForGovernance(
  endpointTemplate: string,
  settings: Record<string, unknown>,
  input: Record<string, unknown>,
  custodySettingNames: ReadonlySet<string>,
): string {
  const safeTemplate = endpointTemplate.replace(/\$\{([^}]+)\}/g, (match, settingName: string, offset: number) => {
    if (settingName.startsWith('input.')) return match;
    if (custodySettingNames.has(settingName)) return SERVER_SETTING_PLACEHOLDER;
    if (offset === 0) {
      const safeBase = safeBaseUrlSetting(settings[settingName]);
      if (safeBase) return safeBase;
    }
    return SERVER_SETTING_PLACEHOLDER;
  });
  const withInput = resolveInputPlaceholders(safeTemplate, input);
  return sanitizeParsedUrl(withInput) || OPAQUE_GOVERNANCE_URL;
}

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

    // 2. Guard evaluation. The HTTP request the capability will make is the
    // act: attached as evidence so the classifier grades WHAT runs (a POST to
    // a registrar buy endpoint is `spend`, whatever the capability is called)
    // and the decision record shows it. Per-call path parameters are resolved
    // for the evidence URL when the body carries them; otherwise the template
    // is graded as-is and the execute step reports the missing input.
    const riskScore = (RISK_SCORE_MAP as Record<string, number>)[(capability as Record<string, any>).risk_level] || 50;
    const capabilitySystems = [`capability:${capability.slug}`, `capability-id:${capabilityId}`];
    const method = String(schema.method || 'POST').toUpperCase();
    let evidenceUrl: string;
    let requestBody: Record<string, unknown>;
    try {
      assertPayloadMatchesSchema(body, schema.input_schema as Record<string, unknown> | null | undefined, 'input');
      evidenceUrl = resolveInputPlaceholders(prepared.endpoint, body);
      const requestMapping = resolveSettingsInMapping(schema.request_mapping, prepared.settings || {});
      requestBody = mapRequest(body as Record<string, unknown>, requestMapping);
    } catch (err) {
      return NextResponse.json({
        success: false,
        error: (err as { code?: string }).code || 'capability_input_invalid',
        message: (err as Error).message,
      }, { status: 400 });
    }
    const bodyless = method === 'GET' || method === 'HEAD';
    const authTokenSetting = schema.auth && typeof schema.auth === 'object'
      ? (schema.auth as Record<string, unknown>).token_setting
      : null;
    const custodySettingNames = collectServerSettingNames(schema.request_mapping);
    if (typeof authTokenSetting === 'string' && authTokenSetting) custodySettingNames.add(authTokenSetting);
    const safeEvidenceUrl = safeEndpointForGovernance(
      typeof schema.endpoint === 'string' ? schema.endpoint : prepared.endpoint,
      prepared.settings || {},
      body as Record<string, unknown>,
      custodySettingNames,
    );
    const invocationAct = {
      kind: 'http',
      request: {
        method,
        url: safeEvidenceUrl,
        url_digest: digestJson(evidenceUrl),
        ...(bodyless ? {} : {
          body_excerpt: safeMappedBodyExcerpt(body as Record<string, unknown>, schema.request_mapping),
          body_digest: digestJson(requestBody),
        }),
      },
    };
    const guardContext = {
      action_type: 'capability_invoke',
      risk_score: riskScore,
      agent_id: identity.agent_id || null,
      verification_status: identity.verification_status,
      systems_touched: capabilitySystems,
      reversible: true,
      declared_goal: body.declared_goal || `Invoke capability: ${capability.name}`,
      act: invocationAct,
      client_capabilities: ['execution_claims'],
    };
    const guardDecision = await evaluateGuard(orgId, guardContext, sql);

    // 3. DLP scan on input
    const dlpFindings: any[] = [];
    const inputSummary = redactAny(
      JSON.stringify(body).slice(0, 500),
      dlpFindings,
    ) as string;

    const actionData = {
      agent_id: identity.agent_id || 'anonymous',
      action_type: guardContext.action_type,
      declared_goal: body.declared_goal || `Invoke capability: ${capability.name}`,
      systems_touched: capabilitySystems,
      reversible: true,
      risk_score: riskScore,
      confidence: 50,
      input_summary: inputSummary,
      act: invocationAct,
      guard_decision_id: guardDecision.decision_id || null,
      client_capabilities: ['execution_claims'],
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
        identityVerified: identity.verified,
        payloadSignatureStatus: 'missing',
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

    // 5. Handle require_approval. A `requires_approval` capability holds on
    // the first call; the retry after the operator approves arrives with the
    // guard's operator-approval grant (builtin:operator_approval, same
    // declared_goal, act-bound) and must execute — without this the capability
    // could only ever answer 202 and the approval bought nothing.
    const grantCovered = Array.isArray(guardDecision.matched_policies)
      && guardDecision.matched_policies.includes('builtin:operator_approval');
    if (guardDecision.decision === 'require_approval' || (capability.requires_approval && !grantCovered)) {
      const createdAction = await createActionRecord(sql, {
        orgId,
        action_id,
        data: { ...actionData, status: 'pending_approval' },
        actionStatus: 'pending_approval',
        costEstimate: 0,
        signature: null,
        verified: identity.verified,
        identityVerified: identity.verified,
        payloadSignatureStatus: 'missing',
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
        identityVerified: identity.verified,
        payloadSignatureStatus: 'missing',
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
      identityVerified: identity.verified,
      payloadSignatureStatus: 'missing',
      timestamp_start,
      createdBy: getUserId(request) || null,
    });

    // 7. Atomically claim this exact recorded attempt before any external call.
    let executionClaim;
    try {
      executionClaim = await authorizeActionExecution(sql, {
        orgId,
        actionId: action_id,
        principalId: getUserId(request),
        attemptId: crypto.randomUUID(),
        act: invocationAct,
        identity,
      });
    } catch (err) {
      console.error('[API] Capability execution claim unavailable:', (err as Error).message);
      return NextResponse.json({
        success: false,
        error: 'execution_claim_unavailable',
        action_id,
        message: 'Execution authority could not be established. No capability call was made.',
      }, { status: 503 });
    }
    if (!executionClaim) {
      return NextResponse.json({
        success: false,
        error: 'execution_claim_conflict',
        action_id,
        message: 'This action is not eligible for a new execution attempt. Reconcile its state before retrying.',
      }, { status: 409 });
    }

    // 8. Invoke the capability
    const result = (await executeCapabilityInvocation({
      endpoint: prepared.endpoint,
      authHeaders: prepared.authHeaders,
      schema,
      body,
      settings: prepared.settings,
    })) as Record<string, any>;

    // 9. Update action outcome through the canonical repository boundary.
    const timestamp_end = new Date().toISOString();
    const retryPrefix = result.retry_metadata?.retried
      ? `[retried: ${result.retry_metadata.total_attempts} attempts] `
      : '';
    const outputSummary = result.success
      ? retryPrefix + JSON.stringify(result.data).slice(0, 500 - retryPrefix.length)
      : retryPrefix + (result.message || result.error);

    try {
      const recorded = await updateActionOutcome(sql, orgId, action_id, {
        status: result.success ? 'completed' : 'failed',
        output_summary: outputSummary,
        error_message: result.success ? null : result.message || result.error,
        timestamp_end,
        duration_ms: result.elapsed_ms || 0,
      }, { gateStatus: 'running', closeSource: 'outcome' });
      if (!recorded) throw new Error('Action outcome update matched no running record');
    } catch (err) {
      console.error('[API] Capability outcome persistence failed after execution:', (err as Error).message);
      return NextResponse.json({
        success: false,
        action_id,
        error: 'execution_outcome_unknown',
        execution_state: 'unknown',
        retry_safe: false,
        message: 'The capability call finished, but its outcome could not be recorded. Reconcile the external effect before retrying.',
      }, { status: 500 });
    }

    // Keep health_status in step with the invocation outcome so checkCircuitBreaker
    // can actually count consecutive failures — without this, the 'healthy' short-circuit
    // in capability-health.js prevents the breaker from ever opening.
    {
      const nextHealth = result.success ? 'healthy' : 'degraded';
      // after() keeps the lambda alive until this write settles — un-awaited
      // writes get killed when the response ends on Vercel (app/api/actions/route.ts).
      after(() => updateCapability(sql, orgId, capabilityId, { health_status: nextHealth })
        .catch((err) => console.warn('[API] Health status update failed:', err.message)));
    }

    // 10. Return response
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
