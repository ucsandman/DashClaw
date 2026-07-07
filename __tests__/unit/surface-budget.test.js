import { describe, expect, it } from 'vitest';
import {
  evaluateBudget,
  liveCounts,
  loadCeilings,
} from '../../scripts/check-surface-budget.mjs';

// Fixture budget mirrors the real file's shape ({ ceiling, source } per surface).
const budget = {
  ceilings: {
    apiRoutes: { ceiling: 100, source: 'app/api/**/route.*' },
    mcpTools: { ceiling: 12, source: 'tools.ts' },
  },
};

describe('evaluateBudget (anti-regrowth brake logic)', () => {
  it('passes when every surface is under its ceiling', () => {
    const r = evaluateBudget({ apiRoutes: 99, mcpTools: 11 }, budget);
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('treats an at-ceiling count as within budget (not a violation)', () => {
    const r = evaluateBudget({ apiRoutes: 100, mcpTools: 12 }, budget);
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('fails and names only the exceeded surface, with its numbers', () => {
    const r = evaluateBudget({ apiRoutes: 101, mcpTools: 12 }, budget);
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.surface)).toEqual(['apiRoutes']);
    expect(r.violations[0]).toMatchObject({ count: 101, ceiling: 100, status: 'exceed' });
  });

  it('reports every exceeded surface when several regrow at once', () => {
    const r = evaluateBudget({ apiRoutes: 101, mcpTools: 20 }, budget);
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.surface).sort()).toEqual(['apiRoutes', 'mcpTools']);
  });

  it('flags a declared ceiling with no matching live count as a violation', () => {
    const r = evaluateBudget({ apiRoutes: 50 }, budget);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.surface === 'mcpTools' && v.status === 'uncounted')).toBe(true);
  });

  it('accepts a flat numeric ceiling map', () => {
    expect(evaluateBudget({ a: 3 }, { a: 3 }).ok).toBe(true);
    expect(evaluateBudget({ a: 4 }, { a: 3 }).ok).toBe(false);
  });
});

describe('surface budget is pinned to the live counts (v5.0.0 ratchet)', () => {
  // The gate is green today: no governed surface exceeds its ceiling, and each
  // ceiling equals its exact current count — no slack to absorb regrowth. When a
  // surface is DELETED, ratchet the ceiling down here (a deletion is never a
  // regrowth, but leaving slack would let one route grow back unnoticed).
  const counts = liveCounts();
  const { ceilings } = loadCeilings();

  it('the live tree is within budget (surface:check would exit 0)', () => {
    expect(evaluateBudget(counts, { ceilings }).ok).toBe(true);
  });

  for (const [surface, spec] of Object.entries(loadCeilings().ceilings)) {
    it(`${surface} ceiling equals its live count`, () => {
      expect(counts[surface]).toBe(spec.ceiling);
    });
  }
});
