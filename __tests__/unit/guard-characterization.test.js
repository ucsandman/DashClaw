import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRequest, createSqlMock } from '../helpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// Guard CHARACTERIZATION tests (phase 2 of the activation-funnel/perf run).
//
// These pin the guard decision CONTRACT — decision outputs
// (allow/warn/block/require_approval), reason/warning shapes, matched-policy
// ids, fail-closed defaults — across a representative policy matrix. They are
// written against the UNTOUCHED engine and must pass unchanged after the
// hot-path refactor (policy cache, predictive-risk gating, batched learning
// context).
//
// Deliberately NOT pinned: the predictive_risk enrichment key (the refactor
// gates it behind PREDICTIVE_RISK_ENABLED by design) and internal query
// counts (covered by separate post-refactor tests).
//
// Each test uses a UNIQUE orgId so module-level caches added later can never
// leak state between cases — that is what keeps these refactor-proof.
// ─────────────────────────────────────────────────────────────────────────────

const { mockDeliverGuardWebhook, mockCheckSemantic, mockIsEmbeddingsEnabled, mockGenerateEmbedding } = vi.hoisted(() => ({
  mockDeliverGuardWebhook: vi.fn(),
  mockCheckSemantic: vi.fn(),
  mockIsEmbeddingsEnabled: vi.fn(() => false),
  mockGenerateEmbedding: vi.fn(),
}));

vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: mockDeliverGuardWebhook }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: mockCheckSemantic }));
// Halt/predictive settings ride a repository read at the top of evaluateGuard
// (Organ 3 Phase 4); without this mock the REAL getSettings would consume the
// first taggedResponse meant for the policy loader (mock calls are ordered).
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: vi.fn(async () => []) }));
vi.mock('@/lib/embeddings.js', () => ({ isEmbeddingsEnabled: mockIsEmbeddingsEnabled, generateActionEmbedding: mockGenerateEmbedding }));

import { evaluateGuard } from '@/lib/guard.js';

let orgCounter = 0;
const freshOrg = () => `org_char_${++orgCounter}`;

function makePolicy(type, rules, overrides = {}) {
  return {
    id: `gp_${type}`,
    name: `Policy ${type}`,
    policy_type: type,
    rules: JSON.stringify(rules),
    ...overrides,
  };
}

const makeSql = (policies, extra = {}) => createSqlMock({ taggedResponses: [policies], ...extra });

describe('guard characterization — decision matrix', () => {
  const savedGuardKey = process.env.GUARD_LLM_KEY;
  const savedOpenAiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (savedGuardKey === undefined) delete process.env.GUARD_LLM_KEY; else process.env.GUARD_LLM_KEY = savedGuardKey;
    if (savedOpenAiKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedOpenAiKey;
  });

  it('no policies → allow with empty reasons and matched_policies', async () => {
    const result = await evaluateGuard(freshOrg(), { action_type: 'deploy', agent_id: 'a1' }, makeSql([]));
    expect(result.decision).toBe('allow');
    expect(result.reasons).toEqual([]);
    expect(result.reason).toBeNull();
    expect(result.matched_policies).toEqual([]);
  });

  it('matching block_action_type policy → block with policy reason + matched id', async () => {
    const sql = makeSql([makePolicy('block_action_type', { action_types: ['deploy'] })]);
    const result = await evaluateGuard(freshOrg(), { action_type: 'deploy', agent_id: 'a1' }, sql);
    expect(result.decision).toBe('block');
    expect(result.reasons[0]).toBe('Policy block_action_type: Action type "deploy" is blocked by policy');
    expect(result.matched_policies).toEqual(['gp_block_action_type']);
  });

  it('warn policy (risk_threshold action=warn) → warn, warning carried in warnings + signals', async () => {
    // risk 90 vs threshold 50: far enough apart that the (refactor-gated)
    // predictive statistical adjustment (±20 max) can never flip the decision.
    const sql = makeSql([makePolicy('risk_threshold', { threshold: 50, action: 'warn' })]);
    const result = await evaluateGuard(freshOrg(), { action_type: 'other', risk_score: 90, agent_id: 'a1' }, sql);
    expect(result.decision).toBe('warn');
    expect(result.warnings[0]).toMatch(/^Policy risk_threshold: Risk score \d+ >= threshold 50$/);
    expect(result.signals[0]).toBe(result.warnings[0]);
    expect(result.reasons).toEqual([]);
  });

  it('approval policy (require_approval action_types) → require_approval', async () => {
    const sql = makeSql([makePolicy('require_approval', { action_types: ['migrate'] })]);
    const result = await evaluateGuard(freshOrg(), { action_type: 'migrate', agent_id: 'a1' }, sql);
    expect(result.decision).toBe('require_approval');
    expect(result.reasons[0]).toBe('Policy require_approval: Action type "migrate" requires approval');
  });

  it('severity precedence: block outranks warn; both policies matched', async () => {
    const sql = makeSql([
      makePolicy('risk_threshold', { threshold: 10, action: 'warn' }, { id: 'gp_warn', name: 'Warn policy' }),
      makePolicy('block_action_type', { action_types: ['deploy'] }, { id: 'gp_block', name: 'Block policy' }),
    ]);
    const result = await evaluateGuard(freshOrg(), { action_type: 'deploy', agent_id: 'a1' }, sql);
    expect(result.decision).toBe('block');
    expect(result.matched_policies).toEqual(['gp_warn', 'gp_block']);
    expect(result.warnings.length).toBe(1);
    expect(result.reasons.length).toBe(1);
  });

  it('agent-scoped policy does not govern a different agent (disabled-for-this-agent)', async () => {
    const sql = makeSql([
      makePolicy('block_action_type', { action_types: ['deploy'] }, { agent_ids: JSON.stringify(['other-agent']) }),
    ]);
    const result = await evaluateGuard(freshOrg(), { action_type: 'deploy', agent_id: 'a1' }, sql);
    expect(result.decision).toBe('allow');
    expect(result.matched_policies).toEqual([]);
  });

  it('malformed agent_ids scope fails CLOSED: policy skipped, never widened to all agents', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const sql = makeSql([
        makePolicy('block_action_type', { action_types: ['deploy'] }, { agent_ids: '{not-json' }),
      ]);
      const result = await evaluateGuard(freshOrg(), { action_type: 'deploy', agent_id: 'a1' }, sql);
      expect(result.decision).toBe('allow');
      expect(result.matched_policies).toEqual([]);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('malformed rules JSON → policy skipped but LOUD: decision unchanged, unenforceable warning surfaced', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const sql = makeSql([{ id: 'gp_bad', name: 'Bad', policy_type: 'risk_threshold', rules: '{broken' }]);
      const result = await evaluateGuard(freshOrg(), { action_type: 'deploy', risk_score: 99, agent_id: 'a1' }, sql);
      expect(result.decision).toBe('allow');
      expect(result.warnings.some((w) => w.includes('cannot enforce'))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('unknown policy_type → skipped but LOUD: unenforceable warning surfaced', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const sql = makeSql([{ id: 'gp_new', name: 'Future', policy_type: 'not_a_real_type', rules: '{}' }]);
      const result = await evaluateGuard(freshOrg(), { action_type: 'deploy', agent_id: 'a1' }, sql);
      expect(result.decision).toBe('allow');
      expect(result.warnings.some((w) => w.includes('unknown policy_type'))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('fail-closed default: semantic_check without any LLM key → require_approval', async () => {
    delete process.env.GUARD_LLM_KEY;
    delete process.env.OPENAI_API_KEY;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const sql = makeSql([makePolicy('semantic_check', { instruction: 'never allow X' })]);
      const result = await evaluateGuard(freshOrg(), { action_type: 'other', agent_id: 'a1' }, sql);
      expect(result.decision).toBe('require_approval');
      expect(result.reasons[0]).toContain('Semantic check unavailable');
      expect(mockCheckSemantic).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('fail-closed default: non_fabrication content without a valid source_of_truth → block', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const sql = makeSql([makePolicy('non_fabrication', {})]);
      const result = await evaluateGuard(freshOrg(), { action_type: 'post', agent_id: 'a1', content: 'claim about the world' }, sql);
      expect(result.decision).toBe('block');
      expect(result.reasons[0]).toContain('Non-fabrication: source-of-truth missing or malformed (fail-closed)');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('missing orgId throws (tenant boundary fail-closed, never policy-less allow)', async () => {
    await expect(evaluateGuard('', { action_type: 'deploy' }, makeSql([]))).rejects.toThrow('orgId is required');
    await expect(evaluateGuard(null, { action_type: 'deploy' }, makeSql([]))).rejects.toThrow('orgId is required');
  });

  it('stable result contract: core keys, decision_id format, action_id alias', async () => {
    const result = await evaluateGuard(freshOrg(), { action_type: 'deploy', agent_id: 'a1', agent_name: 'Bot' }, makeSql([]));
    for (const key of [
      'decision', 'decision_id', 'action_id', 'reason', 'signals', 'matched_policies',
      'risk_score', 'agent_risk_score', 'verification_status', 'agent_id', 'agent_name',
      'evaluated_at', 'reasons', 'warnings',
    ]) {
      expect(result).toHaveProperty(key);
    }
    expect(result.decision_id).toMatch(/^act_gd_[0-9a-f]{16}$/);
    expect(result.action_id).toBe(result.decision_id); // deprecated alias preserved
    expect(result.verification_status).toBe('unverified');
    expect(result.agent_id).toBe('a1');
    expect(result.agent_name).toBe('Bot');
  });

  it('audit persistence is mandatory: failed guard_decisions INSERT rejects (never an unaudited decision)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const sql = createSqlMock({ taggedResponses: [[]] });
      const inner = sql;
      // Make the INSERT INTO guard_decisions call fail; leave other queries alone.
      const failing = (strings, ...values) => {
        const text = strings.join(' ');
        if (text.includes('INSERT INTO guard_decisions')) return Promise.reject(new Error('db down'));
        return inner(strings, ...values);
      };
      Object.assign(failing, inner);
      failing.query = inner.query;
      await expect(evaluateGuard(freshOrg(), { action_type: 'other', agent_id: 'a1' }, failing))
        .rejects.toThrow('Guard decision could not be durably recorded');
    } finally {
      errSpy.mockRestore();
    }
  });
});

// ── Route-level characterization: real validate + real engine, mocked DB ──

const { routeSqlHolder } = vi.hoisted(() => ({ routeSqlHolder: { sql: null } }));
vi.mock('@/lib/db.js', () => ({ getSql: () => routeSqlHolder.sql }));
vi.mock('@/lib/repositories/jti-replay.repository.js', () => ({
  checkAndRecord: vi.fn(async () => 'unique'),
  sweep: vi.fn(async () => 0),
}));

import { POST as guardPost } from '@/api/guard/route.js';

describe('guard characterization — POST /api/guard route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    routeSqlHolder.sql = createSqlMock({ taggedResponses: [[]] });
  });

  it('valid minimal body → 200 with the engine decision payload', async () => {
    const res = await guardPost(makeRequest('http://localhost/api/guard', {
      headers: { 'x-org-id': freshOrg() },
      body: { action_type: 'other', agent_id: 'a1' },
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.decision).toBe('allow');
    expect(data.decision_id).toMatch(/^act_gd_/);
    expect(data.reasons).toEqual([]);
    expect(data.warnings).toEqual([]);
  });

  it('missing action_type → 400 validation failure', async () => {
    const res = await guardPost(makeRequest('http://localhost/api/guard', {
      headers: { 'x-org-id': freshOrg() },
      body: { agent_id: 'a1' },
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
  });

  it('block policy through the route → 200 with decision=block', async () => {
    routeSqlHolder.sql = createSqlMock({
      taggedResponses: [[makePolicy('block_action_type', { action_types: ['deploy'] })]],
    });
    const res = await guardPost(makeRequest('http://localhost/api/guard', {
      headers: { 'x-org-id': freshOrg() },
      body: { action_type: 'deploy', agent_id: 'a1' },
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.decision).toBe('block');
    expect(data.matched_policies).toEqual(['gp_block_action_type']);
  });
});
