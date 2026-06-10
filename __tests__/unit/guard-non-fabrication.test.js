import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSigningKey } from '../../app/lib/integrity/keys.js';
import { verifyReceipt } from '../../app/lib/integrity/receipt.js';

// A deterministic instance signing key for the receipt assertions. We mock the
// hybrid loader so the guard-verdict tests don't depend on DB key provisioning;
// the signing path itself is covered by integrity-server-key/receipt tests.
const FIXED_KEY = generateSigningKey('test-signing-kid');

const { mockScanSensitiveData } = vi.hoisted(() => ({
  mockScanSensitiveData: vi.fn((text) => ({ findings: [], redacted: text, clean: true })),
}));

vi.mock('@/lib/security.js', () => ({ scanSensitiveData: mockScanSensitiveData }));
vi.mock('@/lib/predictive-risk.js', () => ({ getPredictiveRisk: vi.fn(async () => ({ total_adjustment: 0 })) }));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: vi.fn(async () => []) }));
vi.mock('@/lib/integrity/server-key.js', () => ({
  getServerSigningKey: vi.fn(async () => ({
    kid: FIXED_KEY.kid,
    privateKeyJwk: FIXED_KEY.privateKeyJwk,
    publicKeyJwk: FIXED_KEY.publicKeyJwk,
    source: 'db',
  })),
}));

import { evaluateGuard, __resetGuardCaches } from '@/lib/guard.js';
import { createSqlMock } from '../helpers.js';

function makeSql(policies) {
  return createSqlMock({ taggedResponses: [policies] });
}
function makePolicy(rules, overrides = {}) {
  return {
    id: 'gp_non_fab',
    name: 'No fabrication',
    policy_type: 'non_fabrication',
    rules: JSON.stringify(rules),
    agent_ids: null,
    ...overrides,
  };
}

const SOURCE = {
  requiredFacts: [{ label: 'tenant', value: 'Jane Roe' }],
  allowedFacts: [
    { label: 'tenant', value: 'Jane Roe' },
    { label: 'amount', value: '$1,500.00' },
    { label: 'due', value: 'June 1, 2026' },
  ],
  extract: { money: true, dates: true, percentages: true },
};
const CLEAN = 'Dear Jane Roe, your deposit of $1,500.00 is due June 1, 2026.';
const FABRICATED = 'Dear Jane Roe, your deposit of $9,999.00 is due June 1, 2026.';

function findInsert(sql) {
  return sql.taggedCalls.find((c) => /insert into guard_decisions/i.test(c.text));
}

describe('non_fabrication guard policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Guard hot-path caches persist at module level; tests reuse one org id.
    __resetGuardCaches();
    mockScanSensitiveData.mockImplementation((text) => ({ findings: [], redacted: text, clean: true }));
  });

  it('allows a clean grounded message and attaches a re-verifiable pass receipt', async () => {
    const sql = makeSql([makePolicy({ action_types: ['message'] })]);
    const result = await evaluateGuard('org_1', { action_type: 'message', agent_id: 'a1', content: CLEAN, source_of_truth: SOURCE }, sql);
    expect(result.decision).toBe('allow');
    expect(result.non_fabrication).toBeTruthy();
    const ev = result.non_fabrication[0];
    expect(ev.verdict).toBe('pass');
    expect(verifyReceipt(ev.receipt, FIXED_KEY.publicKeyJwk).ok).toBe(true);
  });

  it('blocks a fabricated amount and records a fabricated-fact violation + receipt in the ledger', async () => {
    const sql = makeSql([makePolicy({ action_types: ['message'] })]);
    const result = await evaluateGuard('org_1', { action_type: 'message', agent_id: 'a1', content: FABRICATED, source_of_truth: SOURCE }, sql);
    expect(result.decision).toBe('block');
    expect(result.reason).toMatch(/non.?fabrication/i);
    expect(result.matched_policies).toContain('gp_non_fab');

    const ev = result.non_fabrication[0];
    expect(ev.verdict).toBe('block');
    expect(ev.violations.some((v) => v.code === 'fabricated_fact')).toBe(true);
    expect(verifyReceipt(ev.receipt, FIXED_KEY.publicKeyJwk).ok).toBe(true);

    // evidence persisted to guard_decisions
    const insert = findInsert(sql);
    expect(insert).toBeTruthy();
    const evidenceVal = insert.values.find((v) => typeof v === 'string' && v.includes('fabricated_fact'));
    expect(evidenceVal).toBeTruthy();
  });

  it('fails closed (block) when content is present but the source-of-truth is missing', async () => {
    const sql = makeSql([makePolicy({ action_types: ['message'] })]);
    const result = await evaluateGuard('org_1', { action_type: 'message', agent_id: 'a1', content: CLEAN }, sql);
    expect(result.decision).toBe('block');
    expect(result.reason).toMatch(/source-of-truth|missing/i);
    expect(result.non_fabrication[0].violations.some((v) => v.code === 'missing_source')).toBe(true);
  });

  it('routes through approval when on_violation=require_approval', async () => {
    const sql = makeSql([makePolicy({ action_types: ['message'], on_violation: 'require_approval' })]);
    const result = await evaluateGuard('org_1', { action_type: 'message', agent_id: 'a1', content: FABRICATED, source_of_truth: SOURCE }, sql);
    expect(result.decision).toBe('require_approval');
  });

  it('does not apply when the action type is out of scope', async () => {
    const sql = makeSql([makePolicy({ action_types: ['message'] })]);
    const result = await evaluateGuard('org_1', { action_type: 'deploy', agent_id: 'a1', content: FABRICATED, source_of_truth: SOURCE }, sql);
    expect(result.decision).toBe('allow');
    expect(result.non_fabrication).toBeFalsy();
  });

  it('is a no-op when there is no content attached', async () => {
    const sql = makeSql([makePolicy({ action_types: ['message'] })]);
    const result = await evaluateGuard('org_1', { action_type: 'message', agent_id: 'a1' }, sql);
    expect(result.decision).toBe('allow');
    expect(result.non_fabrication).toBeFalsy();
  });

  it('strips raw content and source-of-truth from the stored ledger context', async () => {
    const sql = makeSql([makePolicy({ action_types: ['message'] })]);
    await evaluateGuard('org_1', { action_type: 'message', agent_id: 'a1', content: CLEAN, source_of_truth: SOURCE }, sql);
    const insert = findInsert(sql);
    const contextVal = insert.values.find((v) => typeof v === 'string' && v.includes('"action_type"'));
    expect(contextVal).toBeTruthy();
    // The full outbound content and the source facts must not be dumped into the ledger row.
    expect(contextVal).not.toContain('Jane Roe');
  });
});
