/**
 * app/lib/repositories/hosted-workspace.repository.ts — v4.6 funnel truth:
 * live-facts SQL shape, snapshot-before-delete (fail-closed), cap-0 skip,
 * pure funnel math (truthful zeros, week-1 eligibility, cohorts, median).
 * Spec: docs/superpowers/specs/2026-07-05-funnel-truth-design.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  queryLiveTrialFacts,
  snapshotTrialFunnelFacts,
  deleteHostedWorkspace,
  computeFunnelAggregates,
  getTrialFunnel,
  type TrialFunnelFacts,
} from '../../app/lib/repositories/hosted-workspace.repository';
import type { SqlTag } from '../../app/lib/types/db';

type Call = { text: string; values: unknown[] };

function makeSqlMock(responses: unknown[][], opts: { failOn?: (text: string) => boolean } = {}) {
  const queue = [...responses];
  const calls: Call[] = [];
  const fn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ');
    calls.push({ text, values });
    if (opts.failOn?.(text)) return Promise.reject(new Error('injected failure'));
    return Promise.resolve(queue.shift() ?? []);
  }) as unknown as SqlTag & { calls: Call[]; query: ReturnType<typeof vi.fn> };
  (fn as unknown as { calls: Call[] }).calls = calls;
  (fn as unknown as { query: unknown }).query = vi.fn(async () => []);
  return fn;
}

beforeEach(() => vi.clearAllMocks());

const factsRow = {
  org_id: 'org_abc',
  minted_at_ms: 1_000,
  key_used: true,
  first_action_at_ms: 5_000,
  last_action_at_ms: 700_000_000, // ≥ 7 days after mint
  action_count: 42,
};

// ─────────────────────────────────────────────────────────────── facts ─────

describe('queryLiveTrialFacts', () => {
  it('filters to real mints and excludes synthetic traffic in SQL', async () => {
    const sql = makeSqlMock([[factsRow]]);
    const facts = await queryLiveTrialFacts(sql, null);
    const { text } = sql.calls[0]!;
    expect(text).toContain('hosted_mode = TRUE');
    expect(text).toContain('trial_action_cap > 0');
    expect(text).toContain('NOT LIKE ALL');
    expect(text).toContain('::timestamptz');
    expect(text).toContain('last_used_at IS NOT NULL');
    expect(facts).toEqual([{
      orgId: 'org_abc', mintedAtMs: 1000, keyUsed: true,
      firstActionAtMs: 5000, lastActionAtMs: 700_000_000,
      actionCount: 42, frozenRetainedWeek1: null, archived: false,
    }]);
  });

  it('coerces pg string numerics and null activity', async () => {
    const sql = makeSqlMock([[{
      org_id: 'org_x', minted_at_ms: '1000', key_used: false,
      first_action_at_ms: null, last_action_at_ms: null, action_count: '0',
    }]]);
    const [f] = await queryLiveTrialFacts(sql, 'org_x');
    expect(f).toMatchObject({ mintedAtMs: 1000, keyUsed: false, firstActionAtMs: null, actionCount: 0 });
  });
});

// ──────────────────────────────────────────────────────────── snapshot ─────

describe('snapshotTrialFunnelFacts', () => {
  it('inserts a frozen row with retained_week1 computed from last activity', async () => {
    const sql = makeSqlMock([[factsRow], []]);
    const r = await snapshotTrialFunnelFacts(sql, 'org_abc');
    expect(r.snapshotted).toBe(true);
    const insert = sql.calls[1]!;
    expect(insert.text).toContain('INSERT INTO hosted_trial_snapshots');
    expect(insert.text).toContain('ON CONFLICT (org_id) DO NOTHING');
    // values: orgId, mintedAtMs, keyUsed, firstIso, lastIso, count, retained
    expect(insert.values[0]).toBe('org_abc');
    expect(insert.values[6]).toBe(true); // 700_000_000ms - 1000ms ≥ 7 days
  });

  it('skips cap-0 placeholders (no facts row → no insert)', async () => {
    const sql = makeSqlMock([[]]);
    const r = await snapshotTrialFunnelFacts(sql, 'org_full');
    expect(r.snapshotted).toBe(false);
    expect(sql.calls).toHaveLength(1);
  });
});

describe('deleteHostedWorkspace (v4.6 fail-closed snapshot)', () => {
  it('snapshots before the child sweep and before the org delete', async () => {
    const sql = makeSqlMock([
      [{ hosted_mode: true }], // existence check
      [],                      // revoke keys
      [factsRow],              // snapshot: facts
      [],                      // snapshot: insert
      [],                      // children catalog query
      [],                      // DELETE FROM organizations
    ]);
    await deleteHostedWorkspace(sql, 'org_abc');
    const texts = sql.calls.map((c) => c.text);
    const snapIdx = texts.findIndex((t) => t.includes('INSERT INTO hosted_trial_snapshots'));
    const orgDeleteIdx = texts.findIndex((t) => t.includes('DELETE FROM organizations'));
    expect(snapIdx).toBeGreaterThan(-1);
    expect(orgDeleteIdx).toBeGreaterThan(snapIdx);
  });

  it('aborts the delete when the snapshot write fails', async () => {
    const sql = makeSqlMock(
      [[{ hosted_mode: true }], [], [factsRow]],
      { failOn: (t) => t.includes('INSERT INTO hosted_trial_snapshots') },
    );
    await expect(deleteHostedWorkspace(sql, 'org_abc')).rejects.toThrow('injected failure');
    const texts = sql.calls.map((c) => c.text);
    expect(texts.some((t) => t.includes('DELETE FROM organizations'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────── aggregates ────

const DAY = 86_400_000;
const NOW = new Date('2026-07-05T00:00:00.000Z');
const mk = (over: Partial<TrialFunnelFacts>): TrialFunnelFacts => ({
  orgId: 'org_1', mintedAtMs: NOW.getTime() - 10 * DAY, keyUsed: false,
  firstActionAtMs: null, lastActionAtMs: null, actionCount: 0,
  frozenRetainedWeek1: null, archived: false, ...over,
});

describe('computeFunnelAggregates', () => {
  it('returns truthful zeros on no facts', () => {
    const agg = computeFunnelAggregates([], NOW);
    expect(agg.funnel).toEqual({ minted: 0, keyUsed: 0, firstAction: 0, retainedWeek1: 0, week1Eligible: 0, week1Pending: 0 });
    expect(agg.medianHoursToFirstAction).toBeNull();
    expect(agg.cohorts).toEqual([]);
    expect(agg.source).toEqual({ live: 0, archived: 0, truthfulSince: null });
  });

  it('a young org is week1Pending, never not-retained', () => {
    const agg = computeFunnelAggregates([mk({ mintedAtMs: NOW.getTime() - 2 * DAY })], NOW);
    expect(agg.funnel.week1Eligible).toBe(0);
    expect(agg.funnel.week1Pending).toBe(1);
    expect(agg.funnel.retainedWeek1).toBe(0);
  });

  it('retention: eligible + activity ≥7d after mint = retained; eligible without = not', () => {
    const minted = NOW.getTime() - 10 * DAY;
    const agg = computeFunnelAggregates([
      mk({ orgId: 'a', mintedAtMs: minted, lastActionAtMs: minted + 8 * DAY, firstActionAtMs: minted + DAY, keyUsed: true }),
      mk({ orgId: 'b', mintedAtMs: minted, lastActionAtMs: minted + 2 * DAY, firstActionAtMs: minted + 2 * DAY }),
    ], NOW);
    expect(agg.funnel).toMatchObject({ minted: 2, keyUsed: 1, firstAction: 2, retainedWeek1: 1, week1Eligible: 2, week1Pending: 0 });
  });

  it('archived rows use the frozen retained_week1 verdict', () => {
    const agg = computeFunnelAggregates([
      mk({ orgId: 'a', archived: true, frozenRetainedWeek1: true, mintedAtMs: NOW.getTime() - 40 * DAY }),
      mk({ orgId: 'b', archived: true, frozenRetainedWeek1: false, mintedAtMs: NOW.getTime() - 40 * DAY, lastActionAtMs: NOW.getTime() - 1 * DAY }),
    ], NOW);
    expect(agg.funnel.retainedWeek1).toBe(1);
    expect(agg.source).toMatchObject({ live: 0, archived: 2 });
  });

  it('median hours to first action (even count → average of middles, 1dp)', () => {
    const minted = NOW.getTime() - 10 * DAY;
    const agg = computeFunnelAggregates([
      mk({ orgId: 'a', mintedAtMs: minted, firstActionAtMs: minted + 3_600_000 }),
      mk({ orgId: 'b', mintedAtMs: minted, firstActionAtMs: minted + 2 * 3_600_000 }),
    ], NOW);
    expect(agg.medianHoursToFirstAction).toBe(1.5);
  });

  it('cohorts group by UTC Monday mint week, newest first, max 8', () => {
    const facts = Array.from({ length: 10 }, (_, i) =>
      mk({ orgId: `o${i}`, mintedAtMs: NOW.getTime() - i * 7 * DAY }));
    const agg = computeFunnelAggregates(facts, NOW);
    expect(agg.cohorts).toHaveLength(8);
    expect(agg.cohorts[0]!.weekStart > agg.cohorts[1]!.weekStart).toBe(true);
    expect(agg.cohorts.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.weekStart))).toBe(true);
  });

  it('truthfulSince is the earliest mint across live + archived', () => {
    const agg = computeFunnelAggregates([
      mk({ mintedAtMs: Date.parse('2026-07-01T00:00:00Z') }),
      mk({ orgId: 'o2', archived: true, frozenRetainedWeek1: false, mintedAtMs: Date.parse('2026-06-01T00:00:00Z') }),
    ], NOW);
    expect(agg.source.truthfulSince).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('getTrialFunnel', () => {
  it('merges live facts with snapshot facts', async () => {
    const sql = makeSqlMock([
      [factsRow],                                 // live
      [{ org_id: 'org_gone', minted_at_ms: 1000, key_used: true,
         first_action_at_ms: 2000, last_action_at_ms: 3000,
         action_count: 5, retained_week1: true }], // snapshots
    ]);
    const agg = await getTrialFunnel(sql, { now: NOW });
    expect(agg.funnel.minted).toBe(2);
    expect(agg.source).toMatchObject({ live: 1, archived: 1 });
  });
});
