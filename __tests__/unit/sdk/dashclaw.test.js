import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DashClaw, ApprovalDeniedError, GuardBlockedError } from '../../../sdk/dashclaw.js';

/**
 * Characterization tests for sdk/dashclaw.js internals and the thin public
 * wrapper methods. Written against the PRE-refactor file and kept green
 * through the structural refactor — these pin observable behavior:
 *   - _request URL construction (exact param order), headers, body, and
 *     error normalization (GuardBlockedError, reason>error>status priority).
 *   - _connectSSE line buffering / event dispatch via waitForApproval.
 *   - waitForApproval decision paths (SSE resolve/deny, polling fallback,
 *     pending-state transitions, timeout, banner printed once).
 *   - A representative sample of public wrappers asserting the exact URL,
 *     HTTP method, and JSON body each produces.
 */

function mockJSON(data = {}, ok = true, status = 200) {
  return { ok, status, json: async () => data };
}

function sseResponseFromChunks(chunks) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      pull(controller) {
        if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
        else controller.close();
      },
    }),
  };
}

function makeClaw(extra = {}) {
  return new DashClaw({
    baseUrl: 'http://localhost:3000',
    apiKey: 'test-key',
    agentId: 'test-agent',
    ...extra,
  });
}

describe('sdk/dashclaw.js characterization', () => {
  let claw;

  beforeEach(() => {
    claw = makeClaw();
    global.fetch = vi.fn().mockResolvedValue(mockJSON({ ok: true }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // _request — URL building, headers, parsing, error normalization
  // -------------------------------------------------------------------------

  describe('_request', () => {
    it('builds the exact URL preserving query param insertion order', async () => {
      await claw.getPendingApprovals();
      expect(global.fetch.mock.calls[0][0]).toBe(
        'http://localhost:3000/api/actions?status=pending_approval&limit=20&offset=0'
      );
    });

    it('omits the query string entirely when params are empty', async () => {
      await claw.listSessions({});
      expect(global.fetch.mock.calls[0][0]).toBe('http://localhost:3000/api/sessions');
    });

    it('skips undefined/null params but keeps 0, false, and empty string', async () => {
      await claw._request('/api/things', 'GET', null, {
        a: 'x', b: undefined, c: null, d: 0, e: false, f: '',
      });
      expect(global.fetch.mock.calls[0][0]).toBe(
        'http://localhost:3000/api/things?a=x&d=0&e=false&f='
      );
    });

    it('sends Content-Type and x-api-key headers, no Authorization without authToken', async () => {
      await claw.getSignals();
      const headers = global.fetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['x-api-key']).toBe('test-key');
      expect(headers.Authorization).toBeUndefined();
    });

    it('sends Authorization: Bearer when authToken is configured', async () => {
      const authed = makeClaw({ authToken: 'jwt-token' });
      await authed.getSignals();
      const headers = global.fetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer jwt-token');
      expect(headers['x-api-key']).toBe('test-key');
    });

    it('sends undefined body for GET and serialized JSON for POST', async () => {
      await claw.getSignals();
      expect(global.fetch.mock.calls[0][1].body).toBeUndefined();
      await claw.recordAssumption({ assumption: 'x' });
      expect(global.fetch.mock.calls[1][1].body).toBe(JSON.stringify({ assumption: 'x' }));
    });

    it('returns the parsed JSON payload on success', async () => {
      global.fetch = vi.fn().mockResolvedValue(mockJSON({ result: 42 }));
      await expect(claw.getSignals()).resolves.toEqual({ result: 42 });
    });

    it('returns {} when a 2xx response has a non-JSON body', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('not json'); },
      });
      await expect(claw.getSignals()).resolves.toEqual({});
    });

    it('throws GuardBlockedError on 403 with a block decision', async () => {
      const decision = { decision: 'block', reason: 'Spend cap exceeded' };
      global.fetch = vi.fn().mockResolvedValue(mockJSON({ decision }, false, 403));
      const err = await claw.guard({ action_type: 'pay' }).catch((e) => e);
      expect(err).toBeInstanceOf(GuardBlockedError);
      expect(err.message).toBe('Spend cap exceeded');
      expect(err.decision).toEqual(decision);
    });

    it('throws a plain status error on 403 when the decision is not block', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockJSON({ decision: { decision: 'warn' }, error: 'nope' }, false, 403)
      );
      const err = await claw.guard({ action_type: 'pay' }).catch((e) => e);
      expect(err).not.toBeInstanceOf(GuardBlockedError);
      expect(err.message).toBe('nope');
      expect(err.status).toBe(403);
    });

    it('prioritizes reason over error over generic status message', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockJSON({ reason: 'policy says no', error: 'generic' }, false, 422)
      );
      await expect(claw.getSignals()).rejects.toThrow('policy says no');

      global.fetch = vi.fn().mockResolvedValue(mockJSON({ error: 'generic' }, false, 422));
      await expect(claw.getSignals()).rejects.toThrow('generic');

      global.fetch = vi.fn().mockResolvedValue(mockJSON({}, false, 500));
      await expect(claw.getSignals()).rejects.toThrow('Request failed with status 500');
    });

    it('attaches status, details, and the full body as decision to thrown errors', async () => {
      const body = { error: 'bad', details: { field: 'x' } };
      global.fetch = vi.fn().mockResolvedValue(mockJSON(body, false, 422));
      const err = await claw.getSignals().catch((e) => e);
      expect(err.status).toBe(422);
      expect(err.details).toEqual({ field: 'x' });
      expect(err.decision).toEqual(body);
    });

    it('surfaces the HTTP status even when the error body is not JSON', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 504,
        json: async () => { throw new SyntaxError("Unexpected token '<'"); },
      });
      await expect(claw.getSignals()).rejects.toMatchObject({
        status: 504,
        message: 'Request failed with status 504',
      });
    });
  });

  // -------------------------------------------------------------------------
  // guard — agent_name stamping
  // -------------------------------------------------------------------------

  describe('guard agent_name stamping', () => {
    it('stamps the constructor agentName when context omits agent_name', async () => {
      const named = makeClaw({ agentName: 'Friendly Bot' });
      await named.guard({ action_type: 'x' });
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.agent_name).toBe('Friendly Bot');
      expect(body.agent_id).toBe('test-agent');
    });

    it('preserves an explicit agent_name from the caller', async () => {
      const named = makeClaw({ agentName: 'Friendly Bot' });
      await named.guard({ action_type: 'x', agent_name: 'Override' });
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.agent_name).toBe('Override');
    });
  });

  // -------------------------------------------------------------------------
  // _connectSSE — line buffering and event dispatch (via waitForApproval)
  // -------------------------------------------------------------------------

  describe('SSE parsing via waitForApproval', () => {
    let stdoutSpy;

    beforeEach(() => {
      stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    it('reassembles frames split across chunks, skipping heartbeats and incomplete frames', async () => {
      const sse = sseResponseFromChunks([
        ': heartbeat\n\n',
        'event: connected\n\n', // event without data — never yielded
        'id: evt_1\nev',
        'ent: action.updated\ndata: {"action_id":"act_123","app',
        'roved_by":"usr_1","status":"running"}\n\n',
      ]);
      global.fetch = vi.fn()
        .mockResolvedValueOnce(sse)
        .mockResolvedValueOnce(mockJSON({ action: { action_id: 'act_123', approved_by: 'usr_1' } }));

      const result = await claw.waitForApproval('act_123', { timeout: 5000 });
      expect(result.action.approved_by).toBe('usr_1');
      // SSE resolve path confirms via GET before returning
      expect(global.fetch.mock.calls[1][0]).toBe('http://localhost:3000/api/actions/act_123');
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('uses x-api-key but NOT Content-Type on the SSE request', async () => {
      const sse = sseResponseFromChunks([
        'event: action.updated\ndata: {"action_id":"act_123","approved_by":"u"}\n\n',
      ]);
      global.fetch = vi.fn()
        .mockResolvedValueOnce(sse)
        .mockResolvedValueOnce(mockJSON({ action: { approved_by: 'u' } }));
      await claw.waitForApproval('act_123', { timeout: 5000 });
      const [url, opts] = global.fetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/stream');
      expect(opts.headers['x-api-key']).toBe('test-key');
      expect(opts.headers['Content-Type']).toBeUndefined();
    });

    it('throws GuardBlockedError when the SSE stream itself is policy-blocked (403)', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockJSON({ decision: { reason: 'stream blocked' } }, false, 403)
      );
      await expect(claw.waitForApproval('act_123', { timeout: 5000 }))
        .rejects.toThrow(GuardBlockedError);
    });

    it('throws ApprovalDeniedError when SSE reports cancellation', async () => {
      const sse = sseResponseFromChunks([
        'event: action.updated\ndata: {"action_id":"act_123","status":"cancelled","error_message":"Denied"}\n\n',
      ]);
      global.fetch = vi.fn().mockResolvedValueOnce(sse);
      await expect(claw.waitForApproval('act_123', { timeout: 5000 }))
        .rejects.toThrow(ApprovalDeniedError);
    });
  });

  // -------------------------------------------------------------------------
  // waitForApproval — polling fallback decision paths
  // -------------------------------------------------------------------------

  describe('waitForApproval polling fallback', () => {
    let stdoutSpy;

    beforeEach(() => {
      stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    it('falls back to polling when the SSE stream closes unresolved', async () => {
      const sse = sseResponseFromChunks([': heartbeat\n\n']); // closes with no events
      global.fetch = vi.fn()
        .mockResolvedValueOnce(sse)
        .mockResolvedValueOnce(mockJSON({ action: { action_id: 'act_123', status: 'running', approved_by: 'usr_1' } }));
      const result = await claw.waitForApproval('act_123', { timeout: 5000, interval: 10 });
      expect(result.action.approved_by).toBe('usr_1');
    });

    it('resolves with the FULL GET response (not just { action }) when polling', async () => {
      const full = {
        action: { action_id: 'act_123', status: 'running', approved_by: 'usr_1' },
        open_loops: [{ id: 'loop_1' }],
        assumptions: [],
      };
      global.fetch = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockJSON(full));
      const result = await claw.waitForApproval('act_123', { timeout: 5000, interval: 10 });
      expect(result).toEqual(full);
    });

    it('prints the approval banner exactly once across multiple polls', async () => {
      global.fetch = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockJSON({ action: { action_id: 'act_123', status: 'pending_approval' } }))
        .mockResolvedValueOnce(mockJSON({ action: { action_id: 'act_123', status: 'pending_approval' } }))
        .mockResolvedValueOnce(mockJSON({ action: { action_id: 'act_123', status: 'running', approved_by: 'usr_1' } }));
      await claw.waitForApproval('act_123', { timeout: 5000, interval: 5 });
      const bannerWrites = stdoutSpy.mock.calls.filter(([s]) =>
        String(s).includes('DashClaw Approval Required'));
      expect(bannerWrites).toHaveLength(1);
      expect(String(bannerWrites[0][0])).toContain('act_123');
    });

    it('returns immediately when the action is already running and never pending', async () => {
      global.fetch = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockJSON({ action: { action_id: 'act_123', status: 'running' } }));
      const result = await claw.waitForApproval('act_123', { timeout: 5000, interval: 10 });
      expect(result.action.status).toBe('running');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('throws ApprovalDeniedError when polling sees failed/cancelled', async () => {
      global.fetch = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockJSON({ action: { action_id: 'act_123', status: 'failed', error_message: 'Denied by ops' } }));
      const err = await claw.waitForApproval('act_123', { timeout: 5000, interval: 10 }).catch((e) => e);
      expect(err).toBeInstanceOf(ApprovalDeniedError);
      expect(err.message).toBe('Denied by ops');
      expect(err.decision).toBe('failed');
    });

    it('throws when the action leaves pending_approval without approval metadata', async () => {
      global.fetch = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockJSON({ action: { action_id: 'act_123', status: 'pending_approval' } }))
        .mockResolvedValueOnce(mockJSON({ action: { action_id: 'act_123', status: 'completed' } }));
      await expect(claw.waitForApproval('act_123', { timeout: 5000, interval: 5 }))
        .rejects.toThrow(/left pending_approval state without explicit approval metadata \(Status: completed\)/);
    });

    it('times out when the action stays pending', async () => {
      global.fetch = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue(mockJSON({ action: { action_id: 'act_123', status: 'pending_approval' } }));
      await expect(claw.waitForApproval('act_123', { timeout: 60, interval: 15 }))
        .rejects.toThrow('Timed out waiting for approval of action act_123');
    });
  });

  // -------------------------------------------------------------------------
  // Public wrapper matrix — exact URL + method + body for thin _request wrappers
  // -------------------------------------------------------------------------

  describe('public wrapper methods produce exact URL/method/body', () => {
    // [name, invoke, method, path (relative), expected JSON body or undefined]
    const CASES = [
      // actions / approvals
      ['getAction', (c) => c.getAction('act_1'), 'GET', '/api/actions/act_1', undefined],
      ['approveAction with reasoning', (c) => c.approveAction('act_1', 'allow', 'looks safe'), 'POST',
        '/api/actions/act_1/approve', { decision: 'allow', reasoning: 'looks safe' }],
      ['approveAction without reasoning', (c) => c.approveAction('act_1', 'deny'), 'POST',
        '/api/actions/act_1/approve', { decision: 'deny' }],
      ['getActionGraph', (c) => c.getActionGraph('act_1'), 'GET', '/api/actions/act_1/graph', undefined],
      // sessions
      ['createSession with explicit args', (c) => c.createSession('agent-2', '/ws', 'main'), 'POST',
        '/api/sessions', { agent_id: 'agent-2', workspace: '/ws', branch: 'main' }],
      ['createSession defaults agent and null branch', (c) => c.createSession(undefined, '/ws'), 'POST',
        '/api/sessions', { agent_id: 'test-agent', workspace: '/ws', branch: null }],
      ['getSession', (c) => c.getSession('ses_1'), 'GET', '/api/sessions/ses_1', undefined],
      ['updateSession', (c) => c.updateSession('ses_1', { status: 'done' }), 'PATCH', '/api/sessions/ses_1', { status: 'done' }],
      ['listSessions', (c) => c.listSessions({ agent_id: 'a', limit: 1 }), 'GET', '/api/sessions?agent_id=a&limit=1', undefined],
      ['getSessionEvents', (c) => c.getSessionEvents('ses_1'), 'GET', '/api/sessions/ses_1/events', undefined],
      // policies
      ['simulatePolicy omits days when not given', (c) => c.simulatePolicy({ policy_type: 'cost', rules: { max: 5 } }),
        'POST', '/api/policies/simulate', { policy_type: 'cost', rules: { max: 5 } }],
      ['simulatePolicy includes days when given', (c) => c.simulatePolicy({ policy_type: 'cost', rules: {}, days: 7 }),
        'POST', '/api/policies/simulate', { policy_type: 'cost', rules: {}, days: 7 }],
    ];

    for (const [name, call, method, path, body] of CASES) {
      it(`${name} → ${method} ${path}`, async () => {
        await call(claw);
        const [url, opts] = global.fetch.mock.calls[0];
        expect(url).toBe(`http://localhost:3000${path}`);
        expect(opts.method).toBe(method);
        if (body === undefined) {
          expect(opts.body).toBeUndefined();
        } else {
          expect(JSON.parse(opts.body)).toEqual(body);
        }
      });
    }
  });

});
