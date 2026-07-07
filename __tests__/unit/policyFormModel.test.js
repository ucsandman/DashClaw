import { describe, expect, it } from 'vitest';
import {
  buildPolicySummary,
  compilePolicyPayload,
  createDefaultPolicyFormState,
  decompilePolicyForm,
} from '../../app/policies/lib/policyFormModel.js';
import { inferPolicyType } from '../../app/lib/policyPackPreviews.js';

describe('policyFormModel', () => {
  it('creates valid default manual authoring state', () => {
    const state = createDefaultPolicyFormState();

    expect(state.name).toBe('');
    expect(state.type).toBe('risk_threshold');
    expect(state.threshold).toBe(80);
    expect(state.action).toBe('block');
    expect(state.agentIds).toEqual([]);
  });

  it('compiles risk threshold form state into the current route payload', () => {
    const payload = compilePolicyPayload({
      name: 'Block high risk deploys',
      type: 'risk_threshold',
      threshold: 90,
      action: 'block',
      agentIds: ['agt_1', 'agt_2'],
    });

    expect(payload).toEqual({
      name: 'Block high risk deploys',
      policy_type: 'risk_threshold',
      rules: JSON.stringify({
        threshold: 90,
        action: 'block',
      }),
      agent_ids: JSON.stringify(['agt_1', 'agt_2']),
    });
  });

  it('compiles non_fabrication state into the route payload', () => {
    const payload = compilePolicyPayload({
      name: 'No fabricated facts',
      type: 'non_fabrication',
      actionTypes: ['message'],
      onViolation: 'require_approval',
      contentPath: 'content',
      sourcePath: 'source_of_truth',
      agentIds: [],
    });

    expect(payload).toEqual({
      name: 'No fabricated facts',
      policy_type: 'non_fabrication',
      rules: JSON.stringify({
        action_types: ['message'],
        content_path: 'content',
        source_path: 'source_of_truth',
        on_violation: 'require_approval',
      }),
      agent_ids: null,
    });
  });

  it('omits action_types from non_fabrication rules when none are selected (applies to all)', () => {
    const payload = compilePolicyPayload({ name: 'NF all', type: 'non_fabrication', actionTypes: [], agentIds: [] });
    expect(JSON.parse(payload.rules)).toEqual({
      content_path: 'content',
      source_path: 'source_of_truth',
      on_violation: 'block',
    });
  });

  it('round-trips a non_fabrication policy through decompile', () => {
    const form = decompilePolicyForm({
      name: 'NF',
      policy_type: 'non_fabrication',
      rules: JSON.stringify({ action_types: ['message'], content_path: 'body', source_path: 'facts', on_violation: 'block' }),
      agent_ids: null,
    });
    expect(form.type).toBe('non_fabrication');
    expect(form.actionTypes).toEqual(['message']);
    expect(form.contentPath).toBe('body');
    expect(form.sourcePath).toBe('facts');
    expect(form.onViolation).toBe('block');
  });

  it('summarizes a non_fabrication policy', () => {
    expect(
      buildPolicySummary({ type: 'non_fabrication', actionTypes: ['message'], onViolation: 'block', agentIds: [] })
    ).toMatch(/source-of-truth/i);
    // applies-to-all reads cleanly (no doubled "selected actions actions")
    const all = buildPolicySummary({ type: 'non_fabrication', actionTypes: [], onViolation: 'require_approval', agentIds: [] });
    expect(all).toContain('any action');
    expect(all).not.toContain('selected actions actions');
  });

  it('decompiles persisted policy into type-specific form state', () => {
    const form = decompilePolicyForm({
      id: 'gp_1',
      name: 'Require deploy approval',
      policy_type: 'require_approval',
      rules: JSON.stringify({
        action_types: ['deploy', 'security'],
        action: 'require_approval',
      }),
      agent_ids: JSON.stringify(['agt_9']),
    });

    expect(form.name).toBe('Require deploy approval');
    expect(form.type).toBe('require_approval');
    expect(form.actionTypes).toEqual(['deploy', 'security']);
    expect(form.agentIds).toEqual(['agt_9']);
  });

  it('builds readable summaries for each supported policy type', () => {
    expect(
      buildPolicySummary({
        type: 'risk_threshold',
        threshold: 80,
        action: 'block',
        agentIds: [],
      })
    ).toContain('Block actions when risk is 80 or higher');

    expect(
      buildPolicySummary({
        type: 'require_approval',
        actionTypes: ['deploy', 'security'],
        agentIds: [],
      })
    ).toContain('Require approval for deploy and security actions');

    expect(
      buildPolicySummary({
        type: 'block_action_type',
        actionTypes: ['cleanup'],
        agentIds: [],
      })
    ).toContain('Block cleanup actions entirely');

    expect(
      buildPolicySummary({
        type: 'rate_limit',
        maxActions: 50,
        windowMinutes: 60,
        action: 'warn',
        agentIds: [],
      })
    ).toContain('Warn when an agent exceeds 50 actions in 60 minutes');

    expect(
      buildPolicySummary({
        type: 'webhook_check',
        webhookUrl: 'https://guard.example.com/check',
        webhookTimeout: 5000,
        webhookOnTimeout: 'allow',
        agentIds: [],
      })
    ).toContain('guard.example.com');
  });
});

describe('custom action types — form output matches Import on the guard-matched fields', () => {
  it('compiles a typed custom action type into the same policy_type + rules.action_types as importing the YAML', () => {
    // Form: name "Marketplace Publish Requires Approval", type require_approval,
    // action type `marketplace_publish` (typed in the free-text input, not a preset).
    const formPayload = compilePolicyPayload({
      name: 'Marketplace Publish Requires Approval',
      type: 'require_approval',
      actionTypes: ['marketplace_publish'],
      agentIds: [],
    });

    // The equivalent imported policy, as app/api/policies/import/route.js compiles
    // it from the YAML:
    //   applies_to: { tools: [marketplace_publish] }
    //   rule: { require: approval }
    const importedPolicy = {
      id: 'ps_marketplace_publish_requires_approval',
      applies_to: { tools: ['marketplace_publish'] },
      rule: { require: 'approval' },
    };
    const importedPolicyType = inferPolicyType(importedPolicy);
    const importedRules = {
      action_types: importedPolicy.applies_to?.tools || [],
      ...(importedPolicy.rule || {}),
      tests: importedPolicy.tests || [],
    };

    // policy_type is identical — both resolve to require_approval.
    expect(formPayload.policy_type).toBe('require_approval');
    expect(importedPolicyType).toBe('require_approval');
    expect(formPayload.policy_type).toBe(importedPolicyType);

    // rules.action_types is the ONLY field the require_approval guard matches on
    // (app/lib/guard.js: `actionTypes.includes(context.action_type)`), so this is
    // the byte-for-byte-relevant field — identical for form and import.
    const formRules = JSON.parse(formPayload.rules);
    expect(formRules.action_types).toEqual(['marketplace_publish']);
    expect(formRules.action_types).toEqual(importedRules.action_types);
  });

  it('summarizes a typed custom action type the same way as a preset', () => {
    expect(
      buildPolicySummary({ type: 'require_approval', actionTypes: ['marketplace_publish'], agentIds: [] })
    ).toContain('Require approval for marketplace_publish actions');
  });
});

// Characterization for every remaining policy type — locks exact compile
// payloads (the persisted behavior) before the structural refactor.
describe('policyFormModel — full-type characterization', () => {
  const rulesOf = (form) => JSON.parse(compilePolicyPayload(form).rules);

  it('compiles rate_limit', () => {
    expect(rulesOf({ type: 'rate_limit', maxActions: 50, windowMinutes: 60, action: 'warn', agentIds: [] }))
      .toEqual({ max_actions: 50, window_minutes: 60, action: 'warn' });
  });

  it('compiles block_action_type', () => {
    expect(rulesOf({ type: 'block_action_type', actionTypes: ['deploy'], agentIds: [] }))
      .toEqual({ action_types: ['deploy'], action: 'block' });
  });

  it('compiles webhook_check (trims url, defaults timeout/on_timeout)', () => {
    expect(rulesOf({ type: 'webhook_check', webhookUrl: '  https://x.com/c  ', webhookTimeout: 3000, webhookOnTimeout: 'block', agentIds: [] }))
      .toEqual({ url: 'https://x.com/c', timeout_ms: 3000, on_timeout: 'block' });
    expect(rulesOf({ type: 'webhook_check', webhookUrl: 'https://y.com', agentIds: [] }))
      .toEqual({ url: 'https://y.com', timeout_ms: 5000, on_timeout: 'require_approval' });
  });

  it('compiles permission_escalation', () => {
    expect(rulesOf({ type: 'permission_escalation', enforce: true, action: 'block', agentIds: [] }))
      .toEqual({ enforce: true, action: 'block' });
  });

  it('compiles green_contract', () => {
    expect(rulesOf({ type: 'green_contract', actionTypes: ['deploy'], requiredLevel: 'org', action: 'block', agentIds: [] }))
      .toEqual({ action_types: ['deploy'], required_level: 'org', action: 'block' });
  });

  it('compiles branch_freshness (defaults freshness, clamps commits behind)', () => {
    expect(rulesOf({ type: 'branch_freshness', actionTypes: ['deploy'], freshness: ['stale'], maxCommitsBehind: 3, action: 'warn', agentIds: [] }))
      .toEqual({ action_types: ['deploy'], freshness: ['stale'], max_commits_behind: 3, action: 'warn' });
    expect(rulesOf({ type: 'branch_freshness', actionTypes: [], freshness: [], maxCommitsBehind: -2, action: 'block', agentIds: [] }))
      .toEqual({ action_types: [], freshness: ['stale', 'diverged'], max_commits_behind: 0, action: 'block' });
  });

  it('compiles protected_path (filters blanks, coerces action)', () => {
    expect(rulesOf({ type: 'protected_path', protectedPaths: ['auth/', '', 'secrets/'], action: 'warn', agentIds: [] }))
      .toEqual({ paths: ['auth/', 'secrets/'], action: 'warn' });
    expect(rulesOf({ type: 'protected_path', protectedPaths: ['x'], action: 'something', agentIds: [] }))
      .toEqual({ paths: ['x'], action: 'require_approval' });
  });

  it('carries inline test recipes through as the last rules key', () => {
    const payload = compilePolicyPayload({ type: 'risk_threshold', threshold: 50, action: 'warn', tests: [{ name: 't' }], agentIds: [] });
    const parsed = JSON.parse(payload.rules);
    expect(parsed.tests).toEqual([{ name: 't' }]);
    expect(Object.keys(parsed)).toEqual(['threshold', 'action', 'tests']);
  });

  it('summarizes every type with the correct action verb and scope', () => {
    expect(buildPolicySummary({ type: 'permission_escalation', enforce: true, action: 'warn', agentIds: ['a'] }))
      .toBe('Warn on actions whose required tool permission exceeds the agent’s approved pairing level for 1 selected agent.');
    expect(buildPolicySummary({ type: 'permission_escalation', enforce: false, agentIds: [] }))
      .toContain('configured but disabled');
    expect(buildPolicySummary({ type: 'green_contract', actionTypes: ['deploy'], requiredLevel: 'org', action: 'block', agentIds: [] }))
      .toBe('Block deploy actions unless test status has reached “org”.');
    expect(buildPolicySummary({ type: 'branch_freshness', actionTypes: ['deploy'], freshness: ['stale', 'diverged'], maxCommitsBehind: 2, action: 'require_approval', agentIds: [] }))
      .toBe('Require approval for deploy actions when the branch is stale or diverged and more than 2 commits behind.');
    expect(buildPolicySummary({ type: 'protected_path', protectedPaths: ['auth/', 'x'], action: 'block', agentIds: [] }))
      .toBe('Block actions that touch 2 protected path patterns.');
    expect(buildPolicySummary({ type: 'unknown_type', agentIds: [] })).toBe('Configure a policy rule.');
  });
});
