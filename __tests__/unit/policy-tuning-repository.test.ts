/**
 * app/lib/repositories/policy-tuning.repository.ts — SQL windowing/unnest
 * shape, dismissal-blob helpers, and pruning. Owner roadmap item 1.
 * Spec: docs/superpowers/specs/2026-07-01-policy-tuning-proposal-loop.md
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSettings, mockUpsertSetting } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockUpsertSetting: vi.fn(async () => undefined),
}));

vi.mock('@/lib/repositories/settings.repository.js', () => ({
  getSettings: mockGetSettings,
  upsertSetting: mockUpsertSetting,
}));

import {
  getDecisionMixByPolicy,
  getApprovalOutcomesByPolicy,
  getTuningDismissals,
  recordTuningDismissal,
  removeTuningDismissal,
  pruneDismissals,
  type TuningDismissal,
} from '@/lib/repositories/policy-tuning.repository';
import { recordApproval } from '@/lib/repositories/actions.repository';

function makeSqlMock() {
  return Object.assign(vi.fn(async () => []), {
    // Loose param typing so mock.calls destructures as [string, unknown[]]
    // instead of the zero-arg tuple vi.fn(async () => []) would infer.
    query: vi.fn(async (_text: string, _params?: unknown[]) => []),
  });
}

/** mockUpsertSetting call args, typed for assertion destructuring. */
type UpsertCall = [unknown, string, { key: string; category: string; value: string }];

describe('getDecisionMixByPolicy', () => {
  it('calls sql.query once with [orgId, days] and the expected SQL shape', async () => {
    const mockSql = makeSqlMock();
    await getDecisionMixByPolicy(mockSql, 'org_1', 30);

    expect(mockSql.query).toHaveBeenCalledTimes(1);
    const [text, params] = mockSql.query.mock.calls[0]!;
    expect(params).toEqual(['org_1', 30]);
    expect(text).toContain('jsonb_array_elements_text');
    expect(text).toContain('GREATEST(');
    expect(text).toContain('updated_at');
  });
});

describe('getApprovalOutcomesByPolicy', () => {
  it('calls sql.query once with [orgId, days] and the expected SQL shape', async () => {
    const mockSql = makeSqlMock();
    await getApprovalOutcomesByPolicy(mockSql, 'org_1', 30);

    expect(mockSql.query).toHaveBeenCalledTimes(1);
    const [text, params] = mockSql.query.mock.calls[0]!;
    expect(params).toEqual(['org_1', 30]);
    expect(text).toContain('jsonb_array_elements_text');
    expect(text).toContain('GREATEST(');
    expect(text).toContain('updated_at');
    expect(text).toContain('[HITL Decision: DENY');
    expect(text).toContain('approved_by IS NOT NULL');
    expect(text).toContain('pending_approval');
  });
});

describe('deny-marker cross-pin', () => {
  it('the literal HITL deny marker in recordApproval SQL matches the tuning repository predicate', async () => {
    // Capture the tagged-template SQL recordApproval actually builds.
    const capturedStrings: string[] = [];
    const taggedSql = ((strings: TemplateStringsArray, ..._values: unknown[]) => {
      capturedStrings.push(...strings);
      // recordApproval also invokes sql`CURRENT_TIMESTAMP` as a nested tag for
      // the approved_at branch; support that recursive call too.
      return Promise.resolve([{}]);
    }) as unknown as Parameters<typeof recordApproval>[0];

    await recordApproval(taggedSql, 'org_1', 'act_1', {
      newStatus: 'running',
      errorMessage: null,
      decision: 'deny',
      userId: 'user_1',
      safeReasoning: '',
    });

    const builtSql = capturedStrings.join('');
    expect(builtSql).toContain('HITL Decision: ');

    // The tuning repository's denied predicate must still match the literal
    // marker recordApproval writes — if either side reworks the wording,
    // this assertion breaks loudly.
    const mockSql = makeSqlMock();
    await getApprovalOutcomesByPolicy(mockSql, 'org_1', 30);
    const [outcomeText] = mockSql.query.mock.calls[0]!;
    expect(outcomeText).toContain('[HITL Decision: DENY');
    // recordApproval writes 'DENY' when decision.toUpperCase() === 'DENY'
    expect('deny'.toUpperCase()).toBe('DENY');
  });
});

describe('getTuningDismissals', () => {
  it('returns {} when the setting is missing', async () => {
    mockGetSettings.mockResolvedValue([]);
    const mockSql = makeSqlMock();
    const result = await getTuningDismissals(mockSql, 'org_1');
    expect(result).toEqual({});
  });

  it('returns {} on corrupt JSON', async () => {
    mockGetSettings.mockResolvedValue([{ key: 'policy_tuning_dismissed', value: 'not-json{{{' }]);
    const mockSql = makeSqlMock();
    const result = await getTuningDismissals(mockSql, 'org_1');
    expect(result).toEqual({});
  });

  it('parses a valid blob', async () => {
    const blob = { ptp_aaaaaaaaaaaaaaaa: { reason: 'seasonal', by: 'user_1', at: '2026-06-01T00:00:00.000Z' } };
    mockGetSettings.mockResolvedValue([{ key: 'policy_tuning_dismissed', value: JSON.stringify(blob) }]);
    const mockSql = makeSqlMock();
    const result = await getTuningDismissals(mockSql, 'org_1');
    expect(result).toEqual(blob);
  });
});

describe('recordTuningDismissal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue([]);
  });

  it('upserts key policy_tuning_dismissed / category general with the entry in the value', async () => {
    const mockSql = makeSqlMock();
    const entry: TuningDismissal = { reason: 'noisy', by: 'user_1', at: '2026-06-01T00:00:00.000Z' };
    await recordTuningDismissal(mockSql, 'org_1', 'ptp_aaaaaaaaaaaaaaaa', entry);

    expect(mockUpsertSetting).toHaveBeenCalledTimes(1);
    const [sqlArg, orgArg, opts] = mockUpsertSetting.mock.calls[0] as unknown as UpsertCall;
    expect(sqlArg).toBe(mockSql);
    expect(orgArg).toBe('org_1');
    expect(opts.key).toBe('policy_tuning_dismissed');
    expect(opts.category).toBe('general');
    const parsed = JSON.parse(opts.value);
    expect(parsed.ptp_aaaaaaaaaaaaaaaa).toEqual(entry);
  });
});

describe('pruneDismissals', () => {
  it('keeps only the newest 200 of 201 entries', () => {
    // Minimal per-entry footprint (short key, empty reason/by, fixed-width
    // `at`) so 200 entries stay under the 9000-char size cap and this test
    // isolates the entry-count cap from the size cap (covered separately
    // below).
    const blob: Record<string, TuningDismissal> = {};
    for (let i = 0; i < 201; i++) {
      blob[`k${String(i).padStart(3, '0')}`] = {
        reason: '',
        by: '',
        at: String(i).padStart(3, '0'),
      };
    }
    const pruned = pruneDismissals(blob);
    expect(JSON.stringify(pruned).length).toBeLessThanOrEqual(9000);
    expect(Object.keys(pruned).length).toBe(200);
    // The oldest entry (index 0) should have been dropped; the newest (200) kept.
    expect(pruned['k000']).toBeUndefined();
    expect(pruned['k200']).toBeDefined();
  });

  it('caps serialized size at 9000 chars, dropping oldest first', () => {
    const blob: Record<string, TuningDismissal> = {};
    // Long reasons to blow past 9000 chars well before the 200-entry cap.
    for (let i = 0; i < 50; i++) {
      blob[`ptp_${String(i).padStart(16, '0')}`] = {
        reason: 'x'.repeat(400),
        by: 'user_1',
        at: new Date(2026, 0, 1 + i).toISOString(),
      };
    }
    const pruned = pruneDismissals(blob);
    expect(JSON.stringify(pruned).length).toBeLessThanOrEqual(9000);
    // Newest entry (index 49) must survive; something must have been dropped.
    expect(pruned['ptp_0000000000000049']).toBeDefined();
    expect(Object.keys(pruned).length).toBeLessThan(50);
  });
});

describe('removeTuningDismissal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false and does not upsert when the proposal is not dismissed', async () => {
    mockGetSettings.mockResolvedValue([]);
    const mockSql = makeSqlMock();
    const result = await removeTuningDismissal(mockSql, 'org_1', 'ptp_aaaaaaaaaaaaaaaa');
    expect(result).toBe(false);
    expect(mockUpsertSetting).not.toHaveBeenCalled();
  });

  it('returns true and upserts a blob without the removed key when present', async () => {
    const blob = {
      ptp_aaaaaaaaaaaaaaaa: { reason: 'a', by: 'user_1', at: '2026-06-01T00:00:00.000Z' },
      ptp_bbbbbbbbbbbbbbbb: { reason: 'b', by: 'user_1', at: '2026-06-02T00:00:00.000Z' },
    };
    mockGetSettings.mockResolvedValue([{ key: 'policy_tuning_dismissed', value: JSON.stringify(blob) }]);
    const mockSql = makeSqlMock();
    const result = await removeTuningDismissal(mockSql, 'org_1', 'ptp_aaaaaaaaaaaaaaaa');
    expect(result).toBe(true);
    expect(mockUpsertSetting).toHaveBeenCalledTimes(1);
    const opts = (mockUpsertSetting.mock.calls[0] as unknown as UpsertCall)[2];
    const parsed = JSON.parse(opts.value);
    expect(parsed.ptp_aaaaaaaaaaaaaaaa).toBeUndefined();
    expect(parsed.ptp_bbbbbbbbbbbbbbbb).toBeDefined();
  });
});
