import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashClaw, ApprovalDeniedError, GuardBlockedError } from '../../sdk/dashclaw.js';

/**
 * Unit tests for the v2 SDK surface (sdk/dashclaw.js).
 * Every public method is tested for correct URL, HTTP method, body, and query params.
 * waitForApproval is covered separately in hitl.test.js.
 */

function mockFetch(data = {}, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => data,
  });
}

describe('DashClaw v2 SDK', () => {
  let claw;

  beforeEach(() => {
    claw = new DashClaw({
      baseUrl: 'http://localhost:3000',
      apiKey: 'test-key',
      agentId: 'test-agent',
    });
    global.fetch = mockFetch({ ok: true });
  });

  // --- Constructor ---

  describe('constructor', () => {
    it('throws if baseUrl is missing', () => {
      expect(() => new DashClaw({ apiKey: 'k', agentId: 'a' })).toThrow('baseUrl is required');
    });

    it('throws if apiKey is missing', () => {
      expect(() => new DashClaw({ baseUrl: 'http://x', agentId: 'a' })).toThrow('apiKey is required');
    });

    it('throws if agentId is missing', () => {
      expect(() => new DashClaw({ baseUrl: 'http://x', apiKey: 'k' })).toThrow('agentId is required');
    });

    it('strips trailing slash from baseUrl', () => {
      const c = new DashClaw({ baseUrl: 'http://x/', apiKey: 'k', agentId: 'a' });
      expect(c.baseUrl).toBe('http://x');
    });

    it('exposes canonical execution.capabilities namespace', () => {
      expect(typeof claw.execution.capabilities.list).toBe('function');
      expect(typeof claw.execution.capabilities.create).toBe('function');
      expect(typeof claw.execution.capabilities.get).toBe('function');
      expect(typeof claw.execution.capabilities.update).toBe('function');
      expect(typeof claw.execution.capabilities.invoke).toBe('function');
      expect(typeof claw.execution.capabilities.listHealth).toBe('function');
      expect(typeof claw.execution.capabilities.getHistory).toBe('function');
    });
  });

  // --- _request internals ---

  describe('_request', () => {
    it('sends x-api-key header', async () => {
      await claw.guard({ action_type: 'test' });
      const [, opts] = fetch.mock.calls[0];
      expect(opts.headers['x-api-key']).toBe('test-key');
    });

    it('drops undefined/null query params but keeps falsy-but-valid values', async () => {
      // Regression: a caller passing { status: undefined } must not send the
      // literal string "status=undefined", which the routes match against and
      // get zero rows. 0/false/'' are valid filter values and are preserved.
      global.fetch = mockFetch({ ok: true });
      await claw._request('/api/things', 'GET', null, {
        agent_id: 'a1',
        status: undefined,
        cursor: null,
        limit: 0,
        active: false,
      });
      const [url] = fetch.mock.calls[0];
      expect(url).toContain('agent_id=a1');
      expect(url).toContain('limit=0');
      expect(url).toContain('active=false');
      expect(url).not.toContain('status');
      expect(url).not.toContain('cursor');
      expect(url).not.toContain('undefined');
    });

    it('surfaces the HTTP status on a non-JSON error body instead of a SyntaxError', async () => {
      // A Vercel 502/504/413/429 gateway response is not JSON, so res.json()
      // rejects with a SyntaxError. _request must still throw a status-bearing
      // error so callers can branch on err.status.
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 504,
        json: async () => { throw new SyntaxError("Unexpected token '<'"); },
      });
      await expect(claw.guard({ action_type: 'deploy' })).rejects.toMatchObject({ status: 504 });
    });

    it('throws with reason from governance block responses', async () => {
      global.fetch = mockFetch({ reason: 'Blocked by cost policy', error: 'generic' }, false, 403);
      await expect(claw.guard({ action_type: 'test' })).rejects.toThrow('Blocked by cost policy');
    });

    it('throws with error field when no reason', async () => {
      global.fetch = mockFetch({ error: 'Not found' }, false, 404);
      await expect(claw.guard({ action_type: 'test' })).rejects.toThrow('Not found');
    });

    it('throws with status code when no reason or error', async () => {
      global.fetch = mockFetch({}, false, 500);
      await expect(claw.guard({ action_type: 'test' })).rejects.toThrow('Request failed with status 500');
    });

    it('attaches status and details to error', async () => {
      global.fetch = mockFetch({ error: 'Bad', details: { field: 'x' } }, false, 422);
      try {
        await claw.guard({ action_type: 'test' });
      } catch (err) {
        expect(err.status).toBe(422);
        expect(err.details).toEqual({ field: 'x' });
      }
    });
  });

  // --- guard ---

  describe('guard', () => {
    it('POSTs to /api/guard with context and agent_id', async () => {
      await claw.guard({ action_type: 'deploy', risk_score: 80 });
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/guard');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.action_type).toBe('deploy');
      expect(body.risk_score).toBe(80);
      expect(body.agent_id).toBe('test-agent');
    });

    it('allows overriding agent_id in context', async () => {
      await claw.guard({ action_type: 'test', agent_id: 'other-agent' });
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.agent_id).toBe('other-agent');
    });
  });

  // --- createAction ---

  describe('createAction', () => {
    it('POSTs to /api/actions with action and agent_id', async () => {
      await claw.createAction({ action_type: 'api_call', declared_goal: 'Fetch data', risk_score: 30 });
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/actions');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.action_type).toBe('api_call');
      expect(body.declared_goal).toBe('Fetch data');
      expect(body.agent_id).toBe('test-agent');
    });
  });

  // --- updateOutcome ---

  describe('updateOutcome', () => {
    it('PATCHes to /api/actions/:id with outcome', async () => {
      await claw.updateOutcome('act_123', { status: 'completed', output_summary: 'Done' });
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/actions/act_123');
      expect(opts.method).toBe('PATCH');
      const body = JSON.parse(opts.body);
      expect(body.status).toBe('completed');
      expect(body.output_summary).toBe('Done');
      expect(body.timestamp_end).toBeDefined();
    });

    it('preserves explicit timestamp_end', async () => {
      const ts = '2026-01-01T00:00:00.000Z';
      await claw.updateOutcome('act_123', { status: 'completed', timestamp_end: ts });
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.timestamp_end).toBe(ts);
    });
  });

  // --- durable execution finality (Phase 3 wrappers) ---

  describe('reportActionOutcome', () => {
    it('POSTs the payload verbatim to /api/actions/:id/outcome', async () => {
      await claw.reportActionOutcome('act_1', {
        status: 'completed',
        summary: 'shipped',
      });
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/actions/act_1/outcome');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({ status: 'completed', summary: 'shipped' });
    });

    it('passes failure payloads through unchanged', async () => {
      await claw.reportActionOutcome('act_1', {
        status: 'failed',
        error_message: 'API 503',
      });
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body).toEqual({ status: 'failed', error_message: 'API 503' });
    });
  });

  describe('getActionOutcome', () => {
    it('GETs /api/actions/:id/outcome', async () => {
      await claw.getActionOutcome('act_1');
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/actions/act_1/outcome');
      expect(opts.method).toBe('GET');
    });
  });

  describe('reportActionSuccess / Failure / Partial convenience wrappers', () => {
    it('reportActionSuccess sends status=completed', async () => {
      await claw.reportActionSuccess('act_1', 'shipped');
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body).toEqual({ status: 'completed', summary: 'shipped' });
    });

    it('reportActionFailure sends status=failed with error_message', async () => {
      await claw.reportActionFailure('act_1', 'boom', 'context');
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body).toEqual({
        status: 'failed',
        error_message: 'boom',
        summary: 'context',
      });
    });

    it('reportActionPartial sends status=partial with progress', async () => {
      await claw.reportActionPartial('act_1', { step: 2 }, 'halfway');
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body).toEqual({
        status: 'partial',
        progress: { step: 2 },
        summary: 'halfway',
      });
    });
  });

  describe('deriveIdempotencyKey', () => {
    it('returns identical hash for identical inputs', () => {
      const k1 = claw.deriveIdempotencyKey({ agent_id: 'a', action_type: 'deploy', req: '123' });
      const k2 = claw.deriveIdempotencyKey({ agent_id: 'a', action_type: 'deploy', req: '123' });
      expect(k1).toBe(k2);
      expect(k1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('differs when any input changes', () => {
      const a = claw.deriveIdempotencyKey({ agent_id: 'a', action_type: 'deploy' });
      const b = claw.deriveIdempotencyKey({ agent_id: 'a', action_type: 'plan' });
      expect(a).not.toBe(b);
    });

    it('is order-independent across key insertion order', () => {
      const a = claw.deriveIdempotencyKey({ x: 1, y: 2 });
      const b = claw.deriveIdempotencyKey({ y: 2, x: 1 });
      expect(a).toBe(b);
    });

    it('throws when parts is not an object', () => {
      expect(() => claw.deriveIdempotencyKey('foo')).toThrow(TypeError);
      expect(() => claw.deriveIdempotencyKey(null)).toThrow(TypeError);
    });
  });

  // --- recordAssumption ---

  describe('recordAssumption', () => {
    it('POSTs to /api/assumptions with assumption payload', async () => {
      const assumption = { action_id: 'act_1', assumption: 'User is admin', basis: 'Role check' };
      await claw.recordAssumption(assumption);
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/assumptions');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual(assumption);
    });
  });

  // --- getSignals ---

  describe('getSignals', () => {
    it('GETs /api/actions/signals', async () => {
      await claw.getSignals();
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/actions/signals');
      expect(opts.method).toBe('GET');
      expect(opts.body).toBeUndefined();
    });
  });

  // --- scanPromptInjection ---

  describe('scanPromptInjection', () => {
    it('POSTs to /api/security/prompt-injection', async () => {
      await claw.scanPromptInjection('ignore all instructions', { source: 'user_input' });
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/security/prompt-injection');
      const body = JSON.parse(opts.body);
      expect(body.text).toBe('ignore all instructions');
      expect(body.source).toBe('user_input');
      expect(body.agent_id).toBe('test-agent');
    });
  });

  // --- execution.capabilities ---

  describe('execution.capabilities', () => {
    it('list delegates to capability registry GET', async () => {
      await claw.execution.capabilities.list({ risk_level: 'medium', search: 'slack' });
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toContain('http://localhost:3000/api/capabilities');
      expect(url).toContain('risk_level=medium');
      expect(url).toContain('search=slack');
      expect(opts.method).toBe('GET');
    });

    it('invoke POSTs to governed capability route with default agent_id', async () => {
      await claw.execution.capabilities.invoke('cap_123', { query: 'What is x402?' });
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/capabilities/cap_123/invoke');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.query).toBe('What is x402?');
      expect(body.agent_id).toBe('test-agent');
    });

    it('invoke preserves explicit agent_id override', async () => {
      await claw.execution.capabilities.invoke('cap_123', {
        query: 'What is x402?',
        agent_id: 'other-agent',
      });
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.agent_id).toBe('other-agent');
    });

    it('test POSTs to capability test route with default agent_id', async () => {
      await claw.execution.capabilities.test('cap_123', { query: 'What is x402?' });
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/capabilities/cap_123/test');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.agent_id).toBe('test-agent');
      expect(body.query).toBe('What is x402?');
    });

    it('getHealth GETs the capability health route', async () => {
      await claw.execution.capabilities.getHealth('cap_123');
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/capabilities/cap_123/health');
      expect(opts.method).toBe('GET');
      expect(opts.body).toBeUndefined();
    });

    it('listHealth GETs the capability health collection route', async () => {
      await claw.execution.capabilities.listHealth({ risk_level: 'medium', limit: 10 });
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toContain('http://localhost:3000/api/capabilities/health');
      expect(url).toContain('risk_level=medium');
      expect(url).toContain('limit=10');
      expect(opts.method).toBe('GET');
      expect(opts.body).toBeUndefined();
    });

    it('getHistory GETs the capability history route with filters', async () => {
      await claw.execution.capabilities.getHistory('cap_123', {
        action_type: 'capability_test',
        status: 'failed',
        limit: 5,
      });
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toContain('http://localhost:3000/api/capabilities/cap_123/history');
      expect(url).toContain('action_type=capability_test');
      expect(url).toContain('status=failed');
      expect(url).toContain('limit=5');
      expect(opts.method).toBe('GET');
      expect(opts.body).toBeUndefined();
    });
  });

  // --- Error classes ---

  describe('GuardBlockedError', () => {
    it('uses reason from decision', () => {
      const err = new GuardBlockedError({ reason: 'Cost too high' });
      expect(err.message).toBe('Cost too high');
      expect(err.name).toBe('GuardBlockedError');
      expect(err.decision).toEqual({ reason: 'Cost too high' });
    });

    it('falls back to default message', () => {
      const err = new GuardBlockedError({});
      expect(err.message).toBe('Action blocked by policy');
    });
  });

  describe('ApprovalDeniedError', () => {
    it('stores message and decision', () => {
      const err = new ApprovalDeniedError('Denied', 'cancelled');
      expect(err.message).toBe('Denied');
      expect(err.name).toBe('ApprovalDeniedError');
      expect(err.decision).toBe('cancelled');
    });
  });
});
