/**
 * v8.3 silent-lane witness — repository tests.
 *
 * In-memory mock of the Neon tagged-template SQL client (same convention as
 * enforcement-liveness.repository.test.js / coverage.repository.test.ts):
 * routed by keyword matching on the query text, values captured for
 * assertion. The activity/witness join itself is SQL the mock can't
 * evaluate, so those shapes are pinned by asserting query text/bound values;
 * a synthetic row set exercises the JS-side mapping.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  getAgentLaneWitness,
  deriveSilentLaneWitnessState,
} from '../../app/lib/repositories/silent-lane-witness.repository';
import { SYNTHETIC_AGENT_LIKE_PATTERNS } from '../../app/lib/calibration-mining.js';
import type { SqlTag } from '../../app/lib/types/db';

function makeSqlMock(rows: Record<string, unknown>[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const fn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(rows);
  }) as unknown as SqlTag & { calls: typeof calls };
  (fn as unknown as { calls: typeof calls }).calls = calls;
  return fn;
}

describe('getAgentLaneWitness', () => {
  it('binds org id, window minutes, and the agent_turn activity action type', async () => {
    const sql = makeSqlMock([]);
    await getAgentLaneWitness(sql, 'org_1', 60);
    const call = (sql as unknown as { calls: { text: string; values: unknown[] }[] }).calls[0]!;
    expect(call.text).toContain('FROM action_records');
    expect(call.text).toContain('FROM guard_decisions');
    expect(call.text).toContain('FULL OUTER JOIN');
    expect(call.values).toContain('org_1');
    expect(call.values).toContain(60);
    const boundArrays = call.values.filter((v) => Array.isArray(v)) as unknown[][];
    expect(boundArrays.some((v) => v.includes('agent_turn'))).toBe(true);
  });

  it('casts guard_decisions.created_at to ::timestamptz (fresh-schema TEXT gotcha)', async () => {
    const sql = makeSqlMock([]);
    await getAgentLaneWitness(sql, 'org_1', 60);
    const call = (sql as unknown as { calls: { text: string; values: unknown[] }[] }).calls[0]!;
    expect(call.text).toContain('guard_decisions');
    // Every created_at reference in the query is cast — this greps the raw
    // SQL text rather than relying on the mock to execute the cast.
    expect(call.text).toMatch(/created_at::timestamptz/);
  });

  it('excludes synthetic agent patterns — the pattern array is bound', async () => {
    const sql = makeSqlMock([]);
    await getAgentLaneWitness(sql, 'org_1');
    const call = (sql as unknown as { calls: { values: unknown[] }[] }).calls[0]!;
    const boundArrays = call.values.filter((v) => Array.isArray(v)) as unknown[][];
    expect(boundArrays.some((v) => v.includes(SYNTHETIC_AGENT_LIKE_PATTERNS[0]))).toBe(true);
  });

  it('maps action_type "agent_turn" rows to the codex-notify source label', async () => {
    const sql = makeSqlMock([
      { agent_id: 'agent_moltfire', last_activity_at: '2026-08-06T11:55:00.000Z', last_activity_type: 'agent_turn', last_witness_at: null },
    ]);
    const rows = await getAgentLaneWitness(sql, 'org_1', 60);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.agentId).toBe('agent_moltfire');
    expect(rows[0]!.lastActivitySource).toBe('codex-notify');
    expect(rows[0]!.lastWitnessAt).toBeNull();
  });

  it('drops rows with an empty agent_id', async () => {
    const sql = makeSqlMock([
      { agent_id: null, last_activity_at: '2026-08-06T11:55:00.000Z', last_activity_type: 'agent_turn', last_witness_at: null },
    ]);
    expect(await getAgentLaneWitness(sql, 'org_1', 60)).toHaveLength(0);
  });

  it('coerces a bare witness row (no activity) through unchanged', async () => {
    const sql = makeSqlMock([
      { agent_id: 'agent_governed', last_activity_at: null, last_activity_type: null, last_witness_at: '2026-08-06T11:50:00.000Z' },
    ]);
    const rows = await getAgentLaneWitness(sql, 'org_1', 60);
    expect(rows[0]!.lastActivityAt).toBeNull();
    expect(rows[0]!.lastActivitySource).toBeNull();
    expect(rows[0]!.lastWitnessAt).toBe('2026-08-06T11:50:00.000Z');
  });
});

// v5.9.1 incident (maintainer log 2026-08-06): MoltFire, an OpenClaw Telegram
// agent, ran a full Codex work loop through the notify bridge — one
// agent_turn ledger row per turn, zero guard_decisions rows, because the
// vendored codex 0.13x line executes no hooks. This fixture reproduces that
// exact shape end to end: repository row -> pure derivation -> recorded-ungoverned.
describe('MoltFire fixture (v5.9.1 incident shape)', () => {
  it('notify-sourced agent_turn rows with zero guard rows derive recorded-ungoverned', async () => {
    const sql = makeSqlMock([
      { agent_id: 'moltfire', last_activity_at: '2026-08-06T11:58:00.000Z', last_activity_type: 'agent_turn', last_witness_at: null },
    ]);
    const rows = await getAgentLaneWitness(sql, 'org_default', 60);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lastActivitySource).toBe('codex-notify');
    expect(rows[0]!.lastWitnessAt).toBeNull();

    const now = Date.parse('2026-08-06T12:00:00.000Z');
    const state = deriveSilentLaneWitnessState(rows[0]!, 60, now);
    expect(state.state).toBe('recorded-ungoverned');
    expect(state.agentId).toBe('moltfire');
  });
});
