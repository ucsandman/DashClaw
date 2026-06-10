/**
 * P14: the opportunistic drift tick must be DEBOUNCED (≤1 run/org/24h via a
 * settings marker claimed BEFORE the run), TIME-BUDGETED (stops picking up the
 * next agent once the budget is spent), and AGENT-CAPPED (LIMIT N most recent).
 * These are acceptance criteria — the tick rides GET /api/drift/stats and a
 * regression here amplifies Neon load on every dashboard visit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, mockSql, engine, markerWrites } = vi.hoisted(() => {
  const state = {
    markerValue: null,        // settings row value (ISO string) or null
    agents: [],               // rows for the agent-listing query
    agentLimitCaptured: null, // LIMIT bind captured from the agent query
    clock: 0,                 // fake time, advanced by engine calls
    engineCost: 0,            // ms each engine call consumes
    failMarkerWrite: false,
  };
  const tagged = (strings, ...values) => {
    const text = strings.join(' ');
    if (text.includes('FROM settings')) {
      return Promise.resolve(state.markerValue ? [{ value: state.markerValue }] : []);
    }
    if (text.includes('FROM action_records')) {
      state.agentLimitCaptured = values[values.length - 1];
      return Promise.resolve(state.agents);
    }
    return Promise.resolve([]);
  };
  tagged.query = vi.fn(async () => []);
  const tick = (name) => vi.fn(async () => { state.clock += state.engineCost; return { [name]: 0 }; });
  return {
    state,
    mockSql: tagged,
    engine: {
      computeBaselines: tick('baselines_computed'),
      detectDrift: tick('alerts_generated'),
      recordSnapshots: tick('snapshots_recorded'),
    },
    markerWrites: [],
  };
});

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));
vi.mock('@/lib/drift.js', () => engine);
vi.mock('@/lib/repositories/settings.repository.js', () => ({
  upsertSetting: vi.fn(async (sql, orgId, input) => {
    if (state.failMarkerWrite) throw new Error('settings write failed');
    markerWrites.push({ at: state.clock, ...input });
    state.markerValue = input.value;
  }),
}));

const { maybeRunDriftTick, DRIFT_TICK_MARKER_KEY } = await import('@/lib/drift-tick.js');

const req = new Request('http://test/api/drift/stats');
const now = () => state.clock;

beforeEach(() => {
  state.markerValue = null;
  state.agents = [{ agent_id: 'a1' }, { agent_id: 'a2' }, { agent_id: 'a3' }];
  state.agentLimitCaptured = null;
  state.clock = 1_000_000_000_000; // arbitrary fixed epoch
  state.engineCost = 0;
  state.failMarkerWrite = false;
  markerWrites.length = 0;
  engine.computeBaselines.mockClear();
  engine.detectDrift.mockClear();
  engine.recordSnapshots.mockClear();
});

describe('debounce', () => {
  it('runs when no marker exists and claims the marker BEFORE the engine', async () => {
    const result = await maybeRunDriftTick(req, { now });
    expect(result.ran).toBe(true);
    expect(markerWrites).toHaveLength(1);
    expect(markerWrites[0].key).toBe(DRIFT_TICK_MARKER_KEY);
    // Marker was written before any engine work consumed clock time.
    expect(markerWrites[0].at).toBe(1_000_000_000_000);
  });

  it('skips entirely within the 24h window', async () => {
    await maybeRunDriftTick(req, { now });
    engine.computeBaselines.mockClear();

    state.clock += 23 * 60 * 60 * 1000; // 23h later — still inside the window
    const second = await maybeRunDriftTick(req, { now });
    expect(second.ran).toBe(false);
    expect(second.reason).toBe('debounced');
    expect(engine.computeBaselines).not.toHaveBeenCalled();
  });

  it('runs again after the window elapses', async () => {
    await maybeRunDriftTick(req, { now });
    state.clock += 25 * 60 * 60 * 1000;
    const second = await maybeRunDriftTick(req, { now });
    expect(second.ran).toBe(true);
  });

  it('does NOT run when the marker claim fails (no debounce → no tick)', async () => {
    state.failMarkerWrite = true;
    const result = await maybeRunDriftTick(req, { now });
    expect(result.ran).toBe(false);
    expect(result.reason).toBe('marker_write_failed');
    expect(engine.computeBaselines).not.toHaveBeenCalled();
  });
});

describe('time budget', () => {
  it('stops picking up agents once the budget is spent', async () => {
    state.engineCost = 2000; // each engine call advances the clock 2s
    // Agent 1 costs 3 calls × 2000ms = 6000ms > the 4000ms budget,
    // so agent 2 and 3 must not start.
    const result = await maybeRunDriftTick(req, { now, budgetMs: 4000 });
    expect(result.ran).toBe(true);
    expect(result.agents_processed).toBe(1);
    expect(engine.computeBaselines).toHaveBeenCalledTimes(1);
  });

  it('processes every capped agent when the budget allows', async () => {
    state.engineCost = 100;
    const result = await maybeRunDriftTick(req, { now, budgetMs: 4000 });
    expect(result.agents_processed).toBe(3);
    expect(engine.detectDrift).toHaveBeenCalledTimes(3);
  });
});

describe('agent cap', () => {
  it('passes the per-tick cap as the LIMIT bind on the agent query', async () => {
    await maybeRunDriftTick(req, { now, maxAgents: 2 });
    expect(state.agentLimitCaptured).toBe(2);
  });
});
