import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ candidate: vi.fn(), claim: vi.fn(), evaluate: vi.fn(), invalidate: vi.fn() }));
vi.mock('@/lib/repositories/actions.repository.execution', () => ({ getExecutionCandidate: mocks.candidate, claimActionExecution: mocks.claim }));
vi.mock('@/lib/guard/evaluate', () => ({ evaluateGuard: mocks.evaluate }));
vi.mock('@/lib/guard/caches', () => ({ invalidateGuardPolicyCache: mocks.invalidate, invalidateGuardSettingsCache: mocks.invalidate, invalidateGuardRiskTemplateCache: mocks.invalidate }));
import { authorizeActionExecution } from '@/lib/guard/execution';

const input = { orgId: 'org_1', actionId: 'act_1', principalId: 'key_1', attemptId: 'attempt_123456789',
  act: { kind: 'shell', command: 'echo fixture' },
  identity: { agent_id: 'agent_1', verified: false, verification_status: 'unverified' } };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.candidate.mockResolvedValue({ action_id: 'act_1', action_type: 'read', declared_goal: 'fixture',
    guard_context: JSON.stringify({ action_type: 'read', declared_goal: 'fixture', verification_status: 'verified' }) });
  mocks.evaluate.mockResolvedValue({ decision: 'allow', decision_id: 'fresh_decision' });
  mocks.claim.mockResolvedValue({ action_id: 'act_1', execution_attempt_id: input.attemptId });
});
it('a fresh block cannot be bypassed by a previously allowed action', async () => {
  mocks.evaluate.mockResolvedValue({ decision: 'block', decision_id: 'fresh_block' });
  expect(await authorizeActionExecution({} as never, input)).toBeNull();
  expect(mocks.claim).not.toHaveBeenCalled();
});
it('claim uses fresh persisted policy authority and current identity', async () => {
  expect(await authorizeActionExecution({} as never, input)).toBeTruthy();
  expect(mocks.evaluate.mock.calls[0]?.[1]).toMatchObject({ verification_status: 'unverified', action_id: 'act_1', act: input.act });
  expect(mocks.claim).toHaveBeenCalledWith({}, expect.objectContaining({ decisionId: 'fresh_decision', principalId: 'key_1' }));
  expect(mocks.invalidate).toHaveBeenCalledWith('org_1');
});
it('verified-subject continuity and eligible record are required', async () => {
  mocks.candidate.mockResolvedValueOnce({ identity_verified: true });
  expect(await authorizeActionExecution({} as never, input)).toBeNull();
  mocks.candidate.mockResolvedValueOnce(null);
  expect(await authorizeActionExecution({} as never, input)).toBeNull();
  expect(mocks.evaluate).not.toHaveBeenCalled();
  expect(mocks.claim).not.toHaveBeenCalled();
});
it('an unfinished policy evaluation cannot grant execution', async () => {
  mocks.evaluate.mockResolvedValue({ decision: 'allow', decision_id: 'degraded', degraded: true });
  expect(await authorizeActionExecution({} as never, input)).toBeNull();
  expect(mocks.claim).not.toHaveBeenCalled();
});
it('a new containment requirement cannot authorize an old direct execution', async () => {
  mocks.evaluate.mockResolvedValue({ decision: 'allow_contained', decision_id: 'new_containment',
    containment: { status: 'contained', ref: 'dashclaw/contained-fixture' } });
  expect(await authorizeActionExecution({} as never, input)).toBeNull();
  expect(mocks.claim).not.toHaveBeenCalled();
});
it('an originally contained action claims only its original containment target', async () => {
  mocks.candidate.mockResolvedValue({ action_type: 'read', declared_goal: 'fixture', guard_context: '{}',
    containment_status: 'contained', containment_ref: 'dashclaw/contained-fixture' });
  mocks.evaluate.mockResolvedValue({ decision: 'allow_contained', decision_id: 'same_containment',
    containment: { status: 'contained', ref: 'dashclaw/contained-fixture' } });
  expect(await authorizeActionExecution({} as never, input)).toBeTruthy();
  mocks.evaluate.mockResolvedValue({ decision: 'allow_contained', decision_id: 'changed_containment',
    containment: { status: 'contained', ref: 'dashclaw/contained-other' } });
  expect(await authorizeActionExecution({} as never, input)).toBeNull();
  expect(mocks.claim).toHaveBeenCalledTimes(1);
});

// --- folded claim (POST /api/guard?record=true passes the verdict it just computed) ---
it('a fresh decision from the same request is reused: no second evaluation, no cache flush', async () => {
  const fresh = { decision: 'allow', decision_id: 'gd_same_request', degraded: false, containment: null };
  expect(await authorizeActionExecution({} as never, { ...input, freshDecision: fresh })).toBeTruthy();
  expect(mocks.evaluate).not.toHaveBeenCalled();
  expect(mocks.invalidate).not.toHaveBeenCalled();
  expect(mocks.claim).toHaveBeenCalledWith({}, expect.objectContaining({ decisionId: 'gd_same_request', attemptId: input.attemptId }));
});
it('a fresh decision still needs an eligible, identity-continuous record', async () => {
  const fresh = { decision: 'allow', decision_id: 'gd_same_request' };
  mocks.candidate.mockResolvedValueOnce(null);
  expect(await authorizeActionExecution({} as never, { ...input, freshDecision: fresh })).toBeNull();
  mocks.candidate.mockResolvedValueOnce({ identity_verified: true });
  expect(await authorizeActionExecution({} as never, { ...input, freshDecision: fresh })).toBeNull();
  expect(mocks.claim).not.toHaveBeenCalled();
});
it('a fresh decision that is not permissive, is degraded, or lacks an id cannot claim', async () => {
  for (const fresh of [
    { decision: 'block', decision_id: 'gd_1' },
    { decision: 'require_approval', decision_id: 'gd_2' },
    { decision: 'allow', decision_id: 'gd_3', degraded: true },
    { decision: 'allow' },
  ]) {
    expect(await authorizeActionExecution({} as never, { ...input, freshDecision: fresh })).toBeNull();
  }
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.evaluate).not.toHaveBeenCalled();
});
it('a fresh allow_contained verdict is held to the same containment binding as a re-evaluation', async () => {
  const fresh = { decision: 'allow_contained', decision_id: 'gd_c', containment: { ref: 'dashclaw/contained-fixture' } };
  // recorded row is not contained -> no claim
  expect(await authorizeActionExecution({} as never, { ...input, freshDecision: fresh })).toBeNull();
  mocks.candidate.mockResolvedValueOnce({ action_id: 'act_1', containment_status: 'contained', containment_ref: 'dashclaw/contained-fixture' });
  expect(await authorizeActionExecution({} as never, { ...input, freshDecision: fresh })).toBeTruthy();
});
