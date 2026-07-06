import { describe, expect, it } from 'vitest';
import {
  normalizeGeneratedPolicyDraft,
  normalizeGeneratedPolicyDrafts,
} from '../../app/policies/lib/policyGeneratorDrafts.js';
import { compilePolicyPayload } from '../../app/policies/lib/policyFormModel.js';

describe('policyGeneratorDrafts', () => {
  it('normalizes a risk threshold draft into shared policy form state', () => {
    const draft = normalizeGeneratedPolicyDraft({
      name: 'Block risky deploys',
      policy_type: 'risk_threshold',
      rules: {
        threshold: 75,
        action: 'require_approval',
      },
      confidence: 0.91,
    });

    expect(draft.id).toBe('generated-0');
    expect(draft.name).toBe('Block risky deploys');
    expect(draft.confidence).toBe(0.91);
    expect(draft.formState).toMatchObject({
      name: 'Block risky deploys',
      type: 'risk_threshold',
      threshold: 75,
      action: 'require_approval',
    });
    expect(draft.summary).toContain('Require approval for actions when risk is 75 or higher');
    expect(draft.hasAdvancedDetails).toBe(false);
    expect(draft.advancedDetails).toBeNull();
    expect(draft.rawPolicy.name).toBe('Block risky deploys');
  });

  it('normalizes a require approval draft and flags unsupported details', () => {
    const draft = normalizeGeneratedPolicyDraft({
      name: 'Require deploy approval',
      policy_type: 'require_approval',
      rules: {
        action_types: ['deploy'],
        action: 'require_approval',
        approval_reason: 'Production deploys need a human gate',
      },
      confidence: 0.84,
      recovery_recipe: {
        signal: 'deploy_without_review',
        suggestion: 'Route the request through a reviewer',
        auto_action: null,
      },
    });

    expect(draft.formState).toMatchObject({
      name: 'Require deploy approval',
      type: 'require_approval',
      actionTypes: ['deploy'],
    });
    expect(draft.summary).toContain('Require approval for deploy actions');
    expect(draft.hasAdvancedDetails).toBe(true);
    expect(draft.advancedDetails).toMatchObject({
      rules: {
        approval_reason: 'Production deploys need a human gate',
      },
      recovery_recipe: {
        signal: 'deploy_without_review',
      },
    });
  });

  it('normalizes multiple drafts with stable generated ids', () => {
    const drafts = normalizeGeneratedPolicyDrafts([
      {
        name: 'First',
        policy_type: 'risk_threshold',
        rules: { threshold: 50, action: 'block' },
      },
      {
        name: 'Second',
        policy_type: 'require_approval',
        rules: { action_types: ['migrate'], action: 'require_approval' },
      },
    ]);

    expect(drafts).toHaveLength(2);
    expect(drafts[0].id).toBe('generated-0');
    expect(drafts[1].id).toBe('generated-1');
    expect(drafts[1].summary).toContain('Require approval for migrate actions');
  });

  it('normalizes a protected_path draft and round-trips its paths', () => {
    const [draft] = normalizeGeneratedPolicyDrafts([
      {
        name: 'Protect secrets',
        policy_type: 'protected_path',
        rules: { paths: ['.env', 'secrets/'], action: 'block' },
      },
    ]);

    expect(draft.id).toBe('generated-0');
    expect(draft.name).toBe('Protect secrets');
    expect(draft.formState.type).toBe('protected_path');
    expect(draft.formState.protectedPaths).toEqual(['.env', 'secrets/']);
    expect(draft.formState.action).toBe('block');

    // Round-trip: the paths must NOT be dropped when the form is compiled back.
    const payload = compilePolicyPayload(draft.formState);
    expect(payload.policy_type).toBe('protected_path');
    const rules = JSON.parse(payload.rules);
    expect(rules.paths).toEqual(expect.arrayContaining(['.env', 'secrets/']));
    expect(rules.action).toBe('block');
  });

});
