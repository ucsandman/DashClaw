// Pins the G4 metering side effect to the SINGLE action-creation funnel.
// Both creation paths (POST /api/actions and POST /api/guard?record=true)
// go through createActionRecord, so incrementing there keeps the two paths
// in side-effect parity by construction (see guard-record parity bug class,
// commit e96183dc).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSql, mockIncrement } = vi.hoisted(() => ({
  mockSql: vi.fn(async () => [{ action_id: 'act_1' }]),
  mockIncrement: vi.fn(async () => undefined),
}));

vi.mock('@/lib/repositories/usage.repository.js', () => ({
  incrementUsageRollup: mockIncrement,
}));

import {
  createActionRecord,
  createBlockedActionRecord,
} from '@/lib/repositories/actions.repository.js';

const basePayload = {
  orgId: 'org_a',
  action_id: 'act_1',
  data: {},
  actionStatus: 'running',
  signature: null,
  verified: false,
  timestamp_start: '2026-08-09T00:00:00.000Z',
  riskScore: 0,
};

describe('usage rollup increment parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockImplementation(async () => [{ action_id: 'act_1' }]);
  });

  it('createActionRecord bumps the rollup for the action org', async () => {
    await createActionRecord(mockSql, { ...basePayload });
    expect(mockIncrement).toHaveBeenCalledTimes(1);
    expect(mockIncrement).toHaveBeenCalledWith(mockSql, 'org_a', { blocked: false });
  });

  it('marks blocked creations as blocked in the rollup', async () => {
    await createActionRecord(mockSql, { ...basePayload, actionStatus: 'blocked' });
    expect(mockIncrement).toHaveBeenCalledWith(mockSql, 'org_a', { blocked: true });
  });

  it('createBlockedActionRecord (guard block path) counts as blocked via the shared funnel', async () => {
    await createBlockedActionRecord(mockSql, {
      orgId: 'org_a',
      action_id: 'act_1',
      data: {},
      guardDecision: null,
      signature: null,
      verified: false,
      timestamp_start: '2026-08-09T00:00:00.000Z',
      riskScore: 5,
    });
    expect(mockIncrement).toHaveBeenCalledTimes(1);
    expect(mockIncrement).toHaveBeenCalledWith(mockSql, 'org_a', { blocked: true });
  });

  it('does not count an action whose insert failed', async () => {
    mockSql.mockRejectedValue(new Error('insert failed'));
    await expect(createActionRecord(mockSql, { ...basePayload })).rejects.toThrow('insert failed');
    expect(mockIncrement).not.toHaveBeenCalled();
  });
});
