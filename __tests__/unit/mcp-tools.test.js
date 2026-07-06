// __tests__/unit/mcp-tools.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPost = vi.fn();
const mockGet = vi.fn();
const mockPatch = vi.fn();

vi.mock('../../mcp-server/lib/client.js', () => ({
  DashClawClient: vi.fn().mockImplementation(function () {
    this.post = mockPost;
    this.get = mockGet;
    this.patch = mockPatch;
    this.agentId = 'default-agent';
  }),
}));

const { createToolHandlers, TOOL_DEFINITIONS } = await import('../../mcp-server/lib/tools.js');
import { DashClawClient } from '../../mcp-server/lib/client.js';

describe('Tool Definitions', () => {
  it('exports exactly 33 tool definitions', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(33);
  });

  it('includes the assumption recording tool', () => {
    const names = TOOL_DEFINITIONS.map((d) => d.name);
    expect(names).toContain('dashclaw_assumption_record');
  });

  it('includes the inbox read tools', () => {
    const names = TOOL_DEFINITIONS.map((d) => d.name);
    expect(names).toContain('dashclaw_inbox_list');
    expect(names).toContain('dashclaw_messages_mark_read');
  });

  it('includes the read-only posture tools', () => {
    const names = TOOL_DEFINITIONS.map((d) => d.name);
    expect(names).toContain('dashclaw_posture');
    expect(names).toContain('dashclaw_posture_next');
  });

  it('every definition has name, description, and inputSchema', () => {
    for (const def of TOOL_DEFINITIONS) {
      expect(def.name).toBeTruthy();
      expect(def.description.length).toBeGreaterThan(50);
      expect(def.inputSchema).toBeDefined();
      expect(def.inputSchema.type).toBe('object');
    }
  });

  it('dashclaw_record schema includes optional session_id', () => {
    const rec = TOOL_DEFINITIONS.find((d) => d.name === 'dashclaw_record');
    expect(rec.inputSchema.properties.session_id).toBeDefined();
    expect(rec.inputSchema.properties.session_id.type).toBe('string');
    expect(rec.inputSchema.required || []).not.toContain('session_id');
  });
});

describe('Tool Handlers', () => {
  let handlers;

  beforeEach(() => {
    vi.clearAllMocks();
    const client = new DashClawClient();
    handlers = createToolHandlers(client);
  });

  describe('dashclaw_guard', () => {
    it('calls POST /api/guard and returns decision', async () => {
      mockPost.mockResolvedValue({ decision: 'allow', reason: 'low risk' });

      const result = await handlers.dashclaw_guard({
        action_type: 'deploy',
        declared_goal: 'Deploy to staging',
        risk_score: 30,
      });

      expect(mockPost).toHaveBeenCalledWith('/api/guard', expect.objectContaining({
        action_type: 'deploy',
        declared_goal: 'Deploy to staging',
        risk_score: 30,
        agent_id: 'default-agent',
        // Phase 3: every guard call carries a derived idempotency key so
        // blind retries dedupe server-side instead of double-counting.
        idempotency_key: expect.stringMatching(/^[0-9a-f]{64}$/),
      }), { timeout: 10000 });
      expect(result).toContain('"decision":"allow"');
    });

    it('server-configured agent_id wins over LLM-supplied agent_id', async () => {
      // Governance: a confused or adversarial prompt must not be able to
      // attribute actions to a different agent identity than the server is
      // configured with. The server's client.agentId (DASHCLAW_AGENT_ID /
      // --agent-id / auto-derived from MCP clientInfo) is authoritative; the
      // tool-input field is preserved only as a last-resort fallback for
      // setups that intentionally run without a server-level default.
      mockPost.mockResolvedValue({ decision: 'block' });

      await handlers.dashclaw_guard({
        action_type: 'deploy',
        declared_goal: 'test',
        risk_score: 50,
        agent_id: 'spoofed-agent', // LLM tries to override the server identity
      });

      expect(mockPost).toHaveBeenCalledWith('/api/guard', expect.objectContaining({
        agent_id: 'default-agent', // server config, not 'spoofed-agent'
      }), expect.anything());
    });

    it('falls back to LLM-supplied agent_id only when server has no default', async () => {
      // Last-resort fallback: if the MCP server was started with no
      // --agent-id, no DASHCLAW_AGENT_ID, AND clientInfo auto-derivation
      // didn't fire (e.g. HTTP transport, or an MCP client that omits
      // clientInfo.name), input.agent_id is the only identity available.
      const bareClient = { agentId: '', post: mockPost, get: mockGet, patch: mockPatch };
      const bareHandlers = createToolHandlers(bareClient);
      mockPost.mockResolvedValue({ decision: 'allow' });

      await bareHandlers.dashclaw_guard({
        action_type: 'deploy',
        declared_goal: 'test',
        risk_score: 30,
        agent_id: 'bare-fallback',
      });

      expect(mockPost).toHaveBeenCalledWith('/api/guard', expect.objectContaining({
        agent_id: 'bare-fallback',
      }), expect.anything());
    });
  });

  describe('dashclaw_record', () => {
    it('calls POST /api/actions and returns action record', async () => {
      mockPost.mockResolvedValue({
        action: { id: '1', action_id: 'act_abc' },
        action_id: 'act_abc',
      });

      const result = await handlers.dashclaw_record({
        action_type: 'research',
        declared_goal: 'Analyzed logs',
        status: 'completed',
      });

      expect(mockPost).toHaveBeenCalledWith('/api/actions', expect.objectContaining({
        action_type: 'research',
        declared_goal: 'Analyzed logs',
        status: 'completed',
        agent_id: 'default-agent',
      }), { timeout: 10000 });
      expect(result).toContain('act_abc');
    });
  });

  describe('dashclaw_record session_id stamping', () => {
    it('stamps the active session from dashclaw_session_start onto a later record', async () => {
      mockPost.mockResolvedValueOnce({ session: { id: 'sess_42' } }); // session_start
      mockPost.mockResolvedValueOnce({ action_id: 'act_1' });          // record
      await handlers.dashclaw_session_start({ agent_id: 'a', workspace: 'w' });
      await handlers.dashclaw_record({ action_type: 'research', declared_goal: 'g', status: 'completed' });
      const [path, body] = mockPost.mock.calls[1];
      expect(path).toBe('/api/actions');
      expect(body.session_id).toBe('sess_42');
    });

    it('lets an explicit session_id override the active session', async () => {
      mockPost.mockResolvedValueOnce({ session: { id: 'sess_42' } });
      mockPost.mockResolvedValueOnce({ action_id: 'act_1' });
      await handlers.dashclaw_session_start({ agent_id: 'a' });
      await handlers.dashclaw_record({ action_type: 'x', declared_goal: 'g', status: 'completed', session_id: 'sess_explicit' });
      expect(mockPost.mock.calls[1][1].session_id).toBe('sess_explicit');
    });

    it('omits session_id when no session is active', async () => {
      mockPost.mockResolvedValueOnce({ action_id: 'act_1' });
      await handlers.dashclaw_record({ action_type: 'x', declared_goal: 'g', status: 'completed' });
      expect(mockPost.mock.calls[0][1].session_id).toBeUndefined();
    });

    it('clears the active session on a matching session_end', async () => {
      mockPost.mockResolvedValueOnce({ session: { id: 'sess_42' } });                 // start
      mockPatch.mockResolvedValueOnce({ session: { id: 'sess_42', status: 'completed' } }); // end
      mockPost.mockResolvedValueOnce({ action_id: 'act_1' });                          // record after end
      await handlers.dashclaw_session_start({ agent_id: 'a' });
      await handlers.dashclaw_session_end({ session_id: 'sess_42', status: 'completed' });
      await handlers.dashclaw_record({ action_type: 'x', declared_goal: 'g', status: 'completed' });
      expect(mockPost.mock.calls[1][1].session_id).toBeUndefined();
    });

    it('keeps the active session when session_end targets a different session', async () => {
      mockPost.mockResolvedValueOnce({ session: { id: 'sess_42' } });                    // start
      mockPatch.mockResolvedValueOnce({ session: { id: 'sess_other', status: 'completed' } }); // end other
      mockPost.mockResolvedValueOnce({ action_id: 'act_1' });                             // record
      await handlers.dashclaw_session_start({ agent_id: 'a' });
      await handlers.dashclaw_session_end({ session_id: 'sess_other', status: 'completed' });
      await handlers.dashclaw_record({ action_type: 'x', declared_goal: 'g', status: 'completed' });
      expect(mockPost.mock.calls[1][1].session_id).toBe('sess_42');
    });
  });

  describe('dashclaw_invoke', () => {
    it('calls POST /api/capabilities/:id/invoke with payload', async () => {
      mockPost.mockResolvedValue({
        success: true,
        action_id: 'act_xyz',
        result: { data: 'response' },
      });

      const result = await handlers.dashclaw_invoke({
        capability_id: 'cap_123',
        declared_goal: 'Send notification',
        payload: { message: 'hello' },
      });

      expect(mockPost).toHaveBeenCalledWith('/api/capabilities/cap_123/invoke', {
        agent_id: 'default-agent',
        declared_goal: 'Send notification',
        payload: { message: 'hello' },
      }, { timeout: 30000 });
      expect(result).toContain('act_xyz');
    });
  });

  describe('dashclaw_capabilities_list', () => {
    it('calls GET /api/capabilities with filters', async () => {
      mockGet.mockResolvedValue({ capabilities: [{ id: 'cap_1', name: 'Slack' }] });

      const result = await handlers.dashclaw_capabilities_list({
        category: 'external_api',
      });

      expect(mockGet).toHaveBeenCalledWith('/api/capabilities', {
        category: 'external_api',
        risk_level: undefined,
        search: undefined,
      }, { timeout: 10000 });
      expect(result).toContain('Slack');
    });
  });

  describe('dashclaw_policies_list', () => {
    it('calls GET /api/policies with optional agent_id', async () => {
      mockGet.mockResolvedValue({ policies: [{ id: 'gp_1', name: 'No prod deploys' }] });

      const result = await handlers.dashclaw_policies_list({ agent_id: 'bot1' });

      expect(mockGet).toHaveBeenCalledWith('/api/policies', { agent_id: 'bot1' }, { timeout: 10000 });
      expect(result).toContain('No prod deploys');
    });
  });

  describe('dashclaw_wait_for_approval', () => {
    it('polls action status until approved', async () => {
      mockGet
        .mockResolvedValueOnce({ action: { status: 'pending_approval' } })
        .mockResolvedValueOnce({ action: { status: 'completed', id: 'act_1' } });

      const result = await handlers.dashclaw_wait_for_approval({
        action_id: 'act_1',
        poll_interval_seconds: 0.01,
      });

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(result).toContain('"approved":true');
    });

    it('returns timeout when max wait exceeded', async () => {
      mockGet.mockResolvedValue({ action: { status: 'pending_approval' } });

      const result = await handlers.dashclaw_wait_for_approval({
        action_id: 'act_1',
        timeout_seconds: 0.02,
        poll_interval_seconds: 0.01,
      });

      expect(result).toContain('"timed_out":true');
    });

    it('resolves within 2s of status flipping from pending_approval to completed', async () => {
      // SPEC CCI-03 acceptance bullet 3: the MCP tool must resolve within 2s
      // of a status change. Uses a 0.5s poll (tighter than the 3s default)
      // to prove the mechanism honors the 2s boundary when the flip happens
      // between polls. flipTime is captured the moment the mock starts
      // returning the resolved status.
      let flipTime = 0;
      let callCount = 0;
      mockGet.mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          return { action: { status: 'pending_approval' } };
        }
        if (flipTime === 0) flipTime = Date.now();
        return { action: { status: 'completed', id: 'act_1' } };
      });

      const start = Date.now();
      const result = await handlers.dashclaw_wait_for_approval({
        action_id: 'act_1',
        timeout_seconds: 10,
        poll_interval_seconds: 0.5,
      });
      const end = Date.now();

      const parsed = JSON.parse(result);
      expect(parsed.approved).toBe(true);
      expect(Number.isFinite(parsed.waited_seconds)).toBe(true);

      // The acceptance boundary: resolution must happen within 2s of the flip.
      expect(flipTime).toBeGreaterThan(0);
      expect(end - flipTime).toBeLessThanOrEqual(2000);
      // Sanity: we didn't resolve faster than the first pending-response polls.
      expect(end - start).toBeGreaterThanOrEqual(0);
    });
  });

  describe('dashclaw_session_start', () => {
    it('calls POST /api/sessions with the server-configured identity winning (same precedence as record/guard)', async () => {
      mockPost.mockResolvedValue({ session: { id: 'sess_1', status: 'active' } });

      const result = await handlers.dashclaw_session_start({
        agent_id: 'my-agent',
        workspace: 'research',
      });

      // WRITE identity precedence: the caller-supplied agent_id is only a
      // fallback — a session must not open under an arbitrary identity while
      // its records stamp the configured one.
      expect(mockPost).toHaveBeenCalledWith('/api/sessions', {
        agent_id: 'default-agent',
        workspace: 'research',
        branch: undefined,
      }, { timeout: 10000 });
      expect(result).toContain('sess_1');
    });
  });

  describe('dashclaw_session_end', () => {
    it('calls PATCH /api/sessions/:id', async () => {
      mockPatch.mockResolvedValue({ session: { id: 'sess_1', status: 'completed' } });

      const result = await handlers.dashclaw_session_end({
        session_id: 'sess_1',
        status: 'completed',
        summary: 'Research done',
      });

      expect(mockPatch).toHaveBeenCalledWith('/api/sessions/sess_1', {
        status: 'completed',
        summary: 'Research done',
      }, { timeout: 10000 });
      expect(result).toContain('completed');
    });
  });

  describe('dashclaw_session_retro', () => {
    it('calls GET /api/sessions/:id/retro using the explicit session_id', async () => {
      mockGet.mockResolvedValue({ retro: { posture: 'clean', coverage: {}, findings: [] } });

      const result = await handlers.dashclaw_session_retro({ session_id: 'sess_1' });

      expect(mockGet).toHaveBeenCalledWith('/api/sessions/sess_1/retro', {}, { timeout: 15000 });
      expect(result).toContain('clean');
    });

    it('falls back to the active session when session_id is omitted', async () => {
      mockPost.mockResolvedValueOnce({ session: { id: 'sess_42' } }); // session_start
      await handlers.dashclaw_session_start({ agent_id: 'a' });
      mockGet.mockResolvedValue({ retro: { posture: 'review', coverage: {}, findings: [] } });

      await handlers.dashclaw_session_retro({});

      expect(mockGet).toHaveBeenCalledWith('/api/sessions/sess_42/retro', {}, { timeout: 15000 });
    });

    it('returns an error when there is no session_id and no active session', async () => {
      const result = await handlers.dashclaw_session_retro({});

      expect(JSON.parse(result).error).toMatch(/No session_id given/);
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  describe('dashclaw_inbox_list', () => {
    it('calls GET /api/messages with the server agent_id and inbox default', async () => {
      mockGet.mockResolvedValue({ messages: [{ id: 'msg_1' }], total: 1, unread_count: 1 });

      const result = await handlers.dashclaw_inbox_list({ unread: true, limit: 25 });

      expect(mockGet).toHaveBeenCalledWith('/api/messages', {
        agent_id: 'default-agent',
        direction: 'inbox',
        unread: 'true',
        type: undefined,
        limit: 25,
      }, { timeout: 10000 });
      expect(result).toContain('unread_count');
    });

    it('drops the unread flag when not requested', async () => {
      mockGet.mockResolvedValue({ messages: [], total: 0, unread_count: 0 });
      await handlers.dashclaw_inbox_list({});
      expect(mockGet).toHaveBeenCalledWith('/api/messages', expect.objectContaining({
        direction: 'inbox',
        unread: undefined,
      }), { timeout: 10000 });
    });
  });

  describe('dashclaw_messages_mark_read', () => {
    it('PATCHes /api/messages with action:read and the server agent_id', async () => {
      mockPatch.mockResolvedValue({ updated: 2 });

      const result = await handlers.dashclaw_messages_mark_read({
        message_ids: ['msg_1', 'msg_2'],
        agent_id: 'spoofed', // must be overridden by the server identity
      });

      expect(mockPatch).toHaveBeenCalledWith('/api/messages', {
        message_ids: ['msg_1', 'msg_2'],
        action: 'read',
        agent_id: 'default-agent',
      }, { timeout: 10000 });
      expect(result).toContain('"updated":2');
    });
  });

  describe('dashclaw_posture', () => {
    it('GETs /api/posture + /api/posture/findings and merges the read-only payload', async () => {
      mockGet.mockImplementation(async (path) => {
        if (path === '/api/posture') return { score: 72, status: 'needs_attention', cappedBy: null, dimensions: [{ dimension: 'spend', score: 45, weight: 8 }], summary: { openFindings: 2 } };
        if (path === '/api/posture/findings') return { findings: [{ key: 'f1', scoreDelta: 6 }], counts: { open: 2 } };
        return {};
      });

      const result = await handlers.dashclaw_posture({ dimension: 'spend' });

      expect(mockGet).toHaveBeenCalledWith('/api/posture', {}, { timeout: 15000 });
      expect(mockGet).toHaveBeenCalledWith('/api/posture/findings', { dimension: 'spend' }, { timeout: 15000 });
      const parsed = JSON.parse(result);
      expect(parsed.score).toBe(72);
      expect(parsed.findings[0].key).toBe('f1');
      // Read-only: never POSTs/PATCHes (no enforcement mutation from MCP).
      expect(mockPost).not.toHaveBeenCalled();
      expect(mockPatch).not.toHaveBeenCalled();
    });
  });

  describe('dashclaw_posture_next', () => {
    it('returns the single top open finding', async () => {
      mockGet.mockResolvedValue({ findings: [{ key: 'top', scoreDelta: 9 }, { key: 'second' }] });
      const result = await handlers.dashclaw_posture_next({});
      expect(mockGet).toHaveBeenCalledWith('/api/posture/findings', {}, { timeout: 15000 });
      expect(JSON.parse(result).next.key).toBe('top');
    });

    it('returns next:null when the queue is clear', async () => {
      mockGet.mockResolvedValue({ findings: [] });
      const result = await handlers.dashclaw_posture_next({});
      expect(JSON.parse(result).next).toBeNull();
    });
  });
});
