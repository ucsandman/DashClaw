/**
 * Guard degradation contract (Organ 3, Phase 1).
 *
 * The guard must fail CLOSED when it cannot complete an evaluation:
 *   - webhook timeout/failure  → resolveDegradedAction(rules.on_timeout)
 *   - semantic LLM failure     → resolveDegradedAction(rules.fallback)
 *   - evaluation deadline      → resolveDegradedAction() applied to the
 *     accumulated state, decision still persisted through the audit gate
 *
 * Precedence: per-policy override → DASHCLAW_GUARD_FALLBACK → require_approval.
 * `allow` is the explicit fail-open escape hatch for self-hosters.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockDeliverGuardWebhook, mockCheckSemantic, mockScanSensitiveData } = vi.hoisted(() => ({
  mockDeliverGuardWebhook: vi.fn(),
  mockCheckSemantic: vi.fn(),
  mockScanSensitiveData: vi.fn((text) => ({ findings: [], redacted: text, clean: true })),
}));

vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: mockDeliverGuardWebhook }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: mockCheckSemantic }));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: mockScanSensitiveData }));
vi.mock('@/lib/predictive-risk.js', () => ({ getPredictiveRisk: vi.fn(async () => ({ statistical: null, llm: null, total_adjustment: 0 })) }));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: vi.fn(async () => []) }));

import { evaluateGuard, resolveDegradedAction, __resetGuardCaches } from '@/lib/guard.js';
import { createSqlMock } from '../helpers.js';

function makeSql(policies) {
  return createSqlMock({ taggedResponses: [policies] });
}

function makePolicy(type, rules, overrides = {}) {
  return {
    id: `gp_${type}`,
    name: `Policy ${type}`,
    policy_type: type,
    rules: JSON.stringify(rules),
    ...overrides,
  };
}

const ENV_KEYS = ['DASHCLAW_GUARD_FALLBACK', 'DASHCLAW_GUARD_DEADLINE_MS', 'GUARD_LLM_KEY'];
const savedEnv = {};

describe('guard degradation contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGuardCaches();
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    mockScanSensitiveData.mockImplementation((text) => ({ findings: [], redacted: text, clean: true }));
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  describe('resolveDegradedAction precedence', () => {
    it('defaults to require_approval (fail closed)', () => {
      expect(resolveDegradedAction()).toBe('require_approval');
    });

    it('per-policy override wins over env', () => {
      process.env.DASHCLAW_GUARD_FALLBACK = 'block';
      expect(resolveDegradedAction('allow')).toBe('allow');
    });

    it('env applies when no policy override', () => {
      process.env.DASHCLAW_GUARD_FALLBACK = 'allow';
      expect(resolveDegradedAction()).toBe('allow');
      process.env.DASHCLAW_GUARD_FALLBACK = 'block';
      expect(resolveDegradedAction()).toBe('block');
    });

    it('unknown values fall through to the fail-closed default', () => {
      process.env.DASHCLAW_GUARD_FALLBACK = 'banana';
      expect(resolveDegradedAction('garbage')).toBe('require_approval');
    });
  });

  describe('webhook degradation', () => {
    it('honors on_timeout=require_approval when the webhook fails', async () => {
      mockDeliverGuardWebhook.mockResolvedValue({ success: false, response: null });
      const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com', on_timeout: 'require_approval' })]);
      const result = await evaluateGuard('org_wd1', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('require_approval');
      expect(result.reason).toContain('on_timeout: require_approval');
    });

    it('defaults to require_approval when nothing is configured (fail-closed default)', async () => {
      mockDeliverGuardWebhook.mockResolvedValue({ success: false, response: null });
      const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com' })]);
      const result = await evaluateGuard('org_wd2', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('require_approval');
    });

    it('DASHCLAW_GUARD_FALLBACK=allow restores fail-open (escape hatch)', async () => {
      process.env.DASHCLAW_GUARD_FALLBACK = 'allow';
      mockDeliverGuardWebhook.mockResolvedValue({ success: false, response: null });
      const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com' })]);
      const result = await evaluateGuard('org_wd3', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('allow');
    });

    it('DASHCLAW_GUARD_FALLBACK=block blocks on webhook degradation', async () => {
      process.env.DASHCLAW_GUARD_FALLBACK = 'block';
      mockDeliverGuardWebhook.mockResolvedValue({ success: false, response: null });
      const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com' })]);
      const result = await evaluateGuard('org_wd4', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('block');
    });

    it('per-policy on_timeout=allow beats a stricter env value', async () => {
      process.env.DASHCLAW_GUARD_FALLBACK = 'block';
      mockDeliverGuardWebhook.mockResolvedValue({ success: false, response: null });
      const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com', on_timeout: 'allow' })]);
      const result = await evaluateGuard('org_wd5', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('allow');
    });
  });

  // A2 (#219 adversarial review): webhook_check policies used to be awaited
  // one at a time inside the shared 3500ms guard deadline — N independent
  // outbound calls cost up to N * per-call timeout instead of max(). They
  // read only the frozen `preliminary` snapshot, so nothing stops them
  // running concurrently; results still apply in original policy order.
  describe('A2: webhook_check policies run concurrently', () => {
    it('evaluates all policies concurrently (wall time close to the slowest call, not their sum)', async () => {
      mockDeliverGuardWebhook.mockImplementation(async ({ policyId }) => {
        // Resolve in REVERSE order of policy/invocation order — proves the
        // implementation does not wait on policy N before starting N+1.
        const delay = { gp_a: 30, gp_b: 20, gp_c: 10 }[policyId] ?? 0;
        await new Promise((r) => setTimeout(r, delay));
        return { success: true, response: { decision: 'allow', reasons: [], warnings: [] } };
      });
      const sql = makeSql([
        makePolicy('webhook_check', { url: 'https://a.example.com' }, { id: 'gp_a', name: 'A' }),
        makePolicy('webhook_check', { url: 'https://b.example.com' }, { id: 'gp_b', name: 'B' }),
        makePolicy('webhook_check', { url: 'https://c.example.com' }, { id: 'gp_c', name: 'C' }),
      ]);
      const started = Date.now();
      await evaluateGuard('org_wd_concurrent1', { action_type: 'deploy' }, sql);
      const elapsed = Date.now() - started;
      // Sequential would cost >= 30+20+10 = 60ms; concurrent costs ~= max = 30ms.
      expect(elapsed).toBeLessThan(55);
      expect(mockDeliverGuardWebhook).toHaveBeenCalledTimes(3);
    });

    it('applies results in ORIGINAL policy order regardless of which provider answers first', async () => {
      mockDeliverGuardWebhook.mockImplementation(async ({ policyId }) => {
        const delay = { gp_a: 30, gp_b: 20, gp_c: 10 }[policyId] ?? 0;
        await new Promise((r) => setTimeout(r, delay));
        // Every policy escalates to warn (decision severity > the allow
        // preliminary), so each one produces a non-null result to apply.
        return { success: true, response: { decision: 'warn', reasons: [], warnings: [`warn from ${policyId}`] } };
      });
      const sql = makeSql([
        makePolicy('webhook_check', { url: 'https://a.example.com' }, { id: 'gp_a', name: 'A' }),
        makePolicy('webhook_check', { url: 'https://b.example.com' }, { id: 'gp_b', name: 'B' }),
        makePolicy('webhook_check', { url: 'https://c.example.com' }, { id: 'gp_c', name: 'C' }),
      ]);
      const result = await evaluateGuard('org_wd_concurrent2', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('warn');
      // Resolution order was C, B, A — applied order stays the original
      // policy order A, B, C, so matched_policies/warnings are deterministic.
      expect(result.matched_policies).toEqual(['gp_a', 'gp_b', 'gp_c']);
      expect(result.warnings.join(' ')).toMatch(/warn from gp_a.*warn from gp_b.*warn from gp_c/s);
    });

    it('an unparseable policy alongside valid ones does not block the others from evaluating', async () => {
      mockDeliverGuardWebhook.mockResolvedValue({ success: true, response: { decision: 'warn', reasons: [], warnings: ['ok'] } });
      const sql = makeSql([
        { id: 'gp_bad', name: 'Bad', policy_type: 'webhook_check', rules: '{not json' },
        makePolicy('webhook_check', { url: 'https://b.example.com' }, { id: 'gp_good', name: 'Good' }),
      ]);
      const result = await evaluateGuard('org_wd_concurrent3', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('warn');
      expect(result.matched_policies).toEqual(['gp_good']);
      expect(result.warnings.some((w) => w.includes('cannot enforce'))).toBe(true);
      expect(mockDeliverGuardWebhook).toHaveBeenCalledTimes(1); // only the parseable policy calls out
    });
  });

  describe('evaluation deadline', () => {
    it('returns a persisted degraded require_approval when a phase overruns the deadline', async () => {
      process.env.DASHCLAW_GUARD_DEADLINE_MS = '50';
      // Webhook hangs forever — the deadline must rescue the evaluation.
      mockDeliverGuardWebhook.mockImplementation(() => new Promise(() => {}));
      const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com' })]);

      const started = Date.now();
      const result = await evaluateGuard('org_dl1', { action_type: 'deploy', agent_id: 'agt_1' }, sql);
      const elapsed = Date.now() - started;

      expect(elapsed).toBeLessThan(5000);
      expect(result.decision).toBe('require_approval');
      expect(result.reason).toContain('exceeded deadline');
      // The degraded decision must still go through the audit gate.
      const persisted = sql.taggedCalls.some((c) => c.text.includes('INSERT INTO guard_decisions'));
      expect(persisted).toBe(true);
      // Result is schema-complete: ids, risk, timestamps all present.
      expect(result.decision_id).toMatch(/^act_gd_/);
      expect(typeof result.risk_score).toBe('number');
      expect(result.evaluated_at).toBeTruthy();
    });

    it('a block found before the deadline is never downgraded by the degraded action', async () => {
      process.env.DASHCLAW_GUARD_DEADLINE_MS = '50';
      mockDeliverGuardWebhook.mockImplementation(() => new Promise(() => {}));
      const sql = makeSql([
        makePolicy('block_action_type', { action_types: ['deploy'] }, { id: 'gp_block' }),
        makePolicy('webhook_check', { url: 'https://example.com' }, { id: 'gp_hook' }),
      ]);
      const result = await evaluateGuard('org_dl2', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('exceeded deadline');
    });

    it('deadline degradation honors DASHCLAW_GUARD_FALLBACK=allow as a warning, not a reason', async () => {
      process.env.DASHCLAW_GUARD_DEADLINE_MS = '50';
      process.env.DASHCLAW_GUARD_FALLBACK = 'allow';
      mockDeliverGuardWebhook.mockImplementation(() => new Promise(() => {}));
      const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com' })]);
      const result = await evaluateGuard('org_dl3', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('allow');
      expect(result.warnings.some((w) => w.includes('exceeded deadline'))).toBe(true);
    });

    it('DASHCLAW_GUARD_DEADLINE_MS overrides the default deadline', async () => {
      // Generous deadline: the fast evaluation completes normally, no degradation.
      process.env.DASHCLAW_GUARD_DEADLINE_MS = '30000';
      mockDeliverGuardWebhook.mockResolvedValue({ success: true, response: { decision: 'allow', reasons: [], warnings: [] } });
      const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com' })]);
      const result = await evaluateGuard('org_dl4', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('allow');
      expect(result.reason ?? '').not.toContain('exceeded deadline');
    });

    it('fast evaluations are unaffected by the default deadline', async () => {
      const sql = makeSql([makePolicy('risk_threshold', { threshold: 80 })]);
      const result = await evaluateGuard('org_dl5', { risk_score: 85, action_type: 'deploy' }, sql);
      expect(result.decision).toBe('block');
      expect(result.reason ?? '').not.toContain('exceeded deadline');
    });
  });

  // v2.1 (docs/plans/2026-07-02-guard-deadline-noise.md): degradation is a
  // first-class persisted marker (column + context._degraded), never inferred
  // by string-matching reason; per-phase timings persist on every decision.
  describe('degradation stamping + timings (v2.1)', () => {
    function guardInsert(sql) {
      const call = sql.taggedCalls.find((c) => c.text.includes('INSERT INTO guard_decisions'));
      expect(call).toBeTruthy();
      // Values order mirrors persistGuardDecision's INSERT column list
      // (idempotency_key landed at index 16 in drizzle/0058, shifting
      // created_at/degraded right by one).
      return { context: JSON.parse(call.values[12]), degraded: call.values[18], result: call };
    }

    it('deadline degradation persists degraded=true, context._degraded, and _timings', async () => {
      process.env.DASHCLAW_GUARD_DEADLINE_MS = '50';
      mockDeliverGuardWebhook.mockImplementation(() => new Promise(() => {}));
      const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com' })]);

      const result = await evaluateGuard('org_st1', { action_type: 'deploy', agent_id: 'agt_1' }, sql);
      expect(result.decision).toBe('require_approval');
      expect(result.degraded).toBe(true);

      const row = guardInsert(sql);
      expect(row.degraded).toBe(true);
      expect(row.context._degraded).toMatchObject({ kind: 'deadline', deadline_ms: 50, action: 'require_approval' });
      // The webhook phase was in flight when the deadline fired.
      expect(row.context._degraded.phase_in_flight).toBe('webhooks');
      expect(row.context._timings).toBeTruthy();
      expect(typeof row.context._timings.total).toBe('number');
    });

    it('fail-open (allow) degradation leaves a persisted trace too', async () => {
      process.env.DASHCLAW_GUARD_DEADLINE_MS = '50';
      process.env.DASHCLAW_GUARD_FALLBACK = 'allow';
      mockDeliverGuardWebhook.mockImplementation(() => new Promise(() => {}));
      const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com' })]);

      const result = await evaluateGuard('org_st2', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('allow');
      expect(result.degraded).toBe(true);

      const row = guardInsert(sql);
      expect(row.degraded).toBe(true);
      expect(row.context._degraded).toMatchObject({ kind: 'deadline', action: 'allow' });
    });

    it('normal evaluations persist degraded=false with _timings and no _degraded', async () => {
      const sql = makeSql([makePolicy('risk_threshold', { threshold: 80 })]);
      const result = await evaluateGuard('org_st3', { risk_score: 10, action_type: 'deploy', agent_id: 'agt_1' }, sql);
      expect(result.decision).toBe('allow');
      expect(result.degraded).toBeUndefined();

      const row = guardInsert(sql);
      expect(row.degraded).toBe(false);
      expect(row.context._degraded).toBeUndefined();
      expect(row.context._timings).toBeTruthy();
      expect(typeof row.context._timings.total).toBe('number');
    });
  });

  // D2 (trust & failure model ADR): ONE knob covers slow AND fast failures.
  // Before this, DASHCLAW_GUARD_FALLBACK applied only on the deadline path; a
  // fast DB failure (policy load, risk read) rejected straight out of
  // evaluateGuard as a 5xx, so an operator who set FALLBACK=allow still got
  // hard failures under a DB outage. Fast failures now produce the same
  // degraded decision, still through the mandatory audit gate — and when
  // persistence itself is down, the audit gate still throws: an unaudited
  // decision is never returned.
  describe('fast evaluation failure joins the degradation contract (D2)', () => {
    function failingPolicySql() {
      const boom = Promise.reject(new Error('connection refused'));
      boom.catch(() => {}); // pre-handle so the queued rejection is not "unhandled"
      return createSqlMock({ taggedResponses: [boom] });
    }
    const findGuardInsert = (sql) => sql.taggedCalls.find((c) => /INSERT INTO guard_decisions/i.test(c.text));

    it('a fast policy-load failure yields the degraded decision through the audit gate — not a thrown 500', async () => {
      const sql = failingPolicySql();
      const result = await evaluateGuard('org_d2', { action_type: 'deploy', declared_goal: 'ship' }, sql);
      expect(result.decision).toBe('require_approval');
      expect(result.degraded).toBe(true);
      expect(findGuardInsert(sql)).toBeTruthy();
    });

    it('DASHCLAW_GUARD_FALLBACK=allow covers fast failures too (one knob), with a warning trace', async () => {
      process.env.DASHCLAW_GUARD_FALLBACK = 'allow';
      const sql = failingPolicySql();
      const result = await evaluateGuard('org_d2b', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('allow');
      expect(result.degraded).toBe(true);
      expect(result.warnings.some((w) => /degraded/i.test(w))).toBe(true);
    });

    it('when persistence is down too, evaluateGuard still throws — an unaudited decision is never returned', async () => {
      const sql = () => Promise.reject(new Error('db down'));
      sql.query = async () => { throw new Error('db down'); };
      await expect(evaluateGuard('org_d2c', { action_type: 'deploy' }, sql)).rejects.toThrow();
    });
  });
});
