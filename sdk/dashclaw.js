/**
 * DashClaw SDK (Stable Runtime API)
 * Focused governance runtime client for AI agents.
 *
 * Version is the single source of truth in sdk/package.json — never
 * hardcoded here, in the README header, or in app/ pages. Consumers
 * read it at runtime via `import pkg from 'dashclaw/package.json'`.
 */

import { createHash, randomUUID } from 'crypto';

class ApprovalDeniedError extends Error {
  constructor(message, decision) {
    super(message);
    this.name = 'ApprovalDeniedError';
    this.decision = decision;
  }
}

class GuardBlockedError extends Error {
  constructor(decision) {
    super(decision.reason || 'Action blocked by policy');
    this.name = 'GuardBlockedError';
    this.decision = decision;
  }
}

class ApprovalPendingError extends Error {
  constructor(actionId) {
    super(`Action ${actionId} is pending approval — the governed work was NOT executed. Poll waitForApproval('${actionId}') and re-run once approved.`);
    this.name = 'ApprovalPendingError';
    this.actionId = actionId;
  }
}

class ExecutionClaimError extends Error {
  constructor(actionId, attemptId, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ExecutionClaimError';
    this.actionId = actionId;
    this.attemptId = attemptId;
  }
}

class OutcomeConfirmationError extends Error {
  constructor(actionId, cause) {
    super(
      `Action ${actionId} ran successfully, but DashClaw did not confirm the completed outcome. ` +
      'Reconcile the action outcome before deciding whether any retry is safe.',
      cause ? { cause } : undefined,
    );
    this.name = 'OutcomeConfirmationError';
    this.actionId = actionId;
  }
}

// ---------------------------------------------------------------------------
// Module-level private helpers — not exported, not part of the published API.
// ---------------------------------------------------------------------------

/**
 * Serialize query params. Skips undefined/null values. Passing them straight
 * into URLSearchParams serializes the literal strings "undefined"/"null",
 * which the receiving routes treat as real filter values and match zero rows.
 * Falsy-but-valid values (0, false, '') are preserved. Mirrors the v1 SDK
 * behavior.
 */
function serializeQuery(params) {
  if (!params) return '';
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) qs.append(key, String(value));
  }
  return qs.toString();
}

/**
 * Parse a response body defensively. A non-JSON error body (a Vercel
 * 502/504/413 gateway page, a 429 rate-limit page) makes res.json() reject
 * with a SyntaxError, which would propagate instead of the status-bearing
 * error and lose res.status. Fall back to {} so the real status is thrown.
 */
async function parseJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/** Normalize a non-OK response into the SDK's thrown error shapes. */
function throwRequestError(res, data) {
  if (res.status === 403 && data.decision && data.decision.decision === 'block') {
    throw new GuardBlockedError(data.decision);
  }

  // Prioritize reason (from governance blocks) over generic error field
  const errorMessage = data.reason || data.error || `Request failed with status ${res.status}`;
  const err = new Error(errorMessage);
  err.status = res.status;
  err.details = data.details;
  err.decision = data;
  throw err;
}

/** Read the decision body of a policy-blocked (403) SSE response. */
async function readBlockedStreamDecision(res) {
  const body = await parseJsonSafe(res);
  return body.decision || { reason: 'SSE stream blocked by policy' };
}

// ---------------------------------------------------------------------------
// Evidence-first guard — client-side scrub. Applied to an `act` payload
// before it rides guard()/createAction() to the server, so a captured
// Authorization header or an embedded secret never leaves the machine even
// as evidence. The server still re-redacts (this is defense in depth, not
// the only redaction layer). See
// docs/superpowers/specs/2026-07-05-evidence-first-guard.md.
// ---------------------------------------------------------------------------

const SCRUB_HEADER_KEYS = new Set(['authorization', 'cookie', 'x-api-key']);

// V5: waitForPlanReview's terminal set. 'pending' and 'previewing' are both
// non-terminal — a plan dry-running its steps ('previewing') hasn't reached
// an operator verdict yet, same as 'pending'.
const PLAN_REVIEW_TERMINAL_STATUSES = new Set(['approved', 'partially_approved', 'denied', 'revoked', 'expired']);

// Containment Verdicts (RFC 2026-07-06) — the only two operator verdicts
// resolveContainment accepts. Validated client-side before the request
// leaves so a typo is a synchronous throw, not a round trip to the 400.
const CONTAINMENT_VERDICTS = new Set(['promote', 'discard']);

/** Mask secret-looking substrings in a command/body/content excerpt. */
function scrubActText(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    .replace(/oc_live_[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, '[REDACTED]')
    .replace(/ghp_[A-Za-z0-9]{20,}/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/(password|token|secret)\s*=\s*[^\s&"']+/gi, (_m, key) => `${key}=[REDACTED]`);
}

/** Drop Authorization/Cookie/x-api-key entries from a headers map. */
function scrubActHeaders(headers) {
  if (!headers || typeof headers !== 'object') return headers;
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SCRUB_HEADER_KEYS.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Pure helper: return a scrubbed deep copy of an `act` payload ({ kind,
 * command, request, statement, file }) safe to send as guard/createAction
 * evidence. Strips secret-bearing headers and masks common token shapes in
 * text excerpts. Exported for unit testing.
 */
function scrubAct(act) {
  if (!act || typeof act !== 'object') return act;
  const clone = JSON.parse(JSON.stringify(act));
  if (typeof clone.command === 'string') clone.command = scrubActText(clone.command);
  if (typeof clone.statement === 'string') clone.statement = scrubActText(clone.statement);
  if (clone.request && typeof clone.request === 'object') {
    if (typeof clone.request.body_excerpt === 'string') {
      clone.request.body_excerpt = scrubActText(clone.request.body_excerpt);
    }
    if (clone.request.headers) clone.request.headers = scrubActHeaders(clone.request.headers);
  }
  if (clone.file && typeof clone.file === 'object' && typeof clone.file.content_excerpt === 'string') {
    clone.file.content_excerpt = scrubActText(clone.file.content_excerpt);
  }
  return clone;
}

function withExecutionClaimCapability(capabilities) {
  const current = Array.isArray(capabilities) ? capabilities : [];
  return current.includes('execution_claims') ? current : [...current, 'execution_claims'];
}

function waitForDelay(ms, signal) {
  if (signal?.aborted) return Promise.resolve(false);
  if (ms <= 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Dispatch the accumulated SSE event (if any) and reset the parser state.
 * Returns the parsed frame, or null for empty/unparseable events.
 */
function flushSSEFrame(state) {
  const { event, data, id } = state;
  state.event = null;
  state.data = '';
  state.id = null;
  if (!event || !data) return null;
  try {
    return { event, data: JSON.parse(data), id };
  } catch { /* ignore parse errors */ }
  return null;
}

/**
 * Consume one SSE line into the parser state. Returns a complete frame when
 * a blank line dispatches an accumulated event, otherwise null.
 */
function consumeSSELine(state, line) {
  if (line.startsWith('id: ')) {
    state.id = line.slice(4).trim();
    return null;
  }
  if (line.startsWith('event: ')) {
    state.event = line.slice(7).trim();
    return null;
  }
  if (line.startsWith('data: ')) {
    state.data += line.slice(6);
    return null;
  }
  if (line.startsWith(':')) return null; // SSE comment (heartbeat)
  if (line !== '') return null;
  return flushSSEFrame(state);
}

/** Buffer a decoded chunk and yield every complete SSE frame it finishes. */
function* drainSSEBuffer(state, text) {
  state.buffer += text;
  const lines = state.buffer.split('\n');
  state.buffer = lines.pop();
  for (const line of lines) {
    const frame = consumeSSELine(state, line);
    if (frame) yield frame;
  }
}

/**
 * Classify an action's approval state.
 * Returns { resolved: false } while waiting, { resolved: true, result } on
 * approval, or { resolved: true, error } on denial.
 */
function evaluateApprovalState(action) {
  if (action.approved_by) return { resolved: true, result: { action } };
  if (action.status === 'failed' || action.status === 'cancelled') {
    return { resolved: true, error: new ApprovalDeniedError(action.error_message || 'Operator denied the action.', action.status) };
  }
  // Approvals lifecycle (roadmap v2.3): the server expired the approval — it
  // can no longer release anything. Terminal; err.status distinguishes it
  // from an operator denial.
  if (action.status === 'expired') {
    return { resolved: true, error: new ApprovalDeniedError(action.error_message || 'Approval expired before a decision was made.', action.status) };
  }
  return { resolved: false };
}

/** Evaluate an SSE frame against the awaited action id. */
function evaluateApprovalFrame(frame, actionId) {
  if (frame.event !== 'action.updated' || frame.data?.action_id !== actionId) {
    return { resolved: false };
  }
  return evaluateApprovalState(frame.data);
}

/**
 * Classify the pending-state transitions of one polling result, after the
 * approve/deny outcomes have already been ruled out by evaluateApprovalState.
 */
function resolvePendingTransition(result, wasPending, actionId) {
  const action = result.action;
  if (wasPending && action.status !== 'pending_approval') {
    return { error: new Error(`Action ${actionId} left pending_approval state without explicit approval metadata (Status: ${action.status})`) };
  }
  if (!wasPending && action.status === 'running') return { done: true, result };
  return {};
}

/**
 * Classify one polling result. Returns { done: true, result } when the wait
 * is over, { error } when it must throw, or {} to keep polling.
 */
function resolvePollState(result, wasPending, actionId) {
  const approval = evaluateApprovalState(result.action);
  if (approval.error) return { error: approval.error };
  if (approval.resolved) return { done: true, result };
  return resolvePendingTransition(result, wasPending, actionId);
}

function approvalTimeoutError(actionId) {
  return new Error(`Timed out waiting for approval of action ${actionId}`);
}

/** Stop the SSE wait: cancel the timeout guard and abort the stream. */
function settleSSEWait(wait) {
  clearTimeout(wait.timeoutId);
  wait.controller.abort();
}

/**
 * Errors that must propagate out of the SSE fast path instead of triggering
 * the polling fallback: explicit denials, policy blocks, and timeouts.
 */
function isApprovalWaitFatal(err) {
  return err instanceof ApprovalDeniedError
    || err instanceof GuardBlockedError
    || Boolean(err.message?.includes('Timed out'));
}

class DashClaw {
  /**
   * @param {Object} options
   * @param {string} options.baseUrl - DashClaw base URL
   * @param {string} options.apiKey - API key for authentication
   * @param {string} options.agentId - Unique identifier for this agent
   * @param {string} [options.agentName] - Human-readable label for this agent (stored in audit trail)
   * @param {string} [options.authToken] - Phase 2: JWT bearer token from your OIDC provider.
   *   When set, DashClaw server verifies the token via JWKS and returns `verification_status`
   *   in every guard response. The JWT `sub` claim overrides agentId in the audit record
   *   when verification succeeds — cryptographic proof beats self-assertion.
   * @param {number} [options.timeoutMs=30000] - Per-request timeout in milliseconds. A slow or
   *   hung server aborts the request instead of hanging the caller forever; throws an Error with
   *   `code: 'ETIMEDOUT'`.
   */
  constructor({ baseUrl, apiKey, agentId, agentName, authToken, timeoutMs }) {
    if (!baseUrl) throw new Error('baseUrl is required');
    if (!apiKey) throw new Error('apiKey is required');
    if (!agentId) throw new Error('agentId is required');

    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.agentId = agentId;
    this.agentName = agentName || null;
    this.authToken = authToken || null;
    this.timeoutMs = timeoutMs || 30_000;
  }

  /** @private Authentication headers shared by JSON requests and the SSE stream. */
  _authHeaders() {
    return {
      'x-api-key': this.apiKey,
      ...(this.authToken ? { 'Authorization': `Bearer ${this.authToken}` } : {}),
    };
  }

  /** @private Join base URL, path, and serialized query params. */
  _buildUrl(path, params) {
    const qs = serializeQuery(params);
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
  }

  async _request(path, method = 'GET', body = null, params = null) {
    let res;
    try {
      res = await fetch(this._buildUrl(path, params), {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...this._authHeaders(),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        const timeoutErr = new Error(`Request to ${path} timed out after ${this.timeoutMs}ms`);
        timeoutErr.code = 'ETIMEDOUT';
        throw timeoutErr;
      }
      throw err;
    }

    const data = await parseJsonSafe(res);
    if (!res.ok) throwRequestError(res, data);
    return data;
  }

  /** @private GET shorthand for thin endpoint wrappers. */
  async _get(path, params = null) {
    return this._request(path, 'GET', null, params);
  }

  /** @private POST shorthand for thin endpoint wrappers. */
  async _post(path, body = null, params = null) {
    return this._request(path, 'POST', body, params);
  }

  /** @private PATCH shorthand for thin endpoint wrappers. */
  async _patch(path, body = null) {
    return this._request(path, 'PATCH', body);
  }


  /**
   * POST /api/guard — "Can I do X?"
   * @param {Object} context
   * @param {number} [context.confidence] - Your honest 0-100 confidence,
   *   stated BEFORE acting, that this action completes without a human
   *   stepping in. Optional integer; stored on the action record the guard
   *   call creates and scored against the real outcome on /decisions
   *   (Predicted vs actual). Never affects the decision. Omit it rather than
   *   guess — exactly 50 is the column default and reads as "unstated", and
   *   an unusable value is dropped rather than rejected.
   * @param {string} [context.content] - Outbound content to fabrication-check
   *   (e.g. a drafted email/message). Pairs with `sourceOfTruth` and a
   *   `non_fabrication` guard policy: every operational token (amounts, dates,
   *   percentages, registered IDs) must trace to an allowed fact, or the action
   *   is blocked / routed to approval. The response carries a signed,
   *   re-verifiable receipt under `non_fabrication`.
   * @param {Object} [context.sourceOfTruth] - The facts `content` is allowed to
   *   state: `{ allowedFacts, requiredFacts, forbiddenPatterns?, extract? }`.
   * @returns {Promise<{
   *   decision: 'allow'|'block'|'require_approval'|'warn'|'allow_contained',
   *   reason: string,
   *   signals: string[],
   *   verification_status: 'verified'|'unverified'|'expired'|'failed'|'unknown_issuer',
   *   agent_id: string|null,
   *   agent_name: string|null,
   *   containment?: { status: 'contained', basis: string, ref: string },
   * }>}
   *
   * `allow_contained` (Containment Verdicts, RFC 2026-07-06): a provably
   * file-scoped act the server will let proceed but hold for operator
   * promote/discard via `resolveContainment` — ONLY when the caller declared
   * `client_capabilities: ['allow_contained']` in the guard context. This SDK
   * never adds that capability itself, so a caller that does not opt in
   * receives `require_approval` in its place (version skew only tightens).
   * When present, `containment` carries the eligibility basis.
   *
   * `verification_status` reflects whether the JWT bearer token (if provided
   * via the `authToken` constructor option) was cryptographically verified:
   *   verified       — signature valid; audit entry anchored to JWT sub
   *   unverified     — no token, or issuer temporarily unreachable (fail-soft)
   *   expired        — token expired; consider refreshing before next call
   *   failed         — bad signature, malformed token, or audience mismatch
   *   unknown_issuer — issuer not in DASHCLAW_ALLOWED_ISSUER (server config)
   */
  async guard(context, { record = false } = {}) {
    const payload = {
      // Approvals lifecycle: declare the wait window this client will poll if
      // the decision is require_approval, so the pending row gets a truthful
      // approval_expires_at stamp. Matches the waitForApproval default
      // (300s); pass approval_wait_seconds in context to override.
      approval_wait_seconds: 300,
      ...context,
      agent_id: context.agent_id || this.agentId,
      // Include agent_name for audit attribution if not already provided by caller
      ...(context.agent_name == null && this.agentName ? { agent_name: this.agentName } : {}),
    };
    // Recording uses the same retry identity as createAction. Evaluation-only
    // calls remain untouched, and an explicit caller key always wins.
    if (record && !payload.idempotency_key) {
      payload.idempotency_key = this.deriveIdempotencyKey({
        agent_id: payload.agent_id ?? '',
        action_type: payload.action_type ?? '',
        declared_goal: payload.declared_goal ?? '',
        session_id: payload.session_id ?? '',
        ts_bucket: Math.floor(Date.now() / 3600000),
      });
    }
    return this._post('/api/guard', payload, record ? { record: true } : null);
  }

  /**
   * POST /api/actions — "I am attempting X."
   *
   * Optional non-fabrication fields: pass `content` (the outbound text) and
   * `sourceOfTruth` ({ allowedFacts, requiredFacts, forbiddenPatterns?, extract? })
   * to have a `non_fabrication` guard policy verify the content before the
   * action proceeds. A violation blocks the action or routes it to approval and
   * is recorded with a signed receipt in the decision ledger.
   *
   * Optional `session_id`: pass the id from `createSession()` to link this
   * action to a session via the Direct path (exact attribution). When omitted,
   * the server falls back to time-window correlation by agent_id.
   * @param {Object} action
   * @param {string} [action.session_id] Session to attribute this action to.
   */
  async createAction(action) {
    const payload = {
      // Approvals lifecycle: same wait-window declaration as guard(), for
      // actions created directly as pending_approval (caller value wins).
      approval_wait_seconds: 300,
      ...action,
      agent_id: this.agentId,
    };
    // Auto-derive an idempotency key when the caller didn't supply one
    // (explicit key always wins) so a blind retry returns the original row
    // instead of duplicating the ledger. The hour bucket scopes
    // content-identical actions: a retry seconds later dedupes; the same
    // logical goal re-run much later is a new action.
    if (!payload.idempotency_key) {
      payload.idempotency_key = this.deriveIdempotencyKey({
        agent_id: payload.agent_id ?? '',
        action_type: payload.action_type ?? '',
        declared_goal: payload.declared_goal ?? '',
        session_id: payload.session_id ?? '',
        ts_bucket: Math.floor(Date.now() / 3600000),
      });
    }
    return this._post('/api/actions', payload);
  }

  // ---------------------------------------------------------------------------
  // Evidence-first guard — attach the actual act (shell/http/sql/file) so the
  // server classifies it and folds the derived risk in, rather than trusting
  // a self-declared action_type. See
  // docs/superpowers/specs/2026-07-05-evidence-first-guard.md. `act` rides
  // through guard()'s existing context spread — its shape is unaffected.
  // ---------------------------------------------------------------------------

  /**
   * One call that runs the full governance loop with evidence attached:
   * guard (with act) → optional createAction → approval → execution
   * claim → fn() → outcome.
   * Minimal inputs use `?record=true` to combine guard and recording. Richer
   * action fields or a server that did not record use createAction. Either
   * response can require approval; params.wait=false raises instead of waiting.
   *
   * @param {Object} act - { kind: 'shell'|'http'|'sql'|'file', ... } — see the
   *   wire contract in the spec above. Scrubbed client-side before send.
   * @param {Object} [params] - context/action fields (action_type,
   *   declared_goal, risk_score, ...). `wait` (default true) controls whether
   *   to block on a pending approval; pass `wait: false` to get an
   *   ApprovalPendingError instead of blocking — the governed work is NEVER
   *   run while the approval is pending. Poll and re-run once approved.
   * @param {Function} fn - the real work to run once guard/approval clears.
   * @returns {Promise<*>} fn()'s return value.
   * @throws {GuardBlockedError} when guard blocks the action.
   * @throws {ApprovalDeniedError} when an operator denies the pending approval.
   * @throws {ApprovalPendingError} when the action needs approval and
   *   `wait: false` was passed (fn() was not executed).
   * @throws {ExecutionClaimError} when the server does not confirm the exact
   *   one-shot execution claim (fn() was not executed).
   * @throws {OutcomeConfirmationError} when fn() succeeds but the completed
   *   outcome cannot be confirmed.
   */
  async runGoverned(act, params, fn) {
    const { wait, ...context } = params || {};
    const scrubbedAct = scrubAct(act);
    const guardContext = {
      ...context,
      act: scrubbedAct,
      client_capabilities: withExecutionClaimCapability(context.client_capabilities),
    };

    // Only use in-guard recording for fields that route preserves. Richer
    // action metadata needs createAction's validation, persistence and pricing.
    const recordFields = new Set([
      'action_type', 'declared_goal', 'risk_score', 'agent_name', 'systems_touched',
      'reversible', 'target', 'content', 'source_of_truth', 'intel', 'tool',
      'write_paths', 'trigger', 'swarm_id', 'idempotency_key',
      'approval_wait_seconds', 'client_capabilities', 'metadata', 'confidence',
    ]);
    const record = Object.keys(context).every((key) => recordFields.has(key));
    const decision = await this.guard(guardContext, { record });
    if (decision.decision === 'block') throw new GuardBlockedError(decision);

    let action_id = decision.action_id;
    let requiresApproval = decision.decision === 'require_approval';
    if (!record || decision.recorded !== true || !action_id) {
      // Server didn't record the action on the guard call — fall back to the
      // compatible two-call recording path. Governed execution still requires
      // the protocol-1 claim endpoint below.
      const created = await this.createAction(guardContext);
      action_id = created.action_id;
      requiresApproval ||= created.action?.status === 'pending_approval';
    }

    if (requiresApproval) {
      // `wait: false` must not become a silent approval bypass: the previous
      // behavior fell through and executed fn() with the approval still
      // pending — an ungoverned run of exactly the work a human was asked to
      // review. Fail loud instead; the caller polls and re-runs.
      if (wait === false) throw new ApprovalPendingError(action_id);
      await this.waitForApproval(action_id);
    }

    await this.claimExecution(action_id, scrubbedAct);

    let result;
    try {
      result = await fn();
    } catch (err) {
      try {
        await this.reportActionOutcome(action_id, { status: 'failed', error_message: err?.message || String(err) });
      } catch (reportError) {
        if (err && (typeof err === 'object' || typeof err === 'function')) {
          err.outcomeReportError = reportError;
          err.actionId ??= action_id;
        }
      }
      throw err;
    }

    try {
      await this.reportActionOutcome(action_id, { status: 'completed' });
    } catch (err) {
      throw new OutcomeConfirmationError(action_id, err);
    }
    return result;
  }

  /**
   * Claim one execution attempt before running governed work. A lost or
   * mismatched response never grants authority to execute and is not retried.
   */
  async claimExecution(actionId, act) {
    const attemptId = randomUUID();
    let response;
    try {
      response = await this._patch(`/api/actions/${actionId}`, {
        claim_execution: true,
        attempt_id: attemptId,
        agent_id: this.agentId,
        act,
      });
    } catch (cause) {
      const upgrade = cause?.status === 404
        ? ' The server does not support required execution claims; upgrade DashClaw before running this callback.'
        : '';
      throw new ExecutionClaimError(
        actionId,
        attemptId,
        `Execution claim for action ${actionId} was not confirmed.${upgrade} Reconcile the action before retrying.`,
        cause,
      );
    }

    if (
      response?.claimed !== true
      || response.action_id !== actionId
      || response.attempt_id !== attemptId
    ) {
      throw new ExecutionClaimError(
        actionId,
        attemptId,
        `Execution claim for action ${actionId} returned an invalid confirmation. Reconcile the action before retrying.`,
      );
    }
    return response;
  }

  /**
   * runGoverned() wrapped around a real fetch(). Derives
   * `act: {kind:'http', request:{method,url,body_excerpt}}` from the request
   * so the server evidence-classifies it instead of trusting a declared
   * action_type.
   * @param {string} url
   * @param {Object} [init] - fetch() options (method, headers, body, ...)
   * @param {Object} [params] - same as runGoverned's params (action_type,
   *   declared_goal, wait, ...); defaults action_type to 'api' (the type the server derives for http acts, so guardedFetch calls grade as evidence).
   * @returns {Promise<Response>}
   */
  async guardedFetch(url, init = {}, params = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const bodyExcerpt = typeof init.body === 'string' ? init.body.slice(0, 4096) : undefined;
    const act = {
      kind: 'http',
      request: {
        method,
        url: String(url).slice(0, 2048),
        ...(bodyExcerpt !== undefined ? { body_excerpt: bodyExcerpt } : {}),
      },
    };
    return this.runGoverned(act, {
      action_type: 'api',
      declared_goal: `HTTP ${method} ${url}`,
      ...params,
    }, () => fetch(url, init));
  }

  /**
   * PATCH /api/actions/:id — "X finished with result Y."
   */
  async updateOutcome(actionId, outcome) {
    return this._patch(`/api/actions/${actionId}`, {
      ...outcome,
      timestamp_end: outcome.timestamp_end || new Date().toISOString()
    });
  }

  /**
   * GET /api/actions/:id — Fetch a single action by ID.
   */
  async getAction(actionId) {
    return this._get(`/api/actions/${actionId}`);
  }

  /**
   * GET /api/actions?status=pending_approval — List actions awaiting approval.
   */
  async getPendingApprovals(limit = 20, offset = 0) {
    return this._get('/api/actions', {
      status: 'pending_approval',
      limit,
      offset,
    });
  }

  /**
   * POST /api/actions/:id/approve — Approve or deny an action.
   * @param {string} actionId
   * @param {'allow'|'deny'} decision
   * @param {string} [reasoning]
   */
  async approveAction(actionId, decision, reasoning) {
    const body = { decision };
    if (reasoning) body.reasoning = reasoning;
    return this._post(`/api/actions/${actionId}/approve`, body);
  }

  // ---------------------------------------------------------------------------
  // Containment Verdicts (RFC 2026-07-06) — operator verdict on a contained
  // action awaiting promotion. This SDK never adds the `allow_contained`
  // capability itself, so a bare guard() call from this client cannot receive
  // that decision (the server negotiates it down to `require_approval`) —
  // resolveContainment/listContained only manage rows that already reached
  // `awaiting_promotion` some other way (e.g. a capability-aware caller, or
  // the dashboard).
  // ---------------------------------------------------------------------------

  /**
   * POST /api/actions/:id/containment — Operator verdict on a contained
   * action awaiting promotion (admin credential required).
   * @param {string} actionId
   * @param {'promote'|'discard'} verdict
   * @returns {Promise<{action: object, promotion_action_id?: string, reissued?: boolean}>}
   *   promotion_action_id is present only when verdict is 'promote'; `action`
   *   is the full action row on every path. reissued=true marks a re-promote
   *   of an already-promoted action (grant re-stamp or fresh mint after the
   *   prior grant was consumed/expired).
   * @throws {TypeError} if verdict is not 'promote' or 'discard' — checked
   *   before any HTTP request is made.
   */
  async resolveContainment(actionId, verdict) {
    if (!CONTAINMENT_VERDICTS.has(verdict)) {
      throw new TypeError(`resolveContainment: verdict must be 'promote' or 'discard', got ${JSON.stringify(verdict)}`);
    }
    return this._post(`/api/actions/${actionId}/containment`, { verdict });
  }

  /**
   * GET /api/actions?containment_status=... — List actions by containment
   * status. Rows are enriched with batched evidence state:
   * `containment_has_evidence` (a patch artifact exists) and
   * `containment_evidence_ref` (the ref the newest captured diff describes).
   * @param {object} [opts] - { status = 'awaiting_promotion', limit? }
   */
  async listContained(opts = {}) {
    const { status = 'awaiting_promotion', limit } = opts;
    return this._get('/api/actions', {
      containment_status: status,
      ...(limit !== undefined ? { limit } : {}),
    });
  }

  /**
   * POST /api/assumptions — "I believe Z is true while doing X."
   */
  async recordAssumption(assumption) {
    return this._post('/api/assumptions', assumption);
  }

  /**
   * @private Connect to SSE stream and yield parsed events.
   */
  async *_connectSSE(controller) {
    const res = await fetch(`${this.baseUrl}/api/stream`, {
      headers: this._authHeaders(),
      signal: controller.signal,
    });

    if (res.status === 403) {
      throw new GuardBlockedError(await readBlockedStreamDecision(res));
    }
    if (!res.ok || !res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const state = { buffer: '', event: null, data: '', id: null };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* drainSSEBuffer(state, decoder.decode(value, { stream: true }));
    }
  }

  /**
   * @private SSE fast path for waitForApproval. Resolves with the confirmed
   * GET response on approval, null when the stream ends unresolved, and
   * throws on denial or timeout.
   */
  async _waitForApprovalViaSSE(actionId, timeout, startTime, sharedController) {
    const controller = sharedController || new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const wait = { actionId, timeout, startTime, controller, timeoutId };

    try {
      return await this._scanApprovalStream(wait);
    } finally {
      clearTimeout(timeoutId);
      if (!controller.signal.aborted) controller.abort();
    }
  }

  /** @private Consume SSE frames until the awaited action resolves or times out. */
  async _scanApprovalStream(wait) {
    for await (const frame of this._connectSSE(wait.controller)) {
      const check = evaluateApprovalFrame(frame, wait.actionId);
      if (check.resolved) {
        settleSSEWait(wait);
        if (check.error) throw check.error;
        return this._request(`/api/actions/${wait.actionId}`, 'GET');
      }

      if (Date.now() - wait.startTime >= wait.timeout) {
        settleSSEWait(wait);
        throw approvalTimeoutError(wait.actionId);
      }
    }
    return null;
  }

  /** @private One-time console banner shown while polling for an approval. */
  _printApprovalBanner(actionId, action) {
    try {
      const actionType = action.action_type || 'unknown';
      const riskScore = action.risk_score != null ? String(action.risk_score) : '-';
      const goal = action.declared_goal || '-';
      const agent = action.agent_id || this.agentId;
      const replayUrl = `${this.baseUrl}/replay/${actionId}`;

      const lines = [
        '╔══ DashClaw Approval Required ═════════════════════════╗',
        `  Action ID:   ${actionId}`,
        `  Agent:       ${agent}`,
        `  Action:      ${actionType}`,
        '  Policy:      require_approval',
        `  Risk Score:  ${riskScore}`,
        `  Goal:        ${goal}`,
        '',
        `  Replay:      ${replayUrl}`,
        '',
        '  Waiting for approval... (Ctrl+C to abort)',
        '╚════════════════════════════════════════════════════╝',
      ];
      process.stdout.write('\n' + lines.join('\n') + '\n\n');
    } catch (_) { /* rendering failure must not prevent wait */ }
  }

  /** @private Polling fallback for waitForApproval. */
  async _pollForApproval(actionId, timeout, interval, startTime, { initialDelay = false, signal } = {}) {
    let wasPending = false;
    let printedBanner = false;

    if (initialDelay && !await waitForDelay(interval, signal)) return null;

    while (Date.now() - startTime < timeout) {
      if (signal?.aborted) return null;
      // Return the full GET response (action + open_loops + assumptions +
      // message_summary) so the polling fallback resolves to the same shape as
      // the SSE fast-path above and the Python SDK. Returning only { action }
      // dropped the related collections whenever SSE was unavailable.
      const result = await this._request(`/api/actions/${actionId}`, 'GET');

      if (!printedBanner) {
        printedBanner = true;
        this._printApprovalBanner(actionId, result.action);
      }

      if (result.action.status === 'pending_approval') wasPending = true;

      const state = resolvePollState(result, wasPending, actionId);
      if (state.error) throw state.error;
      if (state.done) return state.result;

      if (!await waitForDelay(interval, signal)) return null;
    }
    if (signal?.aborted) return null;
    throw approvalTimeoutError(actionId);
  }

  /**
   * Wait for human approval using SSE plus concurrent authoritative polling.
   */
  async waitForApproval(actionId, { timeout = 300000, interval = 5000 } = {}) {
    const startTime = Date.now();
    const controller = new AbortController();

    try {
      const sse = this._waitForApprovalViaSSE(actionId, timeout, startTime, controller)
        .then((value) => value
          ? { kind: 'resolved', value }
          : { kind: 'fallback' })
        .catch((err) => {
          if (isApprovalWaitFatal(err)) throw err;
          return { kind: 'fallback' };
        });
      const reconciliation = this._pollForApproval(
        actionId,
        timeout,
        interval,
        startTime,
        { initialDelay: true, signal: controller.signal },
      ).then((value) => value
        ? { kind: 'resolved', value }
        : new Promise(() => {}));

      const winner = await Promise.race([sse, reconciliation]);
      if (winner.kind === 'resolved') return winner.value;
    } finally {
      controller.abort();
    }

    return this._pollForApproval(actionId, timeout, interval, startTime);
  }

  /**
   * GET /api/signals
   */
  async getSignals() {
    return this._get('/api/signals');
  }

  /**
   * Create a scoped action context that auto-tags assumptions and outcome
   * updates with the given action_id.
   * @param {string} actionId - The action_id to attach to all operations
   * @returns {{ recordAssumption, updateOutcome }}
   */
  actionContext(actionId) {
    return {
      recordAssumption: (assumption) => {
        return this.recordAssumption({ ...assumption, action_id: actionId });
      },
      updateOutcome: (outcome) => {
        return this.updateOutcome(actionId, outcome);
      },
    };
  }

  /**
   * POST /api/pairings — Enroll this agent's identity: submit a PEM public key
   * for admin approval. Approval (POST /api/pairings/{id}/approve) creates the
   * agent_identities row that makes recorded actions signature-verifiable.
   * (Ported from dashclaw/legacy for parity; the private key stays with the
   * caller and is never sent.)
   * @param {string} publicKeyPem
   * @param {Object} [options]
   * @param {string} [options.algorithm='RSASSA-PKCS1-v1_5']
   * @param {string} [options.agentName]
   * @returns {Promise<{pairing: Object}>}
   */
  async createPairing(publicKeyPem, { algorithm = 'RSASSA-PKCS1-v1_5', agentName } = {}) {
    if (!publicKeyPem) throw new Error('publicKeyPem is required');
    return this._post('/api/pairings', {
      agent_id: this.agentId,
      agent_name: agentName || this.agentName,
      public_key: publicKeyPem,
      algorithm,
    });
  }

  /**
   * Poll GET /api/pairings/{id} until the pairing is approved (resolves) or
   * expired/timed out (throws). Parity with Python wait_for_pairing.
   * @param {string} pairingId
   * @param {Object} [options]
   * @param {number} [options.timeout=300000]
   * @param {number} [options.interval=2000]
   * @returns {Promise<Object>} the approved pairing
   */
  async waitForPairing(pairingId, { timeout = 300000, interval = 2000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const res = await this._get(`/api/pairings/${encodeURIComponent(pairingId)}`);
      const pairing = res.pairing;
      if (!pairing) throw new Error('Pairing response missing pairing');
      if (pairing.status === 'approved') return pairing;
      if (pairing.status === 'expired') throw new Error('Pairing expired');
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error('Timed out waiting for pairing approval');
  }

  // ---------------------------------------------------------------------------
  // Security Scanning
  // ---------------------------------------------------------------------------

  /**
   * POST /api/security/prompt-injection — Scan text for prompt injection attacks.
   */
  async scanPromptInjection(text, { source } = {}) {
    return this._post('/api/security/prompt-injection', {
      text,
      source,
      agent_id: this.agentId,
    });
  }

  // ---------------------------------------------------------------------------
  // Session Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * POST /api/sessions — Create a new agent session.
   * @param {string} agentId - Agent identifier (defaults to this.agentId)
   * @param {string} workspace - Workspace path or identifier
   * @param {string|null} [branch=null] - Optional git branch
   */
  async createSession(agentId, workspace, branch = null) {
    return this._post('/api/sessions', {
      agent_id: agentId || this.agentId,
      workspace,
      branch,
    });
  }

  /**
   * GET /api/sessions/:id — Fetch a single session by ID.
   */
  async getSession(sessionId) {
    return this._get(`/api/sessions/${sessionId}`);
  }

  /**
   * PATCH /api/sessions/:id — Update session state.
   * @param {string} sessionId
   * @param {Object} updates - Fields to update (status, green_level, branch_freshness, commits_behind, blocked_reason)
   */
  async updateSession(sessionId, updates) {
    return this._patch(`/api/sessions/${sessionId}`, updates);
  }

  /**
   * GET /api/sessions — List sessions with optional filters.
   * @param {Object} [filters={}] - Query filters (agent_id, status, limit)
   */
  async listSessions(filters = {}) {
    return this._get('/api/sessions', filters);
  }

  /**
   * GET /api/sessions/:id/events — Fetch events for a session.
   */
  async getSessionEvents(sessionId) {
    return this._get(`/api/sessions/${sessionId}/events`);
  }

  // ---------------------------------------------------------------------------
  // Execution Studio — Execution Graph
  // ---------------------------------------------------------------------------

  /**
   * GET /api/actions/:id/graph — Read-only execution graph (nodes + edges).
   */
  async getActionGraph(actionId) {
    return this._get(`/api/actions/${actionId}/graph`);
  }

  // ---------------------------------------------------------------------------
  // Durable execution finality — terminal outcome reporting
  // See docs/architecture/durable-execution-finality.md
  // ---------------------------------------------------------------------------

  /**
   * POST /api/actions/:id/outcome — Record the terminal outcome of an action.
   *
   * @param {string} actionId
   * @param {Object} payload
   * @param {'completed'|'partial'|'failed'} payload.status
   * @param {string} [payload.summary]
   * @param {string} [payload.error_message] — required when status=failed
   * @param {Object} [payload.progress] — required when status=partial
   * @returns {Promise<{ outcome: object, security: object }>}
   * @throws on 409 when the outcome is already terminal — inspect the response
   *   body for `current_status` before deciding what to do next.
   */
  async reportActionOutcome(actionId, payload) {
    return this._post(`/api/actions/${actionId}/outcome`, payload);
  }

  /**
   * GET /api/actions/:id/outcome — Read the current outcome state of an action.
   *
   * Returns `{ action_id, status, outcome_at, summary, error_message, progress, elapsed_ms }`.
   * Status is one of: pending, completed, partial, failed, lost_confirmation.
   * Use this for reconciliation before considering a retry. A non-completed
   * state is not proof that an external effect did not occur.
   */
  async getActionOutcome(actionId) {
    return this._get(`/api/actions/${actionId}/outcome`);
  }

  /**
   * Convenience: report a successful terminal outcome.
   */
  async reportActionSuccess(actionId, summary) {
    return this.reportActionOutcome(actionId, { status: 'completed', summary });
  }

  /**
   * Convenience: report a failed terminal outcome. `error_message` is required.
   */
  async reportActionFailure(actionId, errorMessage, summary) {
    return this.reportActionOutcome(actionId, {
      status: 'failed',
      error_message: errorMessage,
      summary,
    });
  }

  /**
   * Convenience: report a partial outcome with progress state. Progress is
   * required (an object describing where the agent stopped).
   */
  async reportActionPartial(actionId, progress, summary) {
    return this.reportActionOutcome(actionId, {
      status: 'partial',
      progress,
      summary,
    });
  }

  /**
   * Derive a stable idempotency key from the *intent* of an action so a
   * retried `createAction` call returns the original row instead of creating
   * a duplicate. Pass the same `parts` for the same logical action; vary at
   * least one part for distinct actions.
   *
   * The hash function uses SHA-256 hex via Node's built-in crypto. In
   * browser-only environments lacking `require`, callers should compute the
   * key themselves and pass it directly to `createAction({ idempotency_key }).`
   *
   * @param {Object} parts — at minimum agent_id + action_type + a request
   *   discriminator that uniquely identifies this attempt. Reusing the key
   *   for a logically distinct action is the agent's bug, not DashClaw's.
   * @returns {string} SHA-256 hex digest
   */
  deriveIdempotencyKey(parts) {
    if (!parts || typeof parts !== 'object') {
      throw new TypeError('deriveIdempotencyKey: parts must be an object');
    }
    const ordered = Object.keys(parts)
      .sort()
      .map((k) => `${k}=${parts[k] ?? ''}`)
      .join('|');
    return createHash('sha256').update(ordered).digest('hex');
  }

  // ---------------------------------------------------------------------------
  // Policies — dry-run a proposed policy against historical actions before
  // committing it (no persistence; pairs with guard() for live enforcement).
  // ---------------------------------------------------------------------------

  /**
   * POST /api/policies/simulate — Simulate a single proposed policy against
   * recent historical actions. Side-effect-free.
   * @param {Object} args - { policy_type (required), rules (Object, required), days? }
   * @returns {Promise<{ summary: { total, matches, block, warn, require_approval, allow, allow_contained? }, matches: Array, sample_size, window_days }>}
   *
   * `summary.allow_contained` appears when `rules.contain_above` is set on a
   * `risk_threshold` policy and a historical action's risk score falls in the
   * containment band: the evaluator that powers this simulation calls the
   * containment eligibility check directly and is NOT capability-negotiated
   * (that negotiation lives only in the live guard pipeline's
   * `finalizeContainment`, which this simulate path bypasses) — so the count
   * reflects the band verdict regardless of whether any real caller advertises
   * `client_capabilities: ['allow_contained']`.
   */
  async simulatePolicy({ policy_type, rules, days } = {}) {
    return this._post('/api/policies/simulate', {
      policy_type,
      rules,
      ...(days !== undefined ? { days } : {}),
    });
  }

  /**
   * POST /api/policies — Create a delegation_constraint policy: cap what a
   * composed subagent (parent:child identity) may do. Thin wrapper over the
   * policy-create endpoint so attenuation has a first-class verb.
   * @param {object} rules - { parent?, child_types?, max_risk_score?, allowed_action_types?, blocked_action_types?, blocked_path_globs?, max_depth?, escalate_action?, require_verified_parent? }
   * @param {object} [opts] - { name?, agent_ids? }
   */
  async createDelegationConstraint(rules, opts = {}) {
    return this._post('/api/policies', {
      name: opts.name || 'Delegation constraint',
      policy_type: 'delegation_constraint',
      rules,
      active: true,
      ...(opts.agent_ids ? { agent_ids: opts.agent_ids } : {}),
    });
  }

  // ---------------------------------------------------------------------------
  // Team Tasks — multi-agent /team run tracking (fleets-and-teams amendment)
  // ---------------------------------------------------------------------------

  /**
   * POST /api/team-tasks — Create a Team Task (one per multi-agent /team run).
   * @param {object} task - { id, instruction, origin, lead_agent, status?, stop_condition?, max_exchanges? }
   */
  async createTeamTask(task) {
    return this._post('/api/team-tasks', task);
  }

  /**
   * POST /api/team-tasks/:taskId/events — Append one timeline event.
   * @param {string} taskId - Team task id
   * @param {object} event - { from_agent, to_agent, type, summary, ts?, body?, action_id? }
   */
  async appendTeamTaskEvent(taskId, event) {
    return this._post(`/api/team-tasks/${encodeURIComponent(taskId)}/events`, event);
  }

  /**
   * PATCH /api/team-tasks/:taskId — Update status or stored session ids.
   * @param {string} taskId - Team task id
   * @param {object} patch - { status?, claude_session_id?, openclaw_session_key? }
   */
  async updateTeamTask(taskId, patch) {
    return this._patch(`/api/team-tasks/${encodeURIComponent(taskId)}`, patch);
  }

  /**
   * POST /api/plans — Submit a preflight plan for operator review. Each step
   * is dry-run through the guard pipeline server-side; approved steps become
   * single-use grants consumed automatically when the matching action runs.
   * @param {object} plan - { declared_goal, ttl_minutes?, steps: [{ action_type, step_goal, act? }] }
   */
  async submitPlan(plan) {
    // Hash parity with runGoverned/guard: scrub each step's act the same way
    // before it leaves the client, so the server-side act_content_hash binds
    // to what an operator actually reviewed rather than a raw payload the
    // client could later resend unscrubbed under a mismatched hash.
    const steps = Array.isArray(plan?.steps)
      ? plan.steps.map((s) => (s.act ? { ...s, act: scrubAct(s.act) } : s))
      : plan?.steps;
    return this._post('/api/plans', { agent_id: this.agentId, ...plan, ...(steps ? { steps } : {}) });
  }

  /** GET /api/plans/:planId — Plan detail with per-step grant status. */
  async getPlan(planId) {
    return this._get(`/api/plans/${encodeURIComponent(planId)}`);
  }

  /**
   * POST /api/plans/:planId/attest — Prove a pinned plan is still usable
   * before acting on it. Resolves `{ ok: true, ... }` only when the plan is
   * approved, unexpired, unrevoked and still carries `planHash`; every other
   * outcome throws (403/404) so an unattended run fails closed.
   * @param {string} planId
   * @param {string} planHash - the `plan.plan_hash` the run was authorized under
   */
  async attestPlan(planId, planHash) {
    return this._post(`/api/plans/${encodeURIComponent(planId)}/attest`, { plan_hash: planHash });
  }

  /**
   * GET /api/plans — List plans.
   * @param {object} [opts] - { status?, agent_id?, limit? }
   */
  async listPlans(opts = {}) {
    return this._get('/api/plans', opts);
  }

  /**
   * POST /api/plans/:planId — Operator verdict (admin credential required).
   * @param {string} planId
   * @param {'approve'|'deny'|'revoke'} verdict
   * @param {object} [opts] - { step_overrides? }
   */
  async resolvePlan(planId, verdict, opts = {}) {
    return this._post(`/api/plans/${encodeURIComponent(planId)}`, { verdict, ...opts });
  }

  /**
   * Poll GET /api/plans/:planId until the plan reaches a terminal review
   * state or the timeout elapses. Resolves with the final plan+steps — the
   * caller inspects plan.status. Same polling shape as waitForApproval.
   * V5: 'previewing' (the plan is still dry-running its steps) is NOT
   * terminal, same as 'pending' — polling on `status !== 'pending'` would
   * have returned immediately on a 'previewing' plan without ever seeing an
   * operator's actual verdict.
   * @param {string} planId
   * @param {object} [opts] - { timeout = 300000, interval = 5000 }
   */
  async waitForPlanReview(planId, { timeout = 300000, interval = 5000 } = {}) {
    const startTime = Date.now();
    for (;;) {
      const result = await this.getPlan(planId);
      if (result?.plan?.status && PLAN_REVIEW_TERMINAL_STATUSES.has(result.plan.status)) return result;
      if (Date.now() - startTime >= timeout) {
        throw new Error(`Plan ${planId} was not reviewed within ${timeout}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

}

export {
  DashClaw,
  ApprovalDeniedError,
  GuardBlockedError,
  ApprovalPendingError,
  ExecutionClaimError,
  OutcomeConfirmationError,
  scrubAct,
};
