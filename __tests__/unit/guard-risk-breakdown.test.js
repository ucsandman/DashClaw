import { beforeEach, describe, expect, it } from 'vitest';
import { evaluateGuard, computeRiskScore, __resetGuardCaches } from '@/lib/guard.js';

// Risk-derivation ledger coverage: the breakdown's terms must reproduce the
// persisted score exactly (base + modifiers = server_total; final = effective
// + predictive), templates fold in via max, and the word-bounded goal regexes
// no longer fire on 'monkey'/'pushback'/'formatting'.

const stubSql = (riskTemplates = []) =>
  Object.assign(
    async (strings) => {
      const text = Array.isArray(strings) ? strings.join(' ') : '';
      if (text.includes('FROM risk_templates')) return riskTemplates;
      return [];
    },
    { query: async () => [] },
  );

const sumBreakdown = (b) => {
  const serverSum = Math.max(0, Math.min(b.base.score + b.modifiers.reduce((s, m) => s + m.delta, 0), 100));
  expect(b.server_total).toBe(serverSum);
  const effective = Math.max(b.server_total, b.template?.score ?? 0, b.client_reported ?? 0);
  expect(b.effective).toBe(effective);
  const final = Math.round(Math.max(0, Math.min(b.effective + (b.predictive?.adjustment ?? 0), 100)));
  expect(b.final).toBe(final);
};

describe('guard risk breakdown', () => {
  beforeEach(() => __resetGuardCaches());

  it('fixture 1: modifiers + base sum to the final score (no client, no template)', async () => {
    const result = await evaluateGuard('org_b1', {
      action_type: 'deploy',
      agent_id: 'a1',
      declared_goal: 'deploy the release to production',
      systems_touched: ['production'],
      reversible: false,
    }, stubSql());
    const b = result.risk_breakdown;
    expect(b.base).toEqual({ action_type: 'deploy', score: 75 });
    const factors = b.modifiers.map((m) => m.factor);
    expect(factors).toContain('irreversible');
    expect(factors).toContain('systems:production');
    expect(factors).toContain('goal:deployment-pattern');
    sumBreakdown(b);
    expect(result.risk_score).toBe(b.final);
  });

  it('fixture 2: agent-reported risk max-folds into effective', async () => {
    const result = await evaluateGuard('org_b2', {
      action_type: 'research',
      agent_id: 'a2',
      declared_goal: 'summarize the docs',
      risk_score: 88,
    }, stubSql());
    const b = result.risk_breakdown;
    expect(b.client_reported).toBe(88);
    expect(b.effective).toBe(88); // research base 10 < client 88
    sumBreakdown(b);
  });

  it('fixture 3: an active risk template raises effective risk and is attributed', async () => {
    const result = await evaluateGuard('org_b3', {
      action_type: 'config',
      agent_id: 'a3',
      declared_goal: 'update settings',
    }, stubSql([
      { id: 'rt_1', name: 'Production Safety', action_type: 'config', base_risk: 65, rules: [], status: 'active' },
    ]));
    const b = result.risk_breakdown;
    expect(b.template).toEqual({ id: 'rt_1', name: 'Production Safety', score: 65 });
    expect(b.effective).toBe(65); // config base 30 < template 65
    sumBreakdown(b);
    expect(result.risk_score).toBe(65);
  });

  it('breakdown is persisted inside the guard_decisions context payload', async () => {
    const inserts = [];
    const sql = Object.assign(
      async (strings, ...values) => {
        const text = Array.isArray(strings) ? strings.join(' ') : '';
        if (text.includes('INSERT INTO guard_decisions')) inserts.push(values);
        if (text.includes('FROM risk_templates')) return [];
        return [];
      },
      { query: async () => [] },
    );
    const result = await evaluateGuard('org_b4', { action_type: 'test', agent_id: 'a4' }, sql);
    expect(inserts).toHaveLength(1);
    const contextJson = inserts[0].find((v) => typeof v === 'string' && v.includes('_risk_breakdown'));
    expect(contextJson).toBeTruthy();
    expect(JSON.parse(contextJson)._risk_breakdown.final).toBe(result.risk_score);
  });
});

describe('goal-pattern word boundaries (false-positive fixes)', () => {
  it("does not add goal modifiers for 'monkey', 'pushback', or 'formatting'", () => {
    const benign = computeRiskScore({
      action_type: 'fix',
      declared_goal: 'fix the monkey keyboard pushback while reformatting code',
    });
    expect(benign).toBe(20); // fix base only — no secret/deploy/destructive deltas
  });

  it('still catches real secret/deploy/destructive phrasing', () => {
    expect(computeRiskScore({ action_type: 'fix', declared_goal: 'rotate the api key' })).toBe(35); // 20 + secret 15
    expect(computeRiskScore({ action_type: 'fix', declared_goal: 'push the hotfix' })).toBe(30); // 20 + deploy 10
    expect(computeRiskScore({ action_type: 'fix', declared_goal: 'drop table users' })).toBe(40); // 20 + destructive 20
  });
});
