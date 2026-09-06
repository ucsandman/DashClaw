// assumption_hold guard policy (2026-09-05): the operator invalidated an
// assumption the agent recorded, so the agent's next consequential action waits
// for a human instead of proceeding on stale evidence.
//
// Driven through the real `evaluatePolicy` dispatcher with a content-matched
// sql mock, the same approach guard-plan-deviation.test.js uses, so the
// repository's own SQL (the action_records join, the window filter, the family
// match) is exercised rather than stubbed out.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateMessage = vi.fn();
const mockPublish = vi.fn();

vi.mock('../../app/lib/repositories/messagesContext.repository', () => ({
  createMessage: (...args) => mockCreateMessage(...args),
}));
vi.mock('../../app/lib/events', () => ({
  EVENTS: { MESSAGE_CREATED: 'message.created' },
  publishOrgEvent: (...args) => mockPublish(...args),
}));

const { evaluatePolicy } = await import('../../app/lib/guard/policy.ts');
const { notifyAssumptionInvalidated, __resetAssumptionAlertCache } =
  await import('../../app/lib/assumption-notify');

const policy = { id: 'p_ah', name: 'Stale Assumption', policy_type: 'assumption_hold' };

const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();

const row = (over = {}) => ({
  assumption_id: 'asm_1',
  assumption: 'the staging DB is a copy of prod',
  invalidated_reason: 'staging was reseeded Tuesday',
  invalidated_at: minutesAgo(4),
  action_id: 'act_1',
  ...over,
});

// The window is enforced in SQL, so the mock honours it for real: it reads the
// bound `minutes` value out of the query and filters the fixture rows the way
// Postgres would. Bound order is orgId, minutes, ids, likePrefix.
function makeSql(rows = [], { throws = false } = {}) {
  const calls = [];
  const sql = (strings, ...values) => {
    const text = String.raw({ raw: strings }, ...Array(values.length).fill('?'));
    calls.push({ text, values });
    if (throws) return Promise.reject(new Error('assumptions lookup exploded'));
    if (/FROM assumptions a/i.test(text)) {
      const minutes = Number(values[1]);
      const cutoff = Date.now() - minutes * 60_000;
      return Promise.resolve(rows.filter((r) => Date.parse(r.invalidated_at) > cutoff));
    }
    return Promise.resolve([]);
  };
  sql.query = async (text, params = []) => {
    calls.push({ text, values: params });
    return [];
  };
  sql.calls = calls;
  return sql;
}

const assumptionQueries = (sql) => sql.calls.filter((c) => /FROM assumptions a/i.test(c.text));

const ev = (rules, context, sql, risk = 70) =>
  evaluatePolicy(policy, rules, context, sql, 'org_1', risk);

beforeEach(() => {
  vi.clearAllMocks();
  __resetAssumptionAlertCache();
});

describe('assumption_hold evaluator', () => {
  it('holds the next action after a recent invalidation, naming the assumption', async () => {
    const sql = makeSql([row()]);
    const hit = await ev({}, { agent_id: 'coder-1', action_type: 'deploy' }, sql);

    expect(hit.action).toBe('require_approval');
    expect(hit.reason).toContain('the staging DB is a copy of prod');
    expect(hit.reason).toContain('staging was reseeded Tuesday');
    expect(hit.reason).toContain('Stale Assumption');
    expect(hit.reason).toMatch(/invalidated 4 min ago/);
  });

  it('is a no-op for a caller with no agent_id (and never queries)', async () => {
    const sql = makeSql([row()]);
    expect(await ev({}, { action_type: 'deploy' }, sql)).toBeNull();
    expect(assumptionQueries(sql)).toHaveLength(0);
  });

  it('never holds below min_risk_score — reads keep flowing', async () => {
    const sql = makeSql([row()]);
    expect(await ev({ min_risk_score: 40 }, { agent_id: 'coder-1' }, sql, 39)).toBeNull();
    expect(assumptionQueries(sql), 'below the floor must short-circuit before the DB').toHaveLength(0);

    // The floor is inclusive: exactly min_risk_score still holds.
    const sql2 = makeSql([row()]);
    expect((await ev({ min_risk_score: 40 }, { agent_id: 'coder-1' }, sql2, 40)).action)
      .toBe('require_approval');
  });

  it('defaults to min_risk_score 40 and window_minutes 60', async () => {
    const sql = makeSql([row()]);
    expect(await ev({}, { agent_id: 'coder-1' }, sql, 39)).toBeNull();

    const sql2 = makeSql([row()]);
    await ev({}, { agent_id: 'coder-1' }, sql2);
    expect(assumptionQueries(sql2)[0].values[1]).toBe(60);
  });

  it('ignores an invalidation older than the window', async () => {
    const stale = [row({ invalidated_at: minutesAgo(200) })];

    const narrow = makeSql(stale);
    expect(await ev({ window_minutes: 60 }, { agent_id: 'coder-1' }, narrow)).toBeNull();

    // Same row, wider window — proves the null above came from the window and
    // not from the fixture being unreachable (L1: make the check fail on purpose).
    const wide = makeSql(stale);
    expect((await ev({ window_minutes: 240 }, { agent_id: 'coder-1' }, wide)).action)
      .toBe('require_approval');
  });

  it('blocks only when the operator opted into escalate_action: block', async () => {
    expect((await ev({}, { agent_id: 'coder-1' }, makeSql([row()]))).action).toBe('require_approval');
    expect((await ev({ escalate_action: 'block' }, { agent_id: 'coder-1' }, makeSql([row()]))).action)
      .toBe('block');
    // An unrecognised value falls back to the hold, never to block.
    expect((await ev({ escalate_action: 'warn' }, { agent_id: 'coder-1' }, makeSql([row()]))).action)
      .toBe('require_approval');
  });

  it('matches the agent FAMILY: the id, its base, and composed children', async () => {
    const sql = makeSql([row()]);
    await ev({}, { agent_id: 'coder-1' }, sql);
    const [, , ids, likePrefix] = assumptionQueries(sql)[0].values;
    expect(ids).toContain('coder-1');
    expect(likePrefix).toBe('coder-1:%');
  });

  it('escapes LIKE metacharacters in the client-controlled agent_id', async () => {
    const sql = makeSql([]);
    await ev({}, { agent_id: 'ev%il_one' }, sql);
    const likePrefix = assumptionQueries(sql)[0].values[3];
    expect(likePrefix).toBe('ev\\%il\\_one:%');
  });

  it('fails soft when the lookup throws — a broken query never fails a guard call', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sql = makeSql([row()], { throws: true });
    expect(await ev({}, { agent_id: 'coder-1' }, sql)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('assumption_hold negative cache', () => {
  it('short-circuits the second lookup when there was no invalidation', async () => {
    const sql = makeSql([]);
    expect(await ev({}, { agent_id: 'quiet-1' }, sql)).toBeNull();
    expect(await ev({}, { agent_id: 'quiet-1' }, sql)).toBeNull();
    expect(assumptionQueries(sql), 'second call must be served from the negative cache').toHaveLength(1);
  });

  it('is keyed per window, so a second policy with a different window still queries', async () => {
    const sql = makeSql([]);
    await ev({ window_minutes: 60 }, { agent_id: 'quiet-1' }, sql);
    await ev({ window_minutes: 120 }, { agent_id: 'quiet-1' }, sql);
    expect(assumptionQueries(sql)).toHaveLength(2);
  });

  it('never caches a HIT — a hold is re-checked every call so approval can clear it', async () => {
    const sql = makeSql([row()]);
    expect((await ev({}, { agent_id: 'coder-1' }, sql)).action).toBe('require_approval');
    expect((await ev({}, { agent_id: 'coder-1' }, sql)).action).toBe('require_approval');
    expect(assumptionQueries(sql)).toHaveLength(2);
  });

  it('notifyAssumptionInvalidated clears it, so a fresh invalidation takes effect at once', async () => {
    const sql = makeSql([]);
    await ev({}, { agent_id: 'quiet-1' }, sql);
    expect(assumptionQueries(sql)).toHaveLength(1);

    mockCreateMessage.mockResolvedValue({ id: 'msg_x' });
    await notifyAssumptionInvalidated(sql, 'org_1', {
      agent_id: 'quiet-1',
      assumption_id: 'asm_2',
      assumption: 'the flag is enabled',
      invalidated_reason: 'flag is OFF in prod',
      invalidated_at: new Date().toISOString(),
      action_id: 'act_2',
    });

    await ev({}, { agent_id: 'quiet-1' }, sql);
    expect(assumptionQueries(sql), 'the cached "no invalidations" answer must be dropped').toHaveLength(2);
  });
});

describe('assumption_hold rule validation', () => {
  it('rejects the out-of-range and non-tightening rule shapes', async () => {
    const { validatePolicy } = await import('../../app/lib/validate.js');
    const check = (rules) => validatePolicy({
      name: 'Stale Assumption',
      policy_type: 'assumption_hold',
      rules: JSON.stringify(rules),
    });

    expect(check({}).valid).toBe(true);
    expect(check({ window_minutes: 60, min_risk_score: 40, escalate_action: 'block' }).valid).toBe(true);

    expect(check({ window_minutes: 0 }).valid).toBe(false);
    expect(check({ window_minutes: 20000 }).valid).toBe(false);
    expect(check({ window_minutes: 1.5 }).valid).toBe(false);
    expect(check({ min_risk_score: 101 }).valid).toBe(false);
    expect(check({ escalate_action: 'warn' }).valid).toBe(false);

    expect(check({ escalate_action: 'warn' }).errors.join(' ')).toMatch(/only tightens/);
  });
});
