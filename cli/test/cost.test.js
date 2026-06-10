// cli/test/cost.test.js — tests for `dashclaw cost`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runCost, validateCostFlags, formatSpend, USAGE } from '../lib/cost.js';

const CLAUDE_CODE_FIXTURE = {
  lens: 'claude_code',
  period: '7d',
  code_total_usd: 12.34,
  code_sessions: {
    total_cost_usd: 12.34,
    total_cache_savings_usd: 3.21,
    session_count: 42,
    by_project: [
      { project_id: 'cp_1', project_name: 'dashclaw', cost_usd: '8.00' },
      { project_id: 'cp_2', project_name: 'leak-autopilot', cost_usd: '4.34' },
      { project_id: 'cp_3', project_name: 'zero-spend', cost_usd: '0' },
    ],
  },
};

const FLEET_FIXTURE = {
  lens: 'fleet',
  period: '30d',
  fleet_total_usd: 12.34,
  agent: { total_cost_usd: 10.0 },
  x402: { total_spend_usd: 2.34 },
};

describe('validateCostFlags', () => {
  it('accepts the valid lens/period combinations', () => {
    for (const lens of ['fleet', 'claude-code']) {
      for (const period of ['7d', '30d', '90d']) {
        assert.equal(validateCostFlags({ lens, period }), null);
      }
    }
  });

  it('rejects a bad lens with usage text', () => {
    const msg = validateCostFlags({ lens: 'everything', period: '7d' });
    assert.match(msg, /Invalid --lens "everything"/);
    assert.ok(msg.includes(USAGE));
  });

  it('rejects a bad period with usage text', () => {
    const msg = validateCostFlags({ lens: 'fleet', period: '1y' });
    assert.match(msg, /Invalid --period "1y"/);
    assert.ok(msg.includes(USAGE));
  });
});

describe('formatSpend — claude-code lens', () => {
  it('prints correct totals, sessions, cache savings, and project breakdown', () => {
    const out = formatSpend(CLAUDE_CODE_FIXTURE, { lens: 'claude-code', period: '7d' });
    assert.match(out, /Claude Code spend — last 7d/);
    assert.match(out, /Total\s+\$12\.34/);
    assert.match(out, /Sessions\s+42/);
    assert.match(out, /Cache saved\s+\$3\.21/);
    assert.match(out, /dashclaw\s+\$8\.00/);
    assert.match(out, /leak-autopilot\s+\$4\.34/);
    assert.doesNotMatch(out, /zero-spend/); // zero rows pruned
    assert.match(out, /Summary: \$12\.34 across 42 session\(s\) in the last 7d\./);
  });

  it('empty data → "no spend recorded yet" + ingest pointer', () => {
    const out = formatSpend(
      { code_total_usd: 0, code_sessions: { session_count: 0 } },
      { lens: 'claude-code', period: '7d' },
    );
    assert.match(out, /No Claude Code spend recorded yet for 7d/);
    assert.match(out, /DASHCLAW_CODE_SESSIONS_ENABLED/);
  });
});

describe('formatSpend — fleet lens', () => {
  it('prints the Agent LLM / x402 / Total breakdown', () => {
    const out = formatSpend(FLEET_FIXTURE, { lens: 'fleet', period: '30d' });
    assert.match(out, /Fleet spend — last 30d/);
    assert.match(out, /Agent LLM\s+\$10\.00/);
    assert.match(out, /x402 purchases\s+\$2\.34/);
    assert.match(out, /Total\s+\$12\.34/);
  });

  it('empty data → friendly empty message', () => {
    const out = formatSpend({ fleet_total_usd: 0 }, { lens: 'fleet', period: '7d' });
    assert.match(out, /No fleet spend recorded yet for 7d/);
  });
});

describe('runCost', () => {
  it('fetches with the requested lens/period and returns the formatted table', async () => {
    const calls = [];
    const fetcher = async (config, opts) => {
      calls.push({ config, opts });
      return CLAUDE_CODE_FIXTURE;
    };
    const out = await runCost(
      { baseUrl: 'http://x', apiKey: 'k' },
      { lens: 'claude-code', period: '7d' },
      { fetcher },
    );
    assert.deepEqual(calls[0].opts, { lens: 'claude-code', period: '7d' });
    assert.match(out, /\$12\.34/);
  });

  it('defaults to claude-code / 7d', async () => {
    const calls = [];
    const fetcher = async (_c, opts) => { calls.push(opts); return CLAUDE_CODE_FIXTURE; };
    await runCost({ baseUrl: 'http://x', apiKey: 'k' }, {}, { fetcher });
    assert.deepEqual(calls[0], { lens: 'claude-code', period: '7d' });
  });

  it('throws a usage-tagged error on bad flags WITHOUT calling the API', async () => {
    let called = false;
    const fetcher = async () => { called = true; return {}; };
    await assert.rejects(
      runCost({ baseUrl: 'http://x', apiKey: 'k' }, { lens: 'nope', period: '7d' }, { fetcher }),
      (err) => err.usage === true && /Invalid --lens/.test(err.message),
    );
    assert.equal(called, false);
  });

  it('propagates status-bearing API errors (401) for the caller to render', async () => {
    const fetcher = async () => {
      const err = new Error('Invalid or missing API key');
      err.status = 401;
      throw err;
    };
    await assert.rejects(
      runCost({ baseUrl: 'http://x', apiKey: 'bad' }, {}, { fetcher }),
      (err) => err.status === 401,
    );
  });
});
