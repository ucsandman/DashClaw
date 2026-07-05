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

  it('fixture 4: predictive decomposition flows into the breakdown (statistical vs LLM)', async () => {
    // Predictive enabled; failing-fast history → +15 failure prior +5 velocity
    // amplifier; server evidence (10) + 20 stays under the LLM threshold (60).
    const sql = Object.assign(
      async (strings) => {
        const text = Array.isArray(strings) ? strings.join(' ') : '';
        if (text.includes('FROM settings')) return [{ key: 'PREDICTIVE_RISK_ENABLED', value: 'true' }];
        if (text.includes('FROM risk_templates')) return [];
        return [];
      },
      {
        query: async (text) => {
          if (String(text).includes('FROM action_records')) {
            return [{ total: '10', failures: '8', avg_risk: '60', recent_count: '8' }];
          }
          return [];
        },
      },
    );
    const result = await evaluateGuard('org_b5', {
      action_type: 'research',
      agent_id: 'a5',
      declared_goal: 'summarize the docs',
    }, sql);
    const b = result.risk_breakdown;
    expect(b.predictive).toMatchObject({
      adjustment: 20,
      statistical_adjustment: 20,
      velocity: 8,
      failure_rate: 0.8,
      total_actions: 10,
      basis: 'history',
      llm: null,
    });
    sumBreakdown(b);
    expect(result.risk_score).toBe(30); // research base 10 + predictive 20
  });

  it('fixture 5: a client-inflated score cannot recruit the LLM amplifier (item 5 decision b)', async () => {
    // June specimen shape: client 88, server evidence 10, clean high-velocity
    // history. Old trigger (effective 88 >= 60) consulted the LLM; the trigger
    // is now server evidence only, so the LLM history query must never run.
    const taggedTexts = [];
    const sql = Object.assign(
      async (strings) => {
        const text = Array.isArray(strings) ? strings.join(' ') : '';
        taggedTexts.push(text);
        if (text.includes('FROM settings')) return [{ key: 'PREDICTIVE_RISK_ENABLED', value: 'true' }];
        if (text.includes('FROM risk_templates')) return [];
        return [];
      },
      {
        query: async (text) => {
          if (String(text).includes('FROM action_records')) {
            return [{ total: '5000', failures: '0', avg_risk: '20', recent_count: '50' }];
          }
          return [];
        },
      },
    );
    const result = await evaluateGuard('org_b6', {
      action_type: 'research',
      agent_id: 'a6',
      declared_goal: 'summarize the docs',
      risk_score: 88,
    }, sql);
    const b = result.risk_breakdown;
    expect(b.client_reported).toBe(88);
    expect(b.predictive).toMatchObject({ adjustment: 0, statistical_adjustment: 0, llm: null });
    expect(b.final).toBe(88); // no velocity tax, no LLM amplifier
    // The LLM path starts with a recent-actions history read — it must not run.
    // (Sentinel is assessRiskWithLLM's unique select list.)
    expect(taggedTexts.some((t) => t.includes('SELECT action_type, status, risk_score, created_at'))).toBe(false);
    sumBreakdown(b);
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

describe('guard risk breakdown — evidence-derived sibling', () => {
  beforeEach(() => __resetGuardCaches());

  it('folds evidence into effective (only raises) and attributes it as a sibling', async () => {
    const result = await evaluateGuard('org_ev_b1', {
      action_type: 'test',
      agent_id: 'a1',
      act: { kind: 'sql', statement: 'DELETE FROM users' },
    }, stubSql());
    const b = result.risk_breakdown;
    // evidence: DELETE base 60 + whereless 20 + declared/derived mismatch 10 = 90
    expect(b.evidence_derived).toMatchObject({ derived_action_type: 'security', total: 90, mismatch: true });
    expect(b.effective).toBe(90); // test base 15 folded up to evidence 90
    expect(b.final).toBe(90);
    expect(result.risk_score).toBe(90);
    // The sibling is NOT part of the server heuristic sum.
    expect(Math.max(0, Math.min(b.base.score + b.modifiers.reduce((s, m) => s + m.delta, 0), 100))).toBe(b.server_total);
  });

  it('evidence_derived is null when no act is attached', async () => {
    const result = await evaluateGuard('org_ev_b2', {
      action_type: 'deploy',
      agent_id: 'a1',
      declared_goal: 'ship it',
    }, stubSql());
    expect(result.risk_breakdown.evidence_derived).toBeNull();
    sumBreakdown(result.risk_breakdown);
  });

  it('a benign act cannot lower a higher declared score', async () => {
    const result = await evaluateGuard('org_ev_b3', {
      action_type: 'security',
      agent_id: 'a1',
      act: { kind: 'http', request: { method: 'GET', url: 'http://localhost/health' } },
    }, stubSql());
    const b = result.risk_breakdown;
    expect(b.evidence_derived.total).toBe(0); // GET 10 - localhost 10
    expect(b.effective).toBe(80); // security base 80 preserved
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
