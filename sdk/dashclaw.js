/**
 * DashClaw SDK
 * Full-featured agent toolkit for the DashClaw platform.
 * Zero-dependency ESM SDK. Requires Node 18+ (native fetch).
 *
 * 96+ methods across 22+ categories:
 * - Action Recording (7)
 * - Loops & Assumptions (7)
 * - Signals (1)
 * - Dashboard Data (9)
 * - Session Handoffs (3)
 * - Context Manager (7)
 * - Automation Snippets (5)
 * - User Preferences (6)
 * - Daily Digest (1)
 * - Security Scanning (3)
 * - Agent Messaging (9)
 * - Behavior Guard (2)
 * - Agent Pairing (3)
 * - Identity Binding (2)
 * - Organization Management (5)
 * - Activity Logs (1)
 * - Webhooks (5)
 * - Bulk Sync (1)
 * - Policy Testing (3)
 * - Compliance Engine (5)
 * - Task Routing (10)
 * - Real-Time Events (1)
 */

class DashClaw {
  /**
   * @param {Object} options
   * @param {string} options.baseUrl - DashClaw base URL (e.g. "http://localhost:3000" or "https://your-app.vercel.app")
   * @param {string} options.apiKey - API key for authentication (determines which org's data you access)
   * @param {string} options.agentId - Unique identifier for this agent
   * @param {string} [options.agentName] - Human-readable agent name
   * @param {string} [options.swarmId] - Swarm/group identifier if part of a multi-agent system
   * @param {string} [options.guardMode='off'] - Auto guard check before createAction: 'off' | 'warn' | 'enforce'
   * @param {Function} [options.guardCallback] - Called with guard decision object when guardMode is active
   * @param {string} [options.autoRecommend='off'] - Recommendation mode: 'off' | 'warn' | 'enforce'
   * @param {number} [options.recommendationConfidenceMin=70] - Minimum recommendation confidence to auto-apply in enforce mode
   * @param {Function} [options.recommendationCallback] - Called with recommendation adaptation details when autoRecommend is active
   * @param {string} [options.hitlMode='off'] - How to handle pending approvals: 'off' (return immediately) | 'wait' (block and poll)
   * @param {CryptoKey} [options.privateKey] - Web Crypto API Private Key for signing actions
   */
  constructor({
    baseUrl,
    apiKey,
    agentId,
    agentName,
    swarmId,
    guardMode,
    guardCallback,
    autoRecommend,
    recommendationConfidenceMin,
    recommendationCallback,
    hitlMode,
    privateKey
  }) {
    if (!baseUrl) throw new Error('baseUrl is required');
    if (!apiKey) throw new Error('apiKey is required');
    if (!agentId) throw new Error('agentId is required');

    const validModes = ['off', 'warn', 'enforce'];
    if (guardMode && !validModes.includes(guardMode)) {
      throw new Error(`guardMode must be one of: ${validModes.join(', ')}`);
    }
    if (autoRecommend && !validModes.includes(autoRecommend)) {
      throw new Error(`autoRecommend must be one of: ${validModes.join(', ')}`);
    }

    this.baseUrl = baseUrl.replace(/\/$/, '');
    if (!this.baseUrl.startsWith('https://') && !this.baseUrl.includes('localhost') && !this.baseUrl.includes('127.0.0.1')) {
      console.warn('[DashClaw] WARNING: baseUrl does not use HTTPS. API keys will be sent in plaintext. Use HTTPS in production.');
    }
    this.apiKey = apiKey;
    this.agentId = agentId;
    this.agentName = agentName || null;
    this.swarmId = swarmId || null;
    this.guardMode = guardMode || 'off';
    this.guardCallback = guardCallback || null;
    this.autoRecommend = autoRecommend || 'off';
    const parsedConfidenceMin = Number(recommendationConfidenceMin);
    this.recommendationConfidenceMin = Number.isFinite(parsedConfidenceMin)
      ? Math.max(0, Math.min(parsedConfidenceMin, 100))
      : 70;
    this.recommendationCallback = recommendationCallback || null;
    this.hitlMode = hitlMode || 'off';
    this.privateKey = privateKey || null;
    
    // Auto-import JWK if passed as plain object
    if (this.privateKey && typeof this.privateKey === 'object' && this.privateKey.kty) {
      this._pendingKeyImport = this._importJwk(this.privateKey);
    }
  }

  async _importJwk(jwk) {
    try {
      const cryptoSubtle = globalThis.crypto?.subtle || (await import('node:crypto')).webcrypto.subtle;
      this.privateKey = await cryptoSubtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
      );
      delete this._pendingKeyImport;
    } catch (err) {
      console.warn(`[DashClaw] Failed to auto-import privateKey JWK: ${err.message}`);
      this.privateKey = null;
    }
  }

  async _request(path, method, body) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await res.json();

    if (!res.ok) {
      const err = new Error(data.error || `Request failed with status ${res.status}`);
      err.status = res.status;
      err.details = data.details;
      throw err;
    }

    return data;
  }

  /**
   * Create an agent pairing request (returns a link the user can click to approve).
   *
   * @param {Object} options
   * @param {string} options.publicKeyPem - PEM public key (SPKI) to register for this agent.
   * @param {string} [options.algorithm='RSASSA-PKCS1-v1_5']
   * @param {string} [options.agentName]
   * @returns {Promise<{pairing: Object, pairing_url: string}>}
   */
  async createPairing({ publicKeyPem, algorithm = 'RSASSA-PKCS1-v1_5', agentName } = {}) {
    if (!publicKeyPem) throw new Error('publicKeyPem is required');
    return this._request('/api/pairings', 'POST', {
      agent_id: this.agentId,
      agent_name: agentName || this.agentName,
      public_key: publicKeyPem,
      algorithm,
    });
  }

  async _derivePublicKeyPemFromPrivateJwk(privateJwk) {
    // Node-only helper (works in the typical agent runtime).
    const { createPrivateKey, createPublicKey } = await import('node:crypto');
    const priv = createPrivateKey({ key: privateJwk, format: 'jwk' });
    const pub = createPublicKey(priv);
    return pub.export({ type: 'spki', format: 'pem' });
  }

  /**
   * Convenience: derive public PEM from a private JWK and create a pairing request.
   * @param {Object} privateJwk
   * @param {Object} [options]
   * @param {string} [options.agentName]
   */
  async createPairingFromPrivateJwk(privateJwk, { agentName } = {}) {
    if (!privateJwk) throw new Error('privateJwk is required');
    const publicKeyPem = await this._derivePublicKeyPemFromPrivateJwk(privateJwk);
    return this.createPairing({ publicKeyPem, agentName });
  }

  /**
   * Poll a pairing until it is approved/expired.
   * @param {string} pairingId
   * @param {Object} [options]
   * @param {number} [options.timeout=300000] - Max wait time (5 min)
   * @param {number} [options.interval=2000] - Poll interval
   * @returns {Promise<Object>} pairing object
   */
  async waitForPairing(pairingId, { timeout = 300000, interval = 2000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const res = await this._request(`/api/pairings/${encodeURIComponent(pairingId)}`, 'GET');
      const pairing = res.pairing;
      if (!pairing) throw new Error('Pairing response missing pairing');
      if (pairing.status === 'approved') return pairing;
      if (pairing.status === 'expired') throw new Error('Pairing expired');
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error('Timed out waiting for pairing approval');
  }

  /**
   * Internal: check guard policies before action creation.
   * Only active when guardMode is 'warn' or 'enforce'.
   * @param {Object} actionDef - Action definition from createAction()
   */
  async _guardCheck(actionDef) {
    if (this.guardMode === 'off') return;

    const context = {
      action_type: actionDef.action_type,
      risk_score: actionDef.risk_score,
      systems_touched: actionDef.systems_touched,
      reversible: actionDef.reversible,
      declared_goal: actionDef.declared_goal,
    };

    let decision;
    try {
      decision = await this.guard(context);
    } catch (err) {
      // Guard API failure is fail-open: log and proceed
      console.warn(`[DashClaw] Guard check failed (proceeding): ${err.message}`);
      return;
    }

    if (this.guardCallback) {
      try { this.guardCallback(decision); } catch { /* ignore callback errors */ }
    }

    const isBlocked = decision.decision === 'block' || decision.decision === 'require_approval';

    if (this.guardMode === 'warn' && isBlocked) {
      console.warn(
        `[DashClaw] Guard ${decision.decision}: ${decision.reasons.join('; ') || 'no reason'}. Proceeding in warn mode.`
      );
      return;
    }

    if (this.guardMode === 'enforce' && isBlocked) {
      throw new GuardBlockedError(decision);
    }
  }

  _canonicalJsonStringify(value) {
    const canonicalize = (v) => {
      if (v === null) return 'null';

      const t = typeof v;
      if (t === 'string' || t === 'number' || t === 'boolean') return JSON.stringify(v);

      if (t === 'undefined') return 'null';

      if (Array.isArray(v)) {
        return `[${v.map((x) => (typeof x === 'undefined' ? 'null' : canonicalize(x))).join(',')}]`;
      }

      if (t === 'object') {
        const keys = Object.keys(v)
          .filter((k) => typeof v[k] !== 'undefined')
          .sort();
        return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(',')}}`;
      }

      return 'null';
    };

    return canonicalize(value);
  }

  _toBase64(bytes) {
    if (typeof btoa === 'function') {
      return btoa(String.fromCharCode(...bytes));
    }
    return Buffer.from(bytes).toString('base64');
  }

  _isRestrictiveDecision(decision) {
    return decision?.decision === 'block' || decision?.decision === 'require_approval';
  }

  _buildGuardContext(actionDef) {
    return {
      action_type: actionDef.action_type,
      risk_score: actionDef.risk_score,
      systems_touched: actionDef.systems_touched,
      reversible: actionDef.reversible,
      declared_goal: actionDef.declared_goal,
      agent_id: this.agentId,
    };
  }

  async _reportRecommendationEvent(event) {
    try {
      await this._request('/api/learning/recommendations/events', 'POST', {
        ...event,
        agent_id: event.agent_id || this.agentId,
      });
    } catch {
      // Telemetry should never break action execution
    }
  }

  async _autoRecommend(actionDef) {
    if (this.autoRecommend === 'off' || !actionDef?.action_type) {
      return { action: actionDef, recommendation: null, adapted_fields: [] };
    }

    let result;
    try {
      result = await this.recommendAction(actionDef);
    } catch (err) {
      console.warn(`[DashClaw] Recommendation fetch failed (proceeding): ${err.message}`);
      return { action: actionDef, recommendation: null, adapted_fields: [] };
    }

    if (this.recommendationCallback) {
      try { this.recommendationCallback(result); } catch { /* ignore callback errors */ }
    }

    const recommendation = result.recommendation || null;
    if (!recommendation) return result;

    const confidence = Number(recommendation.confidence || 0);
    if (confidence < this.recommendationConfidenceMin) {
      const override_reason = `confidence_below_threshold:${confidence}<${this.recommendationConfidenceMin}`;
      await this._reportRecommendationEvent({
        recommendation_id: recommendation.id,
        event_type: 'overridden',
        details: { action_type: actionDef.action_type, reason: override_reason },
      });
      return {
        ...result,
        action: {
          ...actionDef,
          recommendation_id: recommendation.id,
          recommendation_applied: false,
          recommendation_override_reason: override_reason,
        },
      };
    }

    let guardDecision = null;
    try {
      guardDecision = await this.guard(this._buildGuardContext(result.action || actionDef));
    } catch (err) {
      console.warn(`[DashClaw] Recommendation guard probe failed: ${err.message}`);
    }

    if (this._isRestrictiveDecision(guardDecision)) {
      const override_reason = `guard_restrictive:${guardDecision.decision}`;
      await this._reportRecommendationEvent({
        recommendation_id: recommendation.id,
        event_type: 'overridden',
        details: { action_type: actionDef.action_type, reason: override_reason },
      });
      return {
        ...result,
        action: {
          ...actionDef,
          recommendation_id: recommendation.id,
          recommendation_applied: false,
          recommendation_override_reason: override_reason,
        },
      };
    }

    if (this.autoRecommend === 'warn') {
      const override_reason = 'warn_mode_no_autoadapt';
      await this._reportRecommendationEvent({
        recommendation_id: recommendation.id,
        event_type: 'overridden',
        details: { action_type: actionDef.action_type, reason: override_reason },
      });
      return {
        ...result,
        action: {
          ...actionDef,
          recommendation_id: recommendation.id,
          recommendation_applied: false,
          recommendation_override_reason: override_reason,
        },
      };
    }

    await this._reportRecommendationEvent({
      recommendation_id: recommendation.id,
      event_type: 'applied',
      details: {
        action_type: actionDef.action_type,
        adapted_fields: result.adapted_fields || [],
        confidence,
      },
    });

    return {
      ...result,
      action: {
        ...(result.action || actionDef),
        recommendation_id: recommendation.id,
        recommendation_applied: true,
        recommendation_override_reason: null,
      },
    };
  }

  // ══════════════════════════════════════════════
  // Category 1: Decision Recording (6 methods)
  // ══════════════════════════════════════════════

  /**
   * Record a governed decision. Every action is a decision with a full audit trail: goal, reasoning, assumptions, and policy compliance.
   * @param {Object} action
   * @param {string} action.action_type - One of: build, deploy, post, apply, security, message, api, calendar, research, review, fix, refactor, test, config, monitor, alert, cleanup, sync, migrate, other
   * @param {string} action.declared_goal - What this action aims to accomplish
   * @param {string} [action.action_id] - Custom action ID (auto-generated if omitted)
   * @param {string} [action.reasoning] - Why the agent decided to take this action
   * @param {string} [action.authorization_scope] - What permissions were granted
   * @param {string} [action.trigger] - What triggered this action
   * @param {string[]} [action.systems_touched] - Systems this action interacts with
   * @param {string} [action.input_summary] - Summary of input data
   * @param {string} [action.parent_action_id] - Parent action if this is a sub-action
   * @param {boolean} [action.reversible=true] - Whether this action can be undone
   * @param {number} [action.risk_score=0] - Risk score 0-100
   * @param {number} [action.confidence=50] - Confidence level 0-100
   * @returns {Promise<{action: Object, action_id: string}>}
   */
  async createAction(action) {
    const recommendationResult = await this._autoRecommend(action);
    const finalAction = recommendationResult.action || action;

    await this._guardCheck(finalAction);
    if (this._pendingKeyImport) await this._pendingKeyImport;
    
    const payload = {
      agent_id: this.agentId,
      agent_name: this.agentName,
      swarm_id: this.swarmId,
      ...finalAction
    };

    let signature = null;
    if (this.privateKey) {
      try {
        const encoder = new TextEncoder();
        const data = encoder.encode(this._canonicalJsonStringify(payload));
        // Use global crypto or fallback to node:crypto
        const cryptoSubtle = globalThis.crypto?.subtle || (await import('node:crypto')).webcrypto.subtle;
        
        const sigBuffer = await cryptoSubtle.sign(
          { name: "RSASSA-PKCS1-v1_5" },
          this.privateKey,
          data
        );
        // Base64 encode signature
        signature = this._toBase64(new Uint8Array(sigBuffer));
      } catch (err) {
        throw new Error(`Failed to sign action: ${err.message}`);
      }
    }

    const res = await this._request('/api/actions', 'POST', {
      ...payload,
      _signature: signature
    });

    // Handle HITL Approval
    if (res.action?.status === 'pending_approval' && this.hitlMode === 'wait') {
      console.log(`[DashClaw] Action ${res.action_id} requires human approval. Waiting...`);
      return this.waitForApproval(res.action_id);
    }

    return res;
  }

  /**
   * Poll for human approval of a pending action.
   * @param {string} actionId
   * @param {Object} [options]
   * @param {number} [options.timeout=300000] - Max wait time (5 min)
   * @param {number} [options.interval=5000] - Poll interval
   * @param {boolean} [options.useEvents=false] - Use SSE stream instead of polling
   */
  async waitForApproval(actionId, { timeout = 300000, interval = 5000, useEvents = false } = {}) {
    if (!useEvents) {
      return this._waitForApprovalPolling(actionId, timeout, interval);
    }

    return new Promise((resolve, reject) => {
      const stream = this.events();
      const timeoutId = setTimeout(() => {
        stream.close();
        reject(new Error(`Timed out waiting for approval of action ${actionId}`));
      }, timeout);

      stream.on('action.updated', (data) => {
        if (data.action_id !== actionId) return;
        if (data.status === 'running') {
          clearTimeout(timeoutId);
          stream.close();
          resolve({ action: data, action_id: actionId });
        } else if (data.status === 'failed' || data.status === 'cancelled') {
          clearTimeout(timeoutId);
          stream.close();
          reject(new ApprovalDeniedError(data.error_message || 'Operator denied the action.'));
        }
      });

      stream.on('error', (err) => {
        clearTimeout(timeoutId);
        stream.close();
        reject(err);
      });
    });
  }

  /** @private Polling-based waitForApproval implementation. */
  async _waitForApprovalPolling(actionId, timeout, interval) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const { action } = await this.getAction(actionId);

      if (action.status === 'running') {
        console.log(`[DashClaw] Action ${actionId} approved by operator.`);
        return { action, action_id: actionId };
      }

      if (action.status === 'failed' || action.status === 'cancelled') {
        throw new ApprovalDeniedError(action.error_message || 'Operator denied the action.');
      }

      await new Promise(r => setTimeout(r, interval));
    }

    throw new Error(`[DashClaw] Timed out waiting for approval of action ${actionId}`);
  }

  // ══════════════════════════════════════════════
  // Real-Time Events (1 method)
  // ══════════════════════════════════════════════

  /**
   * Subscribe to real-time SSE events from the DashClaw server.
   * Uses fetch-based SSE parsing for Node 18+ compatibility (no native EventSource required).
   *
   * @param {Object} [options]
   * @param {boolean} [options.reconnect=true] - Auto-reconnect on disconnect (resumes from last event ID)
   * @param {number} [options.maxRetries=Infinity] - Max reconnection attempts before giving up
   * @param {number} [options.retryInterval=3000] - Milliseconds between reconnection attempts
   * @returns {{ on(eventType: string, callback: Function): this, close(): void, _promise: Promise<void> }}
   *
   * @example
   * const stream = client.events();
   * stream
   *   .on('action.created', (data) => console.log('New action:', data))
   *   .on('action.updated', (data) => console.log('Action updated:', data))
   *   .on('loop.created', (data) => console.log('New loop:', data))
   *   .on('loop.updated', (data) => console.log('Loop updated:', data))
   *   .on('goal.created', (data) => console.log('New goal:', data))
   *   .on('goal.updated', (data) => console.log('Goal updated:', data))
   *   .on('policy.updated', (data) => console.log('Policy changed:', data))
   *   .on('task.assigned', (data) => console.log('Task assigned:', data))
   *   .on('task.completed', (data) => console.log('Task done:', data))
   *   .on('reconnecting', ({ attempt }) => console.log(`Reconnecting #${attempt}...`))
   *   .on('error', (err) => console.error('Stream error:', err));
   *
   * // Later:
   * stream.close();
   */
  events({ reconnect = true, maxRetries = Infinity, retryInterval = 3000 } = {}) {
    const url = `${this.baseUrl}/api/stream`;
    const apiKey = this.apiKey;

    const handlers = new Map();
    let closed = false;
    let controller = null;
    let lastEventId = null;
    let retryCount = 0;

    const emit = (eventType, data) => {
      const cbs = handlers.get(eventType) || [];
      for (const cb of cbs) {
        try { cb(data); } catch { /* ignore handler errors */ }
      }
    };

    const connect = async () => {
      controller = new AbortController();
      const headers = { 'x-api-key': apiKey };
      if (lastEventId) headers['last-event-id'] = lastEventId;

      const res = await fetch(url, {
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`SSE connection failed: ${res.status} ${res.statusText}`);
      }

      retryCount = 0; // Reset on successful connection

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // Persist across reads so frames split across chunks are handled correctly
      let currentEvent = null;
      let currentData = '';

      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE frames from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('id: ')) {
            lastEventId = line.slice(4).trim();
          } else if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            currentData += line.slice(6);
          } else if (line.startsWith(':')) {
            // SSE comment (keepalive heartbeat). Ignore.
          } else if (line === '' && currentEvent) {
            // End of SSE frame. Dispatch.
            if (currentData) {
              try {
                const parsed = JSON.parse(currentData);
                emit(currentEvent, parsed);
              } catch { /* ignore parse errors */ }
            }
            currentEvent = null;
            currentData = '';
          } else if (line === '') {
            // Blank line without a pending event. Reset partial state.
            currentEvent = null;
            currentData = '';
          }
        }
      }
    };

    const connectLoop = async () => {
      while (!closed) {
        try {
          await connect();
        } catch (err) {
          if (closed) return;
          emit('error', err);
        }
        // Stream ended (server closed, network drop, etc.)
        if (closed) return;
        if (!reconnect || retryCount >= maxRetries) {
          emit('error', new Error('SSE stream ended'));
          return;
        }
        retryCount++;
        emit('reconnecting', { attempt: retryCount, maxRetries });
        await new Promise((r) => setTimeout(r, retryInterval));
      }
    };

    const connectionPromise = connectLoop();

    const handle = {
      on(eventType, callback) {
        if (!handlers.has(eventType)) handlers.set(eventType, []);
        handlers.get(eventType).push(callback);
        return handle;
      },
      close() {
        closed = true;
        if (controller) controller.abort();
      },
      _promise: connectionPromise,
    };

    return handle;
  }

  /**
   * Report agent presence and health.
   * @param {Object} [options]
   * @param {'online'|'busy'|'error'} [options.status='online']
   * @param {string} [options.currentTaskId]
   * @param {Object} [options.metadata]
   * @returns {Promise<{status: string, timestamp: string}>}
   */
  async heartbeat({ status = 'online', currentTaskId, metadata } = {}) {
    return this._request('/api/agents/heartbeat', 'POST', {
      agent_id: this.agentId,
      agent_name: this.agentName,
      status,
      current_task_id: currentTaskId,
      metadata,
    });
  }

  /**
   * Start an automatic heartbeat timer.
   * @param {Object} [options]
   * @param {number} [options.interval=60000] - Interval in ms
   */
  startHeartbeat(options = {}) {
    if (this._heartbeatTimer) return;
    const interval = options.interval || 60000;
    this.heartbeat(options).catch(() => {}); // Initial heartbeat
    this._heartbeatTimer = setInterval(() => {
      this.heartbeat(options).catch(() => {});
    }, interval);
  }

  /**
   * Stop the automatic heartbeat timer.
   */
  stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  /**
   * Update the outcome of an existing action.
   * @param {string} actionId - The action_id to update
   * @param {Object} outcome
   * @param {string} [outcome.status] - New status: completed, failed, cancelled
   * @param {string} [outcome.output_summary] - What happened
   * @param {string[]} [outcome.side_effects] - Unintended consequences
   * @param {string[]} [outcome.artifacts_created] - Files, records, etc. created
   * @param {string} [outcome.error_message] - Error details if failed
   * @param {number} [outcome.duration_ms] - How long it took
   * @param {number} [outcome.cost_estimate] - Estimated cost in USD
   * @returns {Promise<{action: Object}>}
   */
  async updateOutcome(actionId, outcome) {
    return this._request(`/api/actions/${actionId}`, 'PATCH', {
      ...outcome,
      timestamp_end: outcome.timestamp_end || new Date().toISOString()
    });
  }

  /**
   * Get a list of actions with optional filters.
   * @param {Object} [filters]
   * @param {string} [filters.agent_id] - Filter by agent
   * @param {string} [filters.swarm_id] - Filter by swarm
   * @param {string} [filters.status] - Filter by status
   * @param {string} [filters.action_type] - Filter by type
   * @param {number} [filters.risk_min] - Minimum risk score
   * @param {number} [filters.limit=50] - Max results
   * @param {number} [filters.offset=0] - Pagination offset
   * @returns {Promise<{actions: Object[], total: number, stats: Object}>}
   */
  async getActions(filters = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    }
    return this._request(`/api/actions?${params}`, 'GET');
  }

  /**
   * Get a single action with its open loops and assumptions.
   * @param {string} actionId
   * @returns {Promise<{action: Object, open_loops: Object[], assumptions: Object[]}>}
   */
  async getAction(actionId) {
    return this._request(`/api/actions/${actionId}`, 'GET');
  }

  /**
   * Get root-cause trace for an action.
   * @param {string} actionId
   * @returns {Promise<{action: Object, trace: Object}>}
   */
  async getActionTrace(actionId) {
    return this._request(`/api/actions/${actionId}/trace`, 'GET');
  }

  /**
   * Helper: Create an action, run a function, and auto-update the outcome.
   * @param {Object} actionDef - Action definition (same as createAction)
   * @param {Function} fn - Async function to execute. Receives { action_id } as argument.
   * @returns {Promise<*>} - The return value of fn
   */
  async track(actionDef, fn) {
    const startTime = Date.now();
    const { action_id } = await this.createAction(actionDef);

    try {
      const result = await fn({ action_id });
      await this.updateOutcome(action_id, {
        status: 'completed',
        duration_ms: Date.now() - startTime,
        output_summary: typeof result === 'string' ? result : JSON.stringify(result)
      });
      return result;
    } catch (error) {
      await this.updateOutcome(action_id, {
        status: 'failed',
        duration_ms: Date.now() - startTime,
        error_message: error.message || String(error)
      }).catch(() => {}); // Don't throw if outcome update fails
      throw error;
    }
  }

  // ══════════════════════════════════════════════
  // Category 2: Decision Integrity (Loops & Assumptions) (7 methods)
  // ══════════════════════════════════════════════

  /**
   * Register an unresolved dependency for a decision. Open loops track work that must be completed before the decision can be considered fully resolved.
   * @param {Object} loop
   * @param {string} loop.action_id - Parent action ID
   * @param {string} loop.loop_type - One of: followup, question, dependency, approval, review, handoff, other
   * @param {string} loop.description - What needs to be resolved
   * @param {string} [loop.priority='medium'] - One of: low, medium, high, critical
   * @param {string} [loop.owner] - Who is responsible for resolving this
   * @returns {Promise<{loop: Object, loop_id: string}>}
   */
  async registerOpenLoop(loop) {
    return this._request('/api/actions/loops', 'POST', loop);
  }

  /**
   * Resolve or cancel an open loop.
   * @param {string} loopId - The loop_id to resolve
   * @param {string} status - 'resolved' or 'cancelled'
   * @param {string} [resolution] - Resolution description (required when resolving)
   * @returns {Promise<{loop: Object}>}
   */
  async resolveOpenLoop(loopId, status, resolution) {
    return this._request(`/api/actions/loops/${loopId}`, 'PATCH', {
      status,
      resolution
    });
  }

  /**
   * Get open loops with optional filters.
   * @param {Object} [filters]
   * @param {string} [filters.status] - Filter by status (open, resolved, cancelled)
   * @param {string} [filters.loop_type] - Filter by loop type
   * @param {string} [filters.priority] - Filter by priority
   * @param {number} [filters.limit=50] - Max results
   * @returns {Promise<{loops: Object[], total: number, stats: Object}>}
   */
  async getOpenLoops(filters = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    }
    return this._request(`/api/actions/loops?${params}`, 'GET');
  }

  /**
   * Register assumptions underlying a decision. Assumptions are the decision basis. They must be validated or invalidated to maintain decision integrity.
   * @param {Object} assumption
   * @param {string} assumption.action_id - Parent action ID
   * @param {string} assumption.assumption - The assumption being made
   * @param {string} [assumption.basis] - Evidence or reasoning for the assumption
   * @param {boolean} [assumption.validated=false] - Whether this has been validated
   * @returns {Promise<{assumption: Object, assumption_id: string}>}
   */
  async registerAssumption(assumption) {
    return this._request('/api/actions/assumptions', 'POST', assumption);
  }

  /**
   * Get a single assumption by ID.
   * @param {string} assumptionId
   * @returns {Promise<{assumption: Object}>}
   */
  async getAssumption(assumptionId) {
    return this._request(`/api/actions/assumptions/${assumptionId}`, 'GET');
  }

  /**
   * Validate or invalidate an assumption.
   * @param {string} assumptionId - The assumption_id to update
   * @param {boolean} validated - true to validate, false to invalidate
   * @param {string} [invalidated_reason] - Required when invalidating
   * @returns {Promise<{assumption: Object}>}
   */
  async validateAssumption(assumptionId, validated, invalidated_reason) {
    if (typeof validated !== 'boolean') throw new Error('validated must be a boolean');
    if (validated === false && !invalidated_reason) {
      throw new Error('invalidated_reason is required when invalidating an assumption');
    }
    const body = { validated };
    if (invalidated_reason !== undefined) body.invalidated_reason = invalidated_reason;
    return this._request(`/api/actions/assumptions/${assumptionId}`, 'PATCH', body);
  }

  /**
   * Get drift report for assumptions with risk scoring.
   * @param {Object} [filters]
   * @param {string} [filters.action_id] - Filter by action
   * @param {number} [filters.limit=50] - Max results
   * @returns {Promise<{assumptions: Object[], drift_summary: Object}>}
   */
  async getDriftReport(filters = {}) {
    const params = new URLSearchParams({ drift: 'true' });
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    }
    return this._request(`/api/actions/assumptions?${params}`, 'GET');
  }

  // ══════════════════════════════════════════════
  // Category 3: Decision Integrity Signals (1 method)
  // ══════════════════════════════════════════════

  /**
   * Get current decision integrity signals. Returns autonomy breaches, logic drift, and governance violations.
   * @returns {Promise<{signals: Object[], counts: {red: number, amber: number, total: number}}>}
   */
  async getSignals() {
    return this._request('/api/actions/signals', 'GET');
  }

  // ══════════════════════════════════════════════
  // Category 4: Dashboard Data (9 methods)
  // ══════════════════════════════════════════════

  /**
   * Report token usage snapshot (disabled in dashboard, API still functional).
   * @param {Object} usage
   * @param {number} usage.tokens_in - Input tokens consumed
   * @param {number} usage.tokens_out - Output tokens generated
   * @param {number} [usage.context_used] - Context window tokens used
   * @param {number} [usage.context_max] - Context window max capacity
   * @param {string} [usage.model] - Model name
   * @returns {Promise<{snapshot: Object}>}
   */
  async reportTokenUsage(usage) {
    return this._request('/api/tokens', 'POST', {
      ...usage,
      agent_id: this.agentId
    });
  }

  /**
   * Internal: fire-and-forget token report extracted from an LLM response.
   * @private
   */
  async _reportTokenUsageFromLLM({ tokens_in, tokens_out, model }) {
    if (tokens_in == null && tokens_out == null) return;
    try {
      await this._request('/api/tokens', 'POST', {
        tokens_in: tokens_in || 0,
        tokens_out: tokens_out || 0,
        model: model || undefined,
        agent_id: this.agentId,
      });
    } catch (_) {
      // fire-and-forget: never let telemetry break the caller
    }
  }

  /**
   * Wrap an Anthropic or OpenAI client to auto-report token usage after each call.
   * Returns the same client instance (mutated) for fluent usage.
   *
   * @param {Object} llmClient - An Anthropic or OpenAI SDK client instance
   * @param {Object} [options]
   * @param {'anthropic'|'openai'} [options.provider] - Force provider detection
   * @returns {Object} The wrapped client
   *
   * @example
   * const anthropic = claw.wrapClient(new Anthropic());
   * const msg = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, messages: [...] });
   * // Token usage is auto-reported to DashClaw
   */
  wrapClient(llmClient, { provider } = {}) {
    if (llmClient._dashclawWrapped) return llmClient;

    const detected = provider
      || (llmClient.messages?.create ? 'anthropic' : null)
      || (llmClient.chat?.completions?.create ? 'openai' : null);

    if (!detected) {
      throw new Error(
        'DashClaw.wrapClient: unable to detect provider. Pass { provider: "anthropic" } or { provider: "openai" }.'
      );
    }

    if (detected === 'anthropic') {
      const original = llmClient.messages.create.bind(llmClient.messages);
      llmClient.messages.create = async (...args) => {
        const response = await original(...args);
        this._reportTokenUsageFromLLM({
          tokens_in: response?.usage?.input_tokens ?? null,
          tokens_out: response?.usage?.output_tokens ?? null,
          model: response?.model ?? null,
        });
        return response;
      };
    } else if (detected === 'openai') {
      const original = llmClient.chat.completions.create.bind(llmClient.chat.completions);
      llmClient.chat.completions.create = async (...args) => {
        const response = await original(...args);
        this._reportTokenUsageFromLLM({
          tokens_in: response?.usage?.prompt_tokens ?? null,
          tokens_out: response?.usage?.completion_tokens ?? null,
          model: response?.model ?? null,
        });
        return response;
      };
    }

    llmClient._dashclawWrapped = true;
    return llmClient;
  }

  /**
   * Record a decision for the learning database.
   * @param {Object} entry
   * @param {string} entry.decision - What was decided
   * @param {string} [entry.context] - Context around the decision
   * @param {string} [entry.reasoning] - Why this decision was made
   * @param {string} [entry.outcome] - 'success', 'failure', or 'pending'
   * @param {number} [entry.confidence] - Confidence level 0-100
   * @returns {Promise<{decision: Object}>}
   */
  async recordDecision(entry) {
    return this._request('/api/learning', 'POST', {
      ...entry,
      agent_id: this.agentId
    });
  }

  /**
   * Get adaptive learning recommendations derived from prior episodes.
   * @param {Object} [filters]
   * @param {string} [filters.action_type] - Filter by action type
   * @param {string} [filters.agent_id] - Override agent_id (defaults to SDK agent)
   * @param {boolean} [filters.include_inactive] - Include disabled recommendations (admin/service only)
   * @param {boolean} [filters.track_events=true] - Record recommendation fetched telemetry
   * @param {boolean} [filters.include_metrics] - Include computed metrics in the response payload
   * @param {number} [filters.limit=50] - Max recommendations to return
   * @param {number} [filters.lookback_days=30] - Lookback days used when include_metrics=true
   * @returns {Promise<{recommendations: Object[], metrics?: Object, total: number, lastUpdated: string}>}
   */
  async getRecommendations(filters = {}) {
    const params = new URLSearchParams({
      agent_id: filters.agent_id || this.agentId,
    });
    if (filters.action_type) params.set('action_type', filters.action_type);
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.include_inactive) params.set('include_inactive', 'true');
    if (filters.track_events !== false) params.set('track_events', 'true');
    if (filters.include_metrics) params.set('include_metrics', 'true');
    if (filters.lookback_days) params.set('lookback_days', String(filters.lookback_days));
    return this._request(`/api/learning/recommendations?${params}`, 'GET');
  }

  /**
   * Get recommendation effectiveness metrics and telemetry aggregates.
   * @param {Object} [filters]
   * @param {string} [filters.action_type] - Filter by action type
   * @param {string} [filters.agent_id] - Override agent_id (defaults to SDK agent)
   * @param {number} [filters.lookback_days=30] - Lookback window for episodes/events
   * @param {number} [filters.limit=100] - Max recommendations considered
   * @param {boolean} [filters.include_inactive] - Include inactive recommendations (admin/service only)
   * @returns {Promise<{metrics: Object[], summary: Object, lookback_days: number, lastUpdated: string}>}
   */
  async getRecommendationMetrics(filters = {}) {
    const params = new URLSearchParams({
      agent_id: filters.agent_id || this.agentId,
    });
    if (filters.action_type) params.set('action_type', filters.action_type);
    if (filters.lookback_days) params.set('lookback_days', String(filters.lookback_days));
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.include_inactive) params.set('include_inactive', 'true');
    return this._request(`/api/learning/recommendations/metrics?${params}`, 'GET');
  }

  /**
   * Record recommendation telemetry events (single event or batch).
   * @param {Object|Object[]} events
   * @returns {Promise<{created: Object[], created_count: number}>}
   */
  async recordRecommendationEvents(events) {
    if (Array.isArray(events)) {
      return this._request('/api/learning/recommendations/events', 'POST', { events });
    }
    return this._request('/api/learning/recommendations/events', 'POST', events || {});
  }

  /**
   * Enable or disable a recommendation.
   * @param {string} recommendationId - Recommendation ID
   * @param {boolean} active - Desired active state
   * @returns {Promise<{recommendation: Object}>}
   */
  async setRecommendationActive(recommendationId, active) {
    return this._request(`/api/learning/recommendations/${recommendationId}`, 'PATCH', { active: !!active });
  }

  /**
   * Rebuild recommendations from scored learning episodes.
   * @param {Object} [options]
   * @param {string} [options.action_type] - Scope rebuild to one action type
   * @param {string} [options.agent_id] - Override agent_id (defaults to SDK agent)
   * @param {number} [options.lookback_days=30] - Days of episode history to analyze
   * @param {number} [options.min_samples=5] - Minimum episodes required per recommendation
   * @param {number} [options.episode_limit=5000] - Episode scan cap
   * @param {string} [options.action_id] - Optionally score this action before rebuild
   * @returns {Promise<{recommendations: Object[], total: number, episodes_scanned: number}>}
   */
  async rebuildRecommendations(options = {}) {
    return this._request('/api/learning/recommendations', 'POST', {
      agent_id: options.agent_id || this.agentId,
      action_type: options.action_type,
      lookback_days: options.lookback_days,
      min_samples: options.min_samples,
      episode_limit: options.episode_limit,
      action_id: options.action_id,
    });
  }

  /**
   * Apply top recommendation hints to an action definition (non-destructive).
   * @param {Object} action - Action payload compatible with createAction()
   * @returns {Promise<{action: Object, recommendation: Object|null, adapted_fields: string[]}>}
   */
  async recommendAction(action) {
    if (!action?.action_type) {
      return { action, recommendation: null, adapted_fields: [] };
    }

    const response = await this.getRecommendations({ action_type: action.action_type, limit: 1 });
    const recommendation = response.recommendations?.[0] || null;
    if (!recommendation) {
      return { action, recommendation: null, adapted_fields: [] };
    }

    const adapted = { ...action };
    const adaptedFields = [];
    const hints = recommendation.hints || {};

    if (
      typeof hints.preferred_risk_cap === 'number' &&
      (adapted.risk_score === undefined || adapted.risk_score > hints.preferred_risk_cap)
    ) {
      adapted.risk_score = hints.preferred_risk_cap;
      adaptedFields.push('risk_score');
    }

    if (hints.prefer_reversible === true && adapted.reversible === undefined) {
      adapted.reversible = true;
      adaptedFields.push('reversible');
    }

    if (
      typeof hints.confidence_floor === 'number' &&
      (adapted.confidence === undefined || adapted.confidence < hints.confidence_floor)
    ) {
      adapted.confidence = hints.confidence_floor;
      adaptedFields.push('confidence');
    }

    return {
      action: adapted,
      recommendation,
      adapted_fields: adaptedFields,
    };
  }

  /**
   * Create a goal.
   * @param {Object} goal
   * @param {string} goal.title - Goal title
   * @param {string} [goal.category] - Goal category
   * @param {string} [goal.description] - Detailed description
   * @param {string} [goal.target_date] - Target completion date (ISO string)
   * @param {number} [goal.progress] - Progress 0-100
   * @param {string} [goal.status] - 'active', 'completed', 'paused'
   * @returns {Promise<{goal: Object}>}
   */
  async createGoal(goal) {
    return this._request('/api/goals', 'POST', {
      ...goal,
      agent_id: this.agentId
    });
  }

  /**
   * Record content creation.
   * @param {Object} content
   * @param {string} content.title - Content title
   * @param {string} [content.platform] - Platform (e.g., 'linkedin', 'twitter')
   * @param {string} [content.status] - 'draft' or 'published'
   * @param {string} [content.url] - Published URL
   * @returns {Promise<{content: Object}>}
   */
  async recordContent(content) {
    return this._request('/api/content', 'POST', {
      ...content,
      agent_id: this.agentId
    });
  }

  /**
   * Record a relationship interaction.
   * @param {Object} interaction
   * @param {string} interaction.summary - What happened
   * @param {string} [interaction.contact_name] - Contact name (auto-resolves to contact_id)
   * @param {string} [interaction.contact_id] - Direct contact ID
   * @param {string} [interaction.direction] - 'inbound' or 'outbound'
   * @param {string} [interaction.type] - Interaction type
   * @param {string} [interaction.platform] - Platform used
   * @returns {Promise<{interaction: Object}>}
   */
  async recordInteraction(interaction) {
    return this._request('/api/relationships', 'POST', {
      ...interaction,
      agent_id: this.agentId
    });
  }

  /**
   * Create a calendar event.
   * @param {Object} event
   * @param {string} event.summary - Event title/summary
   * @param {string} event.start_time - Start time (ISO string)
   * @param {string} [event.end_time] - End time (ISO string)
   * @param {string} [event.location] - Event location
   * @param {string} [event.description] - Event description
   * @returns {Promise<{event: Object}>}
   */
  async createCalendarEvent(event) {
    return this._request('/api/calendar', 'POST', event);
  }

  /**
   * Record an idea/inspiration.
   * @param {Object} idea
   * @param {string} idea.title - Idea title
   * @param {string} [idea.description] - Detailed description
   * @param {string} [idea.category] - Category
   * @param {number} [idea.score] - Priority/quality score 0-100
   * @param {string} [idea.status] - 'pending', 'in_progress', 'shipped', 'rejected'
   * @param {string} [idea.source] - Where this idea came from
   * @returns {Promise<{idea: Object}>}
   */
  async recordIdea(idea) {
    return this._request('/api/inspiration', 'POST', idea);
  }

  /**
   * Report memory health snapshot with entities and topics.
   * @param {Object} report
   * @param {Object} report.health - Health metrics
   * @param {number} report.health.score - Health score 0-100
   * @param {Object[]} [report.entities] - Key entities found in memory
   * @param {Object[]} [report.topics] - Topics/themes found in memory
   * @returns {Promise<{snapshot: Object, entities_count: number, topics_count: number}>}
   */
  async reportMemoryHealth(report) {
    return this._request('/api/memory', 'POST', report);
  }

  /**
   * Report active connections/integrations for this agent.
   * @param {Object[]} connections - Array of connection objects
   * @param {string} connections[].provider - Service name (e.g., 'anthropic', 'github')
   * @param {string} [connections[].authType] - Auth method
   * @param {string} [connections[].planName] - Plan name
   * @param {string} [connections[].status] - Connection status: active, inactive, error
   * @param {Object|string} [connections[].metadata] - Optional metadata
   * @returns {Promise<{connections: Object[], created: number}>}
   */
  async reportConnections(connections) {
    return this._request('/api/agents/connections', 'POST', {
      agent_id: this.agentId,
      connections: connections.map(c => ({
        provider: c.provider,
        auth_type: c.authType || c.auth_type || 'api_key',
        plan_name: c.planName || c.plan_name || null,
        status: c.status || 'active',
        metadata: c.metadata || null
      }))
    });
  }

  // ══════════════════════════════════════════════
  // Category 5: Session Handoffs (3 methods)
  // ══════════════════════════════════════════════

  /**
   * Create a session handoff document.
   * @param {Object} handoff
   * @param {string} handoff.summary - Session summary
   * @param {string} [handoff.session_date] - Date string (defaults to today)
   * @param {string[]} [handoff.key_decisions] - Key decisions made
   * @param {string[]} [handoff.open_tasks] - Tasks still open
   * @param {string} [handoff.mood_notes] - Mood/energy observations
   * @param {string[]} [handoff.next_priorities] - What to focus on next
   * @returns {Promise<{handoff: Object, handoff_id: string}>}
   */
  async createHandoff(handoff) {
    return this._request('/api/handoffs', 'POST', {
      agent_id: this.agentId,
      ...handoff
    });
  }

  /**
   * Get handoffs with optional filters.
   * @param {Object} [filters]
   * @param {string} [filters.date] - Filter by session_date
   * @param {number} [filters.limit] - Max results
   * @returns {Promise<{handoffs: Object[], total: number}>}
   */
  async getHandoffs(filters = {}) {
    const params = new URLSearchParams({ agent_id: this.agentId });
    if (filters.date) params.set('date', filters.date);
    if (filters.limit) params.set('limit', String(filters.limit));
    return this._request(`/api/handoffs?${params}`, 'GET');
  }

  /**
   * Get the most recent handoff for this agent.
   * @returns {Promise<{handoff: Object|null}>}
   */
  async getLatestHandoff() {
    return this._request(`/api/handoffs?agent_id=${this.agentId}&latest=true`, 'GET');
  }

  // ══════════════════════════════════════════════
  // Category 6: Context Manager (7 methods)
  // ══════════════════════════════════════════════

  /**
   * Capture a key point from the current session.
   * @param {Object} point
   * @param {string} point.content - The key point content
   * @param {string} [point.category] - One of: decision, task, insight, question, general
   * @param {number} [point.importance] - Importance 1-10 (default 5)
   * @param {string} [point.session_date] - Date string (defaults to today)
   * @returns {Promise<{point: Object, point_id: string}>}
   */
  async captureKeyPoint(point) {
    return this._request('/api/context/points', 'POST', {
      agent_id: this.agentId,
      ...point
    });
  }

  /**
   * Get key points with optional filters.
   * @param {Object} [filters]
   * @param {string} [filters.category] - Filter by category
   * @param {string} [filters.session_date] - Filter by date
   * @param {number} [filters.limit] - Max results
   * @returns {Promise<{points: Object[], total: number}>}
   */
  async getKeyPoints(filters = {}) {
    const params = new URLSearchParams({ agent_id: this.agentId });
    if (filters.category) params.set('category', filters.category);
    if (filters.session_date) params.set('session_date', filters.session_date);
    if (filters.limit) params.set('limit', String(filters.limit));
    return this._request(`/api/context/points?${params}`, 'GET');
  }

  /**
   * Create a context thread for tracking a topic across entries.
   * @param {Object} thread
   * @param {string} thread.name - Thread name (unique per agent per org)
   * @param {string} [thread.summary] - Initial summary
   * @returns {Promise<{thread: Object, thread_id: string}>}
   */
  async createThread(thread) {
    return this._request('/api/context/threads', 'POST', {
      agent_id: this.agentId,
      ...thread
    });
  }

  /**
   * Add an entry to an existing thread.
   * @param {string} threadId - The thread ID
   * @param {string} content - Entry content
   * @param {string} [entryType] - Entry type (default: 'note')
   * @returns {Promise<{entry: Object, entry_id: string}>}
   */
  async addThreadEntry(threadId, content, entryType) {
    return this._request(`/api/context/threads/${threadId}/entries`, 'POST', {
      content,
      entry_type: entryType || 'note'
    });
  }

  /**
   * Close a thread with an optional summary.
   * @param {string} threadId - The thread ID
   * @param {string} [summary] - Final summary
   * @returns {Promise<{thread: Object}>}
   */
  async closeThread(threadId, summary) {
    const body = { status: 'closed' };
    if (summary) body.summary = summary;
    return this._request(`/api/context/threads/${threadId}`, 'PATCH', body);
  }

  /**
   * Get threads with optional filters.
   * @param {Object} [filters]
   * @param {string} [filters.status] - Filter by status (active, closed)
   * @param {number} [filters.limit] - Max results
   * @returns {Promise<{threads: Object[], total: number}>}
   */
  async getThreads(filters = {}) {
    const params = new URLSearchParams({ agent_id: this.agentId });
    if (filters.status) params.set('status', filters.status);
    if (filters.limit) params.set('limit', String(filters.limit));
    return this._request(`/api/context/threads?${params}`, 'GET');
  }

  /**
   * Get a combined context summary: today's key points + active threads.
   * @returns {Promise<{points: Object[], threads: Object[]}>}
   */
  async getContextSummary() {
    const today = new Date().toISOString().split('T')[0];
    const [pointsResult, threadsResult] = await Promise.all([
      this.getKeyPoints({ session_date: today }),
      this.getThreads({ status: 'active' }),
    ]);
    return {
      points: pointsResult.points,
      threads: threadsResult.threads,
    };
  }

  // ══════════════════════════════════════════════
  // Category 7: Automation Snippets (5 methods)
  // ══════════════════════════════════════════════

  /**
   * Save or update a reusable code snippet.
   * @param {Object} snippet
   * @param {string} snippet.name - Snippet name (unique per org, upserts on conflict)
   * @param {string} snippet.code - The snippet code
   * @param {string} [snippet.description] - What this snippet does
   * @param {string} [snippet.language] - Programming language
   * @param {string[]} [snippet.tags] - Tags for categorization
   * @returns {Promise<{snippet: Object, snippet_id: string}>}
   */
  async saveSnippet(snippet) {
    return this._request('/api/snippets', 'POST', {
      agent_id: this.agentId,
      ...snippet
    });
  }

  /**
   * Search and list snippets.
   * @param {Object} [filters]
   * @param {string} [filters.search] - Search name/description
   * @param {string} [filters.tag] - Filter by tag
   * @param {string} [filters.language] - Filter by language
   * @param {number} [filters.limit] - Max results
   * @returns {Promise<{snippets: Object[], total: number}>}
   */
  async getSnippets(filters = {}) {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.tag) params.set('tag', filters.tag);
    if (filters.language) params.set('language', filters.language);
    if (filters.limit) params.set('limit', String(filters.limit));
    return this._request(`/api/snippets?${params}`, 'GET');
  }

  /**
   * Fetch a single snippet by ID.
   * @param {string} snippetId - The snippet ID
   * @returns {Promise<{snippet: Object}>}
   */
  async getSnippet(snippetId) {
    return this._request(`/api/snippets/${snippetId}`, 'GET');
  }

  /**
   * Mark a snippet as used (increments use_count).
   * @param {string} snippetId - The snippet ID
   * @returns {Promise<{snippet: Object}>}
   */
  async useSnippet(snippetId) {
    return this._request(`/api/snippets/${snippetId}/use`, 'POST');
  }

  /**
   * Delete a snippet.
   * @param {string} snippetId - The snippet ID
   * @returns {Promise<{deleted: boolean, id: string}>}
   */
  async deleteSnippet(snippetId) {
    return this._request(`/api/snippets?id=${snippetId}`, 'DELETE');
  }

  // ══════════════════════════════════════════════
  // Category 8: User Preferences (6 methods)
  // ══════════════════════════════════════════════

  /**
   * Log a user observation (what you noticed about the user).
   * @param {Object} obs
   * @param {string} obs.observation - The observation text
   * @param {string} [obs.category] - Category tag
   * @param {number} [obs.importance] - Importance 1-10
   * @returns {Promise<{observation: Object, observation_id: string}>}
   */
  async logObservation(obs) {
    return this._request('/api/preferences', 'POST', {
      type: 'observation',
      agent_id: this.agentId,
      ...obs
    });
  }

  /**
   * Set a learned user preference.
   * @param {Object} pref
   * @param {string} pref.preference - The preference description
   * @param {string} [pref.category] - Category tag
   * @param {number} [pref.confidence] - Confidence 0-100
   * @returns {Promise<{preference: Object, preference_id: string}>}
   */
  async setPreference(pref) {
    return this._request('/api/preferences', 'POST', {
      type: 'preference',
      agent_id: this.agentId,
      ...pref
    });
  }

  /**
   * Log user mood/energy for a session.
   * @param {Object} entry
   * @param {string} entry.mood - Mood description (e.g., 'focused', 'frustrated')
   * @param {string} [entry.energy] - Energy level (e.g., 'high', 'low')
   * @param {string} [entry.notes] - Additional notes
   * @returns {Promise<{mood: Object, mood_id: string}>}
   */
  async logMood(entry) {
    return this._request('/api/preferences', 'POST', {
      type: 'mood',
      agent_id: this.agentId,
      ...entry
    });
  }

  /**
   * Track an approach and whether it succeeded or failed.
   * @param {Object} entry
   * @param {string} entry.approach - The approach description
   * @param {string} [entry.context] - Context for when to use this approach
   * @param {boolean} [entry.success] - true = worked, false = failed, undefined = just recording
   * @returns {Promise<{approach: Object, approach_id: string}>}
   */
  async trackApproach(entry) {
    return this._request('/api/preferences', 'POST', {
      type: 'approach',
      agent_id: this.agentId,
      ...entry
    });
  }

  /**
   * Get a summary of all user preference data.
   * @returns {Promise<{summary: Object}>}
   */
  async getPreferenceSummary() {
    return this._request(`/api/preferences?type=summary&agent_id=${this.agentId}`, 'GET');
  }

  /**
   * Get tracked approaches with success/fail counts.
   * @param {Object} [filters]
   * @param {number} [filters.limit] - Max results
   * @returns {Promise<{approaches: Object[], total: number}>}
   */
  async getApproaches(filters = {}) {
    const params = new URLSearchParams({ type: 'approaches', agent_id: this.agentId });
    if (filters.limit) params.set('limit', String(filters.limit));
    return this._request(`/api/preferences?${params}`, 'GET');
  }

  // ══════════════════════════════════════════════
  // Category 9: Daily Digest (1 method)
  // ══════════════════════════════════════════════

  /**
   * Get a daily activity digest aggregated from all data sources.
   * @param {string} [date] - Date string YYYY-MM-DD (defaults to today)
   * @returns {Promise<{date: string, digest: Object, summary: Object}>}
   */
  async getDailyDigest(date) {
    const params = new URLSearchParams({ agent_id: this.agentId });
    if (date) params.set('date', date);
    return this._request(`/api/digest?${params}`, 'GET');
  }

  // ══════════════════════════════════════════════
  // Category 10: Security Scanning (3 methods)
  // ══════════════════════════════════════════════

  /**
   * Scan text for sensitive data (API keys, tokens, PII, etc.).
   * Returns findings and redacted text. Does NOT store the original content.
   * @param {string} text - Text to scan
   * @param {string} [destination] - Where this text is headed (for context)
   * @returns {Promise<{clean: boolean, findings_count: number, findings: Object[], redacted_text: string}>}
   */
  async scanContent(text, destination) {
    return this._request('/api/security/scan', 'POST', {
      text,
      destination,
      agent_id: this.agentId,
      store: false,
    });
  }

  /**
   * Scan text and store finding metadata (never the content itself).
   * Use this for audit trails of security scans.
   * @param {string} text - Text to scan
   * @param {string} [destination] - Where this text is headed
   * @returns {Promise<{clean: boolean, findings_count: number, findings: Object[], redacted_text: string}>}
   */
  async reportSecurityFinding(text, destination) {
    return this._request('/api/security/scan', 'POST', {
      text,
      destination,
      agent_id: this.agentId,
      store: true,
    });
  }

  /**
   * Scan text for prompt injection attacks (role overrides, delimiter injection,
   * instruction smuggling, data exfiltration attempts, etc.).
   * @param {string} text - Text to scan
   * @param {Object} [options]
   * @param {string} [options.source] - Where this text came from (for context)
   * @returns {Promise<{clean: boolean, risk_level: string, recommendation: string, findings_count: number, critical_count: number, categories: string[], findings: Object[]}>}
   */
  async scanPromptInjection(text, options = {}) {
    return this._request('/api/security/prompt-injection', 'POST', {
      text,
      source: options.source,
      agent_id: this.agentId,
    });
  }

  // ══════════════════════════════════════════════
  // Category 11: Agent Messaging (11 methods)
  // ══════════════════════════════════════════════

  /**
   * Send a message to another agent or broadcast to all.
   * @param {Object} params
   * @param {string} [params.to] - Target agent ID (omit for broadcast)
   * @param {string} [params.type='info'] - Message type: action|info|lesson|question|status
   * @param {string} [params.subject] - Subject line (max 200 chars)
   * @param {string} params.body - Message body (max 2000 chars)
   * @param {string} [params.threadId] - Thread ID to attach message to
   * @param {boolean} [params.urgent=false] - Mark as urgent
   * @param {string} [params.docRef] - Reference to a shared doc ID
   * @param {Array<{filename: string, mime_type: string, data: string}>} [params.attachments] - File attachments (base64 data, max 3, max 5MB each)
   * @returns {Promise<{message: Object, message_id: string}>}
   */
  async sendMessage({ to, type, subject, body, threadId, urgent, docRef, attachments }) {
    const payload = {
      from_agent_id: this.agentId,
      to_agent_id: to || null,
      message_type: type || 'info',
      subject,
      body,
      thread_id: threadId,
      urgent,
      doc_ref: docRef,
    };
    if (attachments?.length) payload.attachments = attachments;
    return this._request('/api/messages', 'POST', payload);
  }

  /**
   * Get inbox messages for this agent.
   * @param {Object} [params]
   * @param {string} [params.type] - Filter by message type
   * @param {boolean} [params.unread] - Only unread messages
   * @param {string} [params.threadId] - Filter by thread
   * @param {number} [params.limit=50] - Max messages to return
   * @returns {Promise<{messages: Object[], total: number, unread_count: number}>}
   */
  async getInbox({ type, unread, threadId, limit } = {}) {
    const params = new URLSearchParams({
      agent_id: this.agentId,
      direction: 'inbox',
    });
    if (type) params.set('type', type);
    if (unread) params.set('unread', 'true');
    if (threadId) params.set('thread_id', threadId);
    if (limit) params.set('limit', String(limit));
    return this._request(`/api/messages?${params}`, 'GET');
  }

  /**
   * Mark messages as read.
   * @param {string[]} messageIds - Array of message IDs to mark read
   * @returns {Promise<{updated: number}>}
   */
  async markRead(messageIds) {
    return this._request('/api/messages', 'PATCH', {
      message_ids: messageIds,
      action: 'read',
      agent_id: this.agentId,
    });
  }

  /**
   * Archive messages.
   * @param {string[]} messageIds - Array of message IDs to archive
   * @returns {Promise<{updated: number}>}
   */
  async archiveMessages(messageIds) {
    return this._request('/api/messages', 'PATCH', {
      message_ids: messageIds,
      action: 'archive',
      agent_id: this.agentId,
    });
  }

  /**
   * Broadcast a message to all agents in the organization.
   * @param {Object} params
   * @param {string} [params.type='info'] - Message type
   * @param {string} [params.subject] - Subject line
   * @param {string} params.body - Message body
   * @param {string} [params.threadId] - Thread ID
   * @returns {Promise<{message: Object, message_id: string}>}
   */
  async broadcast({ type, subject, body, threadId }) {
    return this.sendMessage({ to: null, type, subject, body, threadId });
  }

  /**
   * Create a new message thread for multi-turn conversations.
   * @param {Object} params
   * @param {string} params.name - Thread name
   * @param {string[]} [params.participants] - Agent IDs (null = open to all)
   * @returns {Promise<{thread: Object, thread_id: string}>}
   */
  async createMessageThread({ name, participants }) {
    return this._request('/api/messages/threads', 'POST', {
      name,
      participants,
      created_by: this.agentId,
    });
  }

  /**
   * List message threads.
   * @param {Object} [params]
   * @param {string} [params.status] - Filter by status: open|resolved|archived
   * @param {number} [params.limit=20] - Max threads to return
   * @returns {Promise<{threads: Object[], total: number}>}
   */
  async getMessageThreads({ status, limit } = {}) {
    const params = new URLSearchParams({ agent_id: this.agentId });
    if (status) params.set('status', status);
    if (limit) params.set('limit', String(limit));
    return this._request(`/api/messages/threads?${params}`, 'GET');
  }

  /**
   * Resolve (close) a message thread.
   * @param {string} threadId - Thread ID to resolve
   * @param {string} [summary] - Resolution summary
   * @returns {Promise<{thread: Object}>}
   */
  async resolveMessageThread(threadId, summary) {
    return this._request('/api/messages/threads', 'PATCH', {
      thread_id: threadId,
      status: 'resolved',
      summary,
    });
  }

  /**
   * Create or update a shared workspace document.
   * Upserts by (org_id, name). Updates increment the version.
   * @param {Object} params
   * @param {string} params.name - Document name (unique per org)
   * @param {string} params.content - Document content
   * @returns {Promise<{doc: Object, doc_id: string}>}
   */
  async saveSharedDoc({ name, content }) {
    return this._request('/api/messages/docs', 'POST', {
      name,
      content,
      agent_id: this.agentId,
    });
  }

  /**
   * Get an attachment's download URL or fetch its binary data.
   * @param {string} attachmentId - Attachment ID (att_*)
   * @returns {string} URL to fetch the attachment
   */
  getAttachmentUrl(attachmentId) {
    return `${this.baseUrl}/api/messages/attachments?id=${encodeURIComponent(attachmentId)}`;
  }

  /**
   * Download an attachment as a Buffer.
   * @param {string} attachmentId - Attachment ID (att_*)
   * @returns {Promise<{data: Buffer, filename: string, mimeType: string}>}
   */
  async getAttachment(attachmentId) {
    const url = this.getAttachmentUrl(attachmentId);
    const res = await fetch(url, {
      headers: { 'x-api-key': this.apiKey },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Attachment fetch failed: ${res.status}`);
    }
    const data = Buffer.from(await res.arrayBuffer());
    const cd = res.headers.get('content-disposition') || '';
    const match = cd.match(/filename="(.+?)"/);
    return {
      data,
      filename: match ? match[1] : attachmentId,
      mimeType: res.headers.get('content-type') || 'application/octet-stream',
    };
  }

  // ══════════════════════════════════════════════
  // Category 13: Policy Enforcement (Guard) (2 methods)
  // ══════════════════════════════════════════════

  /**
   * Enforce policies before a decision executes. Guard is the heart of DashClaw. It intercepts intent and returns allow/warn/block/require_approval.
   * @param {Object} context
   * @param {string} context.action_type - Action type (required)
   * @param {number} [context.risk_score] - Risk score 0-100
   * @param {string[]} [context.systems_touched] - Systems involved
   * @param {boolean} [context.reversible] - Whether the action is reversible
   * @param {string} [context.declared_goal] - What the action aims to do
   * @param {Object} [options]
   * @param {boolean} [options.includeSignals=false] - Include live signal warnings
   * @returns {Promise<{decision: string, reasons: string[], warnings: string[], matched_policies: string[], evaluated_at: string}>}
   */
  async guard(context, options = {}) {
    const params = new URLSearchParams();
    if (options.includeSignals) params.set('include_signals', 'true');
    const qs = params.toString();
    return this._request(`/api/guard${qs ? `?${qs}` : ''}`, 'POST', {
      ...context,
      agent_id: context.agent_id || this.agentId,
    });
  }

  /**
   * Get recent guard decisions (audit log).
   * @param {Object} [filters]
   * @param {string} [filters.decision] - Filter by decision: allow|warn|block|require_approval
   * @param {number} [filters.limit=20] - Max results
   * @param {number} [filters.offset=0] - Pagination offset
   * @returns {Promise<{decisions: Object[], total: number, stats: Object}>}
   */
  async getGuardDecisions(filters = {}) {
    const params = new URLSearchParams({ agent_id: this.agentId });
    if (filters.decision) params.set('decision', filters.decision);
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset) params.set('offset', String(filters.offset));
    return this._request(`/api/guard?${params}`, 'GET');
  }

  // ══════════════════════════════════════════════════════════
  // Category 14: Policy Testing (3 methods)
  // ══════════════════════════════════════════════════════════

  /**
   * Run guardrails tests against all active policies for this org.
   * @returns {Promise<{success: boolean, total_policies: number, total_tests: number, passed: number, failed: number, details: Object[]}>}
   */
  async testPolicies() {
    return this._request('/api/policies/test', 'POST', {
      agent_id: this.agentId,
    });
  }

  /**
   * Generate a compliance proof report from active policies.
   * @param {Object} [options]
   * @param {string} [options.format='json'] - 'json' or 'md'
   * @returns {Promise<Object|string>}
   */
  async getProofReport(options = {}) {
    const params = new URLSearchParams();
    if (options.format) params.set('format', options.format);
    return this._request(`/api/policies/proof?${params}`, 'GET');
  }

  /**
   * Import a policy pack or raw YAML into the org's guard policies.
   * Requires admin role.
   * @param {Object} options
   * @param {string} [options.pack] - Pack name: enterprise-strict, smb-safe, startup-growth, development
   * @param {string} [options.yaml] - Raw YAML string of policies to import
   * @returns {Promise<{imported: number, skipped: number, errors: string[], policies: Object[]}>}
   */
  async importPolicies({ pack, yaml } = {}) {
    return this._request('/api/policies/import', 'POST', { pack, yaml });
  }

  // ══════════════════════════════════════════════════════════
  // Category 15: Compliance Engine (5 methods)
  // ══════════════════════════════════════════════════════════

  /**
   * Map active policies to a compliance framework's controls.
   * @param {string} framework - Framework ID: soc2, iso27001, gdpr, nist-ai-rmf, imda-agentic
   * @returns {Promise<Object>} Compliance map with controls, coverage, and gaps
   */
  async mapCompliance(framework) {
    return this._request(`/api/compliance/map?framework=${encodeURIComponent(framework)}`, 'GET');
  }

  /**
   * Run gap analysis on a compliance framework mapping.
   * @param {string} framework - Framework ID
   * @returns {Promise<Object>} Gap analysis with remediation plan and risk assessment
   */
  async analyzeGaps(framework) {
    return this._request(`/api/compliance/gaps?framework=${encodeURIComponent(framework)}`, 'GET');
  }

  /**
   * Generate a full compliance report (markdown or JSON) and save a snapshot.
   * @param {string} framework - Framework ID
   * @param {Object} [options]
   * @param {string} [options.format='json'] - 'json' or 'md'
   * @returns {Promise<Object>}
   */
  async getComplianceReport(framework, options = {}) {
    const params = new URLSearchParams({ framework });
    if (options.format) params.set('format', options.format);
    return this._request(`/api/compliance/report?${params}`, 'GET');
  }

  /**
   * List available compliance frameworks.
   * @returns {Promise<{frameworks: Object[]}>}
   */
  async listFrameworks() {
    return this._request('/api/compliance/frameworks', 'GET');
  }

  /**
   * Get live compliance evidence from guard decisions and action records.
   * @param {Object} [options]
   * @param {string} [options.window='30d'] - Time window (e.g., '7d', '30d', '90d')
   * @returns {Promise<{evidence: Object}>}
   */
  async getComplianceEvidence(options = {}) {
    const params = new URLSearchParams();
    if (options.window) params.set('window', options.window);
    return this._request(`/api/compliance/evidence?${params}`, 'GET');
  }

  // ══════════════════════════════════════════════════════════
  // Category 16: Task Routing (10 methods)
  // ══════════════════════════════════════════════════════════

  /**
   * List routing agents registered in this org.
   * @param {Object} [filters]
   * @param {string} [filters.status] - Filter by status: available, busy, offline
   * @returns {Promise<{agents: Object[]}>}
   */
  async listRoutingAgents(filters = {}) {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    return this._request(`/api/routing/agents?${params}`, 'GET');
  }

  /**
   * Register an agent for task routing.
   * @param {Object} agent
   * @param {string} agent.name - Agent name
   * @param {Array} [agent.capabilities] - Skills/capabilities (strings or {skill, priority} objects)
   * @param {number} [agent.maxConcurrent=3] - Max concurrent tasks
   * @param {string} [agent.endpoint] - Webhook endpoint for task dispatch
   * @returns {Promise<{agent: Object}>}
   */
  async registerRoutingAgent(agent) {
    return this._request('/api/routing/agents', 'POST', agent);
  }

  /**
   * Get a single routing agent by ID.
   * @param {string} agentId - Routing agent ID
   * @returns {Promise<{agent: Object, metrics: Object[]}>}
   */
  async getRoutingAgent(agentId) {
    return this._request(`/api/routing/agents/${encodeURIComponent(agentId)}`, 'GET');
  }

  /**
   * Update routing agent status.
   * @param {string} agentId - Routing agent ID
   * @param {string} status - New status: available, busy, offline
   * @returns {Promise<{agent: Object}>}
   */
  async updateRoutingAgentStatus(agentId, status) {
    return this._request(`/api/routing/agents/${encodeURIComponent(agentId)}`, 'PATCH', { status });
  }

  /**
   * Unregister (delete) a routing agent.
   * @param {string} agentId - Routing agent ID
   * @returns {Promise<{deleted: Object}>}
   */
  async deleteRoutingAgent(agentId) {
    return this._request(`/api/routing/agents/${encodeURIComponent(agentId)}`, 'DELETE');
  }

  /**
   * List routing tasks with optional filters.
   * @param {Object} [filters]
   * @param {string} [filters.status] - Filter by status
   * @param {string} [filters.assignedTo] - Filter by assigned agent
   * @param {number} [filters.limit=50] - Max results
   * @returns {Promise<{tasks: Object[]}>}
   */
  async listRoutingTasks(filters = {}) {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.assignedTo) params.set('assigned_to', filters.assignedTo);
    if (filters.limit) params.set('limit', String(filters.limit));
    return this._request(`/api/routing/tasks?${params}`, 'GET');
  }

  /**
   * Submit a task for auto-routing to the best available agent.
   * @param {Object} task
   * @param {string} task.title - Task title
   * @param {string} [task.description] - Task description
   * @param {string[]} [task.requiredSkills] - Skills needed to complete this task
   * @param {string} [task.urgency='normal'] - Urgency: low, normal, high, critical
   * @param {number} [task.timeoutSeconds=3600] - Timeout in seconds
   * @param {number} [task.maxRetries=2] - Max retry attempts
   * @param {string} [task.callbackUrl] - Webhook URL for task completion callback
   * @returns {Promise<{task: Object, routing: Object}>}
   */
  async submitRoutingTask(task) {
    return this._request('/api/routing/tasks', 'POST', task);
  }

  /**
   * Complete a routing task.
   * @param {string} taskId - Task ID
   * @param {Object} [result]
   * @param {boolean} [result.success=true] - Whether task succeeded
   * @param {Object} [result.result] - Task result data
   * @param {string} [result.error] - Error message if failed
   * @returns {Promise<{task: Object, routing: Object}>}
   */
  async completeRoutingTask(taskId, result = {}) {
    return this._request(`/api/routing/tasks/${encodeURIComponent(taskId)}/complete`, 'POST', result);
  }

  /**
   * Get routing statistics for the org.
   * @returns {Promise<{agents: Object, tasks: Object, routing: Object}>}
   */
  async getRoutingStats() {
    return this._request('/api/routing/stats', 'GET');
  }

  /**
   * Get routing system health status.
   * @returns {Promise<{status: string, agents: Object, tasks: Object}>}
   */
  async getRoutingHealth() {
    return this._request('/api/routing/health', 'GET');
  }

  // ══════════════════════════════════════════════════════════
  // Agent Pairing (3 methods)
  // ══════════════════════════════════════════════════════════

  // createPairing, createPairingFromPrivateJwk, waitForPairing
  // (defined near the top of the class)

  // ══════════════════════════════════════════════════════════
  // Identity Binding (2 methods)
  // ══════════════════════════════════════════════════════════

  /**
   * Register or update an agent's public key for identity verification.
   * Requires admin API key.
   * @param {Object} identity
   * @param {string} identity.agent_id - Agent ID to register
   * @param {string} identity.public_key - PEM public key (SPKI format)
   * @param {string} [identity.algorithm='RSASSA-PKCS1-v1_5'] - Signing algorithm
   * @returns {Promise<{identity: Object}>}
   */
  async registerIdentity(identity) {
    return this._request('/api/identities', 'POST', identity);
  }

  /**
   * List all registered agent identities for this org.
   * @returns {Promise<{identities: Object[]}>}
   */
  async getIdentities() {
    return this._request('/api/identities', 'GET');
  }

  // ══════════════════════════════════════════════════════════
  // Organization Management (5 methods)
  // ══════════════════════════════════════════════════════════

  /**
   * Get the current organization's details. Requires admin API key.
   * @returns {Promise<{organizations: Object[]}>}
   */
  async getOrg() {
    return this._request('/api/orgs', 'GET');
  }

  /**
   * Create a new organization with an initial admin API key. Requires admin API key.
   * @param {Object} org
   * @param {string} org.name - Organization name
   * @param {string} org.slug - URL-safe slug (lowercase alphanumeric + hyphens)
   * @returns {Promise<{organization: Object, api_key: Object}>}
   */
  async createOrg(org) {
    return this._request('/api/orgs', 'POST', org);
  }

  /**
   * Get organization details by ID. Requires admin API key.
   * @param {string} orgId - Organization ID
   * @returns {Promise<{organization: Object}>}
   */
  async getOrgById(orgId) {
    return this._request(`/api/orgs/${encodeURIComponent(orgId)}`, 'GET');
  }

  /**
   * Update organization details. Requires admin API key.
   * @param {string} orgId - Organization ID
   * @param {Object} updates - Fields to update (name, slug)
   * @returns {Promise<{organization: Object}>}
   */
  async updateOrg(orgId, updates) {
    return this._request(`/api/orgs/${encodeURIComponent(orgId)}`, 'PATCH', updates);
  }

  /**
   * List API keys for an organization. Requires admin API key.
   * @param {string} orgId - Organization ID
   * @returns {Promise<{keys: Object[]}>}
   */
  async getOrgKeys(orgId) {
    return this._request(`/api/orgs/${encodeURIComponent(orgId)}/keys`, 'GET');
  }

  // ══════════════════════════════════════════════════════════
  // Activity Logs (1 method)
  // ══════════════════════════════════════════════════════════

  /**
   * Get activity/audit logs for the organization.
   * @param {Object} [filters]
   * @param {string} [filters.action] - Filter by action type
   * @param {string} [filters.actor_id] - Filter by actor
   * @param {string} [filters.resource_type] - Filter by resource type
   * @param {string} [filters.before] - Before timestamp (ISO string)
   * @param {string} [filters.after] - After timestamp (ISO string)
   * @param {number} [filters.limit=50] - Max results (max 200)
   * @param {number} [filters.offset=0] - Pagination offset
   * @returns {Promise<{logs: Object[], stats: Object, pagination: Object}>}
   */
  async getActivityLogs(filters = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    }
    return this._request(`/api/activity?${params}`, 'GET');
  }

  // ══════════════════════════════════════════════════════════
  // Webhooks (5 methods)
  // ══════════════════════════════════════════════════════════

  /**
   * List all webhooks for this org.
   * @returns {Promise<{webhooks: Object[]}>}
   */
  async getWebhooks() {
    return this._request('/api/webhooks', 'GET');
  }

  /**
   * Create a new webhook subscription.
   * @param {Object} webhook
   * @param {string} webhook.url - Webhook endpoint URL
   * @param {string[]} [webhook.events] - Event types to subscribe to
   * @returns {Promise<{webhook: Object}>}
   */
  async createWebhook(webhook) {
    return this._request('/api/webhooks', 'POST', webhook);
  }

  /**
   * Delete a webhook.
   * @param {string} webhookId - Webhook ID
   * @returns {Promise<{deleted: boolean}>}
   */
  async deleteWebhook(webhookId) {
    return this._request(`/api/webhooks?id=${encodeURIComponent(webhookId)}`, 'DELETE');
  }

  /**
   * Send a test event to a webhook.
   * @param {string} webhookId - Webhook ID
   * @returns {Promise<{delivery: Object}>}
   */
  async testWebhook(webhookId) {
    return this._request(`/api/webhooks/${encodeURIComponent(webhookId)}/test`, 'POST');
  }

  /**
   * Get delivery history for a webhook.
   * @param {string} webhookId - Webhook ID
   * @returns {Promise<{deliveries: Object[]}>}
   */
  async getWebhookDeliveries(webhookId) {
    return this._request(`/api/webhooks/${encodeURIComponent(webhookId)}/deliveries`, 'GET');
  }

  // ─── Bulk Sync ────────────────────────────────────────────

  /**
   * Sync multiple data categories in a single request.
   * Every key is optional. Only provided categories are processed.
   * @param {Object} state - Data to sync (connections, memory, goals, learning, content, inspiration, context_points, context_threads, handoffs, preferences, snippets)
   * @returns {Promise<{results: Object, total_synced: number, total_errors: number, duration_ms: number}>}
   */
  async syncState(state) {
    return this._request('/api/sync', 'POST', {
      agent_id: this.agentId,
      ...state,
    });
  }

  // ----------------------------------------------
  // Category: Evaluations
  // ----------------------------------------------

  /**
   * Create an evaluation score for an action.
   * @param {Object} params
   * @param {string} params.actionId - Action record ID
   * @param {string} params.scorerName - Name of the scorer
   * @param {number} params.score - Score between 0.0 and 1.0
   * @param {string} [params.label] - Category label (e.g., 'correct', 'incorrect')
   * @param {string} [params.reasoning] - Explanation of the score
   * @param {string} [params.evaluatedBy] - 'auto', 'human', or 'llm_judge'
   * @param {Object} [params.metadata] - Additional metadata
   * @returns {Promise<Object>}
   */
  async createScore({ actionId, scorerName, score, label, reasoning, evaluatedBy, metadata }) {
    return this._request('/api/evaluations', 'POST', {
      action_id: actionId,
      scorer_name: scorerName,
      score,
      label,
      reasoning,
      evaluated_by: evaluatedBy,
      metadata,
    });
  }

  /**
   * List evaluation scores with optional filters.
   * @param {Object} [filters] - { action_id, scorer_name, evaluated_by, min_score, max_score, limit, offset, agent_id }
   * @returns {Promise<{ scores: Object[], total: number }>}
   */
  async getScores(filters = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    }
    return this._request(`/api/evaluations?${params}`, 'GET');
  }

  /**
   * Create a reusable scorer definition.
   * @param {Object} params
   * @param {string} params.name - Scorer name (unique per org)
   * @param {string} params.scorerType - 'regex', 'contains', 'numeric_range', 'custom_function', or 'llm_judge'
   * @param {Object} params.config - Scorer configuration
   * @param {string} [params.description] - Description
   * @returns {Promise<Object>}
   */
  async createScorer({ name, scorerType, config, description }) {
    return this._request('/api/evaluations/scorers', 'POST', {
      name,
      scorer_type: scorerType,
      config,
      description,
    });
  }

  /**
   * List all scorers for this org.
   * @returns {Promise<{ scorers: Object[], llm_available: boolean }>}
   */
  async getScorers() {
    return this._request('/api/evaluations/scorers', 'GET');
  }

  /**
   * Update a scorer.
   * @param {string} scorerId
   * @param {Object} updates - { name?, description?, config? }
   * @returns {Promise<Object>}
   */
  async updateScorer(scorerId, updates) {
    return this._request(`/api/evaluations/scorers/${scorerId}`, 'PATCH', updates);
  }

  /**
   * Delete a scorer.
   * @param {string} scorerId
   * @returns {Promise<Object>}
   */
  async deleteScorer(scorerId) {
    return this._request(`/api/evaluations/scorers/${scorerId}`, 'DELETE');
  }

  /**
   * Create and start an evaluation run.
   * @param {Object} params
   * @param {string} params.name - Run name
   * @param {string} params.scorerId - Scorer to use
   * @param {Object} [params.actionFilters] - Filters for which actions to evaluate
   * @returns {Promise<Object>}
   */
  async createEvalRun({ name, scorerId, actionFilters }) {
    return this._request('/api/evaluations/runs', 'POST', {
      name,
      scorer_id: scorerId,
      action_filters: actionFilters,
    });
  }

  /**
   * List evaluation runs.
   * @param {Object} [filters] - { status, limit, offset }
   * @returns {Promise<{ runs: Object[] }>}
   */
  async getEvalRuns(filters = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    }
    return this._request(`/api/evaluations/runs?${params}`, 'GET');
  }

  /**
   * Get details of an evaluation run.
   * @param {string} runId
   * @returns {Promise<{ run: Object, distribution: Object[] }>}
   */
  async getEvalRun(runId) {
    return this._request(`/api/evaluations/runs/${runId}`, 'GET');
  }

  /**
   * Get aggregate evaluation statistics.
   * @param {Object} [filters] - { agent_id, scorer_name, days }
   * @returns {Promise<Object>}
   */
  async getEvalStats(filters = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    }
    return this._request(`/api/evaluations/stats?${params}`, 'GET');
  }

  // -----------------------------------------------
  // Prompt Management
  // -----------------------------------------------

  async listPromptTemplates({ category } = {}) {
    const params = category ? `?category=${encodeURIComponent(category)}` : '';
    return this._request(`/api/prompts/templates${params}`, 'GET');
  }

  async createPromptTemplate({ name, description, category }) {
    return this._request('/api/prompts/templates', 'POST', { name, description, category });
  }

  async getPromptTemplate(templateId) {
    return this._request(`/api/prompts/templates/${templateId}`, 'GET');
  }

  async updatePromptTemplate(templateId, fields) {
    return this._request(`/api/prompts/templates/${templateId}`, 'PATCH', fields);
  }

  async deletePromptTemplate(templateId) {
    return this._request(`/api/prompts/templates/${templateId}`, 'DELETE');
  }

  async listPromptVersions(templateId) {
    return this._request(`/api/prompts/templates/${templateId}/versions`, 'GET');
  }

  async createPromptVersion(templateId, { content, model_hint, parameters, changelog }) {
    return this._request(`/api/prompts/templates/${templateId}/versions`, 'POST', { content, model_hint, parameters, changelog });
  }

  async getPromptVersion(templateId, versionId) {
    return this._request(`/api/prompts/templates/${templateId}/versions/${versionId}`, 'GET');
  }

  async activatePromptVersion(templateId, versionId) {
    return this._request(`/api/prompts/templates/${templateId}/versions/${versionId}`, 'POST');
  }

  async renderPrompt({ template_id, version_id, variables, action_id, agent_id, record }) {
    return this._request('/api/prompts/render', 'POST', { template_id, version_id, variables, action_id, agent_id, record });
  }

  async listPromptRuns({ template_id, version_id, limit } = {}) {
    const params = new URLSearchParams();
    if (template_id) params.set('template_id', template_id);
    if (version_id) params.set('version_id', version_id);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this._request(`/api/prompts/runs${qs}`, 'GET');
  }

  async getPromptStats({ template_id } = {}) {
    const params = template_id ? `?template_id=${encodeURIComponent(template_id)}` : '';
    return this._request(`/api/prompts/stats${params}`, 'GET');
  }

  // -----------------------------------------------
  // User Feedback
  // -----------------------------------------------

  async submitFeedback({ action_id, agent_id, rating, comment, category, tags, metadata }) {
    return this._request('/api/feedback', 'POST', { action_id, agent_id, rating, comment, category, tags, metadata, source: 'sdk' });
  }

  async listFeedback({ action_id, agent_id, category, sentiment, resolved, limit, offset } = {}) {
    const params = new URLSearchParams();
    if (action_id) params.set('action_id', action_id);
    if (agent_id) params.set('agent_id', agent_id);
    if (category) params.set('category', category);
    if (sentiment) params.set('sentiment', sentiment);
    if (resolved !== undefined) params.set('resolved', String(resolved));
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this._request(`/api/feedback${qs}`, 'GET');
  }

  async getFeedback(feedbackId) {
    return this._request(`/api/feedback/${feedbackId}`, 'GET');
  }

  async resolveFeedback(feedbackId) {
    return this._request(`/api/feedback/${feedbackId}`, 'PATCH', { resolved_by: 'sdk' });
  }

  async deleteFeedback(feedbackId) {
    return this._request(`/api/feedback/${feedbackId}`, 'DELETE');
  }

  async getFeedbackStats({ agent_id } = {}) {
    const params = agent_id ? `?agent_id=${encodeURIComponent(agent_id)}` : '';
    return this._request(`/api/feedback/stats${params}`, 'GET');
  }

  // -----------------------------------------------
  // Compliance Export
  // -----------------------------------------------

  async createComplianceExport({ name, frameworks, format, window_days, include_evidence, include_remediation, include_trends }) {
    return this._request('/api/compliance/exports', 'POST', { name, frameworks, format, window_days, include_evidence, include_remediation, include_trends });
  }

  async listComplianceExports({ limit } = {}) {
    const params = limit ? `?limit=${limit}` : '';
    return this._request(`/api/compliance/exports${params}`, 'GET');
  }

  async getComplianceExport(exportId) {
    return this._request(`/api/compliance/exports/${exportId}`, 'GET');
  }

  async downloadComplianceExport(exportId) {
    return this._request(`/api/compliance/exports/${exportId}/download`, 'GET');
  }

  async deleteComplianceExport(exportId) {
    return this._request(`/api/compliance/exports/${exportId}`, 'DELETE');
  }

  async createComplianceSchedule({ name, frameworks, format, window_days, cron_expression, include_evidence, include_remediation, include_trends }) {
    return this._request('/api/compliance/schedules', 'POST', { name, frameworks, format, window_days, cron_expression, include_evidence, include_remediation, include_trends });
  }

  async listComplianceSchedules() {
    return this._request('/api/compliance/schedules', 'GET');
  }

  async updateComplianceSchedule(scheduleId, fields) {
    return this._request(`/api/compliance/schedules/${scheduleId}`, 'PATCH', fields);
  }

  async deleteComplianceSchedule(scheduleId) {
    return this._request(`/api/compliance/schedules/${scheduleId}`, 'DELETE');
  }

  async getComplianceTrends({ framework, limit } = {}) {
    const params = new URLSearchParams();
    if (framework) params.set('framework', framework);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this._request(`/api/compliance/trends${qs}`, 'GET');
  }

  // -----------------------------------------------
  // Drift Detection
  // -----------------------------------------------

  async computeDriftBaselines({ agent_id, lookback_days } = {}) {
    return this._request('/api/drift/alerts', 'POST', { action: 'compute_baselines', agent_id, lookback_days });
  }

  async detectDrift({ agent_id, window_days } = {}) {
    return this._request('/api/drift/alerts', 'POST', { action: 'detect', agent_id, window_days });
  }

  async recordDriftSnapshots() {
    return this._request('/api/drift/alerts', 'POST', { action: 'record_snapshots' });
  }

  async listDriftAlerts({ agent_id, severity, acknowledged, limit } = {}) {
    const params = new URLSearchParams();
    if (agent_id) params.set('agent_id', agent_id);
    if (severity) params.set('severity', severity);
    if (acknowledged !== undefined) params.set('acknowledged', String(acknowledged));
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this._request(`/api/drift/alerts${qs}`, 'GET');
  }

  async acknowledgeDriftAlert(alertId) {
    return this._request(`/api/drift/alerts/${alertId}`, 'PATCH');
  }

  async deleteDriftAlert(alertId) {
    return this._request(`/api/drift/alerts/${alertId}`, 'DELETE');
  }

  async getDriftStats({ agent_id } = {}) {
    const params = agent_id ? `?agent_id=${encodeURIComponent(agent_id)}` : '';
    return this._request(`/api/drift/stats${params}`, 'GET');
  }

  async getDriftSnapshots({ agent_id, metric, limit } = {}) {
    const params = new URLSearchParams();
    if (agent_id) params.set('agent_id', agent_id);
    if (metric) params.set('metric', metric);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this._request(`/api/drift/snapshots${qs}`, 'GET');
  }

  async getDriftMetrics() {
    return this._request('/api/drift/metrics', 'GET');
  }
}

/**
 * Error thrown when guardMode is 'enforce' and guard blocks an action.
 */
class GuardBlockedError extends Error {
  /**
   * @param {Object} decision - Guard decision object
   */
  constructor(decision) {
    const reasons = (decision.reasons || []).join('; ') || 'no reason';
    super(`Guard blocked action: ${decision.decision}. Reasons: ${reasons}`);
    this.name = 'GuardBlockedError';
    this.decision = decision.decision;
    this.reasons = decision.reasons || [];
    this.warnings = decision.warnings || [];
    this.matchedPolicies = decision.matched_policies || [];
    this.riskScore = decision.risk_score ?? null;
  }
}

/**
 * Error thrown when a human operator denies an action.
 */
class ApprovalDeniedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ApprovalDeniedError';
  }
}

// Backward compatibility alias (Legacy)
const OpenClawAgent = DashClaw;

export default DashClaw;
export { DashClaw, OpenClawAgent, GuardBlockedError, ApprovalDeniedError };
