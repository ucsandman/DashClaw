import { describe, it, expect } from 'vitest';
import {
  normalizeGoal,
  shapeKey,
  candidateId,
  benignEvidence,
  dangerEvidence,
  mineOverScoredBenign,
  mineUnderScoredDanger,
  mineRepeatedApprovals,
  suggestBounds,
  buildVectorEntry,
  serializeVectorEntry,
  appendVectorToFixtureText,
} from '../../scripts/lib/calibration-mining.mjs';
import { RISK_MEDIUM_MIN } from '@/lib/riskThresholds.js';

const event = (overrides = {}) => ({
  id: 'act_gd_1',
  origin: 'decision',
  risk_score: null,
  decision: null,
  approved: false,
  denied: false,
  outcome_status: null,
  bash_intent: null,
  action_type: 'review',
  declared_goal: 'Bash: git show --stat HEAD',
  command_shape: null,
  risk_breakdown: null,
  ...overrides,
});

describe('shape keys', () => {
  it('prefers command_shape when present', () => {
    expect(shapeKey(event({ command_shape: 'git show *' }))).toBe('git show *');
  });

  it('normalizes ids and digits so identical shapes collide', () => {
    const a = event({ declared_goal: 'Deploy release 4.22 to production' });
    const b = event({ declared_goal: 'Deploy release 4.23 to production' });
    expect(shapeKey(a)).toBe(shapeKey(b));
  });

  it('normalizeGoal strips hashes', () => {
    expect(normalizeGoal('git show dfeac026a11')).toBe('git show #');
  });

  it('candidateId is deterministic and cv_-prefixed', () => {
    expect(candidateId('r1', 'k')).toBe(candidateId('r1', 'k'));
    expect(candidateId('r1', 'k')).toMatch(/^cv_[0-9a-f]{16}$/);
    expect(candidateId('r1', 'k')).not.toBe(candidateId('r2', 'k'));
  });
});

describe('evidence tiers', () => {
  it('benign: approval outranks everything; block disqualifies completion', () => {
    expect(benignEvidence(event({ approved: true }))).toBe('human_approved');
    expect(benignEvidence(event({ outcome_status: 'completed' }))).toBe('completed_success');
    expect(benignEvidence(event({ outcome_status: 'completed', decision: 'block' }))).toBe(null);
    expect(benignEvidence(event({ bash_intent: 'readonly' }))).toBe('readonly_intent');
    expect(benignEvidence(event())).toBe(null);
  });

  it('danger: denial, block, destructive intent', () => {
    expect(dangerEvidence(event({ denied: true }))).toBe('human_denied');
    expect(dangerEvidence(event({ decision: 'block' }))).toBe('blocked');
    expect(dangerEvidence(event({ bash_intent: 'destructive' }))).toBe('destructive_intent');
    expect(dangerEvidence(event())).toBe(null);
  });
});

describe('R1 over-scored benign', () => {
  it('fires on an approved interruption at/above the band', () => {
    const out = mineOverScoredBenign([event({ approved: true, risk_score: RISK_MEDIUM_MIN })]);
    expect(out).toHaveLength(1);
    expect(out[0].rule).toBe('over_scored_benign');
    expect(out[0].suggested_label).toBe('benign');
    expect(out[0].evidence_tier).toBe('human_approved');
  });

  it('stays quiet below the band and without benign evidence', () => {
    expect(mineOverScoredBenign([event({ approved: true, risk_score: RISK_MEDIUM_MIN - 1 })])).toHaveLength(0);
    expect(mineOverScoredBenign([event({ risk_score: 90 })])).toHaveLength(0);
    expect(mineOverScoredBenign([event({ approved: true, risk_score: null })])).toHaveLength(0);
  });

  it('groups identical shapes and caps evidence at 10', () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      event({ id: `act_gd_${i}`, approved: true, risk_score: 55 }),
    );
    const out = mineOverScoredBenign(events);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(12);
    expect(out[0].event_ids).toHaveLength(10);
    expect(out[0].truncated_events).toBe(2);
  });

  it('prefers a representative carrying a risk_breakdown', () => {
    const out = mineOverScoredBenign([
      event({ id: 'a', approved: true, risk_score: 55 }),
      event({ id: 'b', approved: true, risk_score: 55, risk_breakdown: { final: 55 } }),
    ]);
    expect(out[0].representative.id).toBe('b');
  });
});

describe('R2 under-scored danger', () => {
  it('fires on denied / destructive-intent events below the band', () => {
    expect(mineUnderScoredDanger([event({ denied: true, risk_score: 10 })])).toHaveLength(1);
    const out = mineUnderScoredDanger([event({ bash_intent: 'destructive', risk_score: 20 })]);
    expect(out).toHaveLength(1);
    expect(out[0].suggested_label).toBe('risky');
  });

  it('stays quiet at/above the band or without danger evidence', () => {
    expect(mineUnderScoredDanger([event({ denied: true, risk_score: 80 })])).toHaveLength(0);
    expect(mineUnderScoredDanger([event({ outcome_status: 'completed', risk_score: 10 })])).toHaveLength(0);
  });
});

describe('R3 repeated approvals', () => {
  it('fires at minCount identical approved shapes', () => {
    const events = [1, 2, 3].map((i) => event({ id: `a${i}`, approved: true, risk_score: 20 }));
    const out = mineRepeatedApprovals(events);
    expect(out).toHaveLength(1);
    expect(out[0].rule).toBe('repeated_approvals');
    expect(out[0].count).toBe(3);
  });

  it('stays quiet below minCount or across different shapes', () => {
    const two = [1, 2].map((i) => event({ id: `a${i}`, approved: true }));
    expect(mineRepeatedApprovals(two)).toHaveLength(0);
    const different = [1, 2, 3].map((i) =>
      event({ id: `a${i}`, approved: true, declared_goal: `unrelated goal variant ${'x'.repeat(i)}` }),
    );
    expect(mineRepeatedApprovals(different)).toHaveLength(0);
  });
});

describe('suggestBounds', () => {
  it('benign score inside band: round up to 5 plus headroom', () => {
    expect(suggestBounds('benign', { clientScore: 5 })).toEqual({
      requires_model_fix: false,
      client_expected: { max_risk: 10 },
    });
    expect(suggestBounds('benign', { serverScore: 12 }).server_expected).toEqual({ max_risk: 20 });
  });

  it('benign score contradicting the label: band edge + model fix', () => {
    const out = suggestBounds('benign', { serverScore: 55 });
    expect(out.server_expected).toEqual({ max_risk: RISK_MEDIUM_MIN - 1 });
    expect(out.requires_model_fix).toBe(true);
  });

  it('risky score at/above band: round down minus headroom, floored at band', () => {
    expect(suggestBounds('risky', { clientScore: 82 }).client_expected).toEqual({ min_risk: 75 });
    expect(suggestBounds('risky', { clientScore: 42 }).client_expected).toEqual({ min_risk: RISK_MEDIUM_MIN });
  });

  it('risky score contradicting the label: band edge + model fix', () => {
    const out = suggestBounds('risky', { clientScore: 15 });
    expect(out.client_expected).toEqual({ min_risk: RISK_MEDIUM_MIN });
    expect(out.requires_model_fix).toBe(true);
  });
});

describe('vector entries and fixture append', () => {
  const fixtureText = `{
  "_comment": ["test"],
  "vectors": [
    {
      "name": "existing-vector",
      "label": "benign",
      "source": "seed",
      "bash_command": "git status",
      "client_expected": { "intent": "readonly", "max_risk": 10 }
    }
  ]
}
`;

  it('buildVectorEntry validates name, label, source, and layer coverage', () => {
    expect(() => buildVectorEntry({ name: 'Bad Name', label: 'benign', source: 's', bash_command: 'x' })).toThrow(/kebab-case/);
    expect(() => buildVectorEntry({ name: 'ok', label: 'meh', source: 's', bash_command: 'x' })).toThrow(/benign\|risky/);
    expect(() => buildVectorEntry({ name: 'ok', label: 'benign', source: '', bash_command: 'x' })).toThrow(/source/);
    expect(() => buildVectorEntry({ name: 'ok', label: 'benign', source: 's' })).toThrow(/at least one layer/);
  });

  it('serializes in the fixture style (inline nested objects)', () => {
    const entry = buildVectorEntry({
      name: 'npm-ci',
      label: 'benign',
      source: 'mined 2026-07-02',
      bash_command: 'npm ci',
      client_expected: { intent: 'package_management', max_risk: 30 },
    });
    const text = serializeVectorEntry(entry);
    expect(text).toContain('"client_expected": { "intent": "package_management", "max_risk": 30 }');
    expect(text.startsWith('    {')).toBe(true);
    expect(text.endsWith('    }')).toBe(true);
  });

  it('appends preserving format and refuses duplicates', () => {
    const entry = buildVectorEntry({
      name: 'npm-ci',
      label: 'benign',
      source: 'mined 2026-07-02',
      bash_command: 'npm ci',
      client_expected: { intent: 'package_management', max_risk: 30 },
    });
    const updated = appendVectorToFixtureText(fixtureText, entry);
    const parsed = JSON.parse(updated);
    expect(parsed.vectors).toHaveLength(2);
    expect(parsed.vectors[1].name).toBe('npm-ci');
    // Original bytes untouched before the append point.
    expect(updated.startsWith(fixtureText.slice(0, fixtureText.indexOf('\n  ]')))).toBe(true);
    expect(() => appendVectorToFixtureText(updated, entry)).toThrow(/already exists/);
  });
});
