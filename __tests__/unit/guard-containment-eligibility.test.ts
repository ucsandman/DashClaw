import { describe, it, expect } from 'vitest';
import { isContainableAct, clientAdvertisesContainment, finalizeContainment, buildPromotionAct, buildPromotionGoal, safeBranchSegment, buildContainmentRef } from '../../app/lib/guard/containment';

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
  it('advertised + eligible → stays contained, returns containment object with server-derived ref', () => {
    const { acc, rb } = mk('allow_contained', {});
    const out = finalizeContainment({ ...fileAct, client_capabilities: ['allow_contained'], harness_session_id: 'abc-123' } as any, acc, rb);
    expect(acc.highestDecision).toBe('allow_contained');
    expect(out.containment).toEqual({ status: 'contained', basis: 'file', ref: 'dashclaw/contained-abc-123' });
  });
  it('no harness_session_id → ref falls back to the "session" segment (hook parity)', () => {
    const { acc, rb } = mk('allow_contained', {});
    const out = finalizeContainment({ ...fileAct, client_capabilities: ['allow_contained'] } as any, acc, rb);
    expect(out.containment?.ref).toBe('dashclaw/contained-session');
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

// Parity contract with hooks/dashclaw_pretool.py _safe_branch_segment: the hook
// derives the worktree branch from the SAME harness session id it sends as
// harness_session_id on every ?record=true guard payload, so these two
// implementations MUST sanitize identically (sub → strip → truncate → fallback).
// A divergence turns every legitimate awaiting_promotion flip into a 409.
describe('safeBranchSegment (hook parity)', () => {
  it('passes clean alnum+dash ids through', () => {
    expect(safeBranchSegment('abc123-DEF')).toBe('abc123-DEF');
  });
  it('substitutes every non [A-Za-z0-9-] char with a dash', () => {
    expect(safeBranchSegment('a.b_c d')).toBe('a-b-c-d');
  });
  it('strips leading/trailing dashes AFTER substitution', () => {
    expect(safeBranchSegment('_lead.trail_')).toBe('lead-trail');
  });
  it('empty, non-string, and all-invalid inputs fall back to "session"', () => {
    expect(safeBranchSegment('')).toBe('session');
    expect(safeBranchSegment(null)).toBe('session');
    expect(safeBranchSegment(undefined)).toBe('session');
    expect(safeBranchSegment('---')).toBe('session');
    expect(safeBranchSegment(42)).toBe('session');
  });
  it('truncates to 64 chars after stripping (python [:64] order)', () => {
    expect(safeBranchSegment('a'.repeat(80))).toBe('a'.repeat(64));
    // strip happens on the full string first, then the slice
    expect(safeBranchSegment('a'.repeat(63) + '-'.repeat(7))).toBe('a'.repeat(63));
  });
});

describe('buildContainmentRef', () => {
  it('produces the exact ref shape the hook creates and the flip route validates', () => {
    expect(buildContainmentRef('6f9c2b1e-uuid')).toBe('dashclaw/contained-6f9c2b1e-uuid');
    expect(buildContainmentRef(null)).toBe('dashclaw/contained-session');
  });
});

describe('canonical promotion act', () => {
  it('is deterministic', () => {
    expect(buildPromotionGoal('act_123')).toBe('containment promote act_123');
    expect(buildPromotionAct('dashclaw/contained-s1')).toEqual({ kind: 'shell', command: 'git merge --no-ff dashclaw/contained-s1' });
  });
});
