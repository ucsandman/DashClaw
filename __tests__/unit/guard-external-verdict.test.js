/**
 * External policy verdict seam (RFC docs/rfcs/2026-08-13-external-policy-verdict-input.md,
 * frozen v1 contract, #219). Three layers:
 *   1. config — org-settings keys → ExternalVerdictConfig via the guard hot-path cache
 *   2. wire client — fetchExternalVerdict mapping/identity/posture (Task 2)
 *   3. seam — evaluateGuard integration, the ten #220 adversarial cases (Task 3)
 * This file is the executable conformance spec named by docs/external-verdict-provider.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSettings, mockSafeFetch } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(async () => []),
  mockSafeFetch: vi.fn(),
}));

vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: mockGetSettings }));
vi.mock('@/lib/url-safety.js', () => ({ safeFetch: mockSafeFetch }));
vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: vi.fn() }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: vi.fn() }));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: vi.fn((text) => ({ findings: [], redacted: text, clean: true })) }));
vi.mock('@/lib/predictive-risk.js', () => ({ getPredictiveRisk: vi.fn(async () => ({ statistical: null, llm: null, total_adjustment: 0 })) }));

import { evaluateGuard } from '@/lib/guard.js';
import { createSqlMock } from '../helpers.js';
import {
  getExternalVerdictConfig,
  invalidateGuardExternalVerdictCache,
  __resetGuardCaches,
} from '../../app/lib/guard/caches';
import {
  fetchExternalVerdict,
  computeInputIdentity,
  EXTERNAL_VERDICT_MAP,
} from '../../app/lib/guard/external-verdict';

function makeSql() {
  return createSqlMock({ taggedResponses: [[]] });
}

function settingsRows(map) {
  return Object.entries(map).map(([key, value]) => ({ key, value, encrypted: false, category: 'general' }));
}

describe('external verdict config (org-settings → guard cache)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGuardCaches();
    mockGetSettings.mockResolvedValue([]);
  });

  it('defaults to disabled, fail_closed, 1200ms when no settings rows exist', async () => {
    const cfg = await getExternalVerdictConfig(makeSql(), 'org_1');
    expect(cfg.enabled).toBe(false);
    expect(cfg.url).toBeNull();
    expect(cfg.posture).toBe('fail_closed');
    expect(cfg.timeoutMs).toBe(1200);
  });

  it('parses an enabled provider config from settings rows', async () => {
    mockGetSettings.mockResolvedValue(settingsRows({
      EXTERNAL_VERDICT_ENABLED: 'true',
      EXTERNAL_VERDICT_PROVIDER: 'agent-memory-pama',
      EXTERNAL_VERDICT_PROVIDER_URL: 'https://provider.example.com/verdict',
      EXTERNAL_VERDICT_AUTH_TOKEN: 'tok_abc',
      EXTERNAL_VERDICT_TIMEOUT_MS: '800',
      EXTERNAL_VERDICT_POSTURE: 'fail_open',
    }));
    const cfg = await getExternalVerdictConfig(makeSql(), 'org_1');
    expect(cfg.enabled).toBe(true);
    expect(cfg.url).toBe('https://provider.example.com/verdict');
    expect(cfg.authToken).toBe('tok_abc');
    expect(cfg.timeoutMs).toBe(800);
    expect(cfg.posture).toBe('fail_open');
    expect(cfg.providerId).toBe('agent-memory-pama');
  });

  it('clamps timeout to 100..5000 and falls back to URL host for providerId', async () => {
    mockGetSettings.mockResolvedValue(settingsRows({
      EXTERNAL_VERDICT_ENABLED: 'true',
      EXTERNAL_VERDICT_PROVIDER_URL: 'https://provider.example.com/verdict',
      EXTERNAL_VERDICT_TIMEOUT_MS: '99999',
    }));
    const cfg = await getExternalVerdictConfig(makeSql(), 'org_1');
    expect(cfg.timeoutMs).toBe(5000);
    expect(cfg.providerId).toBe('provider.example.com');
  });

  it('treats an unknown posture string as fail_closed', async () => {
    mockGetSettings.mockResolvedValue(settingsRows({
      EXTERNAL_VERDICT_ENABLED: 'true',
      EXTERNAL_VERDICT_PROVIDER_URL: 'https://provider.example.com/verdict',
      EXTERNAL_VERDICT_POSTURE: 'fail_openish',
    }));
    const cfg = await getExternalVerdictConfig(makeSql(), 'org_1');
    expect(cfg.posture).toBe('fail_closed');
  });

  it('serves from cache within TTL and re-reads after invalidation', async () => {
    const sql = makeSql();
    await getExternalVerdictConfig(sql, 'org_1');
    await getExternalVerdictConfig(sql, 'org_1');
    expect(mockGetSettings).toHaveBeenCalledTimes(1);
    invalidateGuardExternalVerdictCache('org_1');
    await getExternalVerdictConfig(sql, 'org_1');
    expect(mockGetSettings).toHaveBeenCalledTimes(2);
  });
});

// --- Layer 2: wire client -------------------------------------------------

const CFG = {
  enabled: true,
  url: 'https://provider.example.com/verdict',
  authToken: 'tok_abc',
  timeoutMs: 1200,
  posture: 'fail_closed',
  providerId: 'agent-memory-pama',
};

function wireRequest(identity = 'sha256:test-identity') {
  return {
    request_id: 'evr_test',
    org_id: 'org_1',
    agent_id: 'agt_1',
    action_type: 'http_request',
    declared_goal: 'test goal',
    act: { kind: 'http' },
    input_identity: identity,
  };
}

function providerResponse(overrides = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      decision: 'deny',
      reason: 'memory_policy_violation',
      policy_source: 'agent-memory-pama',
      policy_version: 'v3',
      input_identity: 'sha256:test-identity',
      evidence: { rule: 'no_unreviewed_mutation' },
      ...overrides,
    }),
  };
}

describe('fetchExternalVerdict (wire client)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps deny → block with full provenance on the happy path', async () => {
    mockSafeFetch.mockResolvedValue(providerResponse());
    const ev = await fetchExternalVerdict(CFG, wireRequest(), 1000);
    expect(ev.status).toBe('ok');
    expect(ev.regime).toBe('external+local');
    expect(ev.raw_verdict).toBe('deny');
    expect(ev.mapped_verdict).toBe('block');
    expect(ev.reason_code).toBe('memory_policy_violation');
    expect(ev.policy_version).toBe('v3');
    expect(ev.provider_id).toBe('agent-memory-pama');
    expect(ev.evidence).toEqual({ rule: 'no_unreviewed_mutation' });
  });

  it('maps escalate → require_approval', async () => {
    mockSafeFetch.mockResolvedValue(providerResponse({ decision: 'escalate' }));
    const ev = await fetchExternalVerdict(CFG, wireRequest(), 1000);
    expect(ev.mapped_verdict).toBe('require_approval');
  });

  it('sends the bearer token and posts the wire request as JSON', async () => {
    mockSafeFetch.mockResolvedValue(providerResponse());
    await fetchExternalVerdict(CFG, wireRequest(), 1000);
    const [url, opts] = mockSafeFetch.mock.calls[0];
    expect(url).toBe(CFG.url);
    expect(opts.method).toBe('POST');
    expect(opts.headers.authorization).toBe('Bearer tok_abc');
    expect(JSON.parse(opts.body).input_identity).toBe('sha256:test-identity');
  });

  it('E3: discards a verdict whose input_identity does not echo the request', async () => {
    mockSafeFetch.mockResolvedValue(providerResponse({ input_identity: 'sha256:DIFFERENT' }));
    const ev = await fetchExternalVerdict(CFG, wireRequest(), 1000);
    expect(ev.status).toBe('unavailable');
    expect(ev.failure).toBe('identity_mismatch');
    expect(ev.mapped_verdict).toBeUndefined();
  });

  it('#220 case 8: an unsupported verdict (transform) is a posture failure, never an allow', async () => {
    mockSafeFetch.mockResolvedValue(providerResponse({ decision: 'transform' }));
    const ev = await fetchExternalVerdict(CFG, wireRequest(), 1000);
    expect(ev.status).toBe('unavailable');
    expect(ev.failure).toBe('unsupported_verdict');
    expect(ev.mapped_verdict).toBeUndefined();
  });

  it('treats non-2xx as http_error', async () => {
    mockSafeFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const ev = await fetchExternalVerdict(CFG, wireRequest(), 1000);
    expect(ev.failure).toBe('http_error');
  });

  it('treats unparseable or decision-less bodies as malformed', async () => {
    mockSafeFetch.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } });
    expect((await fetchExternalVerdict(CFG, wireRequest(), 1000)).failure).toBe('malformed');
    mockSafeFetch.mockResolvedValue(providerResponse({ decision: undefined }));
    expect((await fetchExternalVerdict(CFG, wireRequest(), 1000)).failure).toBe('malformed');
  });

  it('treats an aborted call as timeout', async () => {
    mockSafeFetch.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
    const ev = await fetchExternalVerdict(CFG, wireRequest(), 1000);
    expect(ev.failure).toBe('timeout');
  });

  it('surfaces safeFetch UNSAFE_URL rejections as unsafe_url', async () => {
    mockSafeFetch.mockRejectedValue(Object.assign(new Error('private IP'), { code: 'UNSAFE_URL' }));
    const ev = await fetchExternalVerdict(CFG, wireRequest(), 1000);
    expect(ev.failure).toBe('unsafe_url');
  });

  it('skips the call entirely when the remaining budget is too small', async () => {
    const ev = await fetchExternalVerdict(CFG, wireRequest(), 50);
    expect(ev.failure).toBe('budget');
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it('drops oversized provider evidence with a truncation marker', async () => {
    mockSafeFetch.mockResolvedValue(providerResponse({ evidence: { blob: 'x'.repeat(5000) } }));
    const ev = await fetchExternalVerdict(CFG, wireRequest(), 1000);
    expect(ev.status).toBe('ok');
    expect(ev.evidence).toBeUndefined();
    expect(ev.evidence_truncated).toBe(true);
  });

  it('exposes the exact four-verdict map from the frozen contract', () => {
    expect(EXTERNAL_VERDICT_MAP).toEqual({
      allow: 'allow', warn: 'warn', escalate: 'require_approval', deny: 'block',
    });
  });
});

describe('computeInputIdentity', () => {
  it('is deterministic and act-sensitive, in the house sha256 format', () => {
    const payload = { org_id: 'org_1', agent_id: 'agt_1', action_type: 'http_request', declared_goal: 'g', act: { kind: 'http' } };
    const a = computeInputIdentity(payload);
    const b = computeInputIdentity({ ...payload });
    const c = computeInputIdentity({ ...payload, act: { kind: 'shell' } });
    expect(a).toMatch(/^sha256:/);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});

// --- Layer 3: the seam — the ten #220 adversarial cases -------------------

const PROVIDER_SETTINGS = {
  EXTERNAL_VERDICT_ENABLED: 'true',
  EXTERNAL_VERDICT_PROVIDER: 'agent-memory-pama',
  EXTERNAL_VERDICT_PROVIDER_URL: 'https://provider.example.com/verdict',
};

function makePolicy(type, rules, overrides = {}) {
  return {
    id: `gp_${type}`,
    name: `Policy ${type}`,
    policy_type: type,
    rules: JSON.stringify(rules),
    ...overrides,
  };
}

function ctx(overrides = {}) {
  return {
    agent_id: 'agt_1',
    action_type: 'http_request',
    declared_goal: 'post release notes',
    act: { kind: 'http', method: 'POST', url: 'https://api.example.com/notes' },
    risk_score: 10,
    ...overrides,
  };
}

/** Provider that echoes the request's input_identity — the contract's E3 rule. */
function providerAnswers(decision, { identity, status = 200 } = {}) {
  mockSafeFetch.mockImplementation(async (_url, opts) => {
    const req = JSON.parse(opts.body);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({
        decision,
        reason: 'memory_policy',
        policy_source: 'agent-memory-pama',
        policy_version: 'v3',
        input_identity: identity ?? req.input_identity,
        evidence: {},
      }),
    };
  });
}

function persistedContext(sql) {
  const call = sql.taggedCalls.find((c) => c.text.includes('guard_decisions'));
  expect(call).toBeTruthy();
  const json = call.values.find((v) => typeof v === 'string' && v.includes('_risk_breakdown'));
  expect(json).toBeTruthy();
  return JSON.parse(json);
}

describe('evaluateGuard external-verdict seam (ten #220 adversarial cases)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGuardCaches();
    mockGetSettings.mockResolvedValue(settingsRows(PROVIDER_SETTINGS));
  });

  it('case 1: local allow + external deny → block (E2 — and no approval escape: grant passes only cover require_approval)', async () => {
    providerAnswers('deny');
    const sql = createSqlMock({ taggedResponses: [[]] });
    const result = await evaluateGuard('org_1', ctx(), sql);
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('external verdict deny from agent-memory-pama');
    expect(persistedContext(sql)._external_verdict.mapped_verdict).toBe('block');
  });

  it('case 2: local block + external allow → block (provider allow never loosens)', async () => {
    providerAnswers('allow');
    const sql = createSqlMock({ taggedResponses: [[makePolicy('risk_threshold', { threshold: 80 })]] });
    const result = await evaluateGuard('org_1', ctx({ risk_score: 95 }), sql);
    expect(result.decision).toBe('block');
    expect(persistedContext(sql)._external_verdict.raw_verdict).toBe('allow');
  });

  it('case 3: local allow + external escalate → require_approval', async () => {
    providerAnswers('escalate');
    const sql = createSqlMock({ taggedResponses: [[]] });
    const result = await evaluateGuard('org_1', ctx(), sql);
    expect(result.decision).toBe('require_approval');
    expect(result.reason).toContain('external verdict escalate');
  });

  it('case 4: local require_approval + external allow → require_approval (local never loosened)', async () => {
    providerAnswers('allow');
    const sql = createSqlMock({
      taggedResponses: [[makePolicy('require_approval', { action_types: ['http_request'] })]],
    });
    const result = await evaluateGuard('org_1', ctx(), sql);
    expect(result.decision).toBe('require_approval');
    expect(persistedContext(sql)._external_verdict.mapped_verdict).toBe('allow');
  });

  it('case 5: input-identity mismatch → posture failure, the verdict is never reused', async () => {
    providerAnswers('allow', { identity: 'sha256:WRONG' });
    const sql = createSqlMock({ taggedResponses: [[]] });
    const result = await evaluateGuard('org_1', ctx(), sql);
    // fail_closed default: the discarded verdict costs an approval, and the
    // mismatched allow is nowhere in the outcome.
    expect(result.decision).toBe('require_approval');
    const xv = persistedContext(sql)._external_verdict;
    expect(xv.failure).toBe('identity_mismatch');
    expect(xv.status).toBe('unavailable');
    expect(xv.mapped_verdict).toBeUndefined();
  });

  it('case 6: provider failure under fail_closed stays conservative (500 → require_approval)', async () => {
    providerAnswers('deny', { status: 500 });
    const sql = createSqlMock({ taggedResponses: [[]] });
    const result = await evaluateGuard('org_1', ctx(), sql);
    expect(result.decision).toBe('require_approval');
    expect(result.reason).toContain('external_unavailable');
    expect(persistedContext(sql)._external_verdict.failure).toBe('http_error');
  });

  it('case 7: timeout is VISIBLY unavailable — never a fake success', async () => {
    mockSafeFetch.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
    const sql = createSqlMock({ taggedResponses: [[]] });
    const result = await evaluateGuard('org_1', ctx(), sql);
    expect(result.decision).toBe('require_approval');
    expect(result.reason).toContain('external_unavailable (timeout; fail_closed)');
    const xv = persistedContext(sql)._external_verdict;
    expect(xv.status).toBe('unavailable');
    expect(xv.regime).toBe('external_unavailable');
  });

  it('case 8: unsupported verdict (transform) under fail_open never becomes an implicit allow claim', async () => {
    providerAnswers('transform');
    mockGetSettings.mockResolvedValue(settingsRows({ ...PROVIDER_SETTINGS, EXTERNAL_VERDICT_POSTURE: 'fail_open' }));
    const sql = createSqlMock({ taggedResponses: [[]] });
    const result = await evaluateGuard('org_1', ctx(), sql);
    // fail_open: the local allow proceeds — but as LOCAL-ONLY governance,
    // recorded unavailable, never as an external approval of the act.
    expect(result.decision).toBe('allow');
    const xv = persistedContext(sql)._external_verdict;
    expect(xv.failure).toBe('unsupported_verdict');
    expect(xv.regime).toBe('external_unavailable');
    expect(result.signals.join(' ')).toContain('external_unavailable');
  });

  it('case 9: provider evidence is decision evidence — a context sibling, never score input or witness state', async () => {
    providerAnswers('deny');
    const sql = createSqlMock({ taggedResponses: [[]] });
    const result = await evaluateGuard('org_1', ctx(), sql);
    const context = persistedContext(sql);
    expect(context._external_verdict).toBeTruthy();
    // Never inside the score vector (score-provenance rule).
    expect(JSON.stringify(context._risk_breakdown)).not.toContain('external');
    expect(JSON.stringify(result.risk_breakdown)).not.toContain('external');
    // Never mistaken for execution-witness state: audit statuses untouched.
    const call = sql.taggedCalls.find((c) => c.text.includes('guard_decisions'));
    expect(call.values).toContain('not_applicable'); // replay/act statuses keep their defaults
  });

  it('case 10: no provider configured → behavior identical, no fetch, no evidence key', async () => {
    mockGetSettings.mockResolvedValue([]);
    const run = async () => {
      __resetGuardCaches();
      const sql = createSqlMock({ taggedResponses: [[]] });
      const result = await evaluateGuard('org_1', ctx(), sql);
      return { result, context: persistedContext(sql) };
    };
    const a = await run();
    const b = await run();
    expect(mockSafeFetch).not.toHaveBeenCalled();
    expect(a.context._external_verdict).toBeUndefined();
    const strip = ({ decision_id, action_id, ...rest }) => rest;
    expect(strip(a.result)).toEqual(strip(b.result));
  });

  it('extra: fail_open + provider down → local-only proceed with honest evidence', async () => {
    mockSafeFetch.mockRejectedValue(Object.assign(new Error('down'), { name: 'TimeoutError' }));
    mockGetSettings.mockResolvedValue(settingsRows({ ...PROVIDER_SETTINGS, EXTERNAL_VERDICT_POSTURE: 'fail_open' }));
    const sql = createSqlMock({ taggedResponses: [[]] });
    const result = await evaluateGuard('org_1', ctx(), sql);
    expect(result.decision).toBe('allow');
    expect(persistedContext(sql)._external_verdict.failure).toBe('timeout');
  });

  it('extra: simulate previews never call the provider', async () => {
    providerAnswers('deny');
    const sql = createSqlMock({ taggedResponses: [[]] });
    const result = await evaluateGuard('org_1', ctx(), sql, { simulate: true });
    expect(result.simulated).toBe(true);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it('extra: external warn joins as warn and keeps the external+local regime', async () => {
    providerAnswers('warn');
    const sql = createSqlMock({ taggedResponses: [[]] });
    const result = await evaluateGuard('org_1', ctx(), sql);
    expect(result.decision).toBe('warn');
    expect(persistedContext(sql)._external_verdict.regime).toBe('external+local');
  });
});
