import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/guard', () => ({ getOrgHaltState: vi.fn(async () => null) }));
vi.mock('@/lib/repositories/guard.repository', () => ({
  getGuardDecisionByIdempotencyKey: vi.fn(async () => ({
    id: 'gd_restrictive', decision: 'require_approval',
    context: JSON.stringify({ action_type: 'read', agent_id: 'agent', replay_status: 'not_applicable' }),
  })),
}));
vi.mock('@/lib/guard/route-record', () => ({
  attachAssumptionAlerts: vi.fn(async () => undefined),
  recordRunningAction: vi.fn(async () => ({ recorded: true, action_id: 'act_existing' })),
}));

import { tryIdempotentReplay } from '@/lib/guard/route-replay';

describe('restrictive replay execution protocol', () => {
  it('retains claim negotiation when a retried approval later allows execution', async () => {
    const response = await tryIdempotentReplay(vi.fn() as never, 'org', {
      idempotency_key: 'retry', action_type: 'read', agent_id: 'agent',
    }, { secretScan: null, recordParam: true, createdBy: 'principal' });
    expect(response).not.toBeNull();
    expect(await response!.json()).toMatchObject({
      decision: 'require_approval', idempotent_replay: true,
      recorded: true, action_id: 'act_existing',
      execution_claim_required: true, claim_protocol: 1,
    });
  });
});
