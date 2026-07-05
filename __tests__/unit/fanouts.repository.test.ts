/**
 * v4.3 fleet attribution — fanouts repository tests.
 *
 * In-memory capturing mock of the Neon tagged-template SQL client. The SQL
 * grouping/aggregation can't be evaluated by a mock, so those are pinned by
 * asserting the query text/bound values; the JS-side shaping (numeric coercion,
 * ISO normalization, empty-key drop) is pinned against synthetic aggregate rows.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  getRecentFanouts,
  type FanoutSummary,
} from '../../app/lib/repositories/fanouts.repository';
import {
  SYNTHETIC_AGENT_LIKE_PATTERNS,
  SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS,
} from '../../app/lib/calibration-mining.js';
import type { SqlTag } from '../../app/lib/types/db';

function makeSqlMock(responses: Record<string, unknown>[][]) {
  const queue = [...responses];
  const calls: { text: string; values: unknown[] }[] = [];
  const fn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(queue.shift() ?? []);
  }) as unknown as SqlTag & { calls: typeof calls };
  (fn as unknown as { calls: typeof calls }).calls = calls;
  return fn;
}

const callsOf = (sql: unknown) =>
  (sql as unknown as { calls: { text: string; values: unknown[] }[] }).calls;

describe('getRecentFanouts', () => {
  it('coerces string-numeric counts and normalizes timestamps to ISO', async () => {
    const sql = makeSqlMock([[
      {
        harness_session_id: 'hs_1',
        parent_agent_id: 'orchestrator',
        agents: ['orchestrator', 'orchestrator:reviewer'],
        agent_count: '2',
        spawn_count: '1',
        action_count: '7',
        linked_leaf_count: '3',
        first_at: '2026-07-04T00:00:00.000Z',
        last_at: '2026-07-04T01:00:00.000Z',
      },
    ]]);
    const rows = await getRecentFanouts(sql, 'org_1');
    expect(rows).toHaveLength(1);
    const f = rows[0] as FanoutSummary;
    expect(f.harness_session_id).toBe('hs_1');
    expect(f.parent_agent_id).toBe('orchestrator');
    expect(f.agents).toEqual(['orchestrator', 'orchestrator:reviewer']);
    expect(f.agent_count).toBe(2);
    expect(f.spawn_count).toBe(1);
    expect(f.action_count).toBe(7);
    expect(f.linked_leaf_count).toBe(3);
    expect(f.first_at).toBe('2026-07-04T00:00:00.000Z');
    expect(f.last_at).toBe('2026-07-04T01:00:00.000Z');
  });

  it('groups by harness_session_id and orders newest-first in SQL', async () => {
    const sql = makeSqlMock([[]]);
    await getRecentFanouts(sql, 'org_1');
    const call = callsOf(sql)[0]!;
    expect(call.text).toContain('GROUP BY harness_session_id');
    expect(call.text).toContain('harness_session_id IS NOT NULL');
    expect(call.text).toContain('ORDER BY g.last_at DESC');
    // spawn_count filters orchestration rows.
    expect(call.text).toContain("action_type = 'orchestration'");
  });

  it('linked_leaf_count is the real lineage join — leaf.subagent_uuid must match a spawn row in the SAME session', async () => {
    const sql = makeSqlMock([[]]);
    await getRecentFanouts(sql, 'org_1');
    const call = callsOf(sql)[0]!;
    // The persisted spawn evidence key is extracted from outcome_progress...
    expect(call.text).toContain("outcome_progress->>'spawned_agent_uuid'");
    // ...and only leaves whose subagent_uuid matches a spawn row in the same
    // harness session count (EXISTS join, not a bare subagent_uuid count).
    expect(call.text).toContain('l.subagent_uuid IS NOT NULL');
    expect(call.text).toContain('EXISTS');
    expect(call.text).toContain('s.harness_session_id = l.harness_session_id');
    expect(call.text).toContain('s.spawned_agent_uuid = l.subagent_uuid');
    // Sessions with no matched leaves still render with 0.
    expect(call.text).toContain('COALESCE(li.linked_leaf_count, 0)');
  });

  it('excludes synthetic families in SQL — both pattern arrays are bound with NOT LIKE ALL', async () => {
    const sql = makeSqlMock([[]]);
    await getRecentFanouts(sql, 'org_1');
    const call = callsOf(sql)[0]!;
    expect(call.text).toContain('NOT LIKE ALL');
    const boundArrays = call.values.filter((v) => Array.isArray(v)) as unknown[][];
    expect(boundArrays.some((v) => v.includes(SYNTHETIC_AGENT_LIKE_PATTERNS[0]))).toBe(true);
    expect(boundArrays.some((v) => v.includes(SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS[0]))).toBe(true);
  });

  it('clamps window to 1..168 hours and limit to 1..100', async () => {
    const sql = makeSqlMock([[], [], [], []]);
    await getRecentFanouts(sql, 'org_1', { windowHours: 9999, limit: 9999 });
    expect(callsOf(sql)[0]!.values).toContain(168);
    expect(callsOf(sql)[0]!.values).toContain(100);
    await getRecentFanouts(sql, 'org_1', { windowHours: -5, limit: 0 });
    expect(callsOf(sql)[1]!.values).toContain(1);
  });

  it('drops rows with an empty harness_session_id', async () => {
    const sql = makeSqlMock([[
      {
        harness_session_id: null,
        parent_agent_id: 'a',
        agents: ['a'],
        agent_count: '1',
        spawn_count: '0',
        action_count: '1',
        linked_leaf_count: '0',
        first_at: '2026-07-04T00:00:00.000Z',
        last_at: '2026-07-04T00:00:00.000Z',
      },
    ]]);
    expect(await getRecentFanouts(sql, 'org_1')).toHaveLength(0);
  });

  it('defaults agents to [] when the aggregate is null', async () => {
    const sql = makeSqlMock([[
      {
        harness_session_id: 'hs_2',
        parent_agent_id: null,
        agents: null,
        agent_count: null,
        spawn_count: null,
        action_count: null,
        linked_leaf_count: null,
        first_at: null,
        last_at: null,
      },
    ]]);
    const f = (await getRecentFanouts(sql, 'org_1'))[0]!;
    expect(f.agents).toEqual([]);
    expect(f.agent_count).toBe(0);
    expect(f.parent_agent_id).toBe('');
    expect(f.first_at).toBe('');
  });
});
