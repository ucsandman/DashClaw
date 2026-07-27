import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '@/lib/guard.js';

// RFC 2026-07-06-containment-verdicts, Task 4: risk_threshold gains the
// contain_above band. Harness pattern copied from
// __tests__/unit/guard-delegation-constraint.test.js.
const policy = { id: 'p_rt', name: 'RT', policy_type: 'risk_threshold' };
const ev = (rules: any, context: any, risk: number) => evaluatePolicy(policy as any, rules, context, null as any, 'org_1', risk);

const fileAct = { kind: 'file', file: { path: 'src/a.ts', content_excerpt: 'x' } };
const httpAct = { kind: 'http', request: { url: 'https://x.com', method: 'POST' } };
const rules = { threshold: 80, action: 'require_approval', contain_above: 50 };

describe('risk_threshold evaluator — contain_above band', () => {
  it('below the band → null', async () => {
    expect(await ev(rules, { act: fileAct }, 49)).toBeNull();
  });

  it('at the bottom of the band, eligible act → allow_contained', async () => {
    const result = await ev(rules, { act: fileAct }, 50);
    expect(result!.action).toBe('allow_contained');
    expect(result!.reason).toMatch(/containment band/i);
  });

  it('just below threshold, eligible act → allow_contained', async () => {
    const result = await ev(rules, { act: fileAct }, 79);
    expect(result!.action).toBe('allow_contained');
  });

  it('at threshold → require_approval with the existing >= threshold reason', async () => {
    const result = await ev(rules, { act: fileAct }, 80);
    expect(result!.action).toBe('require_approval');
    expect(result!.reason).toMatch(/>= threshold/);
  });

  it('in the band, ineligible act → require_approval (not containable)', async () => {
    const result = await ev(rules, { act: httpAct }, 50);
    expect(result!.action).toBe('require_approval');
    expect(result!.reason).toMatch(/not containable/i);
  });

  it('no contain_above → today\'s behavior exactly (null below threshold)', async () => {
    const { contain_above, ...noBand } = rules;
    expect(await ev(noBand, { act: fileAct }, 79)).toBeNull();
  });

  it('contain_above present but rules.action is "block" → band inert (no-op)', async () => {
    const blockRules = { threshold: 80, action: 'block', contain_above: 50 };
    expect(await ev(blockRules, { act: fileAct }, 50)).toBeNull();
  });
});
