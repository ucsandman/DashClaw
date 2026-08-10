import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSql = vi.fn(async () => []);

import {
  getCurrentPeriod,
  incrementUsageRollup,
  getUsageSummary,
  getUsageHistory,
  getGovernedActionsThisPeriod,
} from '@/lib/repositories/usage.repository.js';

function joinedQuery(call) {
  return call[0].join(' ');
}

describe('usage.repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockImplementation(async () => []);
  });

  describe('getCurrentPeriod', () => {
    it('formats a UTC date as YYYY-MM', () => {
      expect(getCurrentPeriod(new Date('2026-08-09T12:00:00Z'))).toBe('2026-08');
    });

    it('zero-pads single-digit months', () => {
      expect(getCurrentPeriod(new Date('2026-01-31T23:59:59Z'))).toBe('2026-01');
    });

    it('uses UTC, not local time, at month boundaries', () => {
      // 2026-08-31T23:30Z is still August in UTC regardless of local offset.
      expect(getCurrentPeriod(new Date('2026-08-31T23:30:00Z'))).toBe('2026-08');
    });
  });

  describe('incrementUsageRollup', () => {
    it('upserts into usage_rollups keyed by org and current period', async () => {
      await incrementUsageRollup(mockSql, 'org_a');
      expect(mockSql).toHaveBeenCalledTimes(1);
      const call = mockSql.mock.calls[0];
      const q = joinedQuery(call);
      expect(q).toContain('INSERT INTO usage_rollups');
      expect(q).toContain('ON CONFLICT (org_id, period)');
      const values = call.slice(1);
      expect(values).toContain('org_a');
      expect(values).toContain(getCurrentPeriod());
    });

    it('counts a non-blocked action as governed only (blocked delta 0)', async () => {
      await incrementUsageRollup(mockSql, 'org_a');
      const values = mockSql.mock.calls[0].slice(1);
      expect(values).toContain(0);
      expect(values).not.toContain(1 + 1); // no stray deltas
    });

    it('counts a blocked action in both governed_actions and blocked_actions', async () => {
      await incrementUsageRollup(mockSql, 'org_a', { blocked: true });
      const values = mockSql.mock.calls[0].slice(1);
      expect(values).toContain(1);
      expect(values).not.toContain(0);
    });

    it('never throws when the upsert fails (metering must not break the action path)', async () => {
      mockSql.mockRejectedValue(new Error('db down'));
      await expect(incrementUsageRollup(mockSql, 'org_a')).resolves.toBeUndefined();
    });
  });

  describe('getUsageSummary', () => {
    beforeEach(() => {
      mockSql.mockImplementation(async (strings) => {
        const q = strings.join(' ');
        if (q.includes('FROM usage_rollups')) {
          return [{ governed_actions: 42, blocked_actions: 3 }];
        }
        if (q.includes('FROM users')) return [{ total: 2 }];
        if (q.includes('FROM api_keys')) return [{ total: 4 }];
        if (q.includes('FROM organizations')) {
          return [{ plan: 'free', hosted_mode: true, trial_action_cap: 10000, trial_actions_used: 42 }];
        }
        return [];
      });
    });

    it('returns the current period counters, seats, and trial info', async () => {
      const summary = await getUsageSummary(mockSql, 'org_a');
      expect(summary.period).toBe(getCurrentPeriod());
      expect(summary.governed_actions).toBe(42);
      expect(summary.blocked_actions).toBe(3);
      expect(summary.seats).toEqual({ users: 2, active_api_keys: 4 });
      expect(summary.trial).toEqual({ action_cap: 10000, actions_used: 42 });
      expect(summary.plan).toBe('free');
    });

    it('scopes every query to the caller org', async () => {
      await getUsageSummary(mockSql, 'org_a');
      expect(mockSql.mock.calls.length).toBeGreaterThanOrEqual(4);
      for (const call of mockSql.mock.calls) {
        expect(call.slice(1)).toContain('org_a');
      }
    });

    it('returns zero counters when no rollup row exists yet', async () => {
      mockSql.mockImplementation(async (strings) => {
        const q = strings.join(' ');
        if (q.includes('FROM organizations')) {
          return [{ plan: 'free', hosted_mode: false, trial_action_cap: null, trial_actions_used: 0 }];
        }
        if (q.includes('FROM users') || q.includes('FROM api_keys')) return [{ total: 0 }];
        return [];
      });
      const summary = await getUsageSummary(mockSql, 'org_a');
      expect(summary.governed_actions).toBe(0);
      expect(summary.blocked_actions).toBe(0);
      expect(summary.trial).toBeNull();
    });

    it('coerces stringified counts to numbers (pg numeric returns strings)', async () => {
      mockSql.mockImplementation(async (strings) => {
        const q = strings.join(' ');
        if (q.includes('FROM usage_rollups')) return [{ governed_actions: '7', blocked_actions: '1' }];
        if (q.includes('FROM users')) return [{ total: '2' }];
        if (q.includes('FROM api_keys')) return [{ total: '3' }];
        if (q.includes('FROM organizations')) {
          return [{ plan: 'free', hosted_mode: false, trial_action_cap: null, trial_actions_used: 0 }];
        }
        return [];
      });
      const summary = await getUsageSummary(mockSql, 'org_a');
      expect(summary.governed_actions).toBe(7);
      expect(summary.seats.users).toBe(2);
      expect(summary.seats.active_api_keys).toBe(3);
    });
  });

  describe('getGovernedActionsThisPeriod', () => {
    it('returns the current period governed_actions count, org-scoped', async () => {
      mockSql.mockImplementation(async (strings) => {
        const q = strings.join(' ');
        if (q.includes('FROM usage_rollups')) return [{ governed_actions: 51 }];
        return [];
      });
      const count = await getGovernedActionsThisPeriod(mockSql, 'org_a');
      expect(count).toBe(51);
      const call = mockSql.mock.calls[0];
      expect(call.slice(1)).toContain('org_a');
      expect(call.slice(1)).toContain(getCurrentPeriod());
    });

    it('returns 0 when no rollup row exists yet for the period', async () => {
      mockSql.mockImplementation(async () => []);
      expect(await getGovernedActionsThisPeriod(mockSql, 'org_a')).toBe(0);
    });

    it('coerces a stringified pg numeric count', async () => {
      mockSql.mockImplementation(async () => [{ governed_actions: '250000' }]);
      expect(await getGovernedActionsThisPeriod(mockSql, 'org_a')).toBe(250_000);
    });
  });

  describe('getUsageHistory', () => {
    it('returns org-scoped rows ordered by period descending with a month limit', async () => {
      mockSql.mockResolvedValue([
        { period: '2026-08', governed_actions: 42, blocked_actions: 3 },
        { period: '2026-07', governed_actions: 10, blocked_actions: 0 },
      ]);
      const rows = await getUsageHistory(mockSql, 'org_a', 12);
      expect(rows).toHaveLength(2);
      const call = mockSql.mock.calls[0];
      const q = joinedQuery(call);
      expect(q).toContain('FROM usage_rollups');
      expect(q).toContain('ORDER BY period DESC');
      const values = call.slice(1);
      expect(values).toContain('org_a');
      expect(values).toContain(12);
    });
  });
});
