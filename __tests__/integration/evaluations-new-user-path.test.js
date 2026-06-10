/**
 * Integration (P16): the full new-user path with NO LLM key —
 *   create a scorer from a one-click template (real POST /api/evaluations/scorers)
 *   → launch a run (real POST /api/evaluations/runs; execution goes through
 *     next/server after(), the fix for runs freezing on Vercel)
 *   → the REAL executeEvalRun engine scores recorded actions
 *   → scores are visible via GET /api/evaluations with the SCORER's name
 *     (not the run's — the old scorer_name bug broke filters + by_scorer stats).
 *
 * Storage is an in-memory store: the repository module is mocked over it and
 * the eval engine's raw SQL is text-routed onto it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { store, afterCalls, mockSql } = vi.hoisted(() => {
  const store = { scorers: [], runs: [], scores: [], actions: [] };
  const afterCalls = [];
  const tagged = (strings, ...values) => {
    const text = strings.join(' ');
    if (text.includes('FROM eval_runs er')) {
      // executeEvalRun's run+scorer join
      const [runId] = values;
      const run = store.runs.find((r) => r.id === runId);
      if (!run) return Promise.resolve([]);
      const scorer = store.scorers.find((s) => s.id === run.scorer_id);
      return Promise.resolve([{
        ...run,
        scorer_type: scorer?.scorer_type,
        scorer_config: scorer?.config,
        scorer_display_name: scorer?.name,
      }]);
    }
    if (text.includes("UPDATE eval_runs SET status = 'running'")) {
      const [, runId] = values;
      const run = store.runs.find((r) => r.id === runId);
      if (!run || run.status !== 'pending') return Promise.resolve([]);
      run.status = 'running';
      return Promise.resolve([{ id: run.id }]);
    }
    if (text.includes('FROM action_records')) {
      return Promise.resolve(store.actions);
    }
    if (text.includes('INSERT INTO eval_scores')) {
      const [id, orgId, actionId, scorerId, runId, scorerName, score, label, reasoning, evaluatedBy, createdAt] = values;
      store.scores.push({ id, org_id: orgId, action_id: actionId, scorer_id: scorerId, run_id: runId, scorer_name: scorerName, score, label, reasoning, evaluated_by: evaluatedBy, created_at: createdAt });
      return Promise.resolve([]);
    }
    if (text.includes('UPDATE eval_runs SET total_actions')) return Promise.resolve([]);
    if (text.includes('UPDATE eval_runs SET scored_count')) return Promise.resolve([]);
    if (text.includes("status = 'completed'")) {
      // values: [scored, avgScore, summary, completedAt, runId, orgId]
      const run = store.runs.find((r) => r.id === values[4]);
      if (run) { run.status = 'completed'; run.scored_count = values[0]; }
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };
  tagged.query = vi.fn(async () => []);
  return { store, afterCalls, mockSql: tagged };
});

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({
  getOrgId: () => 'org_eval',
  getOrgRole: () => 'admin',
  getUserId: () => 'usr_wes',
}));
// after() captured so the test drives "post-response" execution explicitly —
// proving the route uses after() rather than a frozen fire-and-forget.
vi.mock('next/server', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, after: (fn) => { afterCalls.push(fn); } };
});
vi.mock('@/lib/repositories/evaluations.repository.js', () => ({
  listEvalScorers: vi.fn(async () => store.scorers),
  createEvalScorer: vi.fn(async (sql, orgId, scorer) => {
    const row = { ...scorer, org_id: orgId, config: JSON.stringify(scorer.config ?? {}) };
    store.scorers.push(row);
    return row;
  }),
  getEvalScorer: vi.fn(async (sql, orgId, id) => store.scorers.find((s) => s.id === id) || null),
  createEvalRun: vi.fn(async (sql, orgId, run) => {
    const row = { ...run, org_id: orgId, filter_criteria: run.filter_criteria ? JSON.stringify(run.filter_criteria) : null };
    store.runs.push(row);
    return row;
  }),
  listEvalRuns: vi.fn(async () => store.runs),
  listEvalScores: vi.fn(async (sql, orgId, { scorerName } = {}) => {
    const scores = store.scores.filter((s) => s.org_id === orgId && (!scorerName || s.scorer_name === scorerName));
    return { scores, total: scores.length };
  }),
  createEvalScore: vi.fn(),
}));

const { POST: createScorer } = await import('@/api/evaluations/scorers/route.js');
const { POST: createRun } = await import('@/api/evaluations/runs/route.js');
const { GET: listScores } = await import('@/api/evaluations/route.js');

// The "Risk stayed low" one-click template from app/evaluations/page.tsx.
const TEMPLATE = {
  name: 'Risk stayed low',
  scorer_type: 'numeric_range',
  description: 'Passes actions whose risk_score stayed at or below 50',
  config: { field: 'risk_score', min: 0, max: 50 },
};

beforeEach(() => {
  store.scorers.length = 0;
  store.runs.length = 0;
  store.scores.length = 0;
  store.actions = [
    { action_id: 'act_1', outcome: 'done', risk_score: 30 },
    { action_id: 'act_2', outcome: 'done', risk_score: 80 },
    { action_id: 'act_3', outcome: 'done', risk_score: 10 },
  ];
  afterCalls.length = 0;
});

describe('new-user path: template → run → visible scores (no LLM key)', () => {
  it('completes end-to-end with the scorer name on every score', async () => {
    // 1. Create the scorer from the template (real route).
    const scorerRes = await createScorer(makeRequest('http://localhost/api/evaluations/scorers', { body: TEMPLATE }));
    expect(scorerRes.status).toBe(201);
    const scorer = await scorerRes.json();

    // 2. Launch a run (real route). created_by carries the user identity.
    const runRes = await createRun(makeRequest('http://localhost/api/evaluations/runs', {
      body: { name: 'First eval run', scorer_id: scorer.id },
    }));
    expect(runRes.status).toBe(201);
    expect(store.runs[0].created_by).toBe('usr_wes');

    // 3. The execution was scheduled via after() — NOT run before the response.
    expect(afterCalls).toHaveLength(1);
    expect(store.scores).toHaveLength(0);
    await afterCalls[0]();

    // 4. The REAL engine scored all 3 actions and completed the run.
    expect(store.runs[0].status).toBe('completed');
    expect(store.scores).toHaveLength(3);

    // 5. Scores are visible through GET /api/evaluations and carry the
    //    SCORER's display name (the old bug wrote the run name).
    const res = await listScores(makeRequest('http://localhost/api/evaluations'));
    const data = await res.json();
    expect(data.scores).toHaveLength(3);
    for (const s of data.scores) {
      expect(s.scorer_name).toBe('Risk stayed low');
    }
    // numeric_range graded honestly: 2 in range, 1 out.
    const passing = data.scores.filter((s) => Number(s.score) === 1);
    expect(passing).toHaveLength(2);

    // 6. The scorer-name filter (broken before) now matches run-generated rows.
    const filtered = await listScores(makeRequest('http://localhost/api/evaluations?scorer_name=Risk%20stayed%20low'));
    const filteredData = await filtered.json();
    expect(filteredData.scores).toHaveLength(3);
  });
});
