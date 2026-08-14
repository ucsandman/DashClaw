import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockListActions, mockGetContexts, mockSweep, mockMaybeSweep } = vi.hoisted(() => ({
  mockListActions: vi.fn(),
  mockGetContexts: vi.fn(async () => new Map()),
  mockSweep: vi.fn(async () => []),
  mockMaybeSweep: vi.fn(async () => []),
}));

vi.mock('@/lib/repositories/actions.repository', () => ({
  listActions: mockListActions,
  getGuardContextsByIds: mockGetContexts,
  sweepExpiredApprovals: mockSweep,
  maybeSweepLostOutcomes: mockMaybeSweep,
}));

import { enrichWithPlainLanguage } from '@/api/actions/route';

describe('enrichWithPlainLanguage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('attaches a plain description built from the joined guard context', async () => {
    const rows = [{ action_id: 'a1', guard_decision_id: 'gd_1', declared_goal: 'Bash: rm -rf build/', risk_score: 85 }];
    mockGetContexts.mockResolvedValueOnce(new Map([['gd_1', { intel: { bash: { intent: 'destructive', reversible: false } } }]]));

    const out = await enrichWithPlainLanguage({}, 'org_1', rows);
    expect(out[0].plain.headline).toContain('build/');
    expect(out[0].plain.reversible).toBe(false);
  });

  it('still attaches a description when the row has no guard decision', async () => {
    const rows = [{ action_id: 'a1', guard_decision_id: null, declared_goal: 'Write: app/page.tsx', target: 'app/page.tsx', risk_score: 10 }];
    const out = await enrichWithPlainLanguage({}, 'org_1', rows);
    expect(out[0].plain.confidence).toBe('high');
    expect(mockGetContexts).toHaveBeenCalledWith({}, 'org_1', []);
  });

  it('degrades to an untranslated card when the context read fails', async () => {
    mockGetContexts.mockRejectedValueOnce(new Error('db down'));
    const rows = [{ action_id: 'a1', guard_decision_id: 'gd_1', declared_goal: 'Bash: rm -rf build/', risk_score: 85 }];
    const out = await enrichWithPlainLanguage({}, 'org_1', rows);
    expect(out[0].plain).toBeDefined();
    expect(out[0].action_id).toBe('a1');
  });

  it('makes exactly one context query for a whole page', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ action_id: `a${i}`, guard_decision_id: `gd_${i}`, declared_goal: 'Bash: ls', risk_score: 5 }));
    await enrichWithPlainLanguage({}, 'org_1', rows);
    expect(mockGetContexts).toHaveBeenCalledTimes(1);
  });

  // RFC 2026-08-13 §6 posture visibility: /approvals rows surface WHICH
  // regime produced the verdict, read-time from the guard context sibling.
  it('surfaces a compact external_verdict regime from the guard context', async () => {
    const rows = [{ action_id: 'a1', guard_decision_id: 'gd_1', declared_goal: 'Bash: ls', risk_score: 5 }];
    mockGetContexts.mockResolvedValueOnce(new Map([['gd_1', {
      _external_verdict: {
        provider_id: 'agent-memory-pama', status: 'ok', regime: 'external+local',
        raw_verdict: 'escalate', mapped_verdict: 'require_approval', posture: 'fail_closed', latency_ms: 42,
      },
    }]]));
    const out = await enrichWithPlainLanguage({}, 'org_1', rows);
    expect(out[0].external_verdict).toEqual({
      regime: 'external+local', raw_verdict: 'escalate', provider_id: 'agent-memory-pama',
    });
  });

  it('leaves external_verdict undefined for local-only decisions', async () => {
    const rows = [{ action_id: 'a1', guard_decision_id: 'gd_1', declared_goal: 'Bash: ls', risk_score: 5 }];
    mockGetContexts.mockResolvedValueOnce(new Map([['gd_1', { target: 'x' }]]));
    const out = await enrichWithPlainLanguage({}, 'org_1', rows);
    expect(out[0].external_verdict).toBeUndefined();
  });
});
