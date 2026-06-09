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

    it('builds exact param order for getProfileScoreStats', async () => {
      await claw.getProfileScoreStats('prof_1');
      expect(global.fetch.mock.calls[0][0]).toBe(
        'http://localhost:3000/api/scoring/score?profile_id=prof_1&view=stats'
      );
    });

    it('builds exact param order for getLatestHandoff', async () => {
      await claw.getLatestHandoff();
      expect(global.fetch.mock.calls[0][0]).toBe(
        'http://localhost:3000/api/handoffs?agent_id=test-agent&latest=true'
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
      // scoring profiles + dimensions
      ['listScoringProfiles', (c) => c.listScoringProfiles({ status: 'active', limit: 5 }), 'GET',
        '/api/scoring/profiles?status=active&limit=5', undefined],
      ['getScoringProfile', (c) => c.getScoringProfile('prof_1'), 'GET', '/api/scoring/profiles/prof_1', undefined],
      ['updateScoringProfile', (c) => c.updateScoringProfile('prof_1', { name: 'n' }), 'PATCH',
        '/api/scoring/profiles/prof_1', { name: 'n' }],
      ['deleteScoringProfile', (c) => c.deleteScoringProfile('prof_1'), 'DELETE', '/api/scoring/profiles/prof_1', undefined],
      ['addScoringDimension', (c) => c.addScoringDimension('prof_1', { name: 'risk' }), 'POST',
        '/api/scoring/profiles/prof_1/dimensions', { name: 'risk' }],
      ['updateScoringDimension', (c) => c.updateScoringDimension('prof_1', 'dim_1', { weight: 2 }), 'PATCH',
        '/api/scoring/profiles/prof_1/dimensions/dim_1', { weight: 2 }],
      ['deleteScoringDimension', (c) => c.deleteScoringDimension('prof_1', 'dim_1'), 'DELETE',
        '/api/scoring/profiles/prof_1/dimensions/dim_1', undefined],
      ['scoreWithProfile', (c) => c.scoreWithProfile('prof_1', { id: 'a1' }), 'POST',
        '/api/scoring/score', { profile_id: 'prof_1', action: { id: 'a1' } }],
      ['batchScoreWithProfile', (c) => c.batchScoreWithProfile('prof_1', [{ id: 'a1' }]), 'POST',
        '/api/scoring/score', { profile_id: 'prof_1', actions: [{ id: 'a1' }] }],
      ['getProfileScores', (c) => c.getProfileScores({ profile_id: 'p', limit: 3 }), 'GET',
        '/api/scoring/score?profile_id=p&limit=3', undefined],
      // risk templates + calibrate
      ['createRiskTemplate', (c) => c.createRiskTemplate({ name: 't' }), 'POST', '/api/scoring/risk-templates', { name: 't' }],
      ['listRiskTemplates', (c) => c.listRiskTemplates({ category: 'ops' }), 'GET',
        '/api/scoring/risk-templates?category=ops', undefined],
      ['updateRiskTemplate', (c) => c.updateRiskTemplate('rt_1', { name: 'n' }), 'PATCH',
        '/api/scoring/risk-templates/rt_1', { name: 'n' }],
      ['deleteRiskTemplate', (c) => c.deleteRiskTemplate('rt_1'), 'DELETE', '/api/scoring/risk-templates/rt_1', undefined],
      ['autoCalibrate', (c) => c.autoCalibrate({ days: 14 }), 'POST', '/api/scoring/calibrate', { days: 14 }],
      // workflows
      ['listWorkflowTemplates', (c) => c.listWorkflowTemplates({ status: 'active', limit: 2 }), 'GET',
        '/api/workflows/templates?status=active&limit=2', undefined],
      ['createWorkflowTemplate', (c) => c.createWorkflowTemplate({ name: 'wf' }), 'POST',
        '/api/workflows/templates', { name: 'wf' }],
      ['getWorkflowTemplate', (c) => c.getWorkflowTemplate('wt_1'), 'GET', '/api/workflows/templates/wt_1', undefined],
      ['updateWorkflowTemplate', (c) => c.updateWorkflowTemplate('wt_1', { name: 'n' }), 'PATCH',
        '/api/workflows/templates/wt_1', { name: 'n' }],
      ['duplicateWorkflowTemplate', (c) => c.duplicateWorkflowTemplate('wt_1', { name: 'copy' }), 'POST',
        '/api/workflows/templates/wt_1/duplicate', { name: 'copy' }],
      ['launchWorkflowTemplate', (c) => c.launchWorkflowTemplate('wt_1', { agent_id: 'a' }), 'POST',
        '/api/workflows/templates/wt_1/launch', { agent_id: 'a' }],
      // model strategies
      ['listModelStrategies', (c) => c.listModelStrategies(), 'GET', '/api/model-strategies', undefined],
      ['createModelStrategy', (c) => c.createModelStrategy({ name: 'ms' }), 'POST', '/api/model-strategies', { name: 'ms' }],
      ['getModelStrategy', (c) => c.getModelStrategy('ms_1'), 'GET', '/api/model-strategies/ms_1', undefined],
      ['updateModelStrategy', (c) => c.updateModelStrategy('ms_1', { name: 'n' }), 'PATCH',
        '/api/model-strategies/ms_1', { name: 'n' }],
      ['deleteModelStrategy', (c) => c.deleteModelStrategy('ms_1'), 'DELETE', '/api/model-strategies/ms_1', undefined],
      ['completeWithStrategy', (c) => c.completeWithStrategy('ms_1', [{ role: 'user', content: 'hi' }], { max_tokens: 5 }),
        'POST', '/api/model-strategies/ms_1/complete', { messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }],
      // knowledge collections
      ['listKnowledgeCollections maps camelCase filters', (c) => c.listKnowledgeCollections({ sourceType: 'github', limit: 2, offset: 4 }),
        'GET', '/api/knowledge/collections?source_type=github&limit=2&offset=4', undefined],
      ['createKnowledgeCollection', (c) => c.createKnowledgeCollection({ name: 'kc' }), 'POST',
        '/api/knowledge/collections', { name: 'kc' }],
      ['getKnowledgeCollection', (c) => c.getKnowledgeCollection('kc_1'), 'GET', '/api/knowledge/collections/kc_1', undefined],
      ['updateKnowledgeCollection', (c) => c.updateKnowledgeCollection('kc_1', { name: 'n' }), 'PATCH',
        '/api/knowledge/collections/kc_1', { name: 'n' }],
      ['listKnowledgeCollectionItems', (c) => c.listKnowledgeCollectionItems('kc_1', { limit: 7 }), 'GET',
        '/api/knowledge/collections/kc_1/items?limit=7', undefined],
      ['addKnowledgeCollectionItem', (c) => c.addKnowledgeCollectionItem('kc_1', { title: 't' }), 'POST',
        '/api/knowledge/collections/kc_1/items', { title: 't' }],
      ['syncKnowledgeCollection sends an empty object body', (c) => c.syncKnowledgeCollection('kc_1'), 'POST',
        '/api/knowledge/collections/kc_1/sync', {}],
      ['searchKnowledgeCollection', (c) => c.searchKnowledgeCollection('kc_1', 'q', { limit: 3 }), 'POST',
        '/api/knowledge/collections/kc_1/search', { query: 'q', limit: 3 }],
      ['deleteKnowledgeCollection', (c) => c.deleteKnowledgeCollection('kc_1'), 'DELETE',
        '/api/knowledge/collections/kc_1', undefined],
      // capabilities (direct methods)
      ['createCapability', (c) => c.createCapability({ name: 'cap' }), 'POST', '/api/capabilities', { name: 'cap' }],
      ['getCapability', (c) => c.getCapability('cap_1'), 'GET', '/api/capabilities/cap_1', undefined],
      ['updateCapability', (c) => c.updateCapability('cap_1', { name: 'n' }), 'PATCH', '/api/capabilities/cap_1', { name: 'n' }],
      ['deleteCapability', (c) => c.deleteCapability('cap_1'), 'DELETE', '/api/capabilities/cap_1', undefined],
      ['getCapabilityHistory', (c) => c.getCapabilityHistory('cap_1', { limit: 5 }), 'GET',
        '/api/capabilities/cap_1/history?limit=5', undefined],
      // prompt library
      ['listPromptTemplates', (c) => c.listPromptTemplates({ category: 'ops' }), 'GET',
        '/api/prompts/templates?category=ops', undefined],
      ['getPromptTemplate', (c) => c.getPromptTemplate('tmpl_1'), 'GET', '/api/prompts/templates/tmpl_1', undefined],
      ['createPromptTemplate', (c) => c.createPromptTemplate({ name: 'p' }), 'POST', '/api/prompts/templates', { name: 'p' }],
      ['updatePromptTemplate', (c) => c.updatePromptTemplate('tmpl_1', { name: 'n' }), 'PATCH',
        '/api/prompts/templates/tmpl_1', { name: 'n' }],
      ['deletePromptTemplate', (c) => c.deletePromptTemplate('tmpl_1'), 'DELETE', '/api/prompts/templates/tmpl_1', undefined],
      ['listPromptVersions', (c) => c.listPromptVersions('tmpl_1'), 'GET', '/api/prompts/templates/tmpl_1/versions', undefined],
      ['createPromptVersion', (c) => c.createPromptVersion('tmpl_1', { content: 'x' }), 'POST',
        '/api/prompts/templates/tmpl_1/versions', { content: 'x' }],
      ['getPromptVersion', (c) => c.getPromptVersion('tmpl_1', 'pv_1'), 'GET',
        '/api/prompts/templates/tmpl_1/versions/pv_1', undefined],
      ['activatePromptVersion POSTs with NO body', (c) => c.activatePromptVersion('tmpl_1', 'pv_1'), 'POST',
        '/api/prompts/templates/tmpl_1/versions/pv_1', undefined],
      ['getPromptStats', (c) => c.getPromptStats({ template_id: 'tmpl_1' }), 'GET',
        '/api/prompts/stats?template_id=tmpl_1', undefined],
      ['listPromptRuns', (c) => c.listPromptRuns({ template_id: 'tmpl_1', limit: 2 }), 'GET',
        '/api/prompts/runs?template_id=tmpl_1&limit=2', undefined],
      // sessions
      ['createSession with explicit args', (c) => c.createSession('agent-2', '/ws', 'main'), 'POST',
        '/api/sessions', { agent_id: 'agent-2', workspace: '/ws', branch: 'main' }],
      ['createSession defaults agent and null branch', (c) => c.createSession(undefined, '/ws'), 'POST',
        '/api/sessions', { agent_id: 'test-agent', workspace: '/ws', branch: null }],
      ['getSession', (c) => c.getSession('ses_1'), 'GET', '/api/sessions/ses_1', undefined],
      ['updateSession', (c) => c.updateSession('ses_1', { status: 'done' }), 'PATCH', '/api/sessions/ses_1', { status: 'done' }],
      ['listSessions', (c) => c.listSessions({ agent_id: 'a', limit: 1 }), 'GET', '/api/sessions?agent_id=a&limit=1', undefined],
      ['getSessionEvents', (c) => c.getSessionEvents('ses_1'), 'GET', '/api/sessions/ses_1/events', undefined],
      // learning
      ['recordDecision stamps default agent_id', (c) => c.recordDecision({ decision: 'd' }), 'POST',
        '/api/learning', { decision: 'd', agent_id: 'test-agent' }],
      ['getLearningRecommendations stamps default agent_id', (c) => c.getLearningRecommendations({ action_type: 'deploy' }),
        'GET', '/api/learning/recommendations?action_type=deploy&agent_id=test-agent', undefined],
      // policies + evaluations
      ['simulatePolicy omits days when not given', (c) => c.simulatePolicy({ policy_type: 'cost', rules: { max: 5 } }),
        'POST', '/api/policies/simulate', { policy_type: 'cost', rules: { max: 5 } }],
      ['simulatePolicy includes days when given', (c) => c.simulatePolicy({ policy_type: 'cost', rules: {}, days: 7 }),
        'POST', '/api/policies/simulate', { policy_type: 'cost', rules: {}, days: 7 }],
      ['previewScorer', (c) => c.previewScorer({ scorer_type: 'regex', config: { p: '.' } }), 'POST',
        '/api/evaluations/scorers/preview', { scorer_type: 'regex', config: { p: '.' } }],
      // reputation
      ['getAgentReputation', (c) => c.getAgentReputation('agent-9'), 'GET', '/api/reputation/agents/agent-9', undefined],
      ['listAgentReputationEvents', (c) => c.listAgentReputationEvents('agent-9', { limit: 4 }), 'GET',
        '/api/reputation/agents/agent-9/events?limit=4', undefined],
      ['recomputeAgentReputation POSTs with NO body', (c) => c.recomputeAgentReputation('agent-9'), 'POST',
        '/api/reputation/agents/agent-9/recompute', undefined],
      ['getAgentReputationReceipt', (c) => c.getAgentReputationReceipt('agent-9'), 'GET',
        '/api/reputation/agents/agent-9/receipt', undefined],
      ['verifyReputationReceipt', (c) => c.verifyReputationReceipt({ sig: 'x' }), 'POST',
        '/api/reputation/verify', { receipt: { sig: 'x' } }],
      // agent registry
      ['registerAgent', (c) => c.registerAgent({ name: 'ext' }), 'POST', '/api/agents/registry', { name: 'ext' }],
      ['listRegisteredAgents', (c) => c.listRegisteredAgents({ status: 'active' }), 'GET',
        '/api/agents/registry?status=active', undefined],
      ['getRegisteredAgent', (c) => c.getRegisteredAgent('ra_1'), 'GET', '/api/agents/registry/ra_1', undefined],
      ['updateRegisteredAgent', (c) => c.updateRegisteredAgent('ra_1', { name: 'n' }), 'PATCH',
        '/api/agents/registry/ra_1', { name: 'n' }],
      ['addAgentCapability maps capability_id', (c) => c.addAgentCapability('ra_1', 'cap_1'), 'POST',
        '/api/agents/registry/ra_1/capabilities', { capability_id: 'cap_1' }],
      ['listAgentCapabilities', (c) => c.listAgentCapabilities('ra_1'), 'GET', '/api/agents/registry/ra_1/capabilities', undefined],
      ['invokeRegisteredAgent drops undefined fields', (c) => c.invokeRegisteredAgent({ registered_agent_id: 'ra_1', capability_id: 'cap_1' }),
        'POST', '/api/agents/invoke', { registered_agent_id: 'ra_1', capability_id: 'cap_1' }],
      // x402
      ['listProviders', (c) => c.listProviders({ status: 'active' }), 'GET', '/api/x402/providers?status=active', undefined],
      ['createProvider', (c) => c.createProvider({ name: 'p' }), 'POST', '/api/x402/providers', { name: 'p' }],
      ['getProvider', (c) => c.getProvider('prov_1'), 'GET', '/api/x402/providers/prov_1', undefined],
      ['updateProvider', (c) => c.updateProvider('prov_1', { name: 'n' }), 'PATCH', '/api/x402/providers/prov_1', { name: 'n' }],
      ['listProviderEndpoints', (c) => c.listProviderEndpoints('prov_1'), 'GET', '/api/x402/providers/prov_1/endpoints', undefined],
      ['createProviderEndpoint', (c) => c.createProviderEndpoint('prov_1', { path: '/v1' }), 'POST',
        '/api/x402/providers/prov_1/endpoints', { path: '/v1' }],
      ['recordPurchase', (c) => c.recordPurchase({ agent_id: 'a', provider: 'p' }), 'POST',
        '/api/x402/purchases', { agent_id: 'a', provider: 'p' }],
      ['listPurchases', (c) => c.listPurchases({ agent_id: 'a' }), 'GET', '/api/x402/purchases?agent_id=a', undefined],
      ['recordPurchaseResult maps artifact fields', (c) => c.recordPurchaseResult('act_1', { summary: 's', data: { a: 1 }, url: 'http://u' }),
        'POST', '/api/artifacts', {
          artifact_type: 'x402_purchase_result',
          name: 'x402 result act_1',
          description: 's',
          content_json: { a: 1 },
          content_url: 'http://u',
          source_action_id: 'act_1',
        }],
      ['recordPurchaseResult defaults', (c) => c.recordPurchaseResult('act_1'),
        'POST', '/api/artifacts', {
          artifact_type: 'x402_purchase_result',
          name: 'x402 result act_1',
          description: null,
          content_json: {},
          content_url: null,
          source_action_id: 'act_1',
        }],
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

    it('scoreWithProfile rejects arrays with a TypeError before any request', async () => {
      await expect(claw.scoreWithProfile('p', [])).rejects.toThrow(TypeError);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('batchScoreWithProfile rejects non-arrays with a TypeError before any request', async () => {
      await expect(claw.batchScoreWithProfile('p', {})).rejects.toThrow(TypeError);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('getMessage URL-encodes the message id', async () => {
      await claw.getMessage('msg/odd id');
      expect(global.fetch.mock.calls[0][0]).toBe('http://localhost:3000/api/messages/msg%2Fodd%20id');
    });
  });

  // -------------------------------------------------------------------------
  // recordX402Purchase — composite flow (purchase → outcome → artifact)
  // -------------------------------------------------------------------------

  describe('recordX402Purchase', () => {
    it('records purchase, reports success, and attaches the receipt artifact', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(mockJSON({
          action: { action_id: 'act_9' },
          purchase: { id: 'pur_1' },
          decision: { decision: 'allow' },
        }))
        .mockResolvedValueOnce(mockJSON({ outcome: { status: 'completed' } }))
        .mockResolvedValueOnce(mockJSON({ artifact: { id: 'art_1' } }));

      const res = await claw.recordX402Purchase({
        agent_id: 'a1',
        provider: 'stableenrich.dev',
        spend: 0.05,
        transaction_hash: '0xabc',
      });

      // 1) governed purchase with derived defaults
      const [purchaseUrl, purchaseOpts] = global.fetch.mock.calls[0];
      expect(purchaseUrl).toBe('http://localhost:3000/api/x402/purchases');
      expect(JSON.parse(purchaseOpts.body)).toEqual({
        agent_id: 'a1',
        provider: 'stableenrich.dev',
        declared_goal: 'x402 capability call to stableenrich.dev',
        purchase_reason: 'Paid x402 capability call to stableenrich.dev',
        context_gap: 'Capability gated behind payment at stableenrich.dev',
        expected_value: 'Paid result from stableenrich.dev',
        spend_amount: 0.05,
        cost_estimate: 0.05,
        currency: 'USDC',
        payment_method: 'x402',
      });

      // 2) terminal outcome
      const [outcomeUrl, outcomeOpts] = global.fetch.mock.calls[1];
      expect(outcomeUrl).toBe('http://localhost:3000/api/actions/act_9/outcome');
      expect(JSON.parse(outcomeOpts.body)).toEqual({
        status: 'completed',
        summary: 'x402 settled: $0.05 USDC at stableenrich.dev',
      });

      // 3) artifact with the tx hash
      const [artifactUrl, artifactOpts] = global.fetch.mock.calls[2];
      expect(artifactUrl).toBe('http://localhost:3000/api/artifacts');
      const artifactBody = JSON.parse(artifactOpts.body);
      expect(artifactBody.source_action_id).toBe('act_9');
      expect(artifactBody.content_json).toEqual({ origin: 'stableenrich.dev', transactionHash: '0xabc' });

      expect(res).toEqual({
        action: { action_id: 'act_9' },
        purchase: { id: 'pur_1' },
        decision: { decision: 'allow' },
        outcome: { outcome: { status: 'completed' } },
      });
    });

    it('skips outcome + artifact when no action id comes back', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockJSON({}));
      const res = await claw.recordX402Purchase({ agent_id: 'a1', provider: 'p.dev', spend: 1 });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(res.outcome).toBeNull();
    });
  });
});
