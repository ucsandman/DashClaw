import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

// GET /api/learning reads the `decisions` table via the repository and gets
// `lessons` from LIVE consolidation (consolidateLessons over
// learning_recommendations + drift_alerts) — the old read of a `lessons`
// table that exists in no migration returned [] forever. The mock routes by
// statement text; consolidation is mocked at the module boundary.
const { mockSql, state } = vi.hoisted(() => {
  const state = {
    decisions: [],
    consolidated: { lessons: [], drift_warnings: [] },
    consolidateThrows: false,
    throwMissing: null,
    lastDecisionValues: null,
  };
  const sql = (strings, ...values) => {
    const text = strings.join(' ? ');
    if (/FROM\s+decisions/i.test(text)) {
      state.lastDecisionValues = values;
      if (state.throwMissing === 'decisions') {
        const e = new Error('relation "decisions" does not exist');
        e.code = '42P01';
        return Promise.reject(e);
      }
      return Promise.resolve(state.decisions);
    }
    return Promise.resolve([]);
  };
  return { mockSql: sql, state };
});

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/events.js', () => ({
  EVENTS: new Proxy({}, { get: (_t, k) => String(k) }),
  publishOrgEvent: vi.fn(async () => {}),
}));
vi.mock('@/lib/learning-lessons.js', () => ({
  consolidateLessons: vi.fn(async () => {
    if (state.consolidateThrows) throw new Error('consolidation exploded');
    return { ...state.consolidated, agent_id: null };
  }),
}));

import { GET, POST } from '@/api/learning/route.js';

describe('/api/learning GET', () => {
  beforeEach(() => {
    state.decisions = [
      { decision: 'use neon', context: 'db', outcome: 'success' },
      { decision: 'add cache', context: 'perf', outcome: 'pending' },
    ];
    state.consolidated = {
      lessons: [{ action_type: 'deploy', confidence: 90, success_rate: 85, sample_size: 12, guidance: 'g', hints: {} }],
      drift_warnings: [{ metric: 'risk_score', severity: 'warning', z_score: '2.1', direction: 'increasing' }],
    };
    state.consolidateThrows = false;
    state.throwMissing = null;
    state.lastDecisionValues = null;
    process.env.DATABASE_URL = 'postgres://unit-test';
  });

  it('returns decisions, consolidated lessons, and computed stats (MCP contract keys intact)', async () => {
    const res = await GET(makeRequest('http://localhost/api/learning'));
    expect(res.status).toBe(200);
    const data = await res.json();
    // Contract: dashclaw_learning_query + ContextCard + LearningStatsCard read
    // `decisions` and `stats` (totalDecisions/totalLessons/successRate); the
    // `lessons` key stays present, now carrying live consolidation rows.
    expect(data.decisions).toHaveLength(2);
    expect(data.lessons).toHaveLength(1);
    expect(data.lessons[0].action_type).toBe('deploy');
    expect(data.drift_warnings).toHaveLength(1);
    expect(data.stats.totalDecisions).toBe(2);
    expect(data.stats.totalLessons).toBe(1);
    // 1 success of 1 with a terminal outcome (pending excluded)
    expect(data.stats.successRate).toBe(100);
    expect(data.stats.totalWithOutcome).toBe(1);
    expect(data.stats.patterns).toBe(1);
  });

  it('degrades lessons to empty when consolidation fails (decisions ledger unaffected)', async () => {
    state.consolidateThrows = true;
    const res = await GET(makeRequest('http://localhost/api/learning'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.decisions).toHaveLength(2);
    expect(data.lessons).toEqual([]);
    expect(data.stats.totalLessons).toBe(0);
  });

  it('scopes decisions by agent_id when supplied', async () => {
    await GET(makeRequest('http://localhost/api/learning?agent_id=bot1'));
    expect(state.lastDecisionValues).toContain('bot1');
  });

  it('applies server-side search (q) and limit to the decisions query', async () => {
    // q becomes a %needle% ILIKE param and limit is clamped and passed through,
    // so dashclaw_learning_query can search the full history server-side rather
    // than filtering only the most-recent 20 client-side.
    await GET(makeRequest('http://localhost/api/learning?q=cache&limit=5'));
    expect(state.lastDecisionValues).toContain('%cache%');
    expect(state.lastDecisionValues).toContain(5);
  });

  it('degrades to empty decisions when the table is missing (no 500)', async () => {
    state.throwMissing = 'decisions';
    const res = await GET(makeRequest('http://localhost/api/learning'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.decisions).toEqual([]);
    expect(data.lessons).toHaveLength(1);
  });
});

describe('/api/learning POST', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://unit-test';
  });

  it('rejects unknown fields instead of silently discarding them', async () => {
    // The old route dropped type/category/tags on the floor — callers lost
    // metadata with zero feedback (the decisions table has no such columns).
    const res = await POST(makeRequest('http://localhost/api/learning', {
      body: { decision: 'ship it', category: 'general', tags: ['a'] },
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Unknown fields: category, tags');
  });

  it('accepts the persisted field set', async () => {
    const res = await POST(makeRequest('http://localhost/api/learning', {
      body: { decision: 'ship it', context: 'ctx', reasoning: 'why', outcome: 'success', confidence: 90, agent_id: 'a1' },
    }));
    expect(res.status).toBe(201);
  });
});
