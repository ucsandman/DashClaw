/**
 * Misfire derivation (spec 2026-08-20 §2.6): three holds of ONE command shape
 * inside 24h, on a Short List line, is a defect report about that line — the
 * operator's escape hatch is a shape exception, which is a click.
 *
 * Pure: deriveMisfires is a function over guard_decision rows. No mocks.
 */
import { describe, expect, it } from 'vitest';
import { deriveMisfires, MISFIRE_THRESHOLD, type MisfireRow } from '@/lib/posture/loosening';
import { commandShapeKey } from '@/lib/policy-shapes';

const NOW = '2026-08-20T12:00:00.000Z';
const minutesAgo = (m: number) => new Date(Date.parse(NOW) - m * 60_000).toISOString();

function row(policyId: string, goal: string, createdAt = minutesAgo(10)): MisfireRow {
  return { matched_policies: JSON.stringify([policyId]), declared_goal: goal, created_at: createdAt };
}

const shortList = new Set(['p_hold']);

describe('deriveMisfires', () => {
  it('reports one misfire for three holds of the same shape in 24h', () => {
    const rows = [
      row('p_hold', 'Bash: git log --oneline -5'),
      row('p_hold', 'Bash: git log --stat'),
      row('p_hold', 'Bash: git log', minutesAgo(30)),
    ];
    const out = deriveMisfires(rows, commandShapeKey, shortList, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      policy_id: 'p_hold',
      shape_key: 'git log',
      count: 3,
      window_hours: 24,
      approvals: 0,
      denials: 0,
    });
    // The row shape carries no adjudication, so the evidence line is volume only.
    expect(out[0]!.sample_goal).toBe('Bash: git log --oneline -5');
    expect(out[0]!.latest_at).toBe(minutesAgo(10));
    expect(MISFIRE_THRESHOLD).toBe(3);
  });

  it('does not report two holds of the same shape', () => {
    const rows = [row('p_hold', 'Bash: git log -1'), row('p_hold', 'Bash: git log -2')];
    expect(deriveMisfires(rows, commandShapeKey, shortList, NOW)).toEqual([]);
  });

  it('ignores policies that are not on the Short List', () => {
    const rows = [
      row('p_watch', 'Bash: git log -1'),
      row('p_watch', 'Bash: git log -2'),
      row('p_watch', 'Bash: git log -3'),
    ];
    expect(deriveMisfires(rows, commandShapeKey, shortList, NOW)).toEqual([]);
  });

  it('ignores rows older than the 24h window', () => {
    const rows = [
      row('p_hold', 'Bash: git log -1'),
      row('p_hold', 'Bash: git log -2'),
      row('p_hold', 'Bash: git log -3', minutesAgo(60 * 25)),
    ];
    expect(deriveMisfires(rows, commandShapeKey, shortList, NOW)).toEqual([]);
  });

  it('excludes a shape the operator already carved out with shape_exceptions', () => {
    const rows = [
      row('p_hold', 'Bash: git log -1'),
      row('p_hold', 'Bash: git log -2'),
      row('p_hold', 'Bash: git log -3'),
      row('p_hold', 'Bash: git status'),
      row('p_hold', 'Bash: git status -s'),
      row('p_hold', 'Bash: git status --porcelain'),
    ];
    const out = deriveMisfires(
      rows,
      commandShapeKey,
      shortList,
      NOW,
      new Map([['p_hold', ['git log']]]),
    );
    expect(out.map((m) => m.shape_key)).toEqual(['git status']);
  });

  it('ignores unreadable goals and rows matching no policy', () => {
    const rows: MisfireRow[] = [
      { matched_policies: JSON.stringify(['p_hold']), declared_goal: null, created_at: minutesAgo(1) },
      { matched_policies: JSON.stringify(['p_hold']), declared_goal: '   ', created_at: minutesAgo(1) },
      { matched_policies: 'not-json', declared_goal: 'Bash: git log', created_at: minutesAgo(1) },
      { declared_goal: 'Bash: git log', created_at: minutesAgo(1) },
    ];
    expect(deriveMisfires(rows, commandShapeKey, shortList, NOW)).toEqual([]);
  });

  it('counts a decision once per matched Short List policy', () => {
    const both = ['p_hold', 'p_hold2'];
    const rows = [1, 2, 3].map((n) => ({
      matched_policies: JSON.stringify(both),
      declared_goal: `Bash: git log -${n}`,
      created_at: minutesAgo(n),
    }));
    const out = deriveMisfires(rows, commandShapeKey, new Set(both), NOW);
    expect(out).toHaveLength(2);
    expect(out.every((m) => m.count === 3 && m.shape_key === 'git log')).toBe(true);
  });
});
