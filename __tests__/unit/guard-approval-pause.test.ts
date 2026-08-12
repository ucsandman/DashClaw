/**
 * The approval-pause post-pass, at the guard level.
 *
 * A pause exists so an operator drowning in approval prompts has something to
 * reach for other than switching governance off wholesale — the act
 * MAINTAINER.md records happening for 18 days in June 2026. That only holds if
 * the pause is narrower than the thing it replaces, so these tests pin the
 * three boundaries it must never cross:
 *
 *   - block stays block (MAINTAINER.md §1, blocks are absolute)
 *   - an `ungrantable` gate still interrupts (F1, control-plane rules)
 *   - warn is untouched: the pause answers "stop ASKING me", not "stop telling
 *     me", and a warn never interrupted anyone in the first place
 *
 * Plus the honesty requirement: a paused allow must never read as approved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same mock setup as guard-allow-grant.test.ts — evaluateGuard runs with no
// external services and only the policy-load tagged query touches sql.
const { mockDeliverGuardWebhook, mockCheckSemantic, mockScanSensitiveData, mockGetSettings } =
  vi.hoisted(() => ({
    mockDeliverGuardWebhook: vi.fn(),
    mockCheckSemantic: vi.fn(),
    mockScanSensitiveData: vi.fn((text: string) => ({ findings: [], redacted: text, clean: true })),
    mockGetSettings: vi.fn(async () => [] as Array<Record<string, unknown>>),
  }));

vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: mockDeliverGuardWebhook }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: mockCheckSemantic }));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: mockScanSensitiveData }));
vi.mock('@/lib/predictive-risk.js', () => ({
  getPredictiveRisk: vi.fn(async () => ({ statistical: null, llm: null, total_adjustment: 0 })),
}));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: mockGetSettings }));
vi.mock('@/lib/repositories/settings.repository', () => ({ getSettings: mockGetSettings }));

import { evaluateGuard, __resetGuardCaches, APPROVAL_PAUSE_KEY } from '@/lib/guard.js';
import { createSqlMock } from '../helpers.js';

let orgN = 0;
const freshOrg = () => `org_pause_${++orgN}`;

function rows(policies: Array<{ policy_type: string; rules: Record<string, unknown>; name?: string }>) {
  return policies.map((p, i) => ({
    id: `gp_p_${i}`,
    name: p.name ?? `P${i}`,
    policy_type: p.policy_type,
    rules: JSON.stringify(p.rules),
    agent_ids: null,
    created_at: new Date().toISOString(),
  }));
}

function pausedFor(ms: number) {
  return [{
    key: APPROVAL_PAUSE_KEY,
    value: JSON.stringify({
      until: new Date(Date.now() + ms).toISOString(),
      actor: 'usr_admin',
      reason: null,
      at: new Date().toISOString(),
    }),
  }];
}

const CTX = {
  agent_id: 'agent_1',
  action_type: 'api',
  declared_goal: 'call stripe',
  target: 'https://api.stripe.com/v1/charges',
};

describe('approval pause post-pass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGuardCaches();
    mockGetSettings.mockResolvedValue([]);
  });

  it('lets a require_approval proceed while the pause is live', async () => {
    mockGetSettings.mockResolvedValue(pausedFor(3_600_000));
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'require_approval', rules: { action_types: ['api'] } },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('allow');
  });

  it('says out loud that nobody approved it', async () => {
    // The honesty contract: a paused allow must never be mistakable for a
    // human decision, on the row or on any surface reading the row.
    mockGetSettings.mockResolvedValue(pausedFor(3_600_000));
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'require_approval', rules: { action_types: ['api'] } },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    const warnings = (res.warnings ?? []).join(' | ');
    expect(warnings).toContain('Approval pause active');
    expect(warnings).toContain('No human approved this action');
  });

  it('preserves WHY it would have interrupted, as forensic context', async () => {
    mockGetSettings.mockResolvedValue(pausedFor(3_600_000));
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'require_approval', rules: { action_types: ['api'] }, name: 'Approve API calls' },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect((res.warnings ?? []).some((w: string) => w.startsWith('paused past:'))).toBe(true);
  });

  it('NEVER downgrades a block', async () => {
    mockGetSettings.mockResolvedValue(pausedFor(3_600_000));
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'block_action_type', rules: { action_types: ['api'] } },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('block');
  });

  it('NEVER clears a gate the operator marked ungrantable', async () => {
    mockGetSettings.mockResolvedValue(pausedFor(3_600_000));
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'require_approval', rules: { action_types: ['api'], ungrantable: true }, name: 'Protect the control plane' },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('require_approval');
    expect((res.warnings ?? []).join(' | ')).toContain('the approval pause cannot clear this verdict');
  });

  it('leaves warn alone — a warn never interrupted anyone', async () => {
    mockGetSettings.mockResolvedValue(pausedFor(3_600_000));
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'warn_action_type', rules: { action_types: ['api'] } },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('warn');
  });

  it('does nothing once the window has passed', async () => {
    mockGetSettings.mockResolvedValue([{
      key: APPROVAL_PAUSE_KEY,
      value: JSON.stringify({ until: new Date(Date.now() - 1_000).toISOString(), actor: 'usr_admin' }),
    }]);
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'require_approval', rules: { action_types: ['api'] } },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('require_approval');
  });

  it('does nothing when no pause was ever set', async () => {
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'require_approval', rules: { action_types: ['api'] } },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('require_approval');
  });
});
