import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFloodState, mockCost } = vi.hoisted(() => ({
  mockFloodState: vi.fn(async () => ({})),
  mockCost: vi.fn(async () => ({ attribution: { attributed_count: 100, total_count: 100, coverage_pct: 100 } })),
}));
vi.mock('../../app/lib/approval-flood', () => ({ getFloodState: mockFloodState, FLEET_KEY: '_fleet' }));
vi.mock('../../app/lib/repositories/actions.repository', () => ({ getCostAggregation: mockCost }));

// Mocks required to import hashSignal from the cron route without side-effects.
// signals.js is NOT mocked here — the existing tests use the real computeSignals.
vi.mock('../../app/lib/db.js', () => ({ getSql: vi.fn() }));
vi.mock('../../app/lib/webhooks.js', () => ({ fireWebhooksForOrg: vi.fn() }));
vi.mock('../../app/lib/notifications.js', () => ({ sendSignalAlertEmail: vi.fn() }));
vi.mock('../../app/lib/audit.js', () => ({ logActivity: vi.fn() }));
vi.mock('../../app/lib/timing-safe.js', () => ({ timingSafeCompare: vi.fn() }));
vi.mock('../../app/lib/events.js', () => ({ EVENTS: {}, publishOrgEvent: vi.fn() }));
vi.mock('../../app/lib/repositories/signals.repository.js', () => ({
  getExistingSignalHashes: vi.fn(),
  upsertSignalSnapshots: vi.fn(),
}));

import { computeSignals } from '../../app/lib/signals';
import { hashSignal } from '../../app/api/cron/signals/route';

// Tagged-template sql mock: every category query resolves empty.
function emptySql() {
  const fn = vi.fn(async () => []);
  fn.query = vi.fn(async () => []);
  return fn;
}

beforeEach(() => vi.clearAllMocks());

describe('W3 signals', () => {
  it('emits a red approval_flood signal per tripped entry', async () => {
    mockFloodState.mockResolvedValue({ gp_a: { tripped_at: '2026-06-11T00:00:00Z', count: 47 } });
    mockCost.mockResolvedValue({ attribution: { attributed_count: 100, total_count: 100, coverage_pct: 100 } });
    const signals = await computeSignals('org1', null, emptySql());
    const flood = signals.find((s) => s.type === 'approval_flood');
    expect(flood).toBeTruthy();
    expect(flood.severity).toBe('red');
    expect(flood.policy_id).toBe('gp_a');
  });

  it('emits amber coverage_drop below 90% with enough volume', async () => {
    mockCost.mockResolvedValue({ attribution: { attributed_count: 40, total_count: 100, coverage_pct: 40 } });
    const signals = await computeSignals('org1', null, emptySql());
    expect(signals.find((s) => s.type === 'coverage_drop')?.severity).toBe('amber');
  });

  it('stays silent on low volume even with low coverage', async () => {
    mockCost.mockResolvedValue({ attribution: { attributed_count: 1, total_count: 10, coverage_pct: 10 } });
    const signals = await computeSignals('org1', null, emptySql());
    expect(signals.find((s) => s.type === 'coverage_drop')).toBeUndefined();
  });
});

it('dedup hash distinguishes approval_flood signals by policy_id', () => {
  const base = { type: 'approval_flood', agent_id: null, action_id: null, loop_id: null, assumption_id: null, session_id: null, provider: null };
  const a = hashSignal({ ...base, policy_id: 'gp_a' });
  const b = hashSignal({ ...base, policy_id: 'gp_b' });
  expect(a).not.toBe(b);
  expect(hashSignal({ ...base, policy_id: 'gp_a' })).toBe(a);
});
