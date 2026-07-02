import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSql = vi.fn();
const mockGetAssumption = vi.fn();
const mockUpdateAssumption = vi.fn();
const mockNotify = vi.fn();

vi.mock('../../app/lib/db', () => ({ getSql: () => mockSql }));
vi.mock('../../app/lib/org', () => ({ getOrgId: () => 'org_1' }));
vi.mock('../../app/lib/security', () => ({ redactAny: (v) => v }));
vi.mock('../../app/lib/repositories/assumptions.repository', () => ({
  getAssumption: (...a) => mockGetAssumption(...a),
  updateAssumption: (...a) => mockUpdateAssumption(...a),
}));
vi.mock('../../app/lib/assumption-notify', () => ({
  notifyAssumptionInvalidated: (...a) => mockNotify(...a),
}));

const { PATCH } = await import('../../app/api/assumptions/[assumptionId]/route');

const req = (body) => new Request('http://x/api/assumptions/asm_1', {
  method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
});
const params = { params: Promise.resolve({ assumptionId: 'asm_1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAssumption.mockResolvedValue({
    id: 1, assumption_id: 'asm_1', assumption: 'flag on', invalidated: 0, action_id: 'act_1', agent_id: 'coder-1',
  });
  mockUpdateAssumption.mockResolvedValue({ assumption_id: 'asm_1', invalidated: 1, action_id: 'act_1' });
});

describe('PATCH /api/assumptions/[assumptionId] — invalidation notification', () => {
  it('notifies the owning agent and returns notification.message_id', async () => {
    mockNotify.mockResolvedValue({ message_id: 'msg_1' });
    const res = await PATCH(req({ validated: false, invalidated_reason: 'wrong' }), params);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.notification).toEqual({ message_id: 'msg_1' });
    expect(mockNotify).toHaveBeenCalledWith(mockSql, 'org_1', expect.objectContaining({
      agent_id: 'coder-1', assumption_id: 'asm_1', invalidated_reason: 'wrong', action_id: 'act_1',
    }));
  });

  it('still 200s with notification_error when notify throws', async () => {
    mockNotify.mockRejectedValue(new Error('db down'));
    const res = await PATCH(req({ validated: false, invalidated_reason: 'wrong' }), params);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.assumption).toBeTruthy();
    expect(json.notification_error).toBe('notification_failed');
  });

  it('does not notify on validate', async () => {
    const res = await PATCH(req({ validated: true }), params);
    expect(res.status).toBe(200);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('does not notify when the race-loss 409 fires', async () => {
    mockUpdateAssumption.mockResolvedValue(null);
    const res = await PATCH(req({ validated: false, invalidated_reason: 'wrong' }), params);
    expect(res.status).toBe(409);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
