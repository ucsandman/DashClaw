/**
 * DashClaw SDK (Stable Runtime API)
 * Focused governance runtime client for AI agents.
 *
 * Version is the single source of truth in sdk/package.json — never
 * hardcoded here, in the README header, or in app/ pages. Consumers
 * read it at runtime via `import pkg from 'dashclaw/package.json'`.
 */

import { createHash } from 'crypto';

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
   */
  constructor({ baseUrl, apiKey, agentId, agentName, authToken }) {
    if (!baseUrl) throw new Error('baseUrl is required');
    if (!apiKey) throw new Error('apiKey is required');
    if (!agentId) throw new Error('agentId is required');

    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.agentId = agentId;
    this.agentName = agentName || null;
    this.authToken = authToken || null;

    this.execution = {
      capabilities: {
        list: (filters = {}) => this.listCapabilities(filters),
        create: (data) => this.createCapability(data),
        get: (capabilityId) => this.getCapability(capabilityId),
        update: (capabilityId, patch) => this.updateCapability(capabilityId, patch),
        invoke: (capabilityId, payload = {}) => this.invokeCapability(capabilityId, payload),
        test: (capabilityId, payload = {}) => this.testCapability(capabilityId, payload),
        getHealth: (capabilityId) => this.getCapabilityHealth(capabilityId),
        listHealth: (filters = {}) => this.listCapabilityHealth(filters),
        getHistory: (capabilityId, filters = {}) => this.getCapabilityHistory(capabilityId, filters),
      },
    };
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
    const res = await fetch(this._buildUrl(path, params), {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...this._authHeaders(),
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await parseJsonSafe(res);
    if (!res.ok) throwRequestError(res, data);
    return data;
  }

  /** @private GET shorthand for thin endpoint wrappers. */
  async _get(path, params = null) {
    return this._request(path, 'GET', null, params);
  }

  /** @private POST shorthand for thin endpoint wrappers. */
  async _post(path, body = null) {
    return this._request(path, 'POST', body);
  }

  /** @private PATCH shorthand for thin endpoint wrappers. */
  async _patch(path, body = null) {
    return this._request(path, 'PATCH', body);
  }

  /** @private DELETE shorthand for thin endpoint wrappers. */
  async _delete(path) {
    return this._request(path, 'DELETE');
  }

  /**
   * POST /api/guard — "Can I do X?"
   * @param {Object} context
   * @param {string} [context.content] - Outbound content to fabrication-check
   *   (e.g. a drafted email/message). Pairs with `sourceOfTruth` and a
   *   `non_fabrication` guard policy: every operational token (amounts, dates,
   *   percentages, registered IDs) must trace to an allowed fact, or the action
   *   is blocked / routed to approval. The response carries a signed,
   *   re-verifiable receipt under `non_fabrication`.
   * @param {Object} [context.sourceOfTruth] - The facts `content` is allowed to
   *   state: `{ allowedFacts, requiredFacts, forbiddenPatterns?, extract? }`.
   * @returns {Promise<{
   *   decision: 'allow'|'block'|'require_approval'|'warn',
   *   action_id: string,
   *   reason: string,
   *   signals: string[],
   *   verification_status: 'verified'|'unverified'|'expired'|'failed'|'unknown_issuer',
   *   agent_id: string|null,
   *   agent_name: string|null,
   * }>}
   *
   * `verification_status` reflects whether the JWT bearer token (if provided
   * via the `authToken` constructor option) was cryptographically verified:
   *   verified       — signature valid; audit entry anchored to JWT sub
   *   unverified     — no token, or issuer temporarily unreachable (fail-soft)
   *   expired        — token expired; consider refreshing before next call
   *   failed         — bad signature, malformed token, or audience mismatch
   *   unknown_issuer — issuer not in DASHCLAW_ALLOWED_ISSUER (server config)
   */
  async guard(context) {
    return this._post('/api/guard', {
      ...context,
      agent_id: context.agent_id || this.agentId,
      // Include agent_name for audit attribution if not already provided by caller
      ...(context.agent_name == null && this.agentName ? { agent_name: this.agentName } : {}),
    });
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
    return this._post('/api/actions', {
      ...action,
      agent_id: this.agentId,
    });
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
  async _waitForApprovalViaSSE(actionId, timeout, startTime) {
    const controller = new AbortController();
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
  async _pollForApproval(actionId, timeout, interval, startTime) {
    let wasPending = false;
    let printedBanner = false;

    while (Date.now() - startTime < timeout) {
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

      await new Promise(r => setTimeout(r, interval));
    }
    throw approvalTimeoutError(actionId);
  }

  /**
   * Wait for human approval. SSE-first with polling fallback.
   */
  async waitForApproval(actionId, { timeout = 300000, interval = 5000 } = {}) {
    const startTime = Date.now();

    // Try SSE first
    try {
      const confirmed = await this._waitForApprovalViaSSE(actionId, timeout, startTime);
      if (confirmed) return confirmed;
    } catch (err) {
      if (isApprovalWaitFatal(err)) throw err;
      // SSE failed — fall through to polling
    }

    return this._pollForApproval(actionId, timeout, interval, startTime);
  }

  /**
   * POST /api/agents/heartbeat
   */
  async heartbeat(status = 'online', metadata = null) {
    return this._post('/api/agents/heartbeat', {
      agent_id: this.agentId,
      status,
      metadata
    });
  }

  /**
   * POST /api/agents/connections
   */
  async reportConnections(connections) {
    return this._post('/api/agents/connections', {
      agent_id: this.agentId,
      connections
    });
  }

  /**
   * POST /api/actions/loops
   */
  async registerOpenLoop(actionId, loopType, description, metadata = null) {
    return this._post('/api/actions/loops', {
      action_id: actionId,
      loop_type: loopType,
      description,
      metadata
    });
  }

  /**
   * PATCH /api/actions/loops/:id
   */
  async resolveOpenLoop(loopId, status, resolution = null) {
    return this._patch(`/api/actions/loops/${loopId}`, {
      status,
      resolution
    });
  }

  /**
   * GET /api/actions/signals
   */
  async getSignals() {
    return this._get('/api/actions/signals');
  }

  /**
   * GET /api/learning/analytics/velocity
   */
  async getLearningVelocity(lookbackDays = 30) {
    return this._get('/api/learning/analytics/velocity', {
      agent_id: this.agentId,
      lookback_days: lookbackDays
    });
  }

  /**
   * GET /api/learning/analytics/curves
   */
  async getLearningCurves(lookbackDays = 60) {
    return this._get('/api/learning/analytics/curves', {
      agent_id: this.agentId,
      lookback_days: lookbackDays
    });
  }

  /**
   * GET /api/learning/lessons — Fetch consolidated lessons from scored outcomes.
   */
  async getLessons({ actionType, limit } = {}) {
    return this._get('/api/learning/lessons', {
      agent_id: this.agentId,
      ...(actionType && { action_type: actionType }),
      ...(limit != null && { limit }),
    });
  }

  /**
   * POST /api/prompts/render
   */
  async renderPrompt({ template_id, version_id, variables, record = false }) {
    return this._post('/api/prompts/render', {
      template_id,
      version_id,
      variables,
      agent_id: this.agentId,
      record
    });
  }

  /**
   * POST /api/evaluations/scorers
   */
  async createScorer(name, scorer_type, config = null, description = null) {
    return this._post('/api/evaluations/scorers', {
      name,
      scorer_type,
      config,
      description
    });
  }

  /**
   * POST /api/scoring/profiles
   */
  async createScoringProfile(profile) {
    return this._post('/api/scoring/profiles', profile);
  }

  /**
   * GET /api/scoring/profiles
   */
  async listScoringProfiles(filters = {}) {
    return this._get('/api/scoring/profiles', filters);
  }

  /**
   * GET /api/scoring/profiles/:id
   */
  async getScoringProfile(profileId) {
    return this._get(`/api/scoring/profiles/${profileId}`);
  }

  /**
   * PATCH /api/scoring/profiles/:id
   */
  async updateScoringProfile(profileId, updates) {
    return this._patch(`/api/scoring/profiles/${profileId}`, updates);
  }

  /**
   * DELETE /api/scoring/profiles/:id
   */
  async deleteScoringProfile(profileId) {
    return this._delete(`/api/scoring/profiles/${profileId}`);
  }

  /**
   * POST /api/scoring/profiles/:id/dimensions
   */
  async addScoringDimension(profileId, dimension) {
    return this._post(`/api/scoring/profiles/${profileId}/dimensions`, dimension);
  }

  /**
   * PATCH /api/scoring/profiles/:id/dimensions/:dimId
   */
  async updateScoringDimension(profileId, dimensionId, updates) {
    return this._patch(`/api/scoring/profiles/${profileId}/dimensions/${dimensionId}`, updates);
  }

  /**
   * DELETE /api/scoring/profiles/:id/dimensions/:dimId
   */
  async deleteScoringDimension(profileId, dimensionId) {
    return this._delete(`/api/scoring/profiles/${profileId}/dimensions/${dimensionId}`);
  }

  /**
   * POST /api/scoring/score — score a single action against a profile
   */
  async scoreWithProfile(profileId, action) {
    if (Array.isArray(action)) throw new TypeError('scoreWithProfile expects a single action object; use batchScoreWithProfile for arrays');
    return this._post('/api/scoring/score', { profile_id: profileId, action });
  }

  /**
   * POST /api/scoring/score — batch score multiple actions against a profile
   */
  async batchScoreWithProfile(profileId, actions) {
    if (!Array.isArray(actions)) throw new TypeError('batchScoreWithProfile expects an array of actions');
    return this._post('/api/scoring/score', { profile_id: profileId, actions });
  }

  /**
   * GET /api/scoring/score — list stored profile scores
   */
  async getProfileScores(filters = {}) {
    return this._get('/api/scoring/score', filters);
  }

  /**
   * GET /api/scoring/score?view=stats — aggregate stats for a profile
   */
  async getProfileScoreStats(profileId) {
    return this._get('/api/scoring/score', { profile_id: profileId, view: 'stats' });
  }

  /**
   * POST /api/scoring/risk-templates
   */
  async createRiskTemplate(template) {
    return this._post('/api/scoring/risk-templates', template);
  }

  /**
   * GET /api/scoring/risk-templates
   */
  async listRiskTemplates(filters = {}) {
    return this._get('/api/scoring/risk-templates', filters);
  }

  /**
   * PATCH /api/scoring/risk-templates/:id
   */
  async updateRiskTemplate(templateId, updates) {
    return this._patch(`/api/scoring/risk-templates/${templateId}`, updates);
  }

  /**
   * DELETE /api/scoring/risk-templates/:id
   */
  async deleteRiskTemplate(templateId) {
    return this._delete(`/api/scoring/risk-templates/${templateId}`);
  }

  /**
   * POST /api/scoring/calibrate — analyze historical data and suggest dimension thresholds
   */
  async autoCalibrate(options = {}) {
    return this._post('/api/scoring/calibrate', options);
  }

  // ---------------------------------------------------------------------------
  // Agent Messaging
  // ---------------------------------------------------------------------------

  /**
   * POST /api/messages — Send a message to another agent or the dashboard.
   */
  async sendMessage({ to, type, subject, body, threadId, urgent, actionId }) {
    return this._post('/api/messages', {
      from_agent_id: this.agentId,
      to_agent_id: to,
      message_type: type,
      subject,
      body,
      thread_id: threadId,
      urgent,
      action_id: actionId,
    });
  }

  /**
   * Create a scoped action context that auto-tags messages and assumptions
   * with the given action_id.
   * @param {string} actionId - The action_id to attach to all operations
   * @returns {{ sendMessage, recordAssumption, updateOutcome }}
   */
  actionContext(actionId) {
    return {
      sendMessage: ({ to, type, subject, body, threadId, urgent }) => {
        return this.sendMessage({ to, type, subject, body, threadId, urgent, actionId });
      },
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
   * Operator-initiated pairing requests arrive in the inbox as messages whose
   * body carries a `dashclaw.pairing_request` JSON directive — answer them by
   * calling this. (Ported from dashclaw/legacy for parity; the private key
   * stays with the caller and is never sent.)
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

  /**
   * GET /api/messages — Fetch this agent's inbox.
   */
  async getInbox({ type, unread, limit } = {}) {
    return this.getMessages({ direction: 'inbox', type, unread, limit });
  }

  /**
   * GET /api/messages — Fetch messages this agent has sent.
   */
  async getSentMessages({ type, threadId, limit } = {}) {
    return this.getMessages({ direction: 'sent', type, threadId, limit });
  }

  /**
   * GET /api/messages — Fetch this agent's messages with flexible filters.
   */
  async getMessages({ direction, type, unread, threadId, limit } = {}) {
    return this._get('/api/messages', {
      agent_id: this.agentId,
      ...(direction && { direction }),
      ...(type && { type }),
      ...(unread != null && { unread }),
      ...(threadId && { thread_id: threadId }),
      ...(limit != null && { limit }),
    });
  }

  /**
   * GET /api/messages/:messageId — Fetch a single message by id.
   */
  async getMessage(messageId) {
    return this._get(`/api/messages/${encodeURIComponent(messageId)}`);
  }

  /**
   * PATCH /api/messages — Mark messages as read for this agent. Direct messages
   * are marked read only for the target agent (or dashboard); broadcasts update
   * read_by for this agent.
   * @param {string[]} messageIds - Message IDs (msg_*) to mark read.
   * @returns {Promise<{ updated: number }>}
   */
  async markRead(messageIds) {
    return this._patch('/api/messages', {
      message_ids: messageIds,
      action: 'read',
      agent_id: this.agentId,
    });
  }

  /**
   * PATCH /api/messages — Archive messages for this agent.
   * @param {string[]} messageIds - Message IDs (msg_*) to archive.
   * @returns {Promise<{ updated: number }>}
   */
  async archiveMessages(messageIds) {
    return this._patch('/api/messages', {
      message_ids: messageIds,
      action: 'archive',
      agent_id: this.agentId,
    });
  }

  // ---------------------------------------------------------------------------
  // Session Handoffs
  // ---------------------------------------------------------------------------

  /**
   * POST /api/handoffs — Create a session handoff record.
   */
  async createHandoff(handoff) {
    return this._post('/api/handoffs', {
      agent_id: this.agentId,
      ...handoff,
    });
  }

  /**
   * GET /api/handoffs — Fetch the most recent handoff for this agent.
   */
  async getLatestHandoff() {
    return this._get('/api/handoffs', {
      agent_id: this.agentId,
      latest: 'true',
    });
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
   * Use this BEFORE retrying any approved action to avoid double-execution.
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
  // Execution Studio — Workflow Templates
  // ---------------------------------------------------------------------------

  /**
   * GET /api/workflows/templates — List workflow templates.
   * @param {Object} [filters={}] - { status, limit, offset }
   */
  async listWorkflowTemplates(filters = {}) {
    return this._get('/api/workflows/templates', filters);
  }

  /**
   * POST /api/workflows/templates — Create a workflow template.
   */
  async createWorkflowTemplate(data) {
    return this._post('/api/workflows/templates', data);
  }

  /**
   * GET /api/workflows/templates/:id — Fetch a single template.
   */
  async getWorkflowTemplate(templateId) {
    return this._get(`/api/workflows/templates/${templateId}`);
  }

  /**
   * PATCH /api/workflows/templates/:id — Partial update. Bumps version when steps change.
   */
  async updateWorkflowTemplate(templateId, patch) {
    return this._patch(`/api/workflows/templates/${templateId}`, patch);
  }

  /**
   * POST /api/workflows/templates/:id/duplicate — Clone as a new draft.
   */
  async duplicateWorkflowTemplate(templateId, overrides = {}) {
    return this._post(`/api/workflows/templates/${templateId}/duplicate`, overrides);
  }

  /**
   * POST /api/workflows/templates/:id/launch — Create a traceable action record.
   * Resolves any linked model strategy into a snapshot at launch time.
   */
  async launchWorkflowTemplate(templateId, options = {}) {
    return this._post(`/api/workflows/templates/${templateId}/launch`, options);
  }

  // ---------------------------------------------------------------------------
  // Execution Studio — Model Strategies
  // ---------------------------------------------------------------------------

  /**
   * GET /api/model-strategies — List model strategies.
   */
  async listModelStrategies() {
    return this._get('/api/model-strategies');
  }

  /**
   * POST /api/model-strategies — Create a model strategy.
   * @param {Object} data - { name, description, config: { primary, fallback, costSensitivity, ... } }
   */
  async createModelStrategy(data) {
    return this._post('/api/model-strategies', data);
  }

  /**
   * GET /api/model-strategies/:id — Fetch a single strategy.
   */
  async getModelStrategy(strategyId) {
    return this._get(`/api/model-strategies/${strategyId}`);
  }

  /**
   * PATCH /api/model-strategies/:id — Partial update. Config patches merge over existing.
   */
  async updateModelStrategy(strategyId, patch) {
    return this._patch(`/api/model-strategies/${strategyId}`, patch);
  }

  /**
   * DELETE /api/model-strategies/:id — Delete. Nulls soft refs on linked templates.
   */
  async deleteModelStrategy(strategyId) {
    return this._delete(`/api/model-strategies/${strategyId}`);
  }

  /**
   * POST /api/model-strategies/:id/complete — Execute a chat completion using
   * this strategy. Resolves BYOK provider credentials, handles fallback chain,
   * enforces budget caps.
   * @param {string} strategyId
   * @param {Array<{role: string, content: string}>} messages
   * @param {Object} [options={}] - { max_tokens, temperature, task_mode }
   */
  async completeWithStrategy(strategyId, messages, options = {}) {
    return this._post(`/api/model-strategies/${strategyId}/complete`, {
      messages,
      ...options,
    });
  }

  // ---------------------------------------------------------------------------
  // Execution Studio — Knowledge Collections
  // ---------------------------------------------------------------------------

  /**
   * GET /api/knowledge/collections — List knowledge collections.
   * @param {Object} [filters={}] - { sourceType, limit, offset }
   */
  async listKnowledgeCollections(filters = {}) {
    const params = {};
    if (filters.sourceType) params.source_type = filters.sourceType;
    if (filters.limit) params.limit = filters.limit;
    if (filters.offset) params.offset = filters.offset;
    return this._get('/api/knowledge/collections', params);
  }

  /**
   * POST /api/knowledge/collections — Create a knowledge collection.
   */
  async createKnowledgeCollection(data) {
    return this._post('/api/knowledge/collections', data);
  }

  /**
   * GET /api/knowledge/collections/:id — Fetch a single collection.
   */
  async getKnowledgeCollection(collectionId) {
    return this._get(`/api/knowledge/collections/${collectionId}`);
  }

  /**
   * PATCH /api/knowledge/collections/:id — Update collection metadata.
   */
  async updateKnowledgeCollection(collectionId, patch) {
    return this._patch(`/api/knowledge/collections/${collectionId}`, patch);
  }

  /**
   * GET /api/knowledge/collections/:id/items — List items in a collection.
   * @param {Object} [filters={}] - { limit, offset }
   */
  async listKnowledgeCollectionItems(collectionId, filters = {}) {
    return this._get(`/api/knowledge/collections/${collectionId}/items`, filters);
  }

  /**
   * POST /api/knowledge/collections/:id/items — Add an item. Bumps parent doc_count.
   */
  async addKnowledgeCollectionItem(collectionId, data) {
    return this._post(`/api/knowledge/collections/${collectionId}/items`, data);
  }

  /**
   * POST /api/knowledge/collections/:id/sync — Ingest pending items (chunk + embed).
   */
  async syncKnowledgeCollection(collectionId) {
    return this._post(`/api/knowledge/collections/${collectionId}/sync`, {});
  }

  /**
   * POST /api/knowledge/collections/:id/search — Semantic search over chunks.
   * @param {string} collectionId
   * @param {string} query
   * @param {Object} [options={}] - { limit }
   */
  async searchKnowledgeCollection(collectionId, query, options = {}) {
    return this._post(`/api/knowledge/collections/${collectionId}/search`, {
      query,
      ...options,
    });
  }

  /**
   * DELETE /api/knowledge/collections/:id — Delete a collection (cascades items + chunks).
   */
  async deleteKnowledgeCollection(collectionId) {
    return this._delete(`/api/knowledge/collections/${collectionId}`);
  }

  // ---------------------------------------------------------------------------
  // Execution Studio — Capability Registry
  // ---------------------------------------------------------------------------

  /**
   * GET /api/capabilities — Search the capability registry.
   * @param {Object} [filters={}] - { category, risk_level, search, limit, offset }
   */
  async listCapabilities(filters = {}) {
    return this._get('/api/capabilities', filters);
  }

  /**
   * POST /api/capabilities — Register a capability.
   */
  async createCapability(data) {
    return this._post('/api/capabilities', data);
  }

  /**
   * GET /api/capabilities/:id — Fetch a single capability.
   */
  async getCapability(capabilityId) {
    return this._get(`/api/capabilities/${capabilityId}`);
  }

  /**
   * PATCH /api/capabilities/:id — Update a capability.
   */
  async updateCapability(capabilityId, patch) {
    return this._patch(`/api/capabilities/${capabilityId}`, patch);
  }

  /**
   * DELETE /api/capabilities/:id — Delete a capability.
   */
  async deleteCapability(capabilityId) {
    return this._delete(`/api/capabilities/${capabilityId}`);
  }

  /**
   * POST /api/capabilities/:id/invoke — Invoke a governed capability.
   */
  async invokeCapability(capabilityId, payload = {}) {
    return this._post(`/api/capabilities/${capabilityId}/invoke`, {
      ...payload,
      agent_id: payload.agent_id || this.agentId,
    });
  }

  /**
   * POST /api/capabilities/:id/test — Run a non-production capability validation call.
   */
  async testCapability(capabilityId, payload = {}) {
    return this._post(`/api/capabilities/${capabilityId}/test`, {
      ...payload,
      agent_id: payload.agent_id || this.agentId,
    });
  }

  /**
   * GET /api/capabilities/:id/health — Fetch derived capability health.
   */
  async getCapabilityHealth(capabilityId) {
    return this._get(`/api/capabilities/${capabilityId}/health`);
  }

  /**
   * GET /api/capabilities/health — List derived health summaries for matching capabilities.
   */
  async listCapabilityHealth(filters = {}) {
    return this._get('/api/capabilities/health', filters);
  }

  /**
   * GET /api/capabilities/:id/history — Fetch recent test and invoke events for a capability.
   */
  async getCapabilityHistory(capabilityId, filters = {}) {
    return this._get(`/api/capabilities/${capabilityId}/history`, filters);
  }

  // ---------------------------------------------------------------------------
  // Prompt Library — reusable prompt templates, versions, render + analytics.
  // renderPrompt() already lives in the rendering section above; these add the
  // template/version management surface so the library is first-class in the SDK.
  // Mutations (create/update/delete/version/activate) require an admin org role.
  // ---------------------------------------------------------------------------

  /**
   * GET /api/prompts/templates — List prompt templates (each with version_count + active_version).
   * @param {Object} [filters={}] - { category }
   */
  async listPromptTemplates(filters = {}) {
    return this._get('/api/prompts/templates', filters);
  }

  /**
   * GET /api/prompts/templates/:id — Fetch a single template.
   */
  async getPromptTemplate(templateId) {
    return this._get(`/api/prompts/templates/${templateId}`);
  }

  /**
   * POST /api/prompts/templates — Create a template (admin). { name, description?, category? }
   */
  async createPromptTemplate(data) {
    return this._post('/api/prompts/templates', data);
  }

  /**
   * PATCH /api/prompts/templates/:id — Update a template (admin). { name?, description?, category? }
   */
  async updatePromptTemplate(templateId, patch) {
    return this._patch(`/api/prompts/templates/${templateId}`, patch);
  }

  /**
   * DELETE /api/prompts/templates/:id — Delete a template + its versions/runs (admin).
   */
  async deletePromptTemplate(templateId) {
    return this._delete(`/api/prompts/templates/${templateId}`);
  }

  /**
   * GET /api/prompts/templates/:id/versions — List versions (newest first).
   */
  async listPromptVersions(templateId) {
    return this._get(`/api/prompts/templates/${templateId}/versions`);
  }

  /**
   * POST /api/prompts/templates/:id/versions — Create a version (admin).
   * @param {string} templateId
   * @param {Object} data - { content, model_hint?, parameters?, changelog? }
   */
  async createPromptVersion(templateId, data) {
    return this._post(`/api/prompts/templates/${templateId}/versions`, data);
  }

  /**
   * GET /api/prompts/templates/:id/versions/:versionId — Fetch a single version.
   */
  async getPromptVersion(templateId, versionId) {
    return this._get(`/api/prompts/templates/${templateId}/versions/${versionId}`);
  }

  /**
   * POST /api/prompts/templates/:id/versions/:versionId — Activate a version (admin).
   * Activating one version deactivates the others for that template.
   */
  async activatePromptVersion(templateId, versionId) {
    return this._post(`/api/prompts/templates/${templateId}/versions/${versionId}`);
  }

  /**
   * GET /api/prompts/stats — Prompt usage analytics.
   * @param {Object} [filters={}] - { template_id }
   */
  async getPromptStats(filters = {}) {
    return this._get('/api/prompts/stats', filters);
  }

  /**
   * GET /api/prompts/runs — List recorded prompt runs.
   * @param {Object} [filters={}] - { template_id, version_id, limit }
   */
  async listPromptRuns(filters = {}) {
    return this._get('/api/prompts/runs', filters);
  }

  // ---------------------------------------------------------------------------
  // Learning — record decisions/outcomes and read back recommendations so the
  // governance loop improves over time.
  // ---------------------------------------------------------------------------

  /**
   * POST /api/learning — Record a decision/outcome into the learning ledger.
   * @param {Object} entry - { decision (required), context?, reasoning?, outcome?, confidence?, agent_id? }
   * @returns {Promise<{ decision: Object }>}
   */
  async recordDecision(entry) {
    return this._post('/api/learning', {
      ...entry,
      agent_id: entry.agent_id || this.agentId,
    });
  }

  /**
   * GET /api/learning/recommendations — Read learned recommendations for an agent/action_type.
   * @param {Object} [filters={}] - { agent_id, action_type, include_metrics, lookback_days, limit }
   */
  async getLearningRecommendations(filters = {}) {
    return this._get('/api/learning/recommendations', {
      ...filters,
      agent_id: filters.agent_id || this.agentId,
    });
  }

  // ---------------------------------------------------------------------------
  // Policies — dry-run a proposed policy against historical actions before
  // committing it (no persistence; pairs with guard() for live enforcement).
  // ---------------------------------------------------------------------------

  /**
   * POST /api/policies/simulate — Simulate a single proposed policy against
   * recent historical actions. Side-effect-free.
   * @param {Object} args - { policy_type (required), rules (Object, required), days? }
   * @returns {Promise<{ summary: { total, matches, block, warn, require_approval, allow }, matches: Array, sample_size, window_days }>}
   */
  async simulatePolicy({ policy_type, rules, days } = {}) {
    return this._post('/api/policies/simulate', {
      policy_type,
      rules,
      ...(days !== undefined ? { days } : {}),
    });
  }

  // ---------------------------------------------------------------------------
  // Evaluations — preview a scorer (dry-run, no eval_scores written).
  // ---------------------------------------------------------------------------

  /**
   * POST /api/evaluations/scorers/preview — Dry-run a scorer config against a
   * sample action without persisting a score. Use to validate a quality gate
   * (e.g. branch-finish scoring) before creating a scorer or launching a run.
   * @param {Object} args - { scorer_type (required), config?, sample? }
   * @returns {Promise<{ preview: true, scorer_type, result: { score, label, reasoning, error } }>}
   */
  async previewScorer({ scorer_type, config, sample } = {}) {
    return this._post('/api/evaluations/scorers/preview', { scorer_type, config, sample });
  }

  // ---------------------------------------------------------------------------
  // Agent Reputation — per-agent trust vector, events, and signed receipts.
  // ---------------------------------------------------------------------------

  /**
   * GET /api/reputation/agents/:agentId — current reputation vector.
   * @returns {Promise<{ agent_id, vector, source }>}
   */
  async getAgentReputation(agentId) {
    return this._get(`/api/reputation/agents/${agentId}`);
  }

  /**
   * GET /api/reputation/agents/:agentId/events — paginated reputation events.
   * @param {string} agentId
   * @param {Object} [filters] - { limit?, offset? }
   */
  async listAgentReputationEvents(agentId, filters = {}) {
    return this._get(`/api/reputation/agents/${agentId}/events`, filters);
  }

  /**
   * POST /api/reputation/agents/:agentId/recompute — recompute the vector from
   * evidence, persist the snapshot, and store a signed receipt.
   */
  async recomputeAgentReputation(agentId) {
    return this._post(`/api/reputation/agents/${agentId}/recompute`);
  }

  /**
   * GET /api/reputation/agents/:agentId/receipt — signed receipt for the vector.
   */
  async getAgentReputationReceipt(agentId) {
    return this._get(`/api/reputation/agents/${agentId}/receipt`);
  }

  /**
   * POST /api/reputation/verify — verify a reputation receipt against the
   * instance's published signing keys. Returns { ok, kid?, reason? }.
   * @param {Object} receipt - a signed reputation receipt
   */
  async verifyReputationReceipt(receipt) {
    return this._post('/api/reputation/verify', { receipt });
  }

  // ---------------------------------------------------------------------------
  // Agent Registry — register external delegatable providers; invocations are
  // governed by the existing capability runtime + guard + action ledger.
  // ---------------------------------------------------------------------------

  /** POST /api/agents/registry — register an external provider. */
  async registerAgent(data = {}) {
    return this._post('/api/agents/registry', data);
  }

  /** GET /api/agents/registry — list registered agents. */
  async listRegisteredAgents(filters = {}) {
    return this._get('/api/agents/registry', filters);
  }

  /** GET /api/agents/registry/:id — registered agent detail. */
  async getRegisteredAgent(id) {
    return this._get(`/api/agents/registry/${id}`);
  }

  /** PATCH /api/agents/registry/:id — update a registered agent. */
  async updateRegisteredAgent(id, patch = {}) {
    return this._patch(`/api/agents/registry/${id}`, patch);
  }

  /** POST /api/agents/registry/:id/capabilities — group a capability under the agent. */
  async addAgentCapability(id, capabilityId) {
    return this._post(`/api/agents/registry/${id}/capabilities`, { capability_id: capabilityId });
  }

  /** GET /api/agents/registry/:id/capabilities — capabilities grouped under the agent. */
  async listAgentCapabilities(id) {
    return this._get(`/api/agents/registry/${id}/capabilities`);
  }

  /**
   * POST /api/agents/invoke — invoke a capability through a registered agent,
   * governed end to end by the existing capability runtime + guard + action.
   * @param {Object} args - { registered_agent_id, capability_id, agent_id?, payload?, declared_goal? }
   */
  async invokeRegisteredAgent({ registered_agent_id, capability_id, agent_id, payload, declared_goal } = {}) {
    return this._post('/api/agents/invoke', { registered_agent_id, capability_id, agent_id, payload, declared_goal });
  }

  // ---------------------------------------------------------------------------
  // x402 spend governance — provider registry + governed paid acquisition.
  // The agent executes the actual x402 call itself; these methods register
  // providers and record/govern the spend. DashClaw never holds a wallet.
  // ---------------------------------------------------------------------------

  /** GET /api/x402/providers — list registered providers. */
  async listProviders(filters = {}) {
    return this._get('/api/x402/providers', filters);
  }
  /** POST /api/x402/providers — register a paid provider. */
  async createProvider(data = {}) {
    return this._post('/api/x402/providers', data);
  }
  /** GET /api/x402/providers/:id — provider detail + endpoints. */
  async getProvider(id) {
    return this._get(`/api/x402/providers/${id}`);
  }
  /** PATCH /api/x402/providers/:id — update a provider. */
  async updateProvider(id, patch = {}) {
    return this._patch(`/api/x402/providers/${id}`, patch);
  }
  /** GET /api/x402/providers/:id/endpoints — list a provider's endpoints. */
  async listProviderEndpoints(id) {
    return this._get(`/api/x402/providers/${id}/endpoints`);
  }
  /** POST /api/x402/providers/:id/endpoints — add an endpoint. */
  async createProviderEndpoint(id, data = {}) {
    return this._post(`/api/x402/providers/${id}/endpoints`, data);
  }
  /**
   * POST /api/x402/purchases — govern + record a paid acquisition.
   * Required: agent_id, provider, declared_goal, purchase_reason, context_gap, expected_value.
   * Returns { action, purchase, decision }; branch on action.status (running | pending_approval).
   */
  async recordPurchase(data = {}) {
    return this._post('/api/x402/purchases', data);
  }
  /** GET /api/x402/purchases — list governed purchases. */
  async listPurchases(filters = {}) {
    return this._get('/api/x402/purchases', filters);
  }
  /**
   * POST /api/artifacts — attach the x402 result snapshot to its purchase action.
   * Reuses the existing artifacts endpoint; links by source_action_id so the
   * snapshot appears in that action's evidence bundle.
   * @param {string} actionId - the act_ id returned by recordPurchase
   * @param {Object} result - { summary?, data?, url? }
   */
  async recordPurchaseResult(actionId, result = {}) {
    return this._post('/api/artifacts', {
      artifact_type: 'x402_purchase_result',
      name: `x402 result ${actionId}`,
      description: result.summary || null,
      content_json: result.data ?? {},
      content_url: result.url || null,
      source_action_id: actionId,
    });
  }
  /**
   * Convenience: record a SETTLED x402 payment end-to-end in one call — govern +
   * record the purchase, mark it succeeded, and (when given) attach the on-chain
   * receipt. Use this when your agent pays OUTSIDE an OpenClaw governance hook
   * (e.g. a Codex/native-shell agentcash wrapper) and must self-report so the
   * spend lands on Spend → x402. The server resolves/auto-registers the provider
   * from `provider`, so you do NOT register one first. Only call this for a
   * settled payment — a free quote or a failed call has nothing to record.
   *
   * @param {Object} p
   * @param {string} p.agent_id
   * @param {string} p.provider - provider name/origin, e.g. "stableenrich.dev"
   * @param {number} p.spend - settled USD amount (> 0)
   * @param {string} [p.declared_goal]
   * @param {string} [p.purchase_reason]
   * @param {string} [p.context_gap]
   * @param {string} [p.expected_value]
   * @param {string} [p.transaction_hash] - on-chain tx hash (receipt evidence)
   * @param {string} [p.request_id]
   * @param {string} [p.currency='USDC']
   * @param {string} [p.payment_method='x402']
   * @returns {Promise<{ action, purchase, decision, outcome }>}
   */
  async recordX402Purchase({
    agent_id, provider, spend,
    declared_goal, purchase_reason, context_gap, expected_value,
    transaction_hash, request_id, currency = 'USDC', payment_method = 'x402',
  } = {}) {
    const origin = provider;
    const res = await this.recordPurchase({
      agent_id,
      provider: origin,
      declared_goal: declared_goal || `x402 capability call to ${origin}`,
      purchase_reason: purchase_reason || `Paid x402 capability call to ${origin}`,
      context_gap: context_gap || `Capability gated behind payment at ${origin}`,
      expected_value: expected_value || `Paid result from ${origin}`,
      spend_amount: spend,
      cost_estimate: spend,
      currency,
      payment_method,
    });
    const actionId = res?.action?.action_id ?? res?.action?.id;
    let outcome = null;
    if (actionId) {
      outcome = await this.reportActionSuccess(actionId, `x402 settled: $${spend} ${currency} at ${origin}`);
      if (transaction_hash || request_id) {
        await this.recordPurchaseResult(actionId, {
          summary: `x402 settled: $${spend} ${currency} at ${origin}`,
          data: { origin, transactionHash: transaction_hash, requestId: request_id },
        });
      }
    }
    return { action: res?.action, purchase: res?.purchase, decision: res?.decision, outcome };
  }

  // ---------------------------------------------------------------------------
  // Work Orders — task-grade contracts + self-verifying receipts ledger.
  // ---------------------------------------------------------------------------

  /**
   * POST /api/work-orders — Submit a work order against a registered contract.
   * The order is validated against the type's input schema, guard-gated (may be
   * blocked or parked for human approval), then queued for a worker to claim.
   * @param {Object} order
   * @param {string} order.type - Registered work order type (e.g. 'research_brief')
   * @param {Object} order.input - Input payload matching the contract input schema
   * @param {Object} [order.budget] - { max_cost_usd?, timeout_seconds? } overrides type defaults
   * @param {string} [order.requested_by] - Submitting agent id (defaults to this.agentId)
   * @returns {Promise<{ work_order_id: string, status: string, guard: Object }>}
   */
  async submitWorkOrder(order) {
    return this._post('/api/work-orders', {
      ...order,
      requested_by: order.requested_by || this.agentId,
    });
  }

  /**
   * GET /api/work-orders/:workOrderId — Fetch a work order + its receipt (when terminal).
   * @param {string} workOrderId - The wo_* id returned at submission
   * @returns {Promise<{ work_order: Object, receipt: Object|null }>}
   */
  async getWorkOrder(workOrderId) {
    return this._get(`/api/work-orders/${workOrderId}`);
  }

  /**
   * GET /api/work-orders — List work orders with optional filters.
   * @param {Object} [filters={}] - { status?, type?, agent?, limit?, offset? }
   * @returns {Promise<{ work_orders: Array, total: number }>}
   */
  async listWorkOrders(filters = {}) {
    return this._get('/api/work-orders', filters);
  }

  /**
   * DELETE /api/work-orders/:workOrderId — Cancel a queued, claimed, or
   * pending-approval work order. Terminal orders (completed/failed/timed_out)
   * cannot be cancelled (409).
   * @param {string} workOrderId
   * @returns {Promise<{ work_order: Object }>}
   */
  async cancelWorkOrder(workOrderId) {
    return this._request(`/api/work-orders/${workOrderId}`, 'DELETE');
  }

  /**
   * POST /api/work-orders/claim — Worker: atomically claim the next queued order
   * of the given types (oldest-first). Returns null work_order when the queue is
   * empty. Lease expires after the order's timeout_seconds.
   * @param {Object} [opts={}]
   * @param {string[]|null} [opts.types=null] - Filter by type(s); null = any type
   * @param {string|null}   [opts.agent_id=null] - Worker id (defaults to this.agentId)
   * @returns {Promise<{ work_order: Object|null }>}
   */
  async claimWorkOrder({ types = null, agent_id = null } = {}) {
    return this._post('/api/work-orders/claim', {
      types,
      agent_id: agent_id || this.agentId,
    });
  }

  /**
   * POST /api/work-orders/:workOrderId/complete — Worker: report completion or
   * failure. On success the server validates the output against the type's output
   * schema and builds a SHA-256-hashed, self-verifying receipt. Output-contract
   * violations (422) leave the order claimed so the worker can re-report before
   * the lease expires.
   * @param {string} workOrderId
   * @param {Object} result
   * @param {'completed'|'failed'} result.status
   * @param {Object}  [result.output]  - Required when status=completed
   * @param {Object}  [result.cost]    - { input_tokens?, output_tokens?, total_usd? }
   * @param {Object}  [result.error]   - { code?, message? } when status=failed
   * @param {string}  [result.agent_id] - Reporting worker id (defaults to this.agentId)
   * @returns {Promise<{ work_order: Object, receipt: { receipt: Object, receipt_hash: string } }>}
   */
  async completeWorkOrder(workOrderId, result) {
    return this._post(`/api/work-orders/${workOrderId}/complete`, {
      ...result,
      agent_id: result.agent_id || this.agentId,
    });
  }

  /**
   * GET /api/work-orders/types — List registered work order contracts.
   * @returns {Promise<{ types: Array, total: number }>}
   */
  async listWorkOrderTypes() {
    return this._get('/api/work-orders/types');
  }

  /**
   * POST /api/work-orders/types — Register a new work order contract.
   * @param {Object} definition
   * @param {string} definition.type         - snake_case slug (3-64 chars)
   * @param {Object} definition.input_schema  - JSON Schema (object root) for inputs
   * @param {Object} definition.output_schema - JSON Schema (object root) for outputs
   * @param {string} [definition.display_name]
   * @param {string} [definition.description]
   * @param {number} [definition.default_max_cost_usd]
   * @param {number} [definition.default_timeout_seconds]
   * @returns {Promise<{ type: Object }>}
   */
  async registerWorkOrderType(definition) {
    return this._post('/api/work-orders/types', definition);
  }

  // ---------------------------------------------------------------------------
  // Managed secrets — opt-in delivery of decrypted secret values to agents.
  // ---------------------------------------------------------------------------

  /**
   * GET /api/secrets/env — Fetch the delivery-enabled managed-secret bundle
   * for an agent (org-level + agent-level merged, decrypted server-side).
   *
   * SECURITY: the returned `env` map contains LIVE secret values. Treat it as
   * memory-only — never log it, never write it to disk or a cache, and never
   * echo values back to a model, a user, or an error message. Inject into a
   * child-process environment (see `dashclaw env -- <command>`) and let the
   * object fall out of scope.
   *
   * @param {Object} [options]
   * @param {string} [options.agentId] - Agent to fetch the merged bundle for
   *   (defaults to this client's agentId).
   * @returns {Promise<{ env: Record<string, string>, count: number, delivered: string[] }>}
   */
  async getAgentEnv({ agentId } = {}) {
    return this._get('/api/secrets/env', { agent_id: agentId || this.agentId });
  }
}

export { DashClaw, ApprovalDeniedError, GuardBlockedError };
