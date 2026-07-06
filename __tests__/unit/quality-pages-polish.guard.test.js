/**
 * P16 guards for the Scoring/Evaluations clarity pass.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { distributionSegmentPct } from '../../app/lib/scoring-ui';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

describe('no alert()/confirm() on the quality pages (repo error-pattern compliance)', () => {
  for (const page of [['app', 'scoring', 'page.tsx'], ['app', 'evaluations', 'page.tsx']]) {
    it(`${page.join('/')} uses inline errors, not native dialogs`, () => {
      const src = read(...page);
      expect(src).not.toMatch(/\balert\(/);
      expect(src).not.toMatch(/\bconfirm\(/);
    });
  }
});

describe('IA: one name per surface', () => {
  it('/scoring page title is Scoring and both Labs surfaces carry Labs breadcrumbs', () => {
    const scoring = read('app', 'scoring', 'page.tsx');
    expect(scoring).toContain('title="Scoring"');
    // Both Labs surfaces carry Labs breadcrumbs (the old taxonomy said Operations).
    expect(scoring).toContain("breadcrumbs={['Labs', 'Scoring']}");
    const evaluations = read('app', 'evaluations', 'page.tsx');
    expect(evaluations).toContain("breadcrumbs={['Labs', 'Evaluations']}");
  });
});

describe('calibration distribution zero-guard', () => {
  it('returns clamped percentages for a normal spread', () => {
    expect(distributionSegmentPct(0, 25, 0, 100)).toBe(25);
    expect(distributionSegmentPct(25, 75, 0, 100)).toBe(50);
  });

  it('returns 0 (not NaN) when every sampled value is identical', () => {
    expect(distributionSegmentPct(5, 5, 5, 5)).toBe(0);
    expect(Number.isNaN(distributionSegmentPct(5, 5, 5, 5))).toBe(false);
  });

  it('clamps out-of-order inputs instead of emitting negative widths', () => {
    expect(distributionSegmentPct(75, 25, 0, 100)).toBe(0);
    expect(distributionSegmentPct(0, 200, 0, 100)).toBe(100);
  });
});
