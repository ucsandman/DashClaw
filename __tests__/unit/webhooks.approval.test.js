import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqlMock } from '../helpers.js';

const { mockDnsLookup, mockFetch } = vi.hoisted(() => ({
  mockDnsLookup: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  default: { lookup: mockDnsLookup, resolve4: vi.fn() },
  lookup: mockDnsLookup,
}));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: (v) => ({ clean: true, redacted: v, findings: [] }) }));
vi.stubGlobal('fetch', mockFetch);
// webhooks.js now imports fetch from undici (so its pinned undici Agent
// dispatcher is honored); route that import to the same mock while keeping the
// real Agent so buildPinnedDispatcher still works.
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetch: (...args) => mockFetch(...args) };
});

import { fireWebhooksForApproval } from '@/lib/webhooks.js';

describe('fireWebhooksForApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    delete process.env.NEXTAUTH_URL;
    delete process.env.VERCEL_URL;
  });

  it('is exported from webhooks.js', () => {
    expect(typeof fireWebhooksForApproval).toBe('function');
  });

  it('queries for active webhooks and calls deliverWebhook with correct named parameters', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        // SELECT webhooks
        [{ id: 'wh_1', url: 'https://example.com/hook', secret: 'sec123', events: '["all"]' }],
        // INSERT INTO webhook_deliveries (from deliverWebhook)
        [],
      ],
    });
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    const action = {
      action_id: 'act_1',
      agent_id: 'agent_1',
      action_type: 'tool_call',
      declared_goal: 'test goal',
      risk_score: 0.8,
      status: 'pending_approval',
      matched_policies: ['policy_1'],
      reason: 'High risk action',
    };

    await fireWebhooksForApproval('org_1', 'approval_pending', action, sql);

    // Wait for fire-and-forget deliverWebhook to complete
    await new Promise((r) => setTimeout(r, 50));

    // First tagged call: SELECT webhooks
    expect(sql.taggedCalls.length).toBeGreaterThanOrEqual(1);
    expect(sql.taggedCalls[0].text).toContain('FROM webhooks');
    expect(sql.taggedCalls[0].values[0]).toBe('org_1');

    // fetch should have been called (deliverWebhook fires fetch)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [fetchUrl, fetchOpts] = mockFetch.mock.calls[0];
    expect(fetchUrl).toBe('https://example.com/hook');
    expect(fetchOpts.method).toBe('POST');

    // Verify payload structure
    const body = JSON.parse(fetchOpts.body);
    expect(body.event).toBe('approval_pending');
    expect(body.org_id).toBe('org_1');
    expect(body.action.action_id).toBe('act_1');
    expect(body.action.agent_id).toBe('agent_1');
    expect(body.action.matched_policies).toEqual(['policy_1']);
    expect(body.action.reason).toBe('High risk action');
    expect(body.approval_url).toContain('/api/approvals/act_1');
    expect(body.replay_url).toContain('/replay/act_1');

    // Verify DashClaw headers
    expect(fetchOpts.headers['X-DashClaw-Event']).toBe('approval_pending');
    expect(fetchOpts.headers['X-DashClaw-Signature']).toBeDefined();
  });

  it('skips webhooks not subscribed to the event type', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        // Webhook only subscribed to autonomy_spike, not approval events
        [{ id: 'wh_1', url: 'https://example.com/hook', secret: 'sec', events: '["autonomy_spike"]' }],
      ],
    });

    const action = {
      action_id: 'act_2',
      agent_id: 'agent_2',
      action_type: 'api_call',
      declared_goal: 'do something',
      risk_score: 0.5,
      status: 'pending_approval',
    };

    await fireWebhooksForApproval('org_1', 'approval_pending', action, sql);

    await new Promise((r) => setTimeout(r, 50));

    // Should NOT have called fetch since the webhook is not subscribed to approval_pending
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('delivers to webhooks subscribed to "all" events', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'wh_1', url: 'https://example.com/hook', secret: 'sec', events: '["all"]' }],
        [],
      ],
    });
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    const action = {
      action_id: 'act_3',
      agent_id: 'agent_3',
      action_type: 'tool_call',
      declared_goal: 'test',
      risk_score: 0.3,
      status: 'running',
    };

    await fireWebhooksForApproval('org_1', 'approval_granted', action, sql);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.event).toBe('approval_granted');
  });

  it('delivers to webhooks explicitly subscribed to the approval event', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'wh_1', url: 'https://example.com/hook', secret: 'sec', events: '["approval_denied"]' }],
        [],
      ],
    });
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    const action = {
      action_id: 'act_4',
      agent_id: 'agent_4',
      action_type: 'tool_call',
      declared_goal: 'test',
      risk_score: 0.9,
      status: 'failed',
    };

    await fireWebhooksForApproval('org_1', 'approval_denied', action, sql);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.event).toBe('approval_denied');
    expect(body.action.status).toBe('failed');
  });

  it('resets failure_count and stamps last_triggered_at on successful approval delivery', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        // SELECT webhooks (carries failure_count so failure state can update)
        [{ id: 'wh_1', url: 'https://example.com/hook', secret: 'sec', events: '["all"]', failure_count: 3 }],
        [], // delivery INSERT
        [], // failure state UPDATE
      ],
    });
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    const action = {
      action_id: 'act_7',
      agent_id: 'agent_7',
      action_type: 'deploy',
      declared_goal: 'test',
      risk_score: 90,
      status: 'pending_approval',
    };

    await fireWebhooksForApproval('org_1', 'approval_pending', action, sql);
    await new Promise((r) => setTimeout(r, 50));

    const updateCall = sql.taggedCalls.find((c) => c.text.includes('UPDATE webhooks'));
    expect(updateCall).toBeDefined();
    expect(updateCall.text).toContain('failure_count = 0');
    expect(updateCall.text).toContain('last_triggered_at');
  });

  it('increments failure_count when an approval delivery fails', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'wh_1', url: 'https://example.com/hook', secret: 'sec', events: '["all"]', failure_count: 2 }],
        [], // delivery INSERT
        [], // failure state UPDATE
      ],
    });
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'error' });

    const action = {
      action_id: 'act_8',
      agent_id: 'agent_8',
      action_type: 'deploy',
      declared_goal: 'test',
      risk_score: 90,
      status: 'pending_approval',
    };

    await fireWebhooksForApproval('org_1', 'approval_pending', action, sql);
    await new Promise((r) => setTimeout(r, 50));

    const updateCall = sql.taggedCalls.find((c) => c.text.includes('UPDATE webhooks'));
    expect(updateCall).toBeDefined();
    // The count is computed in the statement, so none is bound as a parameter.
    expect(updateCall.text).toContain('failure_count = COALESCE(failure_count, 0) + 1');
    expect(updateCall.values).not.toContain(3);
  });

  it('does not throw when db query fails', async () => {
    const sql = createSqlMock({ taggedResponses: [] });
    // Override to throw
    const throwingSql = (...args) => { throw new Error('DB connection lost'); };
    throwingSql.query = sql.query;
    throwingSql.taggedCalls = sql.taggedCalls;

    const action = { action_id: 'act_5', agent_id: 'a', action_type: 'x', declared_goal: '', risk_score: 0, status: 'pending_approval' };

    // Should not throw — error is caught internally
    await expect(fireWebhooksForApproval('org_1', 'approval_pending', action, throwingSql)).resolves.toBeUndefined();
  });

  it('uses NEXTAUTH_URL for approval and replay URLs when set', async () => {
    process.env.NEXTAUTH_URL = 'https://myapp.example.com';

    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'wh_1', url: 'https://example.com/hook', secret: 'sec', events: '["all"]' }],
        [],
      ],
    });
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    const action = {
      action_id: 'act_6',
      agent_id: 'agent_6',
      action_type: 'tool_call',
      declared_goal: 'test',
      risk_score: 0.5,
      status: 'pending_approval',
    };

    await fireWebhooksForApproval('org_1', 'approval_pending', action, sql);

    await new Promise((r) => setTimeout(r, 50));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.approval_url).toBe('https://myapp.example.com/api/approvals/act_6');
    expect(body.replay_url).toBe('https://myapp.example.com/replay/act_6');
  });
});
