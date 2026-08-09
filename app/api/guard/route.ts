export const dynamic = 'force-dynamic';
export const revalidate = 0;

import crypto from 'node:crypto';
import { NextResponse, after } from 'next/server';
import { getOrgId, getUserId } from '../../lib/org';
import { checkOrgRateLimit } from '../../lib/org-rate-limit';
import { validateGuardInput, boundedIdField, enforcementModeField } from '../../lib/validate';
import { evaluateGuard, getOrgHaltState } from '../../lib/guard';
import { getSql } from '../../lib/db';
import { apiErrorResponse } from '../../lib/apiErrors';
import { scanForPromptInjection } from '../../lib/promptInjection';
import { scanSensitiveData, redactAny } from '../../lib/security';
import { getSettings } from '../../lib/repositories/settings.repository';
import { listGuardDecisions, getGuardDecisionByIdempotencyKey } from '../../lib/repositories/guard.repository';
import { createActionRecord, createBlockedActionRecord, getActionByIdempotencyKey } from '../../lib/repositories/actions.repository';
import { incrementTrialActionCount } from '../../lib/repositories/hosted-workspace.repository';
import { fireActionAlert } from '../../lib/actionAlerts';
import { fireApprovalSurfaces } from '../../lib/approvalSurfaces';
import { EVENTS, publishOrgEvent } from '../../lib/events';
import { resolveAgentIdentity } from '../../lib/guard-identity';
import { buildContainmentRef } from '../../lib/guard/containment';
import { getAssumptionAlerts } from '../../lib/assumption-notify';

type GuardSql = ReturnType<typeof getSql>;
type GuardData = Record<string, unknown> & { agent_id?: string; agent_name?: string; declared_goal?: string; verification_status?: string };
type GuardResult = { decision: string; risk_score?: number; decision_id?: string; reason?: string | null; reasons?: string[]; matched_policies?: string[]; containment?: { status: string; basis: string; ref: string } | null };


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
interface PreparedRecordReads {
  existing: Record<string, unknown> | null;
}

async function prepareRecordReads(sql: GuardSql, orgId: string, data: GuardData): Promise<PreparedRecordReads> {
  const existing = typeof data.idempotency_key === 'string' && data.idempotency_key
    ? await getActionByIdempotencyKey(sql, orgId, data.idempotency_key)
    : null;
  return { existing: existing as Record<string, unknown> | null };
}

async function recordRunningAction(
  sql: GuardSql,
  orgId: string,
  data: GuardData,
  result: GuardResult,
  createdBy: string | null,
  prepared?: Promise<PreparedRecordReads | null> | null,
): Promise<{ recorded: boolean; action_id?: string; reason?: string }> {
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
  const dlpFindings: unknown[] = [];
  for (const k of ['agent_name', 'declared_goal', 'reasoning', 'authorization_scope', 'trigger', 'input_summary']) {
    if (record[k] != null) record[k] = redactAny(record[k], dlpFindings);
  }
  if (record.systems_touched != null) record.systems_touched = redactAny(record.systems_touched, dlpFindings);

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
    const blockedAction = await createBlockedActionRecord(sql, {
      orgId,
      action_id: blocked_action_id,
      data: record as Parameters<typeof createBlockedActionRecord>[1]['data'],
      guardDecision: result,
      signature: null,
      verified: data.verification_status === 'verified',
      timestamp_start: new Date().toISOString(),
      riskScore: result.risk_score ?? null,
    });
    after(() => {
      void publishOrgEvent(EVENTS.ACTION_CREATED, { orgId, action: blockedAction });
      void fireActionAlert('blocked', blockedAction as Record<string, unknown>, sql, orgId);
    });
    return { recorded: true, action_id: blocked_action_id };
  }

  // Containment Verdicts (drizzle/0064): a negotiated+eligible allow_contained
  // verdict starts the row's staged-effect lifecycle at 'contained'. Every
  // other decision leaves containment_status NULL (createActionRecord's
  // default passthrough). The merge target (containment_ref) is stamped HERE,
  // server-derived from the payload's harness_session_id (security follow-up,
  // RFC 2026-07-06) — the later awaiting_promotion flip can no longer supply
  // an attacker-controllable ref for a row that carries this stamp.
  if (result.decision === 'allow_contained') {
    record.containment_status = 'contained';
    record.containment_ref = result.containment?.ref ?? buildContainmentRef(data.harness_session_id, data.containment_instance);
  }

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
    // Separation of duties (drizzle/0055): trusted middleware principal.
    createdBy,
  });

  // Same post-response side effects as POST /api/actions (event for the live
  // decision stream, hosted-trial action count). after() — not a bare
  // fire-and-forget promise — because on Vercel the function can freeze the
  // moment the response returns, dropping the increment.
  after(() => {
    void publishOrgEvent(EVENTS.ACTION_CREATED, { orgId, action: createdAction });
    return incrementTrialActionCount(sql, orgId).catch((err: unknown) => {
      console.warn('[Guard] record=true background updates failed:', (err as Error).message);
    });
  });

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

  return { recorded: true, action_id };
}

/**
 * End-to-end idempotency (Organ 3 Phase 3): a duplicate-key call inside the
 * replay window returns the PRIOR decision instead of re-evaluating. No new
 * guard_decisions row is written for a replay, so blind client retries cannot
 * double-count in approval-flood / signal / digest windows — and the original
 * audit row stays untouched. The lookup window is short (10 min, see
 * repository): dedupe absorbs retries, not policy changes. Returns the replay
 * response, or null to fall through to a normal evaluation (including on
 * lookup failure).
 */
async function tryIdempotentReplay(
  sql: GuardSql,
  orgId: string,
  data: GuardData,
  opts: { secretScan: Record<string, unknown> | null; recordParam: boolean; createdBy: string | null; prepared?: Promise<PreparedRecordReads | null> | null },
): Promise<NextResponse | null> {
  if (typeof data.idempotency_key !== 'string' || !data.idempotency_key) return null;

  // Org halt is an emergency override with an immediate-block guarantee, NOT
  // an ordinary policy change the dedupe window may absorb. A halted org
  // must skip the replay short-circuit so the request flows into
  // evaluateGuard (which returns the halt block) — otherwise a retried
  // action carrying a matching idempotency_key would be served its cached
  // pre-halt decision for up to the replay window. (Same cached settings
  // read evaluateGuard uses, so /api/halt's eager invalidation still wins.)
  // The two lookups are independent reads; the halt verdict is applied to the
  // lookup result exactly as before, so a halted org still never replays.
  const [haltState, priorRow] = await Promise.all([
    getOrgHaltState(sql, orgId),
    getGuardDecisionByIdempotencyKey(sql, orgId, data.idempotency_key),
  ]);
  const prior = haltState?.halted ? null : priorRow;
  if (!prior) return null;

  let priorPolicies: unknown[] = [];
  try { priorPolicies = JSON.parse(String(prior.matched_policies ?? '[]')); } catch { priorPolicies = []; }
  const replay: Record<string, unknown> = {
    decision: prior.decision,
    decision_id: prior.id,
    action_id: prior.id, // deprecated alias of decision_id (overwritten by the record id below)
    reason: prior.reason,
    risk_score: prior.risk_score != null ? Number(prior.risk_score) : null,
    matched_policies: priorPolicies,
    verification_status: prior.verification_status,
    agent_id: prior.agent_id,
    agent_name: prior.agent_name,
    evaluated_at: prior.created_at,
    idempotent_replay: true,
  };
  if (opts.secretScan) replay.secret_scan = opts.secretScan;
  await attachAssumptionAlerts(sql, orgId, data, replay);
  if (opts.recordParam) {
    try {
      // recordRunningAction short-circuits on the existing action row;
      // when the prior record attempt failed it heals by creating one.
      const rec = await recordRunningAction(sql, orgId, data, { decision: String(prior.decision), risk_score: prior.risk_score != null ? Number(prior.risk_score) : undefined, decision_id: String(prior.id), reason: prior.reason != null ? String(prior.reason) : null, matched_policies: priorPolicies as string[] }, opts.createdBy, opts.prepared);
      replay.recorded = rec.recorded;
      if (rec.recorded && rec.action_id) replay.action_id = rec.action_id;
      else if (rec.reason) replay.recorded_error = rec.reason;
    } catch (err) {
      console.error('[Guard] record=true replay record failed:', (err as Error).message);
      replay.recorded = false;
      replay.recorded_error = 'Failed to create action record';
    }
  }
  return NextResponse.json(replay, { status: 200 });
}

/**
 * Advocate v2a advisory — rides on the response until acknowledged; never
 * changes the decision. Attached on both the replay path and the fresh
 * evaluation path.
 */
async function attachAssumptionAlerts(
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
      } catch (err) {
        console.error('[Guard] record=true action creation failed:', (err as Error).message);
        mutable.recorded = false;
        mutable.recorded_error = 'Failed to create action record';
      }
      stageTimings.record = Date.now() - recordStart;
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
