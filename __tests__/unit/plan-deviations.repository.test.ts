// Plan deviation events (docs/rfcs/2026-08-11-plan-deviation-events.md).
// Repository-level tests — same scripted-sql-tag approach as
// plans.repository.test.ts: the mock echoes interpolated values back so
// assertions exercise the real INSERT/UPDATE shapes.
import { describe, it, expect } from 'vitest';
import {
  insertPlanDeviation, listDeviationsForPlan, listDeviationsForAction,
  listDeviationsForSession, listDeviationsForPlans, resolveDeviation, sweepAbandonedSteps,
} from '../../app/lib/repositories/plan-deviations.repository';

type SqlCall = { text: string; v: unknown[] };
type ScriptEntry = unknown[] | ((call: SqlCall) => unknown[]);

function sqlMock(script: ScriptEntry[]) {
  const calls: SqlCall[] = [];
  let i = 0;
  const next = (call: SqlCall): unknown[] => {
    const entry = script[i++];
    if (entry === undefined) return [];
    return typeof entry === 'function' ? entry(call) : entry;
  };
  const tag = ((strings: TemplateStringsArray, ...v: unknown[]) => {
    const call: SqlCall = { text: strings.join('?'), v };
    calls.push(call);
    return Promise.resolve(next(call));
  }) as unknown as {
    (s: TemplateStringsArray, ...v: unknown[]): Promise<unknown[]>;
    query: (text: string, params?: unknown[]) => Promise<unknown[]>;
    calls: SqlCall[];
  };
  tag.calls = calls;
  tag.query = async (text: string, params: unknown[] = []) => {
    const call: SqlCall = { text, v: params };
    calls.push(call);
    return next(call);
  };
  return tag;
}

describe('plan-deviations.repository', () => {
  it('insertPlanDeviation mints dv_ ids and redacts declared/observed payloads', async () => {
    const fakeKey = ['sk', 'Y'.repeat(24)].join('-');
    const sql = sqlMock([
      (c) => [{ deviation_id: c.v[0] }],
    ]);
    const row = await insertPlanDeviation(sql as never, 'org_1', {
      orgId: 'org_1', agentId: 'claude-code', planId: 'pa_x', stepId: 'ps_x',
      kind: 'act_substitution', dimension: 'act', severity: 'high',
      declared: { act_summary: 'deploy staging' },
      observed: { act_summary: `deploy prod TOKEN=${fakeKey}` },
      matchConfidence: 90,
    });
    expect(row!.deviation_id).toMatch(/^dv_[0-9a-f]{16}$/);
    // observed payload must pass through redaction before persist (RFC §4)
    const insertCall = sql.calls[0]!;
    const serialized = JSON.stringify(insertCall.v);
    expect(serialized).not.toContain(fakeKey);
  });

  it('insertPlanDeviation returns null when ON CONFLICT swallows a duplicate step_abandoned row', async () => {
    const sql = sqlMock([[]]);
    const row = await insertPlanDeviation(sql as never, 'org_1', {
      orgId: 'org_1', agentId: 'a', planId: 'pa_x', stepId: 'ps_x',
      kind: 'step_abandoned', dimension: 'existence', severity: 'low',
    });
    expect(row).toBeNull();
    expect(sql.calls[0]!.text).toContain('ON CONFLICT');
  });

  it('resolveDeviation only transitions from open, stamps resolver, rejects bad resolutions', async () => {
    const sql = sqlMock([
      (c) => [{ deviation_id: 'dv_1', status: c.v.find((x) => x === 'accepted') ? 'accepted' : 'accepted' }],
    ]);
    const ok = await resolveDeviation(sql as never, 'org_1', 'dv_1', {
      resolution: 'accepted', resolvedBy: 'operator',
    });
    expect(ok).not.toBeNull();
    expect(sql.calls[0]!.text).toContain("status = 'open'");
    expect(sql.calls[0]!.v).toContain('operator');

    // not-open rows: UPDATE matches nothing → null
    const sqlMiss = sqlMock([[]]);
    const miss = await resolveDeviation(sqlMiss as never, 'org_1', 'dv_1', {
      resolution: 'rejected', resolvedBy: 'operator',
    });
    expect(miss).toBeNull();

    await expect(resolveDeviation(sql as never, 'org_1', 'dv_1', {
      resolution: 'promoted' as never, resolvedBy: 'operator',
    })).rejects.toThrow(/resolution/i);
  });

  it('sweepAbandonedSteps inserts one row per approved unconsumed step, idempotently', async () => {
    const sql = sqlMock([
      // approved, unconsumed steps of the terminal plan
      [
        { step_id: 'ps_1', seq: 1, action_type: 'deploy', step_goal: 'deploy web', agent_id: 'a1' },
        { step_id: 'ps_2', seq: 2, action_type: 'migrate', step_goal: 'run migration', agent_id: 'a1' },
      ],
      (c) => [{ deviation_id: c.v[0] }],  // insert 1 lands
      [],                                  // insert 2 conflicts (already swept)
    ]);
    const n = await sweepAbandonedSteps(sql as never, 'org_1', 'pa_x');
    expect(n).toBe(1);
    expect(sql.calls[1]!.text).toContain('ON CONFLICT');
  });

  it('list helpers scope by org and target id', async () => {
    const sql = sqlMock([[{ deviation_id: 'dv_1' }]]);
    const rows = await listDeviationsForPlan(sql as never, 'org_1', 'pa_x');
    expect(rows).toHaveLength(1);
    expect(sql.calls[0]!.v).toEqual(expect.arrayContaining(['org_1', 'pa_x']));

    const sqlA = sqlMock([[{ deviation_id: 'dv_2' }]]);
    await listDeviationsForAction(sqlA as never, 'org_1', 'act_9');
    expect(sqlA.calls[0]!.v).toEqual(expect.arrayContaining(['org_1', 'act_9']));

    const sqlS = sqlMock([[{ deviation_id: 'dv_3' }]]);
    await listDeviationsForSession(sqlS as never, 'org_1', 'sess_9');
    expect(sqlS.calls[0]!.v).toEqual(expect.arrayContaining(['org_1', 'sess_9']));
  });

  // FIX A: batched twin of listDeviationsForPlan for GET
  // /api/plans?expand=details — one query across every plan on the page.
  it('listDeviationsForPlans scopes by org and ANY(planIds), and returns [] without a query for an empty list', async () => {
    const sql = sqlMock([
      [
        { deviation_id: 'dv_1', plan_id: 'pa_1' },
        { deviation_id: 'dv_2', plan_id: 'pa_2' },
      ],
    ]);
    const rows = await listDeviationsForPlans(sql as never, 'org_1', ['pa_1', 'pa_2']);
    expect(rows).toHaveLength(2);
    expect(sql.calls[0]!.text).toContain('= ANY($2)');
    expect(sql.calls[0]!.v).toEqual(['org_1', ['pa_1', 'pa_2']]);

    const emptySql = sqlMock([[{ deviation_id: 'unreached' }]]);
    const emptyRows = await listDeviationsForPlans(emptySql as never, 'org_1', []);
    expect(emptyRows).toEqual([]);
    expect(emptySql.calls).toHaveLength(0);
  });
});
