import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockValidateGuardInput, mockEvaluateGuard, mockListGuardDecisions, mockGetAssumptionAlerts } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockValidateGuardInput: vi.fn(),
  mockEvaluateGuard: vi.fn(),
  mockListGuardDecisions: vi.fn(),
  mockGetAssumptionAlerts: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/validate', () => ({ validateGuardInput: mockValidateGuardInput }));
vi.mock('@/lib/guard', () => ({ evaluateGuard: mockEvaluateGuard }));
vi.mock('@/lib/repositories/guard.repository.js', () => ({ listGuardDecisions: mockListGuardDecisions }));
vi.mock('@/lib/repositories/jti-replay.repository.js', () => ({
  checkAndRecord: vi.fn(async () => 'unique'),
  sweep: vi.fn(async () => 0),
}));
vi.mock('@/lib/assumption-notify', () => ({
  getAssumptionAlerts: mockGetAssumptionAlerts,
}));

import { POST } from '@/api/guard/route.js';

const guardPost = (data) => {
  mockValidateGuardInput.mockReturnValue({ valid: true, data, errors: [] });
  return POST(makeRequest('http://localhost/api/guard', {
    headers: { 'x-org-id': 'org_1' },
    body: data,
  }));
};

describe('guard POST — assumption_alerts advisory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    mockSql.mockImplementation(async () => []);
    mockSql.query.mockImplementation(async () => []);
    mockGetAssumptionAlerts.mockResolvedValue(null);
  });

  it('attaches alerts for the calling agent', async () => {
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', reasons: [], warnings: [], matched_policies: [] });
    mockGetAssumptionAlerts.mockResolvedValue([{ message_id: 'msg_1', assumption_id: 'asm_1' }]);
    const res = await guardPost({ agent_id: 'coder-1', action_type: 'x', declared_goal: 'y' });
    const json = await res.json();
    expect(json.decision).toBe('allow');
    expect(json.assumption_alerts).toEqual([{ message_id: 'msg_1', assumption_id: 'asm_1' }]);
    expect(mockGetAssumptionAlerts).toHaveBeenCalledWith(mockSql, 'org_1', 'coder-1');
  });

  it('omits the field when there are no alerts', async () => {
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', reasons: [], warnings: [], matched_policies: [] });
    mockGetAssumptionAlerts.mockResolvedValue(null);
    const res = await guardPost({ agent_id: 'coder-1', action_type: 'x', declared_goal: 'y' });
    const json = await res.json();
    expect('assumption_alerts' in json).toBe(false);
  });

  it('never calls the lookup without an agent_id', async () => {
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', reasons: [], warnings: [], matched_policies: [] });
    const res = await guardPost({ action_type: 'x', declared_goal: 'y' });
    await res.json();
    expect(mockGetAssumptionAlerts).not.toHaveBeenCalled();
  });

  it('decision is unchanged when alerts are present on a block', async () => {
    mockEvaluateGuard.mockResolvedValue({ decision: 'block', reasons: ['Blocked'], warnings: [], matched_policies: [] });
    mockGetAssumptionAlerts.mockResolvedValue([{ message_id: 'msg_1' }]);
    const res = await guardPost({ agent_id: 'coder-1', action_type: 'x', declared_goal: 'y' });
    const json = await res.json();
    expect(json.decision).toBe('block');
    expect(json.assumption_alerts).toHaveLength(1);
  });
});
