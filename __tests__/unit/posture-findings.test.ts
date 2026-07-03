import { describe, it, expect } from 'vitest';
import { deriveFindings } from '../../app/lib/posture/findings';
import type { GovernableUnit, Adjustments, Dimension } from '../../app/lib/posture/types';
import { validatePolicy } from '../../app/lib/validate.js';

const unit = (over: Partial<GovernableUnit> = {}): GovernableUnit => ({
  key: 'cap:deploy', surfaceType: 'capability', riskLevel: 'high', reversible: false,
  hasSpendExposure: false, requiresApproval: true, observedCount: 10, dimension: 'enforcement', ...over,
});
const noAdj: Adjustments = { incidents: [], approvalFollowThrough: 1, coachOpenGapUnitKeys: [] };

describe('deriveFindings', () => {
  it('produces no finding for a fully-covered unit', () => {
    expect(deriveFindings([unit({ key: 'a' })], { a: 1 }, noAdj)).toHaveLength(0);
  });

  it('produces a create_policy_draft finding for an uncovered unit, policyType chosen by dimension', () => {
    const f = deriveFindings([unit({ key: 'a', dimension: 'spend' })], { a: 0 }, noAdj);
    expect(f).toHaveLength(1);
    expect(f[0]!.fix.type).toBe('create_policy_draft');
    expect(f[0]!.fix).toMatchObject({ policyType: 'x402_spend_limit' });
    expect(f[0]!.status).toBe('open');
    expect(f[0]!.dimension).toBe('spend');
  });

  it('finding keys are deterministic and stable across runs', () => {
    const a = deriveFindings([unit({ key: 'a' })], { a: 0 }, noAdj);
    const b = deriveFindings([unit({ key: 'a' })], { a: 0 }, noAdj);
    expect(a[0]!.key).toBe(b[0]!.key);
    expect(a[0]!.key).toMatch(/^[0-9a-f]{8}$/);
  });

  it('orders coverage gaps by scoreDelta desc (higher-risk uncovered first)', () => {
    const units = [
      unit({ key: 'minor', riskLevel: 'low', observedCount: 1, dimension: 'enforcement' }),
      unit({ key: 'crit', riskLevel: 'critical', observedCount: 100, dimension: 'enforcement' }),
    ];
    const f = deriveFindings(units, { minor: 0, crit: 0 }, noAdj);
    expect(f).toHaveLength(2);
    expect(f[0]!.title).toContain('"crit"');
    expect(f[0]!.scoreDelta).toBeGreaterThanOrEqual(f[1]!.scoreDelta);
  });

  it('a coach open-gap forces at most partial coverage, yielding a finding even if a policy fires', () => {
    const adj: Adjustments = { incidents: [], approvalFollowThrough: 1, coachOpenGapUnitKeys: ['a'] };
    const f = deriveFindings([unit({ key: 'a' })], { a: 1 }, adj);
    expect(f).toHaveLength(1);
    expect(f[0]!.scoreDelta).toBeGreaterThan(0);
  });

  it('an ungoverned incident becomes a critical review_incident finding sorted above coverage gaps', () => {
    const units = [
      unit({ key: 'x', riskLevel: 'critical', dimension: 'enforcement', observedCount: 50 }),
      unit({ key: 'minor', riskLevel: 'low', dimension: 'spend', observedCount: 1 }),
    ];
    const adj: Adjustments = {
      incidents: [{ unitKey: 'x', actionId: 'act_1', riskLevel: 'high', ts: 't' }],
      approvalFollowThrough: 1, coachOpenGapUnitKeys: [],
    };
    const f = deriveFindings(units, { x: 1, minor: 0 }, adj);
    const incident = f.find((y) => y.fix.type === 'review_incident')!;
    expect(incident.severity).toBe('critical');
    expect(incident.fix).toMatchObject({ type: 'review_incident', actionIds: ['act_1'] });
    expect(incident.scoreDelta).toBeGreaterThan(0); // cap-relief gives it real weight
    expect(f[0]).toBe(incident);
  });

  it('collapses same-pattern incidents into ONE finding with a truthful count (v3.1)', () => {
    const units = [unit({ key: 'x', riskLevel: 'critical', dimension: 'enforcement' })];
    const adj: Adjustments = {
      incidents: Array.from({ length: 40 }, (_, i) => ({
        unitKey: 'action_type:deploy', actionId: `act_${i}`, riskLevel: 'high' as const, ts: 't',
      })),
      approvalFollowThrough: 1, coachOpenGapUnitKeys: [],
    };
    const f = deriveFindings(units, { x: 1 }, adj);
    const incidents = f.filter((y) => y.fix.type === 'review_incident');
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.evidence.observedCount).toBe(40);
    expect(incidents[0]!.evidence.exampleActionIds).toHaveLength(5); // capped examples
    expect(incidents[0]!.fix).toMatchObject({ actionIds: ['act_0', 'act_1', 'act_2', 'act_3', 'act_4'] });
  });

  it('distinct incident patterns stay distinct findings, and keys are stable across windows (v3.1)', () => {
    const units = [unit({ key: 'x', riskLevel: 'critical' })];
    const mk = (unitKey: string, riskLevel: 'high' | 'critical', ids: string[]): Adjustments => ({
      incidents: ids.map((id) => ({ unitKey, actionId: id, riskLevel, ts: 't' })),
      approvalFollowThrough: 1, coachOpenGapUnitKeys: [],
    });
    const both: Adjustments = {
      incidents: [
        ...mk('action_type:deploy', 'high', ['a1', 'a2']).incidents,
        ...mk('action_type:migrate', 'critical', ['b1']).incidents,
      ],
      approvalFollowThrough: 1, coachOpenGapUnitKeys: [],
    };
    const f = deriveFindings(units, { x: 1 }, both).filter((y) => y.fix.type === 'review_incident');
    expect(f).toHaveLength(2);
    // Key stability: the same pattern derived from a DIFFERENT window (different
    // action ids) produces the SAME finding key, so stored states survive.
    const later = deriveFindings(units, { x: 1 }, mk('action_type:deploy', 'high', ['z9']))
      .find((y) => y.fix.type === 'review_incident')!;
    const deployNow = f.find((y) => y.evidence.exampleActionIds.includes('a1'))!;
    expect(later.key).toBe(deployNow.key);
  });

  // Guards the cross-task contract: every create_policy_draft fix MUST be a
  // policy that validatePolicy accepts, or the Task 11 resolve route 400s when
  // it tries to insert the draft. (Previously protected_path/require_approval
  // drafts shipped empty paths/action_types and failed validation.)
  it('every dimension produces a create_policy_draft fix that passes validatePolicy', () => {
    const dimensions: Dimension[] = ['identity', 'enforcement', 'spend', 'auditability', 'approval', 'data_protection'];
    for (const dimension of dimensions) {
      const f = deriveFindings([unit({ key: `u-${dimension}`, dimension })], { [`u-${dimension}`]: 0 }, noAdj);
      const fix = f[0]!.fix;
      expect(fix.type).toBe('create_policy_draft');
      if (fix.type !== 'create_policy_draft') continue;
      const result = validatePolicy({
        name: `Posture draft: ${dimension}`,
        policy_type: fix.policyType,
        rules: JSON.stringify(fix.rules),
        active: 0,
      }) as { valid: boolean; errors: string[] };
      expect(result.valid, `${dimension} draft (${fix.policyType}) invalid: ${result.errors?.join('; ')}`).toBe(true);
    }
  });
});
