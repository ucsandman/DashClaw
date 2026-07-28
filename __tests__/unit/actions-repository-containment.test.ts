/**
 * Containment Verdicts (RFC 2026-07-06, drizzle/0064) — repository lifecycle
 * functions. WHERE-gate-as-legality-check pattern (same as recordApproval):
 * an illegal or racing transition returns null, never an error.
 */
import { describe, it, expect } from 'vitest';

import {
  setContainmentAwaiting,
  resolveContainment,
  createActionRecord,
  listActions,
  findUnconsumedPromotionGrant,
  getActionRecord,
} from '../../app/lib/repositories/actions.repository';
import { buildPromotionGoal } from '../../app/lib/guard/containment';

type Row = Record<string, unknown>;

// Tagged-template + .query mock. Each call records the joined SQL text and
// bound values; responses come from a FIFO queue (default: empty result).
// Conditional fragments (sql``) with literal empty text must not consume the
// response queue — see reference_dashclaw_sql_fragment_test_gotcha.
function makeSql(responses: Row[][] = []) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.trim() === '') return Promise.resolve([]);
    calls.push({ text, values });
    return Promise.resolve(responses.shift() ?? []);
  }) as ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>) & {
    query: (text: string, params?: unknown[]) => Promise<Row[]>;
    calls: Array<{ text: string; values: unknown[] }>;
  };
  sql.query = (text: string, params: unknown[] = []) => {
    calls.push({ text, values: params });
    return Promise.resolve(responses.shift() ?? []);
  };
  sql.calls = calls;
  return sql;
}

function makeQuerySqlMock(responses: Row[][]) {
  const queue = [...responses];
  const queryCalls: Array<[string, unknown[]]> = [];
  return {
    queryCalls,
    query: (text: string, params: unknown[] = []) => {
      queryCalls.push([text, params]);
      return Promise.resolve(queue.shift() ?? []);
    },
  };
}

describe('setContainmentAwaiting', () => {
  it('legal flip (prior status contained) returns the updated row', async () => {
    const sql = makeSql([[{ action_id: 'act_1', containment_status: 'awaiting_promotion', containment_ref: 'dashclaw/contained-act_1' }]]);
    const row = await setContainmentAwaiting(sql, 'org_1', 'act_1', 'agent_1', 'dashclaw/contained-act_1');
    expect(row?.containment_status).toBe('awaiting_promotion');
    expect(sql.calls[0]!.text).toContain("containment_status = 'contained'");
  });

  it('wrong prior status (e.g. already awaiting_promotion) returns null — WHERE gate fails', async () => {
    const sql = makeSql([[]]);
    const row = await setContainmentAwaiting(sql, 'org_1', 'act_1', 'agent_1', 'ref');
    expect(row).toBeNull();
  });

  it('org mismatch returns null — org_id is part of the WHERE gate', async () => {
    const sql = makeSql([[]]);
    const row = await setContainmentAwaiting(sql, 'org_other', 'act_1', 'agent_1', 'ref');
    expect(row).toBeNull();
    expect(sql.calls[0]!.text).toContain('org_id =');
    expect(sql.calls[0]!.values).toContain('org_other');
  });

  // IMPORTANT 5 (final fix wave, 2026-07-27): agent_id is part of the
  // WHERE-gate-as-legality-check, same as org_id — a caller asserting a
  // different agent_id than the row's own must not be able to flip it.
  it('agent_id mismatch returns null — agent_id is part of the WHERE gate', async () => {
    const sql = makeSql([[]]);
    const row = await setContainmentAwaiting(sql, 'org_1', 'act_1', 'agent_other', 'ref');
    expect(row).toBeNull();
    expect(sql.calls[0]!.text).toContain('agent_id =');
    expect(sql.calls[0]!.values).toContain('agent_other');
  });

  it('a null ref leaves containment_ref unchanged (COALESCE)', async () => {
    const sql = makeSql([[{ action_id: 'act_1' }]]);
    await setContainmentAwaiting(sql, 'org_1', 'act_1', 'agent_1');
    expect(sql.calls[0]!.text).toContain('COALESCE(');
    expect(sql.calls[0]!.values).toContain(null);
  });

  // Server-stamped ref (security follow-up to RFC 2026-07-06): the guard route
  // stamps containment_ref at ?record=true time, so this flip must never let a
  // client overwrite it — and a conflicting client ref must fail the WHERE
  // gate rather than be silently ignored.
  it('the row-existing ref wins the COALESCE — a client ref can only fill, never overwrite', async () => {
    const sql = makeSql([[{ action_id: 'act_1' }]]);
    await setContainmentAwaiting(sql, 'org_1', 'act_1', 'agent_1', 'dashclaw/contained-x');
    expect(sql.calls[0]!.text).toContain('COALESCE(containment_ref');
  });

  it('a client ref that conflicts with the stamped ref fails the WHERE gate', async () => {
    const sql = makeSql([[]]);
    const row = await setContainmentAwaiting(sql, 'org_1', 'act_1', 'agent_1', 'dashclaw/contained-forged');
    expect(row).toBeNull();
    const text = sql.calls[0]!.text;
    expect(text).toContain('containment_ref IS NULL OR');
    expect(text).toContain('containment_ref =');
  });
});

describe('resolveContainment', () => {
  it("verdict 'promote' flips containment_status to promoted and stamps resolver", async () => {
    const sql = makeSql([[{ action_id: 'act_1', containment_status: 'promoted', containment_resolved_by: 'op_1' }]]);
    const row = await resolveContainment(sql, 'org_1', 'act_1', { verdict: 'promote', resolvedBy: 'op_1' });
    expect(row?.containment_status).toBe('promoted');
    expect(sql.calls[0]!.values).toContain('promoted');
    expect(sql.calls[0]!.values).toContain('op_1');
    expect(sql.calls[0]!.text).toContain("containment_status = 'awaiting_promotion'");
  });

  it("verdict 'discard' flips containment_status to discarded", async () => {
    const sql = makeSql([[{ action_id: 'act_1', containment_status: 'discarded' }]]);
    const row = await resolveContainment(sql, 'org_1', 'act_1', { verdict: 'discard', resolvedBy: 'op_1' });
    expect(row?.containment_status).toBe('discarded');
    expect(sql.calls[0]!.values).toContain('discarded');
  });

  it('wrong prior status (not awaiting_promotion) returns null', async () => {
    const sql = makeSql([[]]);
    const row = await resolveContainment(sql, 'org_1', 'act_1', { verdict: 'promote', resolvedBy: 'op_1' });
    expect(row).toBeNull();
  });

  // Recorded follow-up from the v5.6.0 ship: org scoping was asserted for
  // setContainmentAwaiting but never for the operator-side flip. org_id is
  // part of the WHERE-gate-as-legality-check — a verdict against another
  // org's action must resolve nothing.
  it('org mismatch returns null — org_id is part of the WHERE gate', async () => {
    const sql = makeSql([[]]);
    const row = await resolveContainment(sql, 'org_other', 'act_1', { verdict: 'promote', resolvedBy: 'op_1' });
    expect(row).toBeNull();
    expect(sql.calls[0]!.text).toContain('org_id =');
    expect(sql.calls[0]!.values).toContain('org_other');
  });
});

describe('getActionRecord', () => {
  it('returns the full row scoped by org_id + action_id', async () => {
    const sql = makeSql([[{ action_id: 'act_1', containment_status: 'promoted', declared_goal: 'g' }]]);
    const row = await getActionRecord(sql, 'org_1', 'act_1');
    expect(row?.action_id).toBe('act_1');
    expect(sql.calls[0]!.text).toContain('SELECT * FROM action_records');
    expect(sql.calls[0]!.text).toContain('org_id =');
    expect(sql.calls[0]!.values).toEqual(['act_1', 'org_1']);
  });

  it('org mismatch returns null', async () => {
    const sql = makeSql([[]]);
    const row = await getActionRecord(sql, 'org_other', 'act_1');
    expect(row).toBeNull();
  });
});

describe('findUnconsumedPromotionGrant', () => {
  it('matches on action_type + the canonical declared_goal + agent_id + act_content_hash, unconsumed + approved only', async () => {
    const sql = makeSql([[{ action_id: 'act_promo_1', approval_grant_used_at: null }]]);
    const row = await findUnconsumedPromotionGrant(sql, 'org_1', 'act_1', 'agent_1', 'hash_abc');
    expect(row?.action_id).toBe('act_promo_1');
    expect(sql.calls[0]!.text).toContain("action_type = 'containment_promote'");
    expect(sql.calls[0]!.text).toContain('approval_grant_used_at IS NULL');
    expect(sql.calls[0]!.text).toContain('approved_by IS NOT NULL');
    expect(sql.calls[0]!.text).toContain('agent_id IS NOT DISTINCT FROM');
    expect(sql.calls[0]!.text).toContain('act_content_hash IS NOT DISTINCT FROM');
    expect(sql.calls[0]!.values).toContain(buildPromotionGoal('act_1'));
    expect(sql.calls[0]!.values).toContain('agent_1');
    expect(sql.calls[0]!.values).toContain('hash_abc');
  });

  it('returns null when no unconsumed grant exists (already consumed or never minted)', async () => {
    const sql = makeSql([[]]);
    const row = await findUnconsumedPromotionGrant(sql, 'org_1', 'act_1', 'agent_1', 'hash_abc');
    expect(row).toBeNull();
  });

  // SECURITY (grant-laundering fix, 2026-07-27): a planted row sharing the
  // canonical declared_goal but a different agent_id or act must not be
  // findable — this is the guard against stamping a real operator approval
  // onto an attacker-chosen act via the re-issue path.
  it('a planted row with a different agent_id is not matched (query scopes by agent_id)', async () => {
    const sql = makeSql([[]]);
    const row = await findUnconsumedPromotionGrant(sql, 'org_1', 'act_1', 'agent_real', 'hash_real');
    expect(row).toBeNull();
    expect(sql.calls[0]!.values).toContain('agent_real');
  });

  it('scopes by the exact act_content_hash so a different act never matches', async () => {
    const sql = makeSql([[]]);
    await findUnconsumedPromotionGrant(sql, 'org_1', 'act_1', 'agent_1', 'hash_expected');
    expect(sql.calls[0]!.values).toContain('hash_expected');
    expect(sql.calls[0]!.values).not.toContain('hash_planted');
  });
});

describe('createActionRecord — no undefined SQL binds (strict-driver class)', () => {
  // The self-host postgres driver rejects an undefined bind outright
  // (UNDEFINED_VALUE) while Neon silently coerces — the class behind the
  // 2026-06 approvals 500 and the 2026-07-28 containment-promote 500 on CI.
  // This is the containment route's EXACT mintPromotionGrant payload shape:
  // no riskScore, no costEstimate at the payload top level.
  it("the promote grant's payload shape binds no undefined values", async () => {
    const sql = makeSql([[{ action_id: 'act_promo' }]]);
    await createActionRecord(sql, {
      orgId: 'org_1',
      action_id: 'act_promo',
      data: {
        agent_id: 'agent_1',
        action_type: 'containment_promote',
        declared_goal: 'containment promote act_1',
        act: { kind: 'shell', command: 'git merge --no-ff dashclaw/contained-s1' },
        risk_score: 20,
        reversible: true,
        reasoning: 'Operator promoted contained action act_1',
      },
      actionStatus: 'running',
      signature: null,
      verified: false,
      timestamp_start: '2026-07-28T00:00:00Z',
      createdBy: 'operator',
    } as never);
    expect(sql.calls[0]!.values).not.toContain(undefined);
  });

  it('an undefined agent_id binds null, never undefined', async () => {
    const sql = makeSql([[{ action_id: 'act_x' }]]);
    await createActionRecord(sql, {
      orgId: 'org_1',
      action_id: 'act_x',
      data: { action_type: 'apply', declared_goal: 'g' },
      actionStatus: 'running',
      signature: null,
      verified: false,
      timestamp_start: '2026-07-28T00:00:00Z',
    } as never);
    expect(sql.calls[0]!.values).not.toContain(undefined);
  });
});

describe('createActionRecord — containment_status passthrough', () => {
  it('threads containment_status from data into the INSERT', async () => {
    const sql = makeSql([[{ action_id: 'act_1' }]]);
    await createActionRecord(sql, {
      orgId: 'org_1',
      action_id: 'act_1',
      data: { agent_id: 'a1', action_type: 'file_edit', declared_goal: 'g', containment_status: 'contained' },
      actionStatus: 'running',
      signature: null,
      verified: false,
      timestamp_start: '2026-07-27T00:00:00Z',
    });
    expect(sql.calls[0]!.text).toContain('containment_status');
    expect(sql.calls[0]!.values).toContain('contained');
  });

  it('binds NULL when containment_status is absent', async () => {
    const sql = makeSql([[{ action_id: 'act_1' }]]);
    await createActionRecord(sql, {
      orgId: 'org_1',
      action_id: 'act_1',
      data: { agent_id: 'a1', action_type: 'deploy', declared_goal: 'g' },
      actionStatus: 'running',
      signature: null,
      verified: false,
      timestamp_start: '2026-07-27T00:00:00Z',
    });
    // guard_decision_id, containment_status, act_content_hash, created_by, harness_session_id,
    // subagent_uuid, close_source, approval_expires_at — containment_status is 7th from the end.
    expect(sql.calls[0]!.values.at(-7)).toBeNull();
  });
});

describe('listActions — containment_status filter', () => {
  it('tagged-sql path: builds an active containment_status fragment (embedded into the WHERE as an opaque nested value — this mock does not splice fragment SQL text into the outer call, so we assert on the fragment-builder call itself)', async () => {
    // An empty response queue is fine here: every call falls back to `[]` and
    // we only inspect the SQL text/values, not the parsed result.
    const sql = makeSql([]);
    await listActions(sql, 'org_1', { containment_status: 'awaiting_promotion' });
    const fragmentCall = sql.calls.find((c) => /containment_status/i.test(c.text));
    expect(fragmentCall?.text).toContain('AND containment_status =');
    expect(fragmentCall?.values).toContain('awaiting_promotion');
  });

  it('query-mock path: adds the containment_status condition to the WHERE clause', async () => {
    const sql = makeQuerySqlMock([[], [{ total: '0' }], [{}]]);
    await listActions(sql as never, 'org_1', { containment_status: 'contained' });
    const [listText, listParams] = sql.queryCalls[0]!;
    expect(listText).toContain('containment_status =');
    expect(listParams).toContain('contained');
  });

  // SECURITY LOW (2026-07-27 pre-ship sweep): containment_status must be
  // allowlisted against the four lifecycle values, mirroring outcome_status.
  it('drops an invalid containment_status value instead of passing it through to SQL', async () => {
    const sql = makeSql([]);
    await listActions(sql, 'org_1', { containment_status: "'; DROP TABLE action_records; --" });
    const fragmentCall = sql.calls.find((c) => /AND containment_status =/i.test(c.text));
    expect(fragmentCall).toBeUndefined();
  });

  it('accepts each of the four valid lifecycle values', async () => {
    for (const status of ['contained', 'awaiting_promotion', 'promoted', 'discarded']) {
      const sql = makeSql([]);
      await listActions(sql, 'org_1', { containment_status: status });
      const fragmentCall = sql.calls.find((c) => /AND containment_status =/i.test(c.text));
      expect(fragmentCall?.values).toContain(status);
    }
  });
});

describe('listActions — SELECT projection includes containment columns', () => {
  // Regression: the WHERE-fragment tests above passed even while the explicit
  // SELECT column list omitted containment_status/containment_ref entirely —
  // filtering matched rows server-side, but the returned rows carried no
  // containment fields, so any caller reading row.containment_status (e.g.
  // `dashclaw contained list`) saw undefined on every row. Assert the
  // projected column list itself, not just the WHERE clause.
  it('tagged-sql path: the actions SELECT projects all four containment columns', async () => {
    const sql = makeSql([]);
    await listActions(sql, 'org_1', {});
    const selectCall = sql.calls.find((c) => /SELECT/i.test(c.text) && /FROM\s+action_records/i.test(c.text) && !/COUNT\(/i.test(c.text));
    expect(selectCall?.text).toContain('containment_status');
    expect(selectCall?.text).toContain('containment_ref');
    expect(selectCall?.text).toContain('containment_resolved_by');
    expect(selectCall?.text).toContain('containment_resolved_at');
  });

  it('query-mock path: the actions SELECT projects all four containment columns', async () => {
    const sql = makeQuerySqlMock([[], [{ total: '0' }], [{}]]);
    await listActions(sql as never, 'org_1', {});
    const [listText] = sql.queryCalls[0]!;
    expect(listText).toContain('containment_status');
    expect(listText).toContain('containment_ref');
    expect(listText).toContain('containment_resolved_by');
    expect(listText).toContain('containment_resolved_at');
  });
});
