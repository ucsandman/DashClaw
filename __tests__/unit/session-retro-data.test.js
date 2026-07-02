import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionRetroData } from '@/lib/sessions';

// sql mock: tagged-template fn + .query. Routes queries by matching the
// raw SQL text (fragments also arrive here; return [] for them).
function makeSql(handlers) {
  const sql = vi.fn((strings, ..._values) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    for (const [pattern, rows] of handlers) {
      if (text.includes(pattern)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  });
  sql.query = vi.fn(() => Promise.resolve([]));
  return sql;
}

describe('getSessionRetroData', () => {
  beforeEach(() => { globalThis.__dashclaw_sessions_table_checked = true; });

  it('returns null when the session is missing', async () => {
    const sql = makeSql([['FROM agent_sessions', []]]);
    expect(await getSessionRetroData(sql, 'sess_missing', 'org_1')).toBeNull();
  });

  it('returns the batch shape with coerced total', async () => {
    const sql = makeSql([
      ['COUNT(*)::int AS total', [{ total: '2' }]],
      ['ORDER BY ar.created_at ASC', [
        { action_id: 'act_1', guard_decision_id: 'act_gd_1', declared_goal: 'g', risk_score: '20', action_type: 't', created_at: 'x' },
        { action_id: 'act_2', guard_decision_id: null, declared_goal: 'g', risk_score: null, action_type: 't', created_at: 'y' },
      ]],
      ['FROM guard_decisions', [{ id: 'act_gd_1', decision: 'allow' }]],
      ['FROM assumptions', [{ assumption_id: 'asm_1', action_id: 'act_1', invalidated: 0 }]],
      ['FROM x402_purchases', []],
      ['FROM agent_sessions', [{ id: 'sess_1', org_id: 'org_1', agent_id: 'a', status: 'completed' }]],
    ]);
    const data = await getSessionRetroData(sql, 'sess_1', 'org_1');
    expect(data.session.id).toBe('sess_1');
    expect(data.actionsTotal).toBe(2);
    expect(data.actions).toHaveLength(2);
    expect(data.decisions).toHaveLength(1);
    expect(data.assumptions).toHaveLength(1);
    expect(data.purchases).toEqual([]);
  });
});
