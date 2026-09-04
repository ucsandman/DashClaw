import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeRiskScore } from '@/lib/guard.js';
import { classifyAct, evidenceTotal } from '@/lib/guard/evidence.js';

// Risk-calibration golden vectors, server layer. The Python mirror
// (hooks/tests/test_risk_calibration_golden.py) runs the SAME fixture's
// bash_command vectors through the client classifier. Two-sided contract:
// benign vectors must stay at/below max_risk (false-positive drift fails CI),
// risky vectors at/above min_risk (calibration can't be gamed downward).
// Add cases per the fixture header + the spec in docs/superpowers/specs/.
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/risk-calibration-golden-vectors.json'), 'utf8'),
);

const serverVectors = fixture.vectors.filter((v) => v.server_context && v.server_expected);
// Third layer (2026-09-04): the server's ACT classifier. computeRiskScore only
// ever sees declared descriptors, so a vector about what a command actually
// does — and about the flags evidence-gated policies read — belongs here.
const evidenceVectors = fixture.vectors.filter((v) => v.bash_command && v.evidence_expected);

describe('risk calibration golden vectors — server (computeRiskScore)', () => {
  it('fixture sanity: has vectors on both sides of the contract', () => {
    expect(serverVectors.some((v) => v.label === 'benign')).toBe(true);
    expect(serverVectors.some((v) => v.label === 'risky')).toBe(true);
  });

  for (const v of serverVectors) {
    it(`[${v.label}] ${v.name}`, () => {
      const score = computeRiskScore(v.server_context);
      if (v.server_expected.max_risk !== undefined) {
        expect(score, `${v.name}: benign vector drifted above its band (source: ${v.source})`).toBeLessThanOrEqual(v.server_expected.max_risk);
      }
      if (v.server_expected.min_risk !== undefined) {
        expect(score, `${v.name}: risky vector fell below its floor (source: ${v.source})`).toBeGreaterThanOrEqual(v.server_expected.min_risk);
      }
    });
  }
});

describe('risk calibration golden vectors — server act classifier (classifyAct)', () => {
  it('fixture sanity: has vectors on both sides of the contract', () => {
    expect(evidenceVectors.some((v) => v.label === 'benign')).toBe(true);
    expect(evidenceVectors.some((v) => v.label === 'risky')).toBe(true);
  });

  for (const v of evidenceVectors) {
    it(`[${v.label}] ${v.name}`, () => {
      const classification = classifyAct({ kind: 'shell', command: v.bash_command });
      expect(classification, `${v.name}: produced no gradeable evidence`).not.toBeNull();
      const score = evidenceTotal(classification);
      if (v.evidence_expected.max_risk !== undefined) {
        expect(score, `${v.name}: benign vector drifted above its band (source: ${v.source})`).toBeLessThanOrEqual(v.evidence_expected.max_risk);
      }
      if (v.evidence_expected.min_risk !== undefined) {
        expect(score, `${v.name}: risky vector fell below its floor (source: ${v.source})`).toBeGreaterThanOrEqual(v.evidence_expected.min_risk);
      }
      // Flags are half the contract: a policy gated on `only_evidence_flags`
      // fires (or does not) on these strings, so a flag that silently stops
      // being set is a governance regression the score alone never catches.
      for (const flag of v.evidence_expected.flags || []) {
        expect(classification.flags, `${v.name}: lost flag ${flag} (source: ${v.source})`).toContain(flag);
      }
      for (const flag of v.evidence_expected.not_flags || []) {
        expect(classification.flags, `${v.name}: gained flag ${flag} (source: ${v.source})`).not.toContain(flag);
      }
    });
  }
});
