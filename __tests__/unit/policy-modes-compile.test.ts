import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mirror the proven guard-engine.test.js mock setup so evaluateGuard runs
// without external services and only the policy-load tagged query touches sql.
const { mockDeliverGuardWebhook, mockCheckSemantic, mockScanSensitiveData } =
  vi.hoisted(() => ({
    mockDeliverGuardWebhook: vi.fn(),
    mockCheckSemantic: vi.fn(),
    mockScanSensitiveData: vi.fn((text: string) => ({ findings: [], redacted: text, clean: true })),
  }));

vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: mockDeliverGuardWebhook }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: mockCheckSemantic }));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: mockScanSensitiveData }));
vi.mock('@/lib/predictive-risk.js', () => ({
  getPredictiveRisk: vi.fn(async () => ({ statistical: null, llm: null, total_adjustment: 0 })),
}));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: vi.fn(async () => []) }));

import { evaluateGuard } from '@/lib/guard.js';
import { validatePolicy } from '@/lib/validate.js';
import { compileMode, AVAILABLE_MODES, UnknownPolicyModeError } from '@/lib/policy-modes';
import { createSqlMock } from '../helpers.js';

/** Convert a mode's compiled policies into guard_policies rows for the mock. */
function policyRows(modeId: string) {
  return compileMode(modeId).map((p, i) => ({
    id: `gp_${modeId}_${i}`,
    name: p.name,
    policy_type: p.policy_type,
    rules: JSON.stringify(p.rules),
    agent_ids: null,
  }));
}

/** A fresh sql mock whose single tagged response is the active-policy list. */
function guardSql(modeId: string) {
  return createSqlMock({ taggedResponses: [policyRows(modeId)] });
}

describe('compileMode', () => {
  it("claude-code compiles the expected policy-type multiset with exact rule values", () => {
    const policies = compileMode('claude-code');
    const counts = policies.reduce<Record<string, number>>((acc, p) => {
      acc[p.policy_type] = (acc[p.policy_type] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({
      risk_threshold: 2,
      warn_action_type: 1,
      require_approval: 2,
      protected_path: 1,
      rate_limit: 2,
    });
    // eslint-disable-next-line no-console
    console.log('compileMode("claude-code") types:', policies.map((p) => p.policy_type).join(', '));

    const thresholds = policies
      .filter((p) => p.policy_type === 'risk_threshold')
      .map((p) => p.rules.threshold)
      .sort((a, b) => Number(a) - Number(b));
    expect(thresholds).toEqual([85, 100]);

    const rateWindows = policies
      .filter((p) => p.policy_type === 'rate_limit')
      .map((p) => `${p.rules.max_actions}/${p.rules.window_minutes}:${p.rules.action}`)
      .sort();
    expect(rateWindows).toEqual(['250/30:warn', '650/60:require_approval']);

    // api/sync/message/post/email/calendar are now WARNED (not gated)
    const warnTypes = policies
      .filter((p) => p.policy_type === 'warn_action_type')
      .flatMap((p) => (p.rules.action_types as string[]) ?? []);
    for (const t of ['message', 'post', 'email', 'calendar', 'sync', 'api']) {
      expect(warnTypes).toContain(t);
    }

    const approvalTypes = policies
      .filter((p) => p.policy_type === 'require_approval')
      .flatMap((p) => (p.rules.action_types as string[]) ?? []);
    for (const t of ['deploy', 'migrate', 'workflow_execute', 'delete']) {
      expect(approvalTypes).toContain(t);
    }
    // comms/sync/api are now warned, not gated
    for (const t of ['message', 'email', 'post', 'calendar', 'sync', 'api']) {
      expect(approvalTypes).not.toContain(t);
    }
    // routine coding types must NOT be gated
    for (const t of ['build', 'test', 'cleanup', 'lint']) {
      expect(approvalTypes).not.toContain(t);
    }
  });

  it('every compiled policy for every mode passes validatePolicy', () => {
    let compiled = 0;
    let valid = 0;
    for (const id of AVAILABLE_MODES) {
      for (const p of compileMode(id)) {
        compiled++;
        const res = validatePolicy({
          name: p.name,
          policy_type: p.policy_type,
          rules: JSON.stringify(p.rules),
          active: p.active,
        });
        if (!res.valid) {
          // eslint-disable-next-line no-console
          console.error(`INVALID ${id} :: ${p.name}:`, res.errors);
        } else {
          valid++;
        }
        expect(res.valid).toBe(true);
      }
    }
    expect(valid).toBe(compiled);
    // eslint-disable-next-line no-console
    console.log(`validatePolicy: ${valid}/${compiled} compiled policies valid`);
  });

  it('every compiled policy carries its _mode tag', () => {
    for (const id of AVAILABLE_MODES) {
      for (const p of compileMode(id)) {
        expect((p.rules as Record<string, unknown>)._mode).toBe(id);
        expect(p.active).toBe(1);
        expect(p.name.startsWith('[')).toBe(true);
      }
    }
  });

  it('rejects unknown mode ids', () => {
    expect(() => compileMode('__nope__')).toThrow(UnknownPolicyModeError);
    expect(() => compileMode('__nope__')).toThrow(/unknown policy mode/i);
  });

  it('every non-claude-code mode compiles to >= 1 valid policy', () => {
    for (const id of AVAILABLE_MODES.filter((x) => x !== 'claude-code')) {
      expect(compileMode(id).length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('Claude Code Mode behavioral proof (real evaluateGuard)', () => {
  const originalGuardLlmKey = process.env.GUARD_LLM_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    mockScanSensitiveData.mockImplementation((text: string) => ({ findings: [], redacted: text, clean: true }));
  });

  afterEach(() => {
    if (originalGuardLlmKey === undefined) delete process.env.GUARD_LLM_KEY;
    else process.env.GUARD_LLM_KEY = originalGuardLlmKey;
  });

  it("allows routine coding actions — won't interrupt normal coding", async () => {
    for (const action_type of ['build', 'test', 'fix']) {
      const res = await evaluateGuard('org_1', { action_type, reversible: true }, guardSql('claude-code'));
      expect(res.decision).toBe('allow');
    }
  });

  it('requires approval for deploy and migrate', async () => {
    const deploy = await evaluateGuard('org_1', { action_type: 'deploy' }, guardSql('claude-code'));
    expect(deploy.decision).toBe('require_approval');
    const migrate = await evaluateGuard('org_1', { action_type: 'migrate' }, guardSql('claude-code'));
    expect(migrate.decision).toBe('require_approval');
  });

  it('warns (does not gate) api, sync, message, post, email, calendar', async () => {
    for (const action_type of ['api', 'sync', 'message', 'post', 'email', 'calendar']) {
      const res = await evaluateGuard('org_1', { action_type }, guardSql('claude-code'));
      expect(res.decision).toBe('warn');
    }
  });

  it('requires approval when a protected path is touched', async () => {
    const res = await evaluateGuard(
      'org_1',
      { action_type: 'fix', target: 'app/api/auth/route.ts' },
      guardSql('claude-code'),
    );
    expect(res.decision).toBe('require_approval');
  });

  it('blocks extreme-risk actions (risk score >= 100)', async () => {
    const res = await evaluateGuard('org_1', { action_type: 'other', risk_score: 100 }, guardSql('claude-code'));
    expect(res.decision).toBe('block');
  });
});
