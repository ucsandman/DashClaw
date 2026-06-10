export const dynamic = 'force-dynamic';
export const revalidate = 0;

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getOrgId } from '../../lib/org';
import { validateGuardInput } from '../../lib/validate';
import { evaluateGuard } from '../../lib/guard';
import { getSql } from '../../lib/db';
import { apiErrorResponse } from '../../lib/apiErrors';
import { scanForPromptInjection } from '../../lib/promptInjection';
import { scanSensitiveData, redactAny } from '../../lib/security';
import { getSettings } from '../../lib/repositories/settings.repository';
import { listGuardDecisions } from '../../lib/repositories/guard.repository';
import { createActionRecord } from '../../lib/repositories/actions.repository';
import { upsertAgentPresence } from '../../lib/repositories/agents.repository';
import { incrementTrialActionCount } from '../../lib/repositories/hosted-workspace.repository';
import { checkQuotaFast, getOrgPlan, incrementMeter } from '../../lib/usage';
import { EVENTS, publishOrgEvent } from '../../lib/events';
import { isSelfHostModeEnabled } from '../../lib/selfHost';
import { verifyJwt, extractBearerToken } from '../../lib/jwks-verifier';
import { checkAndRecord as checkAndRecordJti } from '../../lib/repositories/jti-replay.repository';
import { resolveActStatus } from '../../lib/act-binding';

type GuardSql = ReturnType<typeof getSql>;
type GuardData = Record<string, unknown> & { agent_id?: string; agent_name?: string; declared_goal?: string; verification_status?: string };
type GuardResult = { decision: string; risk_score?: number };

/**
 * ?record=true support: create the running action record in-request (the same
 * insert POST /api/actions performs, via the shared repository function) so a
 * governed hook needs ONE HTTP call instead of guard + record. Additive — the
 * response without the param is unchanged.
 */
async function recordRunningAction(
  sql: GuardSql,
  orgId: string,
  data: GuardData,
  result: GuardResult,
): Promise<{ recorded: boolean; action_id?: string; reason?: string }> {
  // Mirrors the two-call flow: the hook never records a blocked action
  // (the guard_decisions audit row already captures the block).
  if (result.decision === 'block') return { recorded: false, reason: 'decision is block' };
  if (!data.agent_id || !data.declared_goal) {
    return { recorded: false, reason: 'agent_id and declared_goal are required to record an action' };
  }

  // Same quota gate POST /api/actions applies — record=true must not bypass
  // plan or hosted-trial caps.
  const plan = await getOrgPlan(orgId, sql);
  const quota = await checkQuotaFast(orgId, 'actions_per_month', plan, sql);
  if (!quota.allowed) return { recorded: false, reason: 'Monthly action limit exceeded' };

  // Same redaction POST /api/actions applies before persisting.
  const record: Record<string, unknown> = { ...data };
  const dlpFindings: unknown[] = [];
  for (const k of ['agent_name', 'declared_goal', 'reasoning', 'authorization_scope', 'trigger', 'input_summary']) {
    if (record[k] != null) record[k] = redactAny(record[k], dlpFindings);
  }
  if (record.systems_touched != null) record.systems_touched = redactAny(record.systems_touched, dlpFindings);

  const action_id = `act_${crypto.randomUUID()}`;
  const createdAction = await createActionRecord(sql, {
    orgId,
    action_id,
    data: record as Parameters<typeof createActionRecord>[1]['data'],
    actionStatus: result.decision === 'require_approval' ? 'pending_approval' : 'running',
    costEstimate: Math.max(0, Number(record.cost_estimate) || 0),
    signature: null,
    verified: data.verification_status === 'verified',
    timestamp_start: new Date().toISOString(),
    riskScore: result.risk_score ?? null,
  });

  // Same fire-and-forget side effects as POST /api/actions (event for Mission
  // Control, meters, implicit presence heartbeat) — never block the response.
  void publishOrgEvent(EVENTS.ACTION_CREATED, { orgId, action: createdAction });
  Promise.all([
    incrementMeter(orgId, 'actions_per_month', sql),
    incrementTrialActionCount(sql, orgId).catch(() => {}),
    upsertAgentPresence(sql, orgId, {
      agent_id: data.agent_id,
      agent_name: data.agent_name || null,
      status: 'online',
      current_task_id: action_id,
      metadata: null,
      timestamp: new Date().toISOString(),
    }).catch(() => {}),
  ]).catch((err: unknown) => {
    console.warn('[Guard] record=true background updates failed:', (err as Error).message);
  });

  return { recorded: true, action_id };
}

/**
 * POST /api/guard — Evaluate guard policies for a proposed action.
 * Returns allow/warn/block/require_approval.
 *
 * Body: { action_type, risk_score?, agent_id?, agent_name?, systems_touched?, reversible?, declared_goal? }
 * Query: ?include_signals=true (optional, adds live signal warnings)
 * Query: ?record=true (optional, additive) — also creates the running action
 *        record (same insert as POST /api/actions) and returns its action_id,
 *        so a governed hook needs one HTTP call instead of two. On a block
 *        decision no record is created (`recorded: false`).
 *
 * Agent identity — two tiers:
 *
 *   Phase 1 (trust-on-assertion): Pass agent_id / agent_name in the request
 *   body. The API-key boundary provides authentication. verification_status
 *   will be 'unverified'.
 *
 *   Phase 2 (JWKS verification): Attach `Authorization: Bearer <JWT>` to the
 *   request. DashClaw verifies the token against the issuer's JWKS endpoint
 *   (fetched from {iss}/.well-known/jwks.json, cached 1 h). On success:
 *     - verification_status → 'verified'
 *     - agent_id is set to the JWT `sub` claim (body value overridden for
 *       integrity: cryptographic proof beats self-assertion)
 *     - agent_name is set to the JWT `agent_name` claim (if present)
 *   On issuer outage the verifier fails-soft to 'unverified' so a downed
 *   identity provider cannot block agent decisions.
 *
 *   verification_status enum: verified | unverified | expired | failed | unknown_issuer | exp_too_far
 *
 * Config (env vars, no YAML needed):
 *   DASHCLAW_ALLOWED_ISSUER  — restrict which JWT issuers are trusted
 *   DASHCLAW_JWT_AUDIENCE    — require this value in the `aud` claim
 *
 * Provider-agnostic: works with any OIDC issuer (Keycloak, Auth0, AgentLair,
 * etc.) — see docs/agent-identity.md for setup examples.
 */
export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const { valid, data, errors } = validateGuardInput(body);

    if (!valid) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    // SECURITY: Block prompt injection patterns in declared_goal (per D-04)
    const goalText = data.declared_goal || '';
    if (goalText) {
      const injectionScan = scanForPromptInjection(goalText);
      if (injectionScan.recommendation === 'block') {
        return NextResponse.json({
          error: 'Input rejected: prompt injection pattern detected',
          risk_level: injectionScan.risk_level,
          categories: injectionScan.categories,
        }, { status: 400 });
      }
    }

    // Hoist sql once — used by the replay check and evaluateGuard. getSql()
    // returns a cached singleton so calling it twice is harmless, but a
    // single binding makes the dependency clear and avoids subtle risk if
    // getSql() ever stops being idempotent (e.g., during hot reload).
    const sql = getSql();

    // Phase 2: JWKS verification — resolve agent identity from JWT bearer token.
    // Fail-soft: infrastructure errors fall back to 'unverified', never 'failed'.
    const authHeader = request.headers.get('authorization');
    const bearerToken = extractBearerToken(authHeader);

    if (bearerToken) {
      const verificationResult = await verifyJwt(bearerToken);

      if (verificationResult.verification_status === 'verified') {
        // Cryptographic proof beats self-assertion: JWT sub overrides body agent_id.
        if (verificationResult.agent_id) {
          if (data.agent_id && data.agent_id !== verificationResult.agent_id) {
            console.warn(
              `[Guard] JWT sub (${verificationResult.agent_id}) overrides body agent_id (${data.agent_id})`
            );
          }
          data.agent_id = verificationResult.agent_id;
        }
        if (verificationResult.agent_name && !data.agent_name) {
          data.agent_name = verificationResult.agent_name;
        }
      }

      data.verification_status = verificationResult.verification_status;
      data.jti = verificationResult.jti || null;

      // Phase 2b: replay-protection check (issue #120, design by @piiiico).
      // Only verified tokens hit the store — there's no signature trust to
      // replay without that. The exp_too_far signal flows through verification
      // status directly (the verifier sets it before any network call).
      const replayProtection = (process.env.DASHCLAW_JTI_REPLAY_PROTECTION || 'best_effort').toLowerCase();
      if (verificationResult.verification_status === 'exp_too_far') {
        data.replay_status = 'exp_too_far';
      } else if (verificationResult.verification_status === 'verified' && replayProtection === 'off') {
        // Distinct from `not_applicable` so the audit trail can tell apart
        // "Phase 1 path / no JWT" from "verified JWT but operator opted out
        // of replay protection." Same allow-everything outcome, different
        // forensic story during incident review.
        data.replay_status = 'disabled';
      } else if (verificationResult.verification_status === 'verified') {
        // Length cap matches the repository's MAX_JTI_LENGTH (1024). Catching
        // it here too means a hostile-IdP-issued multi-MB jti never reaches
        // the store at all and never throws OVERSIZED_JTI. Boundary
        // validation > deep validation.
        const oversizedJti = typeof verificationResult.jti === 'string' && verificationResult.jti.length > 1024;
        if (!verificationResult.jti) {
          data.replay_status = 'not_present';
        } else if (oversizedJti) {
          console.warn('[Guard] Oversized jti rejected from replay store', {
            jti_length: verificationResult.jti.length,
            issuer: verificationResult.issuer,
          });
          data.replay_status = 'not_present';
        } else if (typeof verificationResult.exp !== 'number') {
          // jti without exp can't be safely TTL'd → treat as not_present so
          // the store never accumulates rows with no purge horizon.
          data.replay_status = 'not_present';
        } else if (!verificationResult.issuer) {
          // Defense in depth: the verifier currently sets verification_status
          // to 'failed' when issuer is null, so we should never reach here
          // with a 'verified' status and null issuer. If a future code path
          // ever does, treat as not_present rather than throwing INVALID_INPUT
          // out of the repository (which would surface as an unhandled 500).
          data.replay_status = 'not_present';
        } else {
          data.replay_status = await checkAndRecordJti(sql, {
            jti: verificationResult.jti,
            issuer: verificationResult.issuer,
            expiresAt: verificationResult.exp,
            agentId: verificationResult.agent_id,
          });
        }
      } else {
        data.replay_status = 'not_applicable';
      }

      // Phase 2c: action-binding status (issue #121). Its own axis, like
      // replay_status — never overloads verification_status. Computed for
      // verified tokens in EVERY mode (off included): even an operator running
      // DASHCLAW_ACT_BINDING=off gets the `match` signal that tells them their
      // issuer started minting bindings and it's safe to flip to required.
      // resolveActStatus returns 'not_applicable' for any non-verified token,
      // and hashes the raw request context (pre-redaction) so legitimate
      // matches whose goal contains a redactable pattern still compare.
      data.act_status = resolveActStatus(verificationResult, data);
      data.act_hash = verificationResult.act?.hash || null;
    } else {
      data.verification_status = 'unverified';
      data.replay_status = 'not_applicable';
      data.jti = null;
      data.act_status = 'not_applicable';
      data.act_hash = null;
    }

    // SECURITY: auto-scan the outbound `content` for secrets/credentials so
    // protection is built in, not opt-in. Warn by default (advisory in the
    // response — the agent hook surfaces it); only hard-block when the org
    // opts in via the DASHCLAW_AUTOSCAN_BLOCK setting. Never echo the raw
    // secret — only finding type/category/severity leave the server.
    let secretScan = null;
    if (data.content) {
      const scan = scanSensitiveData(data.content);
      if (!scan.clean) {
        const findings = scan.findings.map((f: { pattern: string; category: string; severity: string }) => ({ pattern: f.pattern, category: f.category, severity: f.severity }));
        const generalSettings = await getSettings(sql, orgId, { category: 'general' });
        const blockOn = generalSettings.some(
          (s: Record<string, unknown>) => s.key === 'DASHCLAW_AUTOSCAN_BLOCK' && String(s.value).toLowerCase() === 'true'
        );
        if (blockOn) {
          return NextResponse.json({
            decision: 'block',
            allowed: false,
            reasons: ['Secret or credential detected in outbound content'],
            secret_scan: { detected: true, recommendation: 'block', findings },
          }, { status: 200 });
        }
        secretScan = { detected: true, recommendation: 'warn', findings };
      }
    }

    const includeSignals = (request as Request & { nextUrl: URL }).nextUrl.searchParams.get('include_signals') === 'true';

    let computeSignalsFn = null;
    if (includeSignals) {
      const { computeSignals } = await import('../../lib/signals');
      computeSignalsFn = computeSignals;
    }

    const result = await evaluateGuard(orgId, data, sql, {
      includeSignals,
      computeSignals: computeSignalsFn as unknown as NonNullable<Parameters<typeof evaluateGuard>[3]>['computeSignals'],
    });

    if (secretScan) (result as Record<string, unknown>).secret_scan = secretScan;

    // Optional ?record=true — also create the running action record and return
    // its action_id (one HTTP call for governed hooks instead of two). Without
    // the param the response is byte-identical to the pre-record behavior.
    if ((request as Request & { nextUrl: URL }).nextUrl.searchParams.get('record') === 'true') {
      const mutable = result as Record<string, unknown>;
      try {
        const rec = await recordRunningAction(sql, orgId, data, result);
        mutable.recorded = rec.recorded;
        if (rec.recorded && rec.action_id) {
          mutable.action_id = rec.action_id;
        } else if (rec.reason) {
          mutable.recorded_error = rec.reason;
        }
      } catch (err) {
        console.error('[Guard] record=true action creation failed:', (err as Error).message);
        mutable.recorded = false;
        mutable.recorded_error = 'Failed to create action record';
      }
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return apiErrorResponse(err, 'GUARD POST');
  }
}

/**
 * GET /api/guard — List recent guard decisions.
 *
 * Query: ?agent_id=X&decision=block&limit=20&offset=0
 */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);

    // Self-host bypass: if no org is configured yet, return empty results gracefully.
    if (isSelfHostModeEnabled() && orgId === 'org_default') {
      const sql = getSql();
      const { searchParams } = (request as Request & { nextUrl: URL }).nextUrl;
      const agentId = searchParams.get('agent_id') || undefined;
      const decision = searchParams.get('decision') || undefined;
      const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 1000);
      const offset = parseInt(searchParams.get('offset') || '0', 10);

      const result = await listGuardDecisions(sql, orgId, { agentId, decision, limit, offset });
      return NextResponse.json({ ...result, limit, offset });
    }

    const sql = getSql();
    const { searchParams } = (request as Request & { nextUrl: URL }).nextUrl;
    const agentId = searchParams.get('agent_id') || undefined;
    const decision = searchParams.get('decision') || undefined;
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 1000);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const result = await listGuardDecisions(sql, orgId, { agentId, decision, limit, offset });
    return NextResponse.json({ ...result, limit, offset });
  } catch (err) {
    return apiErrorResponse(err, 'GUARD GET');
  }
}
