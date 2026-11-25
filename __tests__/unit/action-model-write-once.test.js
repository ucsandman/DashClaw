/**
 * `model` on an action record is settable once.
 *
 * It is free text an operator reads on the decision record, and any org key
 * can PATCH any action in the org. It has to stay reportable after the close
 * (the Stop hook sends it with the turn's tokens), so it cannot be gated on
 * `running` like the other text fields. Instead the first non-empty value
 * sticks: a later write never replaces a stored model.
 *
 * The rule lives in SQL, which a tagged-template mock cannot evaluate, so
 * these tests pin the expression the repository sends on both write paths.
 * The behaviour itself is proven against a real database at ship time.
 */
import { describe, it, expect, vi } from 'vitest';
import { updateActionOutcome } from '../../app/lib/repositories/actions.repository.js';

const squash = (text) => text.replace(/\s+/g, ' ');

function makeCapturingSqlMock(responses) {
  const queue = [...responses];
  const calls = [];
  const sql = vi.fn((strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(queue.shift() ?? []);
  });
  sql.calls = calls;
  return sql;
}

describe('updateActionOutcome: model is write-once', () => {
  it('tagged-SQL path keeps a stored model and takes the request model only when none is stored', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }], [{ action_id: 'act_1', model: 'first' }]]);

    await updateActionOutcome(sql, 'org_1', 'act_1', { model: 'second', tokens_in: 1 });

    const update = sql.calls[1];
    const text = squash(update.text);
    expect(text).toContain('UPDATE action_records SET');
    expect(text).toContain("model = COALESCE(NULLIF(model, ''), NULLIF(?::text, ''), model)");
    expect(text).not.toContain('model = COALESCE(?, model)');
    expect(update.values).toContain('second');
  });

  it('.query() path sends the same rule', async () => {
    const queryCalls = [];
    const sql = Object.assign(vi.fn(async () => [{ action_id: 'act_1' }]), {
      queryCalls,
      query: vi.fn(async (text, params) => {
        queryCalls.push({ text, params });
        return [{ action_id: 'act_1', model: 'first' }];
      }),
    });

    await updateActionOutcome(sql, 'org_1', 'act_1', { model: 'second', tokens_in: 1 });

    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0].text).toMatch(/model = COALESCE\(NULLIF\(model, ''\), NULLIF\(\$\d+, ''\), model\)/);
    expect(queryCalls[0].text).not.toMatch(/model = \$\d+/);
    expect(queryCalls[0].params).toContain('second');
  });
});
