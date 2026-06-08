import { describe, it, expect } from 'vitest';
import { createSqlMock } from '../helpers.js';
import {
  upsertLearningRecommendations,
  createLearningRecommendationEvents,
} from '../../app/lib/repositories/learningLoop.repository.js';

describe('upsertLearningRecommendations', () => {
  const baseRec = (overrides) => ({
    agent_id: 'a1',
    action_type: 'deploy',
    confidence: 80,
    sample_size: 5,
    top_sample_size: 3,
    success_rate: 0.8,
    avg_score: 82,
    hints: { prefer_reversible: true },
    guidance: ['go slow'],
    active: true,
    ...overrides,
  });

  it('writes one batched INSERT preserving ON CONFLICT semantics and exact params', async () => {
    const sql = createSqlMock({
      queryResponses: [[
        { id: 'lrec_x', agent_id: 'a1', action_type: 'deploy', hints: '{"prefer_reversible":true}', guidance: '["go slow"]', active: 1, confidence: 80 },
      ]],
    });

    const saved = await upsertLearningRecommendations(sql, 'org_1', [baseRec()]);

    expect(sql.queryCalls).toHaveLength(1);
    const { text, params } = sql.queryCalls[0];
    expect(text).toContain('INSERT INTO learning_recommendations');
    expect(text).toContain('ON CONFLICT (org_id, agent_id, action_type)');
    expect(text).toContain('active = learning_recommendations.active');
    expect(text).toContain('RETURNING *');
    // 14 cols, one row
    expect(params).toHaveLength(14);
    expect(params[0]).toMatch(/^lrec_/);
    expect(params.slice(1, 9)).toEqual(['org_1', 'a1', 'deploy', 80, 5, 3, 0.8, 82]);
    expect(params[9]).toBe(JSON.stringify({ prefer_reversible: true }));
    expect(params[10]).toBe(JSON.stringify(['go slow']));
    expect(params[11]).toBe(1); // active true -> 1

    // returned row is post-processed (JSON parsed, active coerced to boolean)
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe('lrec_x');
    expect(saved[0].hints).toEqual({ prefer_reversible: true });
    expect(saved[0].guidance).toEqual(['go slow']);
    expect(saved[0].active).toBe(true);
  });

  it('returns rows in input order regardless of RETURNING order', async () => {
    const sql = createSqlMock({
      // DB returns them reversed
      queryResponses: [[
        { id: 'r2', agent_id: 'a2', action_type: 'delete', hints: '{}', guidance: '[]', active: 1 },
        { id: 'r1', agent_id: 'a1', action_type: 'deploy', hints: '{}', guidance: '[]', active: 1 },
      ]],
    });

    const saved = await upsertLearningRecommendations(sql, 'org_1', [
      baseRec({ agent_id: 'a1', action_type: 'deploy' }),
      baseRec({ agent_id: 'a2', action_type: 'delete' }),
    ]);

    expect(saved.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('de-dupes intra-batch conflict keys keeping the last, one INSERT row', async () => {
    const sql = createSqlMock({ queryResponses: [[{ id: 'r', agent_id: 'a1', action_type: 'deploy', hints: '{}', guidance: '[]', active: 1, confidence: 90 }]] });

    await upsertLearningRecommendations(sql, 'org_1', [
      baseRec({ confidence: 70 }),
      baseRec({ confidence: 90 }),
    ]);

    expect(sql.queryCalls).toHaveLength(1);
    expect(sql.queryCalls[0].params).toHaveLength(14); // collapsed to one row
    expect(sql.queryCalls[0].params[4]).toBe(90); // confidence of last wins
  });

  it('keeps distinct (agent_id, action_type) pairs whose naive space-join would collide', async () => {
    // 'a' + ' ' + 'b c'  ===  'a b' + ' ' + 'c'  — a space separator would merge
    // these two genuinely-distinct recommendations and drop one. The NUL-joined
    // key must keep both.
    const sql = createSqlMock({
      queryResponses: [[
        { id: 'r1', agent_id: 'a', action_type: 'b c', hints: '{}', guidance: '[]', active: 1 },
        { id: 'r2', agent_id: 'a b', action_type: 'c', hints: '{}', guidance: '[]', active: 1 },
      ]],
    });

    const saved = await upsertLearningRecommendations(sql, 'org_1', [
      baseRec({ agent_id: 'a', action_type: 'b c' }),
      baseRec({ agent_id: 'a b', action_type: 'c' }),
    ]);

    expect(sql.queryCalls).toHaveLength(1);
    expect(sql.queryCalls[0].params).toHaveLength(28); // 2 distinct rows × 14 cols
    expect(saved).toHaveLength(2);
    expect(saved.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('issues no query for an empty input', async () => {
    const sql = createSqlMock();
    const saved = await upsertLearningRecommendations(sql, 'org_1', []);
    expect(saved).toEqual([]);
    expect(sql.queryCalls).toHaveLength(0);
  });
});

describe('createLearningRecommendationEvents', () => {
  // Faithful mock: reconstruct RETURNING rows from the inserted params so the
  // id-based mapping is exercised the way Postgres would return inserted rows.
  // `skipKeys` simulates ON CONFLICT DO NOTHING dropping rows whose event_key
  // matched an existing/earlier row (those rows are NOT returned).
  function makeInsertMock(skipKeys = new Set()) {
    const cols = ['id', 'org_id', 'recommendation_id', 'agent_id', 'action_id', 'event_type', 'event_key', 'details', 'created_at'];
    const queryCalls = [];
    return {
      query: async (text, params) => {
        queryCalls.push({ text, params });
        const rows = [];
        for (let i = 0; i < params.length; i += cols.length) {
          const row = {};
          cols.forEach((c, k) => { row[c] = params[i + k]; });
          if (!skipKeys.has(row.event_key)) rows.push(row);
        }
        return rows;
      },
      queryCalls,
    };
  }

  it('writes one batched INSERT with DO NOTHING and maps inserted rows back by id', async () => {
    const sql = makeInsertMock();

    const created = await createLearningRecommendationEvents(sql, 'org_1', [
      { recommendation_id: 'lrec_1', agent_id: 'a1', event_type: 'fetched', event_key: 'k1', details: { n: 1 } },
      { recommendation_id: 'lrec_1', agent_id: 'a1', event_type: 'applied', event_key: 'k2' },
    ]);

    expect(sql.queryCalls).toHaveLength(1);
    const { text, params } = sql.queryCalls[0];
    expect(text).toContain('INSERT INTO learning_recommendation_events');
    expect(text).toContain('ON CONFLICT (org_id, event_key)');
    expect(text).toContain('DO NOTHING');
    expect(params).toHaveLength(18); // 2 rows × 9 cols
    expect(params[0]).toMatch(/^lrev_/);

    expect(created).toHaveLength(2);
    expect(created[0].event_type).toBe('fetched');
    expect(created[0].details).toEqual({ n: 1 }); // parsed from JSON
    expect(created[1].event_type).toBe('applied');
    expect(created[1].details).toEqual({}); // null details -> parseJson default
  });

  it('omits events skipped by DO NOTHING (conflict), preserving order of the rest', async () => {
    const sql = makeInsertMock(new Set(['dup_key']));

    const created = await createLearningRecommendationEvents(sql, 'org_1', [
      { event_type: 'fetched', event_key: 'k1' },
      { event_type: 'applied', event_key: 'dup_key' }, // skipped
      { event_type: 'outcome', event_key: 'k3' },
    ]);

    expect(created.map((e) => e.event_type)).toEqual(['fetched', 'outcome']);
  });

  it('issues no query for an empty input', async () => {
    const sql = makeInsertMock();
    const created = await createLearningRecommendationEvents(sql, 'org_1', []);
    expect(created).toEqual([]);
    expect(sql.queryCalls).toHaveLength(0);
  });
});
