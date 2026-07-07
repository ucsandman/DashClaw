/**
 * Org kill switch — guard engine behavior (Organ 3, Phase 4).
 *
 * Halt is checked FIRST: a halted org evaluates no policies and every call
 * returns an immediate, audited block. The halt state rides the same cached
 * settings entry the predictive layer uses (one settings read per org per
 * TTL window); invalidateGuardSettingsCache is what makes the switch
 * immediate instead of TTL-lagged — proven below.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDeliverGuardWebhook, mockCheckSemantic, mockScanSensitiveData, mockGetSettings } = vi.hoisted(() => ({
  mockDeliverGuardWebhook: vi.fn(),
  mockCheckSemantic: vi.fn(),
  mockScanSensitiveData: vi.fn((text) => ({ findings: [], redacted: text, clean: true })),
  mockGetSettings: vi.fn(async () => []),
}));

vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: mockDeliverGuardWebhook }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: mockCheckSemantic }));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: mockScanSensitiveData }));
vi.mock('@/lib/predictive-risk.js', () => ({ getPredictiveRisk: vi.fn(async () => ({ statistical: null, llm: null, total_adjustment: 0 })) }));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: mockGetSettings }));

import { evaluateGuard, invalidateGuardSettingsCache, __resetGuardCaches } from '@/lib/guard.js';
import { createSqlMock } from '../helpers.js';

const HALT_ROW = {
  key: 'DASHCLAW_ORG_HALT',
  value: JSON.stringify({ halted: true, actor: 'alice', reason: 'incident response', at: '2026-06-12T12:00:00.000Z' }),
};

function makeSql(policies = []) {
  return createSqlMock({ taggedResponses: [policies] });
}

function makePolicy(type, rules) {
  return { id: `gp_${type}`, name: `Policy ${type}`, policy_type: type, rules: JSON.stringify(rules) };
}

describe('org kill switch (guard engine)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGuardCaches();
    mockGetSettings.mockResolvedValue([]);
    mockScanSensitiveData.mockImplementation((text) => ({ findings: [], redacted: text, clean: true }));
  });

  it('halted org: every evaluation blocks with the halt actor + reason', async () => {
    mockGetSettings.mockResolvedValue([HALT_ROW]);
    const sql = makeSql();
    const result = await evaluateGuard('org_h1', { action_type: 'read', agent_id: 'agt_1' }, sql);
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Org halted by alice: incident response');
  });

  it('halted org: the block decision is persisted through the audit gate', async () => {
    mockGetSettings.mockResolvedValue([HALT_ROW]);
    const sql = makeSql();
    await evaluateGuard('org_h2', { action_type: 'deploy' }, sql);
    expect(sql.taggedCalls.some((c) => c.text.includes('INSERT INTO guard_decisions'))).toBe(true);
  });

  it('halted org: policies are not even loaded (halt outranks everything)', async () => {
    mockGetSettings.mockResolvedValue([HALT_ROW]);
    const sql = makeSql([makePolicy('risk_threshold', { threshold: 99 })]);
    const result = await evaluateGuard('org_h3', { action_type: 'read', risk_score: 1 }, sql);
    expect(result.decision).toBe('block');
    // The only tagged calls are the audit INSERT — no guard_policies SELECT.
    expect(sql.taggedCalls.some((c) => c.text.includes('FROM guard_policies'))).toBe(false);
  });

  it('halt off: normal evaluation resumes', async () => {
    mockGetSettings.mockResolvedValue([
      { key: 'DASHCLAW_ORG_HALT', value: JSON.stringify({ halted: false }) },
    ]);
    const sql = makeSql([]);
    const result = await evaluateGuard('org_h4', { action_type: 'read' }, sql);
    expect(result.decision).toBe('allow');
  });

  it('eager invalidation makes the switch immediate (no 30s TTL lag)', async () => {
    const org = 'org_h5';
    // 1. Evaluate while not halted — caches the not-halted settings entry.
    expect((await evaluateGuard(org, { action_type: 'read' }, makeSql([]))).decision).toBe('allow');

    // 2. The org gets halted in the DB...
    mockGetSettings.mockResolvedValue([HALT_ROW]);

    // 3. ...but WITHOUT invalidation the cached entry still answers: TTL lag.
    expect((await evaluateGuard(org, { action_type: 'read' }, makeSql([]))).decision).toBe('allow');

    // 4. The halt endpoint's eager invalidation closes the gap immediately.
    invalidateGuardSettingsCache(org);
    expect((await evaluateGuard(org, { action_type: 'read' }, makeSql([]))).decision).toBe('block');
  });

  it('adds no standalone settings query: halt and predictive risk share one read', async () => {
    const sql = makeSql([]);
    await evaluateGuard('org_h6', { action_type: 'read', agent_id: 'agt_1' }, sql);
    // One getSettings call total for the whole evaluation (halt check at the
    // top + predictive layer both hit the same cached entry).
    expect(mockGetSettings).toHaveBeenCalledTimes(1);
  });
});
