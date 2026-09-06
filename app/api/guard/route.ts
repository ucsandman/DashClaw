export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId, getUserId } from '../../lib/org';
import { checkOrgRateLimit } from '../../lib/org-rate-limit';
import { validateGuardInput, boundedIdField, enforcementModeField } from '../../lib/validate';
import { evaluateGuard } from '../../lib/guard';
import { getSql } from '../../lib/db';
import { apiErrorResponse } from '../../lib/apiErrors';
import { scanForPromptInjection } from '../../lib/promptInjection';
import { scanSensitiveData } from '../../lib/security';
import { getSettings } from '../../lib/repositories/settings.repository';
import { listGuardDecisions } from '../../lib/repositories/guard.repository';
import { resolveAgentIdentity } from '../../lib/guard-identity';
import { statedConfidence, prepareRecordReads, recordRunningAction, attachAssumptionAlerts } from '../../lib/guard/route-record';
import { tryIdempotentReplay } from '../../lib/guard/route-replay';
import { requestedAttemptId, attachExecutionClaim } from '../../lib/guard/route-claim';

/**
 * POST /api/guard — Evaluate guard policies for a proposed action.
 * Returns allow/warn/block/require_approval.
 *
 * Body: { action_type, risk_score?, agent_id?, agent_name?, systems_touched?, reversible?, declared_goal? }
 * Query: ?include_signals=true (optional, adds live signal warnings)
 * Query: ?record=true (optional, additive) — also creates the action record
 *        (same insert as POST /api/actions; a block creates the blocked
 *        record) and returns its action_id, so a governed hook needs one HTTP
 *        call instead of two — and the blocked record reuses this evaluation
 *        instead of re-evaluating into a duplicate guard_decisions row.
 *        Body { claim_execution: true, attempt_id } with ?record=true also
 *        claims the recorded action's one execution attempt for an allow/warn
 *        verdict (the same claim PATCH /api/actions/<id> performs) and echoes
 *        { claimed, attempt_id, claimed_at }, so the hook needs no second
 *        request at all (app/lib/guard/route-claim.ts).
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
// Route-level stage timings exposed as a standard Server-Timing header so a
// benchmark (scripts/bench-guard-hotpath.mjs) or browser devtools can split
// the caller-observed latency into replay-lookup / evaluation / record without
// touching the response body. Durations are attached to every success path.
function serverTimingHeader(stages: Record<string, number>): string {
  return Object.entries(stages)
    .map(([name, dur]) => `${name};dur=${Math.max(0, Math.round(dur))}`)
    .join(', ');
}

export async function POST(request: Request) {
  const stageTimings: Record<string, number> = {};
  const routeStart = Date.now();
  try {
    const orgId = getOrgId(request);

    // G5: org-keyed rate limit (Redis-backed, memory fallback). Runs before
    // any parsing or evaluation so a limited org costs nothing downstream.
    // The per-IP limiter in middleware remains the pre-auth fallback.
    const rateLimit = await checkOrgRateLimit(orgId);
    if (!rateLimit.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000));
      return NextResponse.json(
        {
          error: `Organization rate limit exceeded (${rateLimit.limit} requests per window). Retry after ${retryAfterSeconds}s.`,
          code: 'ORG_RATE_LIMITED',
          retry_after_ms: rateLimit.retryAfterMs,
          limit: rateLimit.limit,
        },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
      );
    }

    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const { valid, data, errors } = validateGuardInput(body);

    if (!valid) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    // Fleet attribution (v4.3): the pretool hook stamps the harness session uuid
    // on every ?record=true guard payload, and the subagent instance uuid on a
    // leaf call. Threaded onto the validated field bag so recordRunningAction's
    // insert persists them; sanitize to ≤ 200 chars (else null). No effect on
    // guard evaluation — these are attribution-only fields.
    data.harness_session_id = boundedIdField(body?.harness_session_id);
    data.subagent_uuid = boundedIdField(body?.subagent_uuid);
    // Containment instance discriminator (co-installed hook instances): rides
    // into buildContainmentRef so two installations sharing a harness session
    // never collide on the same worktree branch. Sanitized again (alnum ≤16)
    // in safeInstanceSegment before it touches a ref.
    data.containment_instance = boundedIdField(body?.containment_instance);
    // Client enforcement posture (attribution-only, like the fleet fields
    // above): rides in the persisted decision context so signals/doctor can
    // surface agents whose hooks observe but do not enforce.
    data.enforcement_mode = enforcementModeField(body?.enforcement_mode);
    // Stated confidence, threaded onto the same field bag so the ?record=true
    // insert persists it (see statedConfidence above). The route is the
    // authority: an unusable value clears the field outright rather than
    // trusting the validator to have stripped it.
    const stated = statedConfidence(body?.confidence);
    if (stated === undefined) delete data.confidence;
    else data.confidence = stated;

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

    // Phase 2: JWKS verification, replay protection, and act-binding status —
    // resolves agent identity from the JWT bearer token, mutating `data` in
    // place (app/lib/guard-identity.ts). Fail-soft: infrastructure errors fall
    // back to 'unverified', never 'failed'.
    await resolveAgentIdentity(request, data, sql);

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

    // End-to-end idempotency (Organ 3 Phase 3): a duplicate-key call inside
    // the replay window returns the PRIOR decision instead of re-evaluating.
    // No new guard_decisions row is written for a replay, so blind client
    // retries cannot double-count in approval-flood / signal / digest windows
    // — and the original audit row stays untouched. The lookup window is
    // short (10 min, see repository): dedupe absorbs retries, not policy
    // changes. Lookup failures fall through to a normal evaluation.
    const recordParam = (request as Request & { nextUrl: URL }).nextUrl.searchParams.get('record') === 'true';

    // Record-path gate reads (idempotency row, org plan, quota meter) depend
    // only on the request payload, never on the decision — start them now so
    // they overlap the replay lookup and the evaluation instead of running
    // serially after them. A failed prepare resolves null and the record path
    // falls back to its inline reads; the catch also keeps an abandoned
    // prepare (early-return paths) from surfacing as an unhandled rejection.
    const preparedRecordReads = recordParam
      ? prepareRecordReads(sql, orgId, data).catch(() => null)
      : null;

    const replayStart = Date.now();
    const replayResponse = await tryIdempotentReplay(sql, orgId, data, {
      secretScan,
      recordParam,
      createdBy: getUserId(request) || null,
      prepared: preparedRecordReads,
    });
    stageTimings.replay = Date.now() - replayStart;
    if (replayResponse) {
      stageTimings.total = Date.now() - routeStart;
      replayResponse.headers.set('Server-Timing', serverTimingHeader(stageTimings));
      return replayResponse;
    }

    const includeSignals = (request as Request & { nextUrl: URL }).nextUrl.searchParams.get('include_signals') === 'true';

    let computeSignalsFn = null;
    if (includeSignals) {
      const { computeSignals } = await import('../../lib/signals');
      computeSignalsFn = computeSignals;
    }

    const evalStart = Date.now();
    const result = await evaluateGuard(orgId, data, sql, {
      includeSignals,
      computeSignals: computeSignalsFn as unknown as NonNullable<Parameters<typeof evaluateGuard>[3]>['computeSignals'],
    });
    stageTimings.eval = Date.now() - evalStart;

    if (secretScan) (result as Record<string, unknown>).secret_scan = secretScan;

    await attachAssumptionAlerts(sql, orgId, data, result as Record<string, unknown>);

    // Optional ?record=true — also create the running action record and return
    // its action_id (one HTTP call for governed hooks instead of two). Without
    // the param the response is byte-identical to the pre-record behavior.
    if (recordParam) {
      const mutable = result as Record<string, unknown>;
      const recordStart = Date.now();
      try {
        const rec = await recordRunningAction(sql, orgId, data, result, getUserId(request) || null, preparedRecordReads);
        mutable.recorded = rec.recorded;
        if (rec.recorded && rec.action_id) {
          mutable.action_id = rec.action_id;
        } else if (rec.reason) {
          mutable.recorded_error = rec.reason;
        }
        if (rec.security) mutable.security = rec.security;
      } catch (err) {
        console.error('[Guard] record=true action creation failed:', (err as Error).message);
        mutable.recorded = false;
        mutable.recorded_error = 'Failed to create action record';
      }
      stageTimings.record = Date.now() - recordStart;

      // Folded execution claim: one request for evaluate + record + claim.
      const attemptId = requestedAttemptId(body);
      if (attemptId) {
        const claimStart = Date.now();
        await attachExecutionClaim(sql, orgId, { attemptId, principalId: getUserId(request) || '', act: body?.act }, data, mutable);
        stageTimings.claim = Date.now() - claimStart;
      }
    }

    stageTimings.total = Date.now() - routeStart;
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Server-Timing': serverTimingHeader(stageTimings) },
    });
  } catch (err) {
    return apiErrorResponse(err, 'GUARD POST');
  }
}

// ?days=N windows the list + `total` (clamped 1–90); absent = all history.
function parseDaysParam(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.min(n, 90);
}

/**
 * GET /api/guard — List recent guard decisions.
 *
 * Query: ?agent_id=X&decision=block&days=7&limit=20&offset=0
 * `days` windows both the rows and `total`, so `?decision=block&days=7`
 * returns the true weekly denied count via `total`.
 */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);

    // Self-host with an unconfigured org ('org_default') takes this same path:
    // listGuardDecisions simply returns empty results for an unseeded org, so
    // no bypass branch is needed.
    const sql = getSql();
    const { searchParams } = (request as Request & { nextUrl: URL }).nextUrl;
    const agentId = searchParams.get('agent_id') || undefined;
    const decision = searchParams.get('decision') || undefined;
    const days = parseDaysParam(searchParams.get('days'));
    // Same guard as plans R4: NaN (?limit=abc) must not reach the SQL
    // LIMIT/OFFSET clause (it 500s), and explicit 0/negatives clamp to the
    // floor. Number.isFinite keeps NaN and a deliberate 0 distinguishable
    // (2026-07-29 security review, LOW).
    const rawLimit = parseInt(searchParams.get('limit') || '20', 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 20;
    const rawOffset = parseInt(searchParams.get('offset') || '0', 10);
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

    const result = await listGuardDecisions(sql, orgId, { agentId, decision, days, limit, offset });
    return NextResponse.json({ ...result, limit, offset });
  } catch (err) {
    return apiErrorResponse(err, 'GUARD GET');
  }
}
