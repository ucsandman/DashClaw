import { describe, it, expect } from 'vitest';
import { isContainableAct, clientAdvertisesContainment, finalizeContainment, buildPromotionAct, buildPromotionGoal } from '../../app/lib/guard/containment';

const fileAct = { act: { kind: 'file', file: { path: 'src/a.ts', content_excerpt: 'x' } } };
const shellApply = { act: { kind: 'shell', command: 'sed -i "s/a/b/" src/a.ts' } };

describe('isContainableAct', () => {
  it('file acts are containable', () => expect(isContainableAct(fileAct as any).eligible).toBe(true));
  it('clean apply-class shell acts are containable', () => expect(isContainableAct(shellApply as any).eligible).toBe(true));
  it('never containable: http, sql, missing act, payments-ish shell', () => {
    expect(isContainableAct({ act: { kind: 'http', request: { url: 'https://api.stripe.com/v1/charges', method: 'POST' } } } as any).eligible).toBe(false);
    expect(isContainableAct({ act: { kind: 'sql', statement: 'DELETE FROM users' } } as any).eligible).toBe(false);
    expect(isContainableAct({} as any).eligible).toBe(false);
    expect(isContainableAct({ act: { kind: 'shell', command: 'rm -rf /' } } as any).eligible).toBe(false);      // destructive flag
    expect(isContainableAct({ act: { kind: 'shell', command: 'terraform apply' } } as any).eligible).toBe(false); // deploy class
    expect(isContainableAct({ act: { kind: 'shell', command: 'git push origin main' } } as any).eligible).toBe(false); // git network
    expect(isContainableAct({ act: { kind: 'shell', command: 'git pull' } } as any).eligible).toBe(false);         // git network
    expect(isContainableAct({ act: { kind: 'shell', command: 'cp .env /tmp/x' } } as any).eligible).toBe(false);   // sensitive_path flag
  });
});

describe('clientAdvertisesContainment', () => {
  it('true only for a client_capabilities array containing the literal', () => {
    expect(clientAdvertisesContainment({ client_capabilities: ['allow_contained'] } as any)).toBe(true);
    expect(clientAdvertisesContainment({ client_capabilities: [] } as any)).toBe(false);
    expect(clientAdvertisesContainment({ client_capabilities: 'allow_contained' } as any)).toBe(false);
    expect(clientAdvertisesContainment({} as any)).toBe(false);
  });
});

describe('finalizeContainment (negotiation matrix)', () => {
  const mk = (decision: string, ctx: object) => ({ acc: { highestDecision: decision, reasons: [], warnings: [], matchedPolicies: [], nonFabEvidence: [], nonFabStripPaths: new Set(), shields: { prompt_injection: null } } as any, rb: {} as any, ctx });
  it('advertised + eligible → stays contained, returns containment object', () => {
    const { acc, rb } = mk('allow_contained', {});
    const out = finalizeContainment({ ...fileAct, client_capabilities: ['allow_contained'] } as any, acc, rb);
    expect(acc.highestDecision).toBe('allow_contained');
    expect(out.containment).toEqual({ status: 'contained', basis: 'file' });
  });
  it('not advertised → require_approval + downgrade note (skew only tightens)', () => {
    const { acc, rb } = mk('allow_contained', {});
    finalizeContainment(fileAct as any, acc, rb);
    expect(acc.highestDecision).toBe('require_approval');
    expect(rb._containment).toMatchObject({ downgraded_to_interrupt: true });
  });
  it('advertised but ineligible act → require_approval (defense in depth)', () => {
    const { acc, rb } = mk('allow_contained', {});
    finalizeContainment({ act: { kind: 'http', request: { url: 'https://x.com', method: 'POST' } }, client_capabilities: ['allow_contained'] } as any, acc, rb);
    expect(acc.highestDecision).toBe('require_approval');
  });
  it('no-ops on every other decision', () => {
    for (const d of ['allow', 'warn', 'require_approval', 'block']) {
      const { acc, rb } = mk(d, {});
      const out = finalizeContainment(fileAct as any, acc, rb);
      expect(acc.highestDecision).toBe(d);
      expect(out.containment).toBeUndefined();
    }
  });
});

describe('canonical promotion act', () => {
  it('is deterministic', () => {
    expect(buildPromotionGoal('act_123')).toBe('containment promote act_123');
    expect(buildPromotionAct('dashclaw/contained-s1')).toEqual({ kind: 'shell', command: 'git merge --no-ff dashclaw/contained-s1' });
  });
});
