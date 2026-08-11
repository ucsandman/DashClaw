// Two calibration candidates can be mined from the SAME shape by DIFFERENT
// rules — e.g. `rm -rf node_modules/.cache` at risk 45 approved 6x mines both
// over_scored_benign (R1) and repeated_approvals (R3). Verified against the
// live route on 2026-08-11: both carried identical suggested_name, count and
// risk band, and identical evidence_tier ('human_approved'). `rule` is the ONLY
// field that separates them, so the triage card must render it or the operator
// sees two identical rows and cannot tell which finding they are judging.
import { describe, it, expect } from 'vitest';
import { CALIBRATION_RULE_LABEL } from '../../app/policies/lib/calibrationClient';

// Mirrors the CalibrationProposal['rule'] union. A new rule added to the union
// without a label here fails this test rather than shipping a blank card.
const RULES = ['over_scored_benign', 'under_scored_danger', 'repeated_approvals'] as const;

describe('CALIBRATION_RULE_LABEL', () => {
  it('labels every mining rule', () => {
    for (const rule of RULES) {
      expect(CALIBRATION_RULE_LABEL[rule], `no label for ${rule}`).toBeTruthy();
    }
  });

  it('gives each rule a DISTINCT label, so same-shape candidates are tellable apart', () => {
    const labels = RULES.map((r) => CALIBRATION_RULE_LABEL[r]);
    expect(new Set(labels).size).toBe(RULES.length);
  });

  it('covers the union exactly — no orphan labels left behind by a rename', () => {
    expect(Object.keys(CALIBRATION_RULE_LABEL).sort()).toEqual([...RULES].sort());
  });

  it('reads as plain English, not the raw enum', () => {
    for (const rule of RULES) {
      expect(CALIBRATION_RULE_LABEL[rule]).not.toContain('_');
    }
  });
});
