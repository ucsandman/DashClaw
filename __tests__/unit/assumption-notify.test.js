import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSql = vi.fn();
const mockCreateMessage = vi.fn();
const mockPublish = vi.fn();

vi.mock('../../app/lib/repositories/messagesContext.repository', () => ({
  createMessage: (...args) => mockCreateMessage(...args),
}));
vi.mock('../../app/lib/events', () => ({
  EVENTS: { MESSAGE_CREATED: 'message.created' },
  publishOrgEvent: (...args) => mockPublish(...args),
}));

const { notifyAssumptionInvalidated, getAssumptionAlerts, __resetAssumptionAlertCache, ASSUMPTION_INVALIDATED_TYPE } =
  await import('../../app/lib/assumption-notify');

beforeEach(() => {
  vi.clearAllMocks();
  __resetAssumptionAlertCache();
});

describe('notifyAssumptionInvalidated', () => {
  const input = {
    agent_id: 'coder-1',
    assumption_id: 'asm_abc',
    assumption: 'the flag is enabled',
    invalidated_reason: 'flag is OFF in prod',
    invalidated_at: '2026-07-02T00:00:00.000Z',
    action_id: 'act_1',
  };

  it('creates a direct message with the JSON directive and doc_ref', async () => {
    mockCreateMessage.mockResolvedValue({ id: 'msg_x' });
    const out = await notifyAssumptionInvalidated(mockSql, 'org_1', input);
    expect(out).toEqual({ message_id: expect.stringMatching(/^msg_/) });
    const payload = mockCreateMessage.mock.calls[0][1];
    expect(payload.to_agent_id).toBe('coder-1');
    expect(payload.message_type).toBe(ASSUMPTION_INVALIDATED_TYPE);
    expect(payload.doc_ref).toBe('asm_abc');
    expect(payload.urgent).toBe(true);
    const body = JSON.parse(payload.body);
    expect(body).toMatchObject({
      directive: 'assumption_invalidated',
      assumption_id: 'asm_abc',
      invalidated_reason: 'flag is OFF in prod',
      action_id: 'act_1',
    });
    expect(mockPublish).toHaveBeenCalledWith('message.created', expect.objectContaining({ orgId: 'org_1' }));
  });

  it('returns null (no message) when the assumption has no owning agent', async () => {
    const out = await notifyAssumptionInvalidated(mockSql, 'org_1', { ...input, agent_id: null });
    expect(out).toBeNull();
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });
});

describe('getAssumptionAlerts', () => {
  const row = (id) => ({
    id,
    body: JSON.stringify({
      directive: 'assumption_invalidated',
      assumption_id: 'asm_abc',
      assumption: 'x',
      invalidated_reason: 'r',
      action_id: 'act_1',
      invalidated_at: 't',
    }),
    created_at: 't',
  });

  it('returns parsed alerts for unread messages', async () => {
    mockSql.mockResolvedValueOnce([row('msg_1')]);
    const alerts = await getAssumptionAlerts(mockSql, 'org_1', 'coder-1');
    expect(alerts).toEqual([
      { message_id: 'msg_1', assumption_id: 'asm_abc', assumption: 'x', invalidated_reason: 'r', action_id: 'act_1', invalidated_at: 't' },
    ]);
  });

  it('caches the empty result for 30s (second call skips the query)', async () => {
    mockSql.mockResolvedValueOnce([]);
    expect(await getAssumptionAlerts(mockSql, 'org_1', 'coder-1')).toBeNull();
    expect(await getAssumptionAlerts(mockSql, 'org_1', 'coder-1')).toBeNull();
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('notify clears the negative cache so new alerts surface immediately', async () => {
    mockSql.mockResolvedValueOnce([]);
    await getAssumptionAlerts(mockSql, 'org_1', 'coder-1');
    mockCreateMessage.mockResolvedValue({ id: 'msg_x' });
    await notifyAssumptionInvalidated(mockSql, 'org_1', {
      agent_id: 'coder-1', assumption_id: 'asm_abc', assumption: 'x',
      invalidated_reason: 'r', invalidated_at: 't', action_id: 'act_1',
    });
    mockSql.mockResolvedValueOnce([row('msg_2')]);
    const alerts = await getAssumptionAlerts(mockSql, 'org_1', 'coder-1');
    expect(alerts).toHaveLength(1);
  });

  it('swallows query errors and returns null (advisory must not break guard)', async () => {
    mockSql.mockRejectedValueOnce(new Error('boom'));
    expect(await getAssumptionAlerts(mockSql, 'org_1', 'coder-1')).toBeNull();
  });

  it('escapes LIKE metacharacters in the family-prefix pattern', async () => {
    mockSql.mockResolvedValueOnce([]);
    await getAssumptionAlerts(mockSql, 'org_1', 'we%ird_agent');
    // Tagged-template call: (strings, ...values). The LIKE pattern is the last value.
    const values = mockSql.mock.calls[0].slice(1);
    expect(values).toContain('we\\%ird\\_agent:%');
  });

  it('returns null without querying when agentId is missing', async () => {
    expect(await getAssumptionAlerts(mockSql, 'org_1', null)).toBeNull();
    expect(mockSql).not.toHaveBeenCalled();
  });
});
