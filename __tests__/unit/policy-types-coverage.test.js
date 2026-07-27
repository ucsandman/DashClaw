import { describe, expect, it } from 'vitest';
import {
  compilePolicyPayload,
  decompilePolicyForm,
  buildPolicySummary,
  POLICY_TYPE_OPTIONS,
} from '../../app/policies/lib/policyFormModel.js';
import { validatePolicy, POLICY_TYPES } from '../../app/lib/validate.js';

// Representative authoring-form state for every backend-enforced policy type.
// Each must compile to a payload that passes the real backend validator.
const FORMS = {
  risk_threshold: { name: 'Risk', type: 'risk_threshold', threshold: 80, action: 'block', agentIds: [] },
  require_approval: { name: 'Approve', type: 'require_approval', actionTypes: ['deploy'], agentIds: [] },
  block_action_type: { name: 'Block', type: 'block_action_type', actionTypes: ['cleanup'], agentIds: [] },
  warn_action_type: { name: 'Warn', type: 'warn_action_type', actionTypes: ['api'], agentIds: [] },
  allow_grant: { name: 'Allow', type: 'allow_grant', actionType: 'api', targetPrefix: 'stripe.com', agentIds: [] },
  rate_limit: { name: 'Rate', type: 'rate_limit', maxActions: 50, windowMinutes: 60, action: 'warn', agentIds: [] },
  webhook_check: { name: 'Webhook', type: 'webhook_check', webhookUrl: 'https://guard.example.com/check', webhookTimeout: 5000, webhookOnTimeout: 'allow', agentIds: [] },
  permission_escalation: { name: 'Perm', type: 'permission_escalation', enforce: true, action: 'block', agentIds: [] },
  green_contract: { name: 'Green', type: 'green_contract', actionTypes: ['deploy'], requiredLevel: 'workspace', action: 'block', agentIds: [] },
  branch_freshness: { name: 'Branch', type: 'branch_freshness', actionTypes: ['deploy'], freshness: ['stale', 'diverged'], maxCommitsBehind: 0, action: 'block', agentIds: [] },
  non_fabrication: { name: 'NF', type: 'non_fabrication', actionTypes: ['message'], onViolation: 'block', agentIds: [] },
  protected_path: { name: 'PP', type: 'protected_path', protectedPaths: ['**/auth/**', '**/secrets/**'], action: 'require_approval', agentIds: [] },
  agent_allowlist: { name: 'Envelope', type: 'agent_allowlist', allowedActionTypes: ['read', 'search'], action: 'warn', agentIds: [] },
  require_evidence: { name: 'Evidence', type: 'require_evidence', actionTypes: ['deploy'], enforcement: 'require_approval', agentIds: [] },
  delegation_constraint: { name: 'Subagent', type: 'delegation_constraint', parent: '*', childTypes: ['*'], maxRiskScore: 60, escalateAction: 'require_approval', agentIds: [] },
};

describe('policy type coverage (UI ↔ backend contract)', () => {
  it('offers every backend POLICY_TYPE in the authoring picker', () => {
    const offered = POLICY_TYPE_OPTIONS.map((o) => o.value).sort();
    expect(offered).toEqual([...POLICY_TYPES].sort());
  });

  it('gives every picker option a label and a description', () => {
    for (const opt of POLICY_TYPE_OPTIONS) {
      expect(opt.label, `${opt.value} label`).toBeTruthy();
      expect(opt.desc, `${opt.value} desc`).toBeTruthy();
    }
  });

  it('compiles a valid payload for every policy type that the backend accepts', () => {
    for (const type of POLICY_TYPES) {
      expect(FORMS[type], `missing test form for ${type}`).toBeTruthy();
      const payload = compilePolicyPayload(FORMS[type]);
      expect(payload.policy_type).toBe(type);
      const result = validatePolicy(payload);
      expect(result.valid, `${type} validation errors: ${JSON.stringify(result.errors)}`).toBe(true);
    }
  });

  it('produces the exact rule shapes the guard engine reads for the added types', () => {
    expect(JSON.parse(compilePolicyPayload(FORMS.permission_escalation).rules)).toEqual({
      enforce: true, action: 'block',
    });
    expect(JSON.parse(compilePolicyPayload(FORMS.green_contract).rules)).toEqual({
      action_types: ['deploy'], required_level: 'workspace', action: 'block',
    });
    expect(JSON.parse(compilePolicyPayload(FORMS.branch_freshness).rules)).toEqual({
      action_types: ['deploy'], freshness: ['stale', 'diverged'], max_commits_behind: 0, action: 'block',
    });
    expect(JSON.parse(compilePolicyPayload({ ...FORMS.allow_grant, actionType: 'api', targetPrefix: 'api.stripe.com' }).rules)).toEqual({
      action_type: 'api', target_prefix: 'api.stripe.com',
    });
    expect(JSON.parse(compilePolicyPayload(FORMS.warn_action_type).rules)).toEqual({
      action_types: ['api'],
    });
  });

  it('round-trips the added types through decompile', () => {
    for (const type of ['permission_escalation', 'green_contract', 'branch_freshness', 'allow_grant', 'warn_action_type']) {
      const payload = compilePolicyPayload(FORMS[type]);
      const form = decompilePolicyForm({ ...payload, rules: payload.rules });
      expect(form.type).toBe(type);
      // recompiling the decompiled form yields the same rules
      expect(JSON.parse(compilePolicyPayload(form).rules)).toEqual(JSON.parse(payload.rules));
    }
  });

  it('summarizes the added types in plain language', () => {
    expect(buildPolicySummary(FORMS.permission_escalation)).toMatch(/permission/i);
    expect(buildPolicySummary({ ...FORMS.permission_escalation, enforce: false })).toMatch(/disabled/i);
    expect(buildPolicySummary(FORMS.green_contract)).toMatch(/workspace/i);
    expect(buildPolicySummary(FORMS.branch_freshness)).toMatch(/commits behind/i);
  });
});
