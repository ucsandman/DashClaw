/**
 * Guard evaluation engine.
 * Evaluates agent context against org policies and returns allow/warn/block/require_approval.
 */

import { randomUUID } from 'node:crypto';
import { baseAgentId } from './agent-identity-resolve';
import { deliverGuardWebhook } from './webhooks';
import { checkSemanticGuardrail } from './llm';
import { generateActionEmbedding, isEmbeddingsEnabled } from './embeddings';
import { scanSensitiveData } from './security';
import { scanForPromptInjection } from './promptInjection';
import { EVENTS, publishOrgEvent } from './events';
import { getLearningContext } from './learning-context';
import { evaluateRecoveryRecipes } from './recovery';
import { getActBindingMode } from './act-binding';
import { matchesProtectedPath } from './behavior/path-match';
import { grantMatches, targetPrefixMatches } from './policy-shapes';
import { verify } from './integrity/verify';
import type { SourceOfTruth } from './integrity/verify';
import { issueReceipt } from './integrity/receipt';
import { getServerSigningKey } from './integrity/server-key';

const DECISION_SEVERITY = { allow: 0, warn: 1, require_approval: 2, block: 3 } as const;
const SEVERITY = DECISION_SEVERITY as Record<string, number>;
/** Severity of a decision string (0 for an unknown value — matches JS `undefined`-comparison behaviour). */
const sevOf = (d: string): number => SEVERITY[d] ?? 0;
const hasSev = (d: string): boolean => SEVERITY[d] !== undefined;

// ── Global guard-degradation contract ──
// What the guard returns when it cannot complete an evaluation: webhook
// timeout/failure, semantic LLM failure, or the evaluation deadline firing.
// Precedence: per-policy override → DASHCLAW_GUARD_FALLBACK env → fail-closed
// default (require_approval). `allow` is the documented self-hoster escape
// hatch that restores the old fail-open behavior.
const DEGRADED_ACTIONS = ['allow', 'block', 'require_approval'] as const;
type DegradedAction = (typeof DEGRADED_ACTIONS)[number];

export function resolveDegradedAction(policyOverride?: string | null): DegradedAction {
  for (const candidate of [policyOverride, process.env.DASHCLAW_GUARD_FALLBACK]) {
    if (candidate && (DEGRADED_ACTIONS as readonly string[]).includes(candidate)) {
      return candidate as DegradedAction;
    }
  }
  return 'require_approval';
}

// Evaluation deadline: the hook gives the whole guard call one attempt with a
// 5s read timeout (GUARD_TIMEOUT, GUARD_RETRIES=0) — the server must answer
// safely inside that window, so the policy-evaluation phases are bounded and a
// degraded decision is returned (and still persisted) when they overrun.
const DEFAULT_GUARD_DEADLINE_MS = 3500;

function guardDeadlineMs(): number {
  const raw = Number(process.env.DASHCLAW_GUARD_DEADLINE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GUARD_DEADLINE_MS;
}

const ACTION_TYPE_BASE_SCORES = {
  deploy: 75, security: 80, migrate: 70, apply: 60, sync: 40,
  api: 35, build: 25, fix: 20, refactor: 20, test: 15,
  config: 30, monitor: 10, alert: 10, cleanup: 30, post: 25,
  message: 15, calendar: 10, research: 10, review: 10, other: 20,
} as const;
const baseScore = (t: unknown): number =>
  (typeof t === 'string' ? (ACTION_TYPE_BASE_SCORES as Record<string, number>)[t] : undefined) ?? ACTION_TYPE_BASE_SCORES.other;

/** Lookup into a rank table by an untrusted key, with a fallback. */
const rankOf = (table: Record<string, number>, key: unknown, fallback: number): number =>
  (typeof key === 'string' ? table[key] : undefined) ?? fallback;

const HIGH_RISK_SYSTEMS = ['production', 'database', 'postgres', 'neon', 'redis'];
const MODERATE_RISK_SYSTEMS = ['filesystem', 'shell'];
// Word-bounded: the old unanchored substrings flipped scores on wording alone
// ('monkey' matched /key/ +15, 'pushback' matched /push/ +10, 'formatting'
// matched /format/ +20) — a top source of the "risk looks random" perception.
// 'format' additionally rejects flag forms: punctuation satisfies \b, so
// `--format=""` scored +20 on read-only commands (calibration vector
// git-show-format-flag). Prose ("format the disk") still matches.
const DESTRUCTIVE_GOAL_PATTERNS = /rm\s+-rf|drop\s+table|delete\s+from|\btruncate\b|(?<!-)\bformat\b|\bwipe\b/i;
const DEPLOYMENT_GOAL_PATTERNS = /\bpush(?:es|ed|ing)?\b|\bdeploy|\brelease|\bship(?:s|ped|ping)?\b|\bmigrat/i;
const SECRET_GOAL_PATTERNS = /\bsecrets?\b|\bcredentials?\b|\bpasswords?\b|\btokens?\b|\bkeys?\b|\.env\b/i;

/** SQL client usable as a tagged template AND via `.query()` (Neon/postgres shape). */
type GuardSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

interface GuardEvalContext {
  action_type?: string;
  agent_id?: string | null;
  agent_name?: string | null;
  risk_score?: number | string | null;
  systems_touched?: unknown;
  reversible?: boolean;
  declared_goal?: string | null;
  verification_status?: string;
  replay_status?: string;
  act_status?: string;
  jti?: string | null;
  act_hash?: string | null;
  target?: string;
  write_paths?: unknown;
  provider?: string;
  vendor?: string;
  provider_id?: string | null;
  cost_estimate?: number;
  cost?: number;
  tool?: { required_permission?: string };
  intel?: {
    branch?: { freshness: string; commits_behind?: number; name?: string };
    mcp?: { healthy?: boolean };
    green?: { observed_level?: string };
    tool?: { required_permission?: string };
  };
  [field: string]: unknown;
}

interface PolicyRow {
  id: string;
  name: string;
  policy_type: string;
  rules: string;
  agent_ids?: string | null;
  [field: string]: unknown;
}

interface PolicyRules {
  threshold?: number;
  action?: string;
  action_types?: string[];
  target_prefix?: string;
  paths?: string[];
  max_actions?: number;
  window_minutes?: number;
  url?: string;
  timeout_ms?: number;
  on_timeout?: string;
  content_path?: string;
  source_path?: string;
  on_violation?: string;
  similarity_threshold?: number;
  min_history?: number;
  instruction?: string;
  model?: string;
  fallback?: string;
  enforce?: boolean;
  required_level?: string;
  freshness?: string[];
  max_commits_behind?: number;
  max_spend_usd?: number;
  approval_threshold?: number;
  allowed_providers?: string[];
  blocked_providers?: string[];
  budget_usd?: number;
  budget_approval_threshold?: number;
  budget_window_days?: number;
  budget_scope?: string;
  on_failure?: string;
}

interface PolicyResult {
  action: string;
  reason: string;
  nonFabrication?: unknown;
  stripPaths?: string[];
  extraWarnings?: string[];
}

interface GuardOptions {
  includeSignals?: boolean;
  computeSignals?: (orgId: string, agentId: string | null, sql: GuardSql) => Promise<Array<{ type: string; label: string }>>;
}

interface Preliminary {
  decision: string;
  reasons: string[];
  warnings: string[];
  matchedPolicies: string[];
}

/** One additive term of the server-side risk formula. */
export interface RiskFactor {
  factor: string;
  delta: number;
}

// Additional risk from the systems an action touches (high vs moderate tiers).
function systemsTouchedFactors(systemsTouched: unknown): RiskFactor[] {
  if (!Array.isArray(systemsTouched)) return [];
  const systems = systemsTouched.map((s) => (typeof s === 'string' ? s.toLowerCase() : ''));
  const factors: RiskFactor[] = [];
  const high = systems.find((s) => HIGH_RISK_SYSTEMS.includes(s));
  if (high) factors.push({ factor: `systems:${high}`, delta: 10 });
  const moderate = systems.find((s) => MODERATE_RISK_SYSTEMS.includes(s));
  if (moderate) factors.push({ factor: `systems:${moderate}`, delta: 5 });
  return factors;
}

// Additional risk from destructive/deployment/secret patterns in the declared goal.
function declaredGoalFactors(declaredGoal: unknown): RiskFactor[] {
  if (typeof declaredGoal !== 'string') return [];
  const factors: RiskFactor[] = [];
  if (DESTRUCTIVE_GOAL_PATTERNS.test(declaredGoal)) factors.push({ factor: 'goal:destructive-pattern', delta: 20 });
  if (DEPLOYMENT_GOAL_PATTERNS.test(declaredGoal)) factors.push({ factor: 'goal:deployment-pattern', delta: 10 });
  if (SECRET_GOAL_PATTERNS.test(declaredGoal)) factors.push({ factor: 'goal:secret-pattern', delta: 15 });
  return factors;
}

// The shared term computation behind computeRiskScore and the breakdown.
// NOTE: this is the per-action guard heuristic — unrelated to reputation.ts's
// computeRiskScore (a decay-weighted mean of these persisted values).
function serverRiskTerms(context: GuardEvalContext): { base: { action_type: string; score: number }; modifiers: RiskFactor[]; total: number } {
  const base = { action_type: typeof context.action_type === 'string' ? context.action_type : 'other', score: baseScore(context.action_type) };
  const modifiers: RiskFactor[] = [];
  if (context.reversible === false) modifiers.push({ factor: 'irreversible', delta: 15 });
  modifiers.push(...systemsTouchedFactors(context.systems_touched));
  modifiers.push(...declaredGoalFactors(context.declared_goal));
  const total = Math.max(0, Math.min(base.score + modifiers.reduce((s, m) => s + m.delta, 0), 100));
  return { base, modifiers, total };
}

/**
 * Compute an authoritative risk score from structured guard context fields.
 * Returns an integer 0-100.
 */
export function computeRiskScore(context: GuardEvalContext): number {
  return serverRiskTerms(context).total;
}

// Resolve a dotted field path into the guard context. Returns undefined for any missing segment.
function getByPath(obj: unknown, path: unknown): unknown {
  if (obj == null || typeof path !== 'string') return undefined;
  return path.split('.').reduce<unknown>((acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key]), obj);
}

const isRecord = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object';

// Walk all but the last path segment, returning the parent record (or undefined
// if any segment is missing or non-object).
function navigateToParent(obj: unknown, keys: string[]): Record<string, unknown> | undefined {
  let cur: unknown = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!isRecord(cur) || k === undefined) return undefined;
    cur = cur[k];
  }
  return isRecord(cur) ? cur : undefined;
}

// Replace the leaf at `path` with `marker` if present. Used to keep raw
// non_fabrication inputs out of the persisted guard_decisions.context row.
function redactByPath(obj: unknown, path: unknown, marker: unknown): void {
  if (obj == null || typeof path !== 'string') return;
  const keys = path.split('.');
  const parent = navigateToParent(obj, keys);
  const leaf = keys[keys.length - 1];
  if (parent && leaf !== undefined && leaf in parent) {
    parent[leaf] = marker;
  }
}

function redactAny(value: unknown, findings: unknown[]): unknown {
  if (typeof value === 'string') {
    const scan = scanSensitiveData(value);
    if (!scan.clean) findings.push(...scan.findings);
    return scan.redacted;
  }
  if (Array.isArray(value)) return value.map((v) => redactAny(v, findings));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactAny(v, findings);
    return out;
  }
  return value;
}

// Structural shield outcomes persisted with the decision (context._shields).
// null = the check never ran on this evaluation (halt, deadline) — persisted
// as absent, never as a fabricated "clean".
export type PromptInjectionShieldStatus = 'clean' | 'warned' | 'blocked' | 'disabled';
interface GuardShields {
  prompt_injection: PromptInjectionShieldStatus | null;
}

// Mutable accumulator threaded through the guard phases below.
interface GuardAccumulator {
  reasons: string[];
  warnings: string[];
  matchedPolicies: string[];
  nonFabEvidence: unknown[];
  nonFabStripPaths: Set<string>;
  highestDecision: string;
  shields: GuardShields;
}

function newAccumulator(): GuardAccumulator {
  return { reasons: [], warnings: [], matchedPolicies: [], nonFabEvidence: [], nonFabStripPaths: new Set(), highestDecision: 'allow', shields: { prompt_injection: null } };
}

function raiseDecision(acc: GuardAccumulator, action: string): void {
  if (sevOf(action) > sevOf(acc.highestDecision)) acc.highestDecision = action;
}

function applyResult(result: PolicyResult, policy: PolicyRow, acc: GuardAccumulator): void {
  if (result.action === 'warn') {
    acc.warnings.push(`${policy.name}: ${result.reason}`);
  } else if (result.action !== 'allow') {
    acc.reasons.push(`${policy.name}: ${result.reason}`);
  }
  if (result.extraWarnings) {
    acc.warnings.push(...result.extraWarnings);
  }
  acc.matchedPolicies.push(policy.id);
}

// A block reason forces `block` (it always outranks a policy outcome) and is
// prepended to the reason list. Mirrors the original replay/act override shape.
function applyBlockOverride(acc: GuardAccumulator, reason: string | null): void {
  if (!reason) return;
  if (DECISION_SEVERITY.block >= sevOf(acc.highestDecision)) {
    acc.highestDecision = 'block';
  }
  acc.reasons.unshift(reason);
}

// Flat (no else-if chain — those desugar to nested elses) replay reason lookup.
function replayReasonFor(replayStatus: string): string | null {
  const required = (process.env.DASHCLAW_JTI_REPLAY_PROTECTION || 'best_effort').toLowerCase() === 'required';
  if (replayStatus === 'replayed') return `Replay detected: jti has been seen in a prior verified guard call within its exp window.`;
  if (replayStatus === 'exp_too_far') return `Token exp exceeds the configured max TTL (DASHCLAW_JTI_MAX_TTL_SECONDS).`;
  if (replayStatus === 'unavailable' && required) return `Replay store unreachable and DASHCLAW_JTI_REPLAY_PROTECTION=required.`;
  if (replayStatus === 'not_present' && required) return `Verified token has no jti claim and DASHCLAW_JTI_REPLAY_PROTECTION=required.`;
  return null;
}

// Phase 2b (issue #120): replay block decision, decided at the audit boundary.
function computeReplayBlockReason(context: GuardEvalContext, orgId: string): string | null {
  const replayStatus = context.replay_status || 'not_applicable';
  const reason = replayReasonFor(replayStatus);
  if (reason) {
    console.warn('[Guard] Replay-protection block:', {
      reason, replay_status: replayStatus, jti: context.jti || null, agent_id: context.agent_id || null, org_id: orgId,
    });
  }
  return reason;
}

const ACT_BINDING_INCOMPLETE = ['not_present', 'unsupported_typ', 'ctx_incomplete'];

// Phase 2c (issue #121): action-binding block decision. Mirrors replay_status —
// its own axis, decided here at the audit boundary, never re-checked.
function computeActBindingBlockReason(context: GuardEvalContext, orgId: string): string | null {
  const actBindingMode = getActBindingMode();
  const actStatus = context.act_status || 'not_applicable';
  let reason: string | null = null;
  if (actBindingMode !== 'off' && actStatus === 'mismatch') {
    reason = 'Action-binding mismatch: token committed to a different (action, target, goal) than this call.';
  } else if (actBindingMode === 'required' && ACT_BINDING_INCOMPLETE.includes(actStatus)) {
    reason = `Action-binding ${actStatus} and DASHCLAW_ACT_BINDING=required.`;
  }
  if (reason) {
    console.warn('[Guard] Action-binding block:', {
      reason, act_status: actStatus, agent_id: context.agent_id || null, org_id: orgId,
    });
  }
  return reason;
}

// Hot-path caches (pattern: middleware apiKeyCache). Guard is invoked on every
// governed tool call; policies and the predictive-risk settings change rarely.
// TTL is short (≤60s per the enforcement contract) and policy mutations
// invalidate eagerly via invalidateGuardPolicyCache().
const GUARD_CACHE_TTL_MS = 30_000;
const policyCache = new Map<string, { rows: PolicyRow[]; expires: number }>();
interface OrgHaltState {
  halted: boolean;
  actor?: string;
  reason?: string;
  at?: string;
}

const predictiveSettingsCache = new Map<string, { enabled: boolean; threshold: number; halt: OrgHaltState | null; expires: number }>();
const riskTemplateCache = new Map<string, { rows: Array<Record<string, unknown>>; expires: number }>();

/** Called by policy mutation paths so a changed policy takes effect immediately. */
export function invalidateGuardPolicyCache(orgId?: string): void {
  if (orgId) policyCache.delete(orgId);
  else policyCache.clear();
}

/** Called by risk-template mutation paths so edited weights apply immediately. */
export function invalidateGuardRiskTemplateCache(orgId?: string): void {
  if (orgId) riskTemplateCache.delete(orgId);
  else riskTemplateCache.clear();
}

/**
 * Called by the /api/halt endpoint so the org kill switch takes effect
 * immediately instead of after the ~30s settings-cache TTL.
 */
export function invalidateGuardSettingsCache(orgId?: string): void {
  if (orgId) predictiveSettingsCache.delete(orgId);
  else predictiveSettingsCache.clear();
}

/**
 * Read just the org kill-switch (halt) state. Shares the predictive-settings
 * cache + eager invalidation, so /api/halt still takes effect immediately.
 * Exposed for the guard route's pre-replay halt check: the idempotency replay
 * short-circuit must NOT absorb an emergency halt the way it deliberately
 * absorbs ordinary retries (halt is an override with its own immediate-block
 * guarantee, not a policy change).
 */
export async function getOrgHaltState(sql: GuardSql, orgId: string): Promise<OrgHaltState | null> {
  return (await getPredictiveSettings(sql, orgId)).halt;
}

/** Test-only: clear all guard hot-path caches. */
export function __resetGuardCaches(): void {
  policyCache.clear();
  predictiveSettingsCache.clear();
  riskTemplateCache.clear();
}

// Active org risk templates, served from the short-TTL cache (same pattern as
// loadOrgPolicies — guard is the hot path, templates change rarely).
// Best-effort: a template-load failure must never block guard.
async function loadOrgRiskTemplates(sql: GuardSql, orgId: string): Promise<Array<Record<string, unknown>>> {
  const hit = riskTemplateCache.get(orgId);
  if (hit && hit.expires > Date.now()) return hit.rows;
  let rows: Array<Record<string, unknown>> = [];
  try {
    rows = await sql`
      SELECT id, name, action_type, base_risk, rules, status
      FROM risk_templates
      WHERE org_id = ${orgId} AND status = 'active'
    `;
  } catch (err) {
    console.warn('[Guard] risk_templates load failed (continuing without templates):', (err as Error).message);
  }
  riskTemplateCache.set(orgId, { rows, expires: Date.now() + GUARD_CACHE_TTL_MS });
  return rows;
}

// Active org policies, served from the short-TTL cache (one DB round-trip per
// org per TTL window instead of one per governed call).
async function loadOrgPolicies(sql: GuardSql, orgId: string): Promise<PolicyRow[]> {
  const hit = policyCache.get(orgId);
  if (hit && hit.expires > Date.now()) return hit.rows;
  const allPolicies = await sql`
    SELECT id, name, policy_type, rules, agent_ids
    FROM guard_policies
    WHERE org_id = ${orgId} AND active = 1
  ` as PolicyRow[];
  policyCache.set(orgId, { rows: allPolicies, expires: Date.now() + GUARD_CACHE_TTL_MS });
  return allPolicies;
}

// Load active org policies and filter to those that apply to this agent
// (null/empty agent_ids = all agents; malformed scope fails closed).
async function loadApplicablePolicies(sql: GuardSql, orgId: string, currentAgentId: string | null): Promise<PolicyRow[]> {
  const allPolicies = await loadOrgPolicies(sql, orgId);
  return (allPolicies as PolicyRow[]).filter((p) => {
    if (!p.agent_ids) return true; // null/empty = applies to all
    try {
      const scoped = JSON.parse(p.agent_ids);
      if (!Array.isArray(scoped) || scoped.length === 0) return true;
      return Boolean(currentAgentId && scoped.includes(currentAgentId));
    } catch (parseErr) {
      // Fail closed on malformed scope data: skip the policy rather than silently
      // widening a targeted rule to govern every agent in the org.
      console.error('[GUARD] Skipping policy with malformed agent_ids:', p.id, (parseErr as Error).message);
      return false;
    }
  });
}

// Predictive-risk org settings, served from the short-TTL cache so the
// settings table is read at most once per org per TTL window.
// The org kill switch rides this same cache entry (hot-path discipline: one
// settings read per org per TTL window, shared by predictive risk and halt).
function parseHaltSetting(value: unknown): OrgHaltState | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as OrgHaltState) : null;
  } catch {
    return null;
  }
}

async function getPredictiveSettings(sql: GuardSql, orgId: string): Promise<{ enabled: boolean; threshold: number; halt: OrgHaltState | null }> {
  const hit = predictiveSettingsCache.get(orgId);
  if (hit && hit.expires > Date.now()) return hit;
  const { getSettings } = await import('./repositories/settings.repository');
  const riskSettings = await getSettings(sql, orgId, { category: 'general' });
  const settingsList = riskSettings as Array<Record<string, unknown>>;
  const entry = {
    enabled: settingsList.find((s) => s.key === 'PREDICTIVE_RISK_ENABLED')?.value === 'true',
    threshold: parseInt(String(settingsList.find((s) => s.key === 'PREDICTIVE_RISK_THRESHOLD')?.value ?? ''), 10) || 60,
    halt: parseHaltSetting(settingsList.find((s) => s.key === 'DASHCLAW_ORG_HALT')?.value),
    expires: Date.now() + GUARD_CACHE_TTL_MS,
  };
  predictiveSettingsCache.set(orgId, entry);
  return entry;
}

// Post-LLM phases (local_policies, grants, persist) need headroom inside the
// evaluation deadline; the LLM amplifier only gets what's left minus this.
const LLM_SAFETY_MARGIN_MS = 600;

// Predictive risk scoring — statistical analysis of historical behavior.
// Best-effort: never block guard on failure. Skipped entirely (no settings
// re-read, no historical-stats query) when PREDICTIVE_RISK_ENABLED is off.
// serverEvidenceScore is max(server_total, template) — the client-reported
// term is deliberately excluded from the LLM trigger (see getPredictiveRisk).
// remainingBudgetMs bounds the LLM amplifier: the measured 1.2–3s call was
// the dominant cause of deadline degradations (v2.1 diagnosis).
async function computePredictiveRisk(
  sql: GuardSql,
  orgId: string,
  context: GuardEvalContext,
  serverEvidenceScore: number,
  remainingBudgetMs: number,
): Promise<{ total_adjustment?: number } | null> {
  try {
    const { enabled, threshold } = await getPredictiveSettings(sql, orgId);
    if (!enabled) return null;

    if (context.agent_id && context.action_type) {
      const { getPredictiveRisk } = await import('./predictive-risk');
      return await getPredictiveRisk(
        sql, orgId, context.agent_id, context.action_type, serverEvidenceScore,
        { enabled, threshold, llmBudgetMs: Math.max(0, remainingBudgetMs - LLM_SAFETY_MARGIN_MS) },
      );
    }
    return null;
  } catch (e) {
    console.warn('[Guard] Predictive risk failed:', (e as Error).message);
    return null;
  }
}

// Shared per-evaluation dependencies threaded through the guard phases.
interface GuardPhaseDeps {
  context: GuardEvalContext;
  sql: GuardSql;
  orgId: string;
}

async function runLocalPolicies(
  policies: PolicyRow[],
  deps: GuardPhaseDeps,
  adjustedRiskScore: number,
  acc: GuardAccumulator,
): Promise<void> {
  const { context, sql, orgId } = deps;
  for (const policy of policies) {
    let rules: PolicyRules;
    try {
      rules = JSON.parse(policy.rules);
    } catch {
      continue; // skip malformed
    }

    const result = await evaluatePolicy(policy, rules, context, sql, orgId, adjustedRiskScore);
    if (!result) continue;
    applyResult(result, policy, acc);
    if (result.nonFabrication) {
      acc.nonFabEvidence.push(result.nonFabrication);
      for (const p of result.stripPaths || []) acc.nonFabStripPaths.add(p);
    }
    raiseDecision(acc, result.action);
  }
}

/**
 * allow_grant post-pass: a matching grant downgrades warn / require_approval
 * to allow. It can NEVER override block — blocks are absolute.
 */
function applyAllowGrants(policies: PolicyRow[], context: GuardEvalContext, acc: GuardAccumulator): void {
  if (acc.highestDecision !== 'warn' && acc.highestDecision !== 'require_approval') return;
  for (const policy of policies) {
    if (policy.policy_type !== 'allow_grant') continue;
    let rules: PolicyRules;
    try {
      rules = JSON.parse(policy.rules);
    } catch {
      continue;
    }
    if (grantMatches(rules as { action_type?: unknown; target_prefix?: unknown }, context)) {
      acc.warnings.push(`${policy.name}: grant downgraded ${acc.highestDecision} to allow`);
      acc.matchedPolicies.push(policy.id);
      acc.highestDecision = 'allow';
      acc.reasons.length = 0; // gating reasons no longer apply
      return;
    }
  }
}

// How long a HITL approval covers a re-evaluation of the same action. Short on
// purpose: it absorbs the "operator approved after the hook's wait timed out,
// agent retries the identical call" loop, not standing permission.
const OPERATOR_APPROVAL_WINDOW_MINUTES = 15;

/**
 * Operator-approval post-pass: a recent HITL approval for the same agent and
 * the exact same declared_goal downgrades require_approval to allow.
 *
 * Why: the hook's approval wait times out (~30s) long before most operators
 * click approve. The retried tool call is a NEW evaluation with a new
 * idempotency key, so without this pass it re-queues for approval and the
 * granted approval is never honored. `approved_by` is only ever set by the
 * admin-gated approvals routes, and only on ALLOW (deny leaves it NULL), so
 * its presence IS the grant.
 *
 * Like allow_grant, this can NEVER override block — blocks are absolute.
 * Best-effort: a lookup failure leaves the decision at require_approval
 * (fails closed).
 */
async function applyOperatorApprovalGrant(deps: GuardPhaseDeps, acc: GuardAccumulator): Promise<void> {
  if (acc.highestDecision !== 'require_approval') return;
  const { context, sql, orgId } = deps;
  if (!context.agent_id || !context.declared_goal) return;
  try {
    const rows = await sql`
      SELECT action_id, approved_by
      FROM action_records
      WHERE org_id = ${orgId}
        AND agent_id = ${context.agent_id}
        AND declared_goal = ${context.declared_goal}
        AND approved_by IS NOT NULL
        AND approved_at > NOW() - make_interval(mins => ${OPERATOR_APPROVAL_WINDOW_MINUTES})
      ORDER BY approved_at DESC
      LIMIT 1
    `;
    const grant = rows[0];
    if (!grant) return;
    acc.warnings.push(
      `Covered by operator approval ${grant.action_id} (approved by ${grant.approved_by}) — require_approval downgraded to allow`
    );
    acc.matchedPolicies.push('builtin:operator_approval');
    acc.highestDecision = 'allow';
    acc.reasons.length = 0; // gating reasons no longer apply
  } catch (err) {
    console.warn('[Guard] operator-approval lookup failed:', (err as Error).message);
  }
}

// Default-on prompt injection scanning (opt-out via DISABLE_PROMPT_INJECTION_SCAN=true).
function scanPromptInjection(context: GuardEvalContext, acc: GuardAccumulator): void {
  if (process.env.DISABLE_PROMPT_INJECTION_SCAN === 'true') {
    acc.shields.prompt_injection = 'disabled';
    return;
  }
  acc.shields.prompt_injection = 'clean';
  const textFields = [context.declared_goal, context.action_type].filter(Boolean) as string[];
  for (const text of textFields) {
    const scan = scanForPromptInjection(text);
    if (scan.clean) continue;
    const reason = `Prompt injection detected (${scan.risk_level}): ${scan.categories.join(', ')}`;
    if (scan.recommendation === 'block') {
      acc.reasons.push(reason);
      acc.matchedPolicies.push('builtin:prompt_injection_scan');
      raiseDecision(acc, 'block');
      acc.shields.prompt_injection = 'blocked';
    } else if (scan.recommendation === 'warn') {
      acc.warnings.push(reason);
      if (acc.shields.prompt_injection !== 'blocked') acc.shields.prompt_injection = 'warned';
    }
  }
}

// Process webhook_check policies after local policies, so the preliminary
// decision (a snapshot of acc at this point) is known to the customer endpoint.
async function runWebhookPolicies(
  policies: PolicyRow[],
  deps: GuardPhaseDeps,
  acc: GuardAccumulator,
): Promise<void> {
  const { context, sql, orgId } = deps;
  const webhookPolicies = policies.filter((p) => p.policy_type === 'webhook_check');
  const preliminary: Preliminary = {
    decision: acc.highestDecision,
    reasons: [...acc.reasons],
    warnings: [...acc.warnings],
    matchedPolicies: [...acc.matchedPolicies],
  };
  for (const policy of webhookPolicies) {
    let rules: PolicyRules;
    try { rules = JSON.parse(policy.rules); } catch { continue; }

    const webhookResult = await evaluateWebhookPolicy(policy, rules, context, orgId, sql, preliminary);
    if (!webhookResult) continue;
    applyResult(webhookResult, policy, acc);
    raiseDecision(acc, webhookResult.action);
  }
}

async function runSignalChecks(
  deps: GuardPhaseDeps,
  options: GuardOptions,
  acc: GuardAccumulator,
): Promise<void> {
  if (!options.includeSignals || !options.computeSignals) return;
  const { context, sql, orgId } = deps;
  try {
    const signals = await options.computeSignals(orgId, context.agent_id || null, sql);
    for (const signal of signals) {
      acc.warnings.push(`Active signal: ${signal.type} — ${signal.label}`);
    }
  } catch {
    // Signal check is best-effort
  }
}

// SECURITY: do not store raw secrets in guard decision context.
function redactContextForLog(context: GuardEvalContext, nonFabStripPaths: Set<string>): unknown {
  const dlpFindings: unknown[] = [];
  const safeContextForLog = redactAny(context, dlpFindings);
  if (dlpFindings.length > 0) {
    console.warn(`[Guard] Redacted ${dlpFindings.length} sensitive pattern(s) from guard_decisions.context before storing.`);
  }
  for (const p of nonFabStripPaths) redactByPath(safeContextForLog, p, '[redacted:non_fabrication_input]');
  return safeContextForLog;
}

interface GuardDecisionInsert {
  decisionId: string;
  orgId: string;
  agentId: string | null;
  agentName: string | null;
  verificationStatus: string;
  replayStatus: string;
  jti: string | null;
  actStatus: string;
  actHash: string | null;
  decision: string;
  reason: string | null;
  matchedPolicies: string[];
  context: unknown;
  evidence: string | null;
  riskScore: number;
  actionType: string | null;
  createdAt: string;
  degraded: boolean;
}

// SECURITY (R2): the guard_decisions row IS the audit evidence — losing it means
// the platform cannot prove what it decided. Await it and fail loudly.
async function persistGuardDecision(sql: GuardSql, row: GuardDecisionInsert): Promise<void> {
  try {
    await sql`
      INSERT INTO guard_decisions (id, org_id, agent_id, agent_name, verification_status, replay_status, jti, act_status, act_hash, decision, reason, matched_policies, context, evidence, risk_score, action_type, created_at, degraded)
      VALUES (
        ${row.decisionId},
        ${row.orgId},
        ${row.agentId},
        ${row.agentName},
        ${row.verificationStatus},
        ${row.replayStatus},
        ${row.jti},
        ${row.actStatus},
        ${row.actHash},
        ${row.decision},
        ${row.reason},
        ${JSON.stringify(row.matchedPolicies)},
        ${JSON.stringify(row.context)},
        ${row.evidence},
        ${row.riskScore},
        ${row.actionType},
        ${row.createdAt},
        ${row.degraded}
      )
    `;
  } catch (err) {
    console.error('[Guard] CRITICAL: failed to persist required guard_decisions audit row:', (err as Error)?.message || err);
    throw Object.assign(
      new Error('Guard decision could not be durably recorded; refusing to return an unaudited decision.'),
      { code: 'GUARD_AUDIT_PERSIST_FAILED' },
    );
  }
}

// Recovery recipe evaluation — best-effort enrichment for non-allow decisions.
function buildRecovery(context: GuardEvalContext, reasons: string[], highestDecision: string): unknown {
  try {
    if (highestDecision === 'allow') return null;
    const recentSignals: Array<{ type: string; severity: string; agent_id?: string | null }> = [];
    if (context.intel?.branch?.freshness === 'stale') {
      recentSignals.push({ type: 'branch_stale', severity: 'amber', agent_id: context.agent_id });
    }
    if (context.intel?.mcp?.healthy === false) {
      recentSignals.push({ type: 'mcp_degraded', severity: 'amber', agent_id: context.agent_id });
    }
    if (reasons.some((r) => r.includes('Green contract'))) {
      recentSignals.push({ type: 'green_insufficient', severity: 'red', agent_id: context.agent_id });
    }
    const recipes = evaluateRecoveryRecipes(recentSignals as Array<{ type: string; severity: string; agent_id: string }>);
    return recipes.length > 0 ? recipes[0] : null;
  } catch {
    return null; // recovery is best-effort
  }
}

/**
 * Evaluate guard policies for an incoming agent action.
 */
interface AuditStatuses {
  verificationStatus: string;
  replayStatus: string;
  jti: string | null;
  actStatus: string;
  actHash: string | null;
}

function resolveAuditStatuses(context: GuardEvalContext): AuditStatuses {
  return {
    verificationStatus: context.verification_status || 'unverified',
    replayStatus: context.replay_status || 'not_applicable',
    jti: context.jti || null,
    actStatus: context.act_status || 'not_applicable',
    actHash: context.act_hash || null,
  };
}

// Compute authoritative server-side risk; use the higher of computed vs
// agent-reported (agents may have internal knowledge).
function computeEffectiveRisk(context: GuardEvalContext): { agentRiskScore: number | null; effectiveRiskScore: number } {
  const authoritativeRiskScore = computeRiskScore(context);
  const agentRiskScore = context.risk_score != null ? Number(context.risk_score) : null;
  const effectiveRiskScore = agentRiskScore != null
    ? Math.max(authoritativeRiskScore, Math.max(0, Math.min(agentRiskScore, 100)))
    : authoritativeRiskScore;
  return { agentRiskScore, effectiveRiskScore };
}

/** Full derivation ledger for one guard evaluation's risk score. */
export interface RiskBreakdown {
  /** Server heuristic: action-type base score. */
  base: { action_type: string; score: number };
  /** Additive server modifiers (irreversible, systems, goal patterns). */
  modifiers: RiskFactor[];
  /** Server heuristic total (base + modifiers, clamped 0-100). */
  server_total: number;
  /** Org risk-template layer (null when no active template matches). */
  template: { id: string; name: string; score: number } | null;
  /** Agent-reported risk_score from the request (null when absent). */
  client_reported: number | null;
  /** max(server_total, template.score, client_reported) — pre-predictive. */
  effective: number;
  /**
   * Predictive history adjustment (null when disabled/unavailable).
   * `adjustment` is the applied total; `statistical_adjustment` + `llm` split
   * it so forensics never have to infer the LLM term by subtraction.
   */
  predictive: {
    adjustment: number;
    basis?: string;
    failure_rate?: number;
    total_actions?: number;
    velocity?: number;
    statistical_adjustment?: number;
    llm?: { adjustment: number; model: string; reasoning: string } | null;
    /** Why the LLM amplifier didn't run when its trigger fired (v2.1). */
    llm_skipped?: string;
  } | null;
  /** The persisted guard_decisions.risk_score (effective + predictive, clamped). */
  final: number;
}

// Coerce a risk_templates row into computeAutoRisk's template shape (rules is
// jsonb — object from Neon, string from some drivers/tests).
function coerceRiskTemplate(row: Record<string, unknown>): { status: string; action_type: string | null; base_risk: number; rules: Array<{ condition: string; add: number }>; id: string; name: string } {
  let rules: unknown = row.rules;
  if (typeof rules === 'string') {
    try { rules = JSON.parse(rules); } catch { rules = []; }
  }
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    status: String(row.status ?? 'active'),
    action_type: (row.action_type as string | null) ?? null,
    base_risk: Number(row.base_risk) || 0,
    rules: Array.isArray(rules) ? (rules as Array<{ condition: string; add: number }>) : [],
  };
}

// Effective risk including the org risk-template layer (the /scoring "Risk
// Templates" tab — previously a dead wire). Templates can only RAISE the
// effective score (folded via max), so an org with no templates is untouched.
async function computeRiskAssessment(
  sql: GuardSql,
  orgId: string,
  context: GuardEvalContext,
): Promise<{ agentRiskScore: number | null; effectiveRiskScore: number; breakdownBase: Omit<RiskBreakdown, 'predictive' | 'final'> }> {
  const terms = serverRiskTerms(context);
  const { agentRiskScore } = computeEffectiveRisk(context);

  let template: RiskBreakdown['template'] = null;
  try {
    const rows = await loadOrgRiskTemplates(sql, orgId);
    if (rows.length > 0) {
      const templates = rows.map(coerceRiskTemplate);
      const { computeAutoRisk } = await import('./scoringProfiles');
      const score = computeAutoRisk(context as Parameters<typeof computeAutoRisk>[0], templates);
      if (score != null) {
        const matched = templates.find((t) => t.action_type === context.action_type) || templates[0]!;
        template = { id: matched.id, name: matched.name, score };
      }
    }
  } catch (err) {
    console.warn('[Guard] risk-template evaluation failed (continuing without):', (err as Error).message);
  }

  const clientClamped = agentRiskScore != null ? Math.max(0, Math.min(agentRiskScore, 100)) : null;
  const effectiveRiskScore = Math.max(
    terms.total,
    template?.score ?? 0,
    clientClamped ?? 0,
  );

  return {
    agentRiskScore,
    effectiveRiskScore,
    breakdownBase: {
      base: terms.base,
      modifiers: terms.modifiers,
      server_total: terms.total,
      template,
      client_reported: clientClamped,
      effective: effectiveRiskScore,
    },
  };
}

// Everything the persist / event / result builders need, computed once.
interface GuardFinalizeInput {
  decisionId: string;
  orgId: string;
  context: GuardEvalContext;
  acc: GuardAccumulator;
  safeContextForLog: unknown;
  evidenceJson: string | null;
  statuses: AuditStatuses;
  adjustedRiskScore: number;
  agentRiskScore: number | null;
  evaluatedAt: string;
  learningContext: unknown;
  recovery: unknown;
  predictiveRisk: { total_adjustment?: number } | null;
  riskBreakdown: RiskBreakdown;
  timings: Record<string, number> | null;
  degraded: { kind: string; deadline_ms: number; action: string; phase_in_flight: string | null } | null;
}

function buildGuardDecisionRow(input: GuardFinalizeInput): GuardDecisionInsert {
  const { context, acc, statuses } = input;
  return {
    decisionId: input.decisionId,
    orgId: input.orgId,
    agentId: context.agent_id || null,
    agentName: context.agent_name || null,
    verificationStatus: statuses.verificationStatus,
    replayStatus: statuses.replayStatus,
    jti: statuses.jti,
    actStatus: statuses.actStatus,
    actHash: statuses.actHash,
    decision: acc.highestDecision,
    reason: acc.reasons.join('; ') || null,
    matchedPolicies: acc.matchedPolicies,
    // The breakdown + shield outcomes ride inside the persisted context JSON
    // (additive, underscore-prefixed) — no schema migration, queryable via
    // jsonb. _shields is only written when a shield actually ran: absence
    // means "not recorded", never "clean".
    context: {
      ...(input.safeContextForLog as Record<string, unknown>),
      _risk_breakdown: input.riskBreakdown,
      ...(acc.shields.prompt_injection !== null
        ? { _shields: { prompt_injection: acc.shields.prompt_injection } }
        : {}),
      ...(input.timings ? { _timings: input.timings } : {}),
      ...(input.degraded ? { _degraded: input.degraded } : {}),
    },
    evidence: input.evidenceJson,
    riskScore: input.adjustedRiskScore,
    actionType: context.action_type || null,
    createdAt: input.evaluatedAt,
    degraded: input.degraded !== null,
  };
}

function publishGuardDecisionEvent(input: GuardFinalizeInput): void {
  const { context, acc, statuses } = input;
  void publishOrgEvent(EVENTS.GUARD_DECISION_CREATED, {
    orgId: input.orgId,
    decision: {
      id: input.decisionId,
      org_id: input.orgId,
      agent_id: context.agent_id || null,
      agent_name: context.agent_name || null,
      verification_status: statuses.verificationStatus,
      replay_status: statuses.replayStatus,
      jti: statuses.jti,
      act_status: statuses.actStatus,
      act_hash: statuses.actHash,
      decision: acc.highestDecision,
      reason: acc.reasons.join('; ') || null,
      matched_policies: acc.matchedPolicies,
      context: input.safeContextForLog,
      risk_score: input.adjustedRiskScore,
      agent_risk_score: input.agentRiskScore,
      action_type: context.action_type || null,
      created_at: input.evaluatedAt,
      degraded: input.degraded !== null,
    },
  });
}

function buildGuardResult(input: GuardFinalizeInput) {
  const { context, acc, statuses } = input;
  return {
    decision: acc.highestDecision,
    decision_id: input.decisionId, // Canonical: the guard-evaluation id (act_gd_*).
    action_id: input.decisionId, // DEPRECATED alias of decision_id (the evaluation id, NOT action_records id).
    reason: acc.reasons.join('; ') || null,
    signals: [...acc.warnings, ...acc.reasons],
    matched_policies: acc.matchedPolicies,
    ...(acc.nonFabEvidence.length > 0 ? { non_fabrication: acc.nonFabEvidence } : {}),
    risk_score: input.adjustedRiskScore,
    agent_risk_score: input.agentRiskScore,
    risk_breakdown: input.riskBreakdown,
    verification_status: statuses.verificationStatus,
    agent_id: context.agent_id || null,
    agent_name: context.agent_name || null,
    evaluated_at: input.evaluatedAt,
    learning: input.learningContext || undefined,
    ...(input.recovery ? { recovery: input.recovery } : {}),
    ...(input.predictiveRisk ? { predictive_risk: input.predictiveRisk } : {}),
    ...(input.degraded ? { degraded: true } : {}),
    // Backward compatibility
    reasons: acc.reasons,
    warnings: acc.warnings,
  };
}

export async function evaluateGuard(orgId: string, context: GuardEvalContext, sql: GuardSql, options: GuardOptions = {}) {
  // SECURITY: orgId is the tenant boundary. Without this guard a caller bug
  // that loses orgId (null/undefined/'') would cause Postgres to evaluate
  // `WHERE org_id = NULL AND ...` which silently returns zero rows — guard
  // would then approve every action because no policies matched.
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('evaluateGuard: orgId is required and must be a string');
  }

  // Replay + action-binding pre-checks (decided at the audit boundary).
  const replayBlockReason = computeReplayBlockReason(context, orgId);
  const actBlockReason = computeActBindingBlockReason(context, orgId);

  // Org kill switch — checked FIRST. The read rides the same 30s-TTL cached
  // settings entry the predictive layer uses (no extra hot-path query); the
  // /api/halt endpoint calls invalidateGuardSettingsCache so a flipped switch
  // takes effect immediately, not after the TTL. A halted org evaluates no
  // policies: the decision is an immediate block, still persisted through the
  // audit gate below like any other decision.
  const orgHalt = (await getPredictiveSettings(sql, orgId)).halt;
  const orgHalted = !!orgHalt?.halted;

  const liveAcc = newAccumulator();

  // Per-phase wall-clock ledger (ms), persisted as context._timings on every
  // decision so degraded evaluations can be diagnosed against a steady-state
  // baseline. Mutated by the (possibly abandoned) evaluation — snapshot on
  // deadline, like the accumulator.
  const liveTimings: Record<string, number> = {};
  let phaseInFlight: string | null = null;
  const timed = async <T>(phase: string, fn: () => T | Promise<T>): Promise<T> => {
    phaseInFlight = phase;
    const start = Date.now();
    try {
      return await fn();
    } finally {
      liveTimings[phase] = (liveTimings[phase] ?? 0) + (Date.now() - start);
      phaseInFlight = null;
    }
  };

  // Defaults available even when the deadline fires before the async risk
  // assessment completes: the cheap synchronous server heuristic.
  const syncTerms = serverRiskTerms(context);
  const { agentRiskScore: syncAgentRisk } = computeEffectiveRisk(context);
  let agentRiskScore: number | null = syncAgentRisk;
  let adjustedRiskScore = syncTerms.total;
  let predictiveRisk:
    | {
        total_adjustment?: number;
        statistical?: { adjustment?: number; basis?: string; failure_rate?: number; total_actions?: number; velocity?: number } | null;
        llm?: { adjustment: number; model: string; reasoning: string } | null;
        llm_skipped?: string;
      }
    | null = null;
  let riskBreakdown: RiskBreakdown = {
    base: syncTerms.base,
    modifiers: syncTerms.modifiers,
    server_total: syncTerms.total,
    template: null,
    client_reported: null,
    effective: syncTerms.total,
    predictive: null,
    final: syncTerms.total,
  };

  // Policy evaluation is bounded by a deadline (DASHCLAW_GUARD_DEADLINE_MS,
  // default 3500ms): the hook's whole HTTP budget is 5s with zero retries, so
  // an overrunning webhook/LLM/DB phase must yield a degraded decision instead
  // of bricking the hook into its timeout. The webhook caller has no
  // AbortSignal support, so the race abandons (not cancels) the slow phase.
  const deadlineMs = guardDeadlineMs();
  const evalStart = Date.now();
  const runEvaluation = async (): Promise<'completed'> => {
    const policies = await timed('policies', () => loadApplicablePolicies(sql, orgId, context.agent_id || null));

    const riskAssessment = await timed('risk', () => computeRiskAssessment(sql, orgId, context));
    agentRiskScore = riskAssessment.agentRiskScore;
    const serverEvidenceScore = Math.max(
      riskAssessment.breakdownBase.server_total,
      riskAssessment.breakdownBase.template?.score ?? 0,
    );
    predictiveRisk = await timed('predictive', () =>
      computePredictiveRisk(sql, orgId, context, serverEvidenceScore, deadlineMs - (Date.now() - evalStart)),
    ) as typeof predictiveRisk;
    const predictiveAdjustment = predictiveRisk?.total_adjustment ?? 0;
    adjustedRiskScore = Math.round(Math.max(0, Math.min(riskAssessment.effectiveRiskScore + predictiveAdjustment, 100)));

    // Full derivation ledger — returned with the result and persisted with the
    // decision so every score is provable after the fact.
    riskBreakdown = {
      ...riskAssessment.breakdownBase,
      predictive: predictiveRisk
        ? {
            adjustment: predictiveAdjustment,
            basis: predictiveRisk.statistical?.basis,
            failure_rate: predictiveRisk.statistical?.failure_rate,
            total_actions: predictiveRisk.statistical?.total_actions,
            velocity: predictiveRisk.statistical?.velocity,
            statistical_adjustment: predictiveRisk.statistical?.adjustment,
            llm: predictiveRisk.llm ?? null,
            ...(predictiveRisk.llm_skipped ? { llm_skipped: predictiveRisk.llm_skipped } : {}),
          }
        : null,
      final: adjustedRiskScore,
    };

    const deps: GuardPhaseDeps = { context, sql, orgId };
    await timed('local_policies', () => runLocalPolicies(policies, deps, adjustedRiskScore, liveAcc));
    scanPromptInjection(context, liveAcc);
    await timed('webhooks', () => runWebhookPolicies(policies, deps, liveAcc));
    // Grants run after the LAST phase where org policies can raise warn /
    // require_approval (webhook_check, above). The later phases can only append
    // warnings (runSignalChecks) or raise to block (replay/act overrides), which
    // grants never touch — so a downgrade decided here is final. The operator-
    // approval pass runs after policy grants: it only fires when the decision
    // is still require_approval.
    applyAllowGrants(policies, context, liveAcc);
    await timed('grants', () => applyOperatorApprovalGrant(deps, liveAcc));
    await timed('signals', () => runSignalChecks(deps, options, liveAcc));
    return 'completed';
  };

  let deadlineExceeded = false;
  if (!orgHalted) {
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadlinePromise = new Promise<'deadline'>((resolve) => {
      deadlineTimer = setTimeout(() => resolve('deadline'), deadlineMs);
    });

    try {
      const evalPromise = runEvaluation();
      const winner = await Promise.race([evalPromise, deadlinePromise]);
      deadlineExceeded = winner === 'deadline';
      if (deadlineExceeded) {
        // The abandoned evaluation keeps running in the background; swallow its
        // eventual rejection so it cannot surface as an unhandled rejection.
        evalPromise.catch((err: unknown) => {
          console.warn('[Guard] abandoned evaluation failed after deadline:', (err as Error)?.message || err);
        });
      }
    } finally {
      clearTimeout(deadlineTimer);
    }
  }

  // Snapshot the timing ledger before the abandoned evaluation can keep
  // mutating it; the in-flight phase is the one the deadline caught.
  const phaseAtDeadline = deadlineExceeded ? phaseInFlight : null;
  const timings: Record<string, number> | null = orgHalted
    ? null
    : { ...liveTimings, total: Date.now() - evalStart };

  // On deadline, snapshot the accumulator: the abandoned evaluation may still
  // be mutating the live one while we finalize and persist.
  const acc: GuardAccumulator = deadlineExceeded
    ? {
        reasons: [...liveAcc.reasons],
        warnings: [...liveAcc.warnings],
        matchedPolicies: [...liveAcc.matchedPolicies],
        nonFabEvidence: [...liveAcc.nonFabEvidence],
        nonFabStripPaths: new Set(liveAcc.nonFabStripPaths),
        highestDecision: liveAcc.highestDecision,
        shields: { ...liveAcc.shields },
      }
    : liveAcc;

  if (orgHalted) {
    // Halt means stop: an immediate block, regardless of policy outcome.
    applyBlockOverride(acc, `Org halted by ${orgHalt?.actor || 'admin'}: ${orgHalt?.reason || 'no reason given'}`);
  }

  let degradedDetail: { kind: string; deadline_ms: number; action: string; phase_in_flight: string | null } | null = null;
  if (deadlineExceeded) {
    const degraded = resolveDegradedAction();
    const note = `Guard evaluation exceeded deadline (${deadlineMs}ms) — degraded decision (${degraded})`;
    // Structured marker persisted with the decision (column + context._degraded)
    // so aggregation never falls back to string-matching the reason — and the
    // fail-open path leaves a trace too, which the reason string never did.
    degradedDetail = { kind: 'deadline', deadline_ms: deadlineMs, action: degraded, phase_in_flight: phaseAtDeadline };
    if (degraded === 'allow') {
      // Explicit fail-open escape hatch: surface the degradation as a warning.
      acc.warnings.push(note);
    } else {
      // Never downgrade a decision already reached from accumulated state.
      raiseDecision(acc, degraded);
      acc.reasons.unshift(note);
    }
    console.warn('[Guard] evaluation deadline exceeded:', { org_id: orgId, agent_id: context.agent_id || null, deadline_ms: deadlineMs, degraded, phase_in_flight: phaseAtDeadline });
  }

  const evaluatedAt = new Date().toISOString();
  const decisionId = `act_gd_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const safeContextForLog = redactContextForLog(context, acc.nonFabStripPaths);
  const evidenceJson = acc.nonFabEvidence.length > 0 ? JSON.stringify(acc.nonFabEvidence) : null;
  const statuses = resolveAuditStatuses(context);

  // Replay/act pre-checks override the policy outcome and prepend their reason.
  applyBlockOverride(acc, replayBlockReason);
  applyBlockOverride(acc, actBlockReason);

  // Learning context — best-effort enrichment. Skipped on a degraded decision:
  // the remaining budget is reserved for the mandatory audit persist.
  const learningContext = deadlineExceeded
    ? null
    : await getLearningContext(sql, orgId, { agentId: context.agent_id, actionType: context.action_type });
  let recovery = buildRecovery(context, acc.reasons, acc.highestDecision);
  if (deadlineExceeded && recovery) {
    // Recovery was computed from partial (pre-deadline) state — mark it so.
    recovery = { ...(recovery as Record<string, unknown>), partial: true, partial_reason: 'evaluation degraded by deadline; recovery computed from accumulated partial state' };
  }

  const input: GuardFinalizeInput = {
    decisionId, orgId, context, acc, safeContextForLog, evidenceJson, statuses,
    adjustedRiskScore, agentRiskScore, evaluatedAt, learningContext, recovery, predictiveRisk,
    riskBreakdown, timings, degraded: degradedDetail,
  };

  await persistGuardDecision(sql, buildGuardDecisionRow(input));
  publishGuardDecisionEvent(input);
  return buildGuardResult(input);
}

// Bundled arguments shared by every per-type policy evaluator.
interface PolicyEvalArgs {
  policy: PolicyRow;
  rules: PolicyRules;
  context: GuardEvalContext;
  sql: GuardSql;
  orgId: string;
  effectiveRiskScore: number;
}

type PolicyEvaluator = (args: PolicyEvalArgs) => PolicyResult | null | Promise<PolicyResult | null>;

// require_approval / block_action_type share action_type matching; only the
// decision and reason wording differ.
function matchActionType(
  rules: PolicyRules,
  context: GuardEvalContext,
  action: string,
  reason: (type: string) => string,
): PolicyResult | null {
  const actionTypes = rules.action_types || [];
  if (context.action_type === undefined || !actionTypes.includes(context.action_type)) {
    return null;
  }
  // Optional narrowing: a rule born from a targeted shape (review-feed
  // "tighten") only fires when the action's target matches the prefix —
  // without this, a narrow tighten gates the whole action_type org-wide.
  if (typeof rules.target_prefix === 'string' && rules.target_prefix &&
      !targetPrefixMatches(rules.target_prefix, context)) {
    return null;
  }
  return { action, reason: reason(context.action_type) };
}

// ── non_fabrication evaluation (decomposed) ──

function nonFabAppliesTo(rules: PolicyRules, context: GuardEvalContext): boolean {
  const actionTypes = Array.isArray(rules.action_types) ? rules.action_types : null;
  if (!actionTypes || actionTypes.length === 0) return true;
  return context.action_type !== undefined && actionTypes.includes(context.action_type);
}

function nonFabConfig(rules: PolicyRules) {
  const contentPath = (typeof rules.content_path === 'string' && rules.content_path) || 'content';
  const sourcePath = (typeof rules.source_path === 'string' && rules.source_path) || 'source_of_truth';
  const onViolation = rules.on_violation === 'require_approval' ? 'require_approval' : 'block';
  return { contentPath, sourcePath, onViolation, stripPaths: [contentPath, sourcePath] };
}

function isValidSourceOfTruth(source: unknown): boolean {
  const s = source as { allowedFacts?: unknown; requiredFacts?: unknown } | null;
  return Boolean(
    s && typeof s === 'object' && !Array.isArray(s) &&
    Array.isArray(s.allowedFacts) && Array.isArray(s.requiredFacts),
  );
}

async function signNonFabReceipt(
  sql: GuardSql,
  content: string,
  source: unknown,
  verifyResult: { verdict: string; violations: unknown[] },
): Promise<unknown> {
  try {
    const key = await getServerSigningKey(sql);
    return issueReceipt(
      // verifyResult's violations carry { code, label } at runtime — the loose
      // `unknown[]` here is wider than ReceiptViolation[].
      verifyResult as Parameters<typeof issueReceipt>[0],
      content,
      // Only ever called after sourceValid confirms the SourceOfTruthLike shape.
      source as Parameters<typeof issueReceipt>[2],
      { kid: key.kid, privateKeyJwk: key.privateKeyJwk },
      new Date().toISOString(),
    );
  } catch (e) {
    console.warn('[Guard] non_fabrication receipt signing failed (verdict still enforced):', (e as Error).message);
    return null;
  }
}

function summarizeViolations(violations: Array<{ detail?: string; label: string; code: string }>): string {
  return violations
    .map((v) => (v.detail ? `${v.label}: ${v.detail}` : v.code === 'missing_required' ? `missing ${v.label}` : v.label))
    .slice(0, 5)
    .join(', ');
}

// Shared inputs for the two non_fabrication result builders.
interface NonFabCtx {
  policy: PolicyRow;
  content: unknown;
  source: unknown;
  stripPaths: string[];
  sql: GuardSql;
}

async function nonFabFailClosed({ policy, content, source, stripPaths, sql }: NonFabCtx, sourceValid: boolean): Promise<PolicyResult> {
  const violations = [
    sourceValid ? { code: 'invalid_content', label: 'content' } : { code: 'missing_source', label: 'source_of_truth' },
  ];
  const receipt = sourceValid && typeof content === 'string'
    ? await signNonFabReceipt(sql, content, source, { verdict: 'block', violations })
    : null;
  return {
    action: 'block',
    reason: sourceValid
      ? 'Non-fabrication: content is not verifiable text (fail-closed)'
      : 'Non-fabrication: source-of-truth missing or malformed (fail-closed)',
    nonFabrication: { policy_id: policy.id, verdict: 'block', violations, receipt },
    stripPaths,
  };
}

async function nonFabVerifiedResult({ policy, content, source, stripPaths, sql }: NonFabCtx, onViolation: string): Promise<PolicyResult> {
  // `content` is a string and `source` the validated SourceOfTruth shape (checked by the caller).
  const verifyResult = verify(content as string, source as unknown as SourceOfTruth);
  const receipt = await signNonFabReceipt(sql, content as string, source, verifyResult);

  if (verifyResult.verdict === 'pass') {
    return {
      action: 'allow',
      reason: 'Non-fabrication: pass',
      nonFabrication: { policy_id: policy.id, verdict: 'pass', violations: [], receipt },
      stripPaths,
    };
  }

  const summary = summarizeViolations(verifyResult.violations);
  return {
    action: onViolation,
    reason: `Non-fabrication: ${verifyResult.violations[0]?.code} (${summary})`,
    nonFabrication: { policy_id: policy.id, verdict: 'block', violations: verifyResult.violations, receipt },
    stripPaths,
  };
}

async function evaluateNonFabricationPolicy({ policy, rules, context, sql }: PolicyEvalArgs): Promise<PolicyResult | null> {
  if (!nonFabAppliesTo(rules, context)) return null;

  const { contentPath, sourcePath, onViolation, stripPaths } = nonFabConfig(rules);
  const content = getByPath(context, contentPath);
  if (content == null || content === '') return null;

  const source = getByPath(context, sourcePath);
  const sourceValid = isValidSourceOfTruth(source);
  const ctx: NonFabCtx = { policy, content, source, stripPaths, sql };

  if (typeof content !== 'string' || !sourceValid) {
    return nonFabFailClosed(ctx, sourceValid);
  }
  return nonFabVerifiedResult(ctx, onViolation);
}

// ── behavioral_anomaly evaluation (decomposed) ──

async function countAgentEmbeddings(sql: GuardSql, orgId: string, agentId: string): Promise<number | null> {
  try {
    const countRows = await sql`
      SELECT COUNT(*)::int AS count
      FROM action_embeddings
      WHERE org_id = ${orgId} AND agent_id = ${agentId}
    `;
    return (countRows[0]?.count as number | undefined) ?? 0;
  } catch (err) {
    const msg = (err as Error)?.message;
    if (msg?.includes('does not exist') || msg?.includes('vector')) {
      console.warn('[Guard] action_embeddings missing or pgvector unavailable. Skipping anomaly detection.');
      return null;
    }
    throw err;
  }
}

async function maxEmbeddingSimilarity(sql: GuardSql, embedding: unknown, orgId: string, agentId: string): Promise<number | null> {
  const similarityQuery = `
    SELECT 1 - (embedding <=> $1::vector) as similarity
    FROM action_embeddings
    WHERE org_id = $2 AND agent_id = $3
    ORDER BY similarity DESC
    LIMIT 1
  `;
  try {
    const rows = await sql.query(similarityQuery, [JSON.stringify(embedding), orgId, agentId]);
    if (rows.length === 0) return null;
    return Number(rows[0]?.similarity);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg?.includes('vector') || msg?.includes('does not exist')) {
      console.warn('[Guard] pgvector not enabled or table missing. Skipping anomaly detection.');
      return null;
    }
    throw err;
  }
}

async function hasEnoughEmbeddingHistory(sql: GuardSql, orgId: string, agentId: string, minHistory: number): Promise<boolean> {
  const historyCount = await countAgentEmbeddings(sql, orgId, agentId);
  return historyCount !== null && historyCount >= minHistory;
}

async function evaluateBehavioralAnomalyPolicy({ rules, context, sql, orgId }: PolicyEvalArgs): Promise<PolicyResult | null> {
  if (!isEmbeddingsEnabled()) {
    console.warn('[Guard] behavioral_anomaly policy skipped: No OpenAI API Key configured.');
    return null;
  }
  const threshold = rules.similarity_threshold ?? 0.75;
  const agentId = context.agent_id;
  if (!agentId) return null;
  if (!(await hasEnoughEmbeddingHistory(sql, orgId, agentId, rules.min_history ?? 5))) return null;

  // GuardEvalContext's loosely-typed fields (systems_touched: unknown) are read
  // defensively inside generateActionEmbedding; runtime shape is compatible.
  const embedding = await generateActionEmbedding(context as Parameters<typeof generateActionEmbedding>[0]);
  if (!embedding) return null;

  const maxSimilarity = await maxEmbeddingSimilarity(sql, embedding, orgId, agentId);
  if (maxSimilarity !== null && maxSimilarity < threshold) {
    return {
      action: rules.action || 'require_approval',
      reason: `Behavioral Anomaly: Action similarity (${(maxSimilarity * 100).toFixed(1)}%) is below the safety threshold (${(threshold * 100).toFixed(0)}%).`,
    };
  }
  return null;
}

// ── semantic_check evaluation ──

// Result when the semantic check itself could not run (LLM returned nothing).
function semanticFallbackResult(fallback: string): PolicyResult | null {
  if (fallback === 'block') return { action: 'block', reason: 'Semantic check failed (fallback: block)' };
  if (fallback === 'require_approval') return { action: 'require_approval', reason: 'Semantic check failed (fallback: require_approval)' };
  return null; // fallback === 'allow' — pass-through
}

const hasGuardLlmKey = (): boolean => !!(process.env.GUARD_LLM_KEY || process.env.OPENAI_API_KEY);

async function evaluateSemanticCheckPolicy({ context, rules }: PolicyEvalArgs): Promise<PolicyResult | null> {
  const instruction = rules.instruction;
  if (!instruction) return null;

  // Degradation contract: per-policy fallback → DASHCLAW_GUARD_FALLBACK →
  // fail-closed default (require_approval). 'allow' is the explicit escape hatch.
  const fallback = resolveDegradedAction(rules.fallback);
  const model = rules.model || 'gpt-4o-mini';

  if (!hasGuardLlmKey()) {
    console.warn('[Guard] semantic_check policy skipped: No GUARD_LLM_KEY or OPENAI_API_KEY configured. Requiring approval as safe fallback.');
    return { action: 'require_approval', reason: 'Semantic check unavailable (no LLM key configured) — human review required' };
  }

  // checkSemanticGuardrail returns the parsed LLM JSON ({ allowed, reason }) or null.
  const result = (await checkSemanticGuardrail(context, instruction, model)) as { allowed?: boolean; reason?: string } | null;

  if (!result) return semanticFallbackResult(fallback);
  if (result.allowed === false) return { action: 'block', reason: `Semantic Violation: ${result.reason}` };
  return null;
}

// ── permission_escalation evaluation ──

const PERM_RANK: Record<string, number> = { readonly: 0, workspace_write: 1, danger: 2, prompt: 3, allow: 4 };

async function evaluatePermissionEscalationPolicy({ rules, context, sql, orgId }: PolicyEvalArgs): Promise<PolicyResult | null> {
  if (!rules.enforce) return null;
  const toolPerm = context.intel?.tool?.required_permission ?? context.tool?.required_permission;
  if (!toolPerm) return null;
  const pairingBaseId = baseAgentId(context.agent_id) || context.agent_id;
  const [pairing] = await sql`
    SELECT permission_level FROM agent_pairings
    WHERE org_id = ${orgId} AND agent_id IN (${context.agent_id}, ${pairingBaseId}) AND status = 'approved'
    ORDER BY (agent_id = ${context.agent_id}) DESC, created_at DESC LIMIT 1
  `;
  const agentLevel = (pairing?.permission_level as string | undefined) || 'danger';
  if (rankOf(PERM_RANK, toolPerm, 0) > rankOf(PERM_RANK, agentLevel, 0)) {
    return { action: rules.action || 'block', reason: `Permission escalation: agent has ${agentLevel}, tool requires ${toolPerm}` };
  }
  return null;
}

// ── x402_spend_limit evaluation ──

const GREEN_RANK: Record<string, number> = { targeted: 0, package: 1, workspace: 2, merge_ready: 3 };

const asArr = (v: unknown): string[] => (Array.isArray(v) ? v : []);

function resolveX402Provider(context: GuardEvalContext): { provider: string; providerId: string | null } {
  return { provider: context.provider || context.vendor || 'unknown', providerId: context.provider_id || null };
}

function x402Spend(context: GuardEvalContext): number {
  return Number(context.cost_estimate ?? context.cost ?? 0) || 0;
}

function x402ProviderDecision(rules: PolicyRules, provider: string, providerId: string | null): PolicyResult | null {
  const inList = (list: string[]): boolean => list.includes(provider) || (providerId != null && list.includes(providerId));
  if (inList(asArr(rules.blocked_providers))) return { action: 'block', reason: `Provider "${provider}" is blocked by policy` };
  const allowed = asArr(rules.allowed_providers);
  if (allowed.length > 0 && !inList(allowed)) return { action: 'block', reason: `Provider "${provider}" not in approved list` };
  return null;
}

function x402SpendDecision(rules: PolicyRules, spend: number): PolicyResult | null {
  const maxSpend = rules.max_spend_usd ?? Infinity;
  const approvalThreshold = rules.approval_threshold ?? Infinity;
  if (spend > maxSpend) return { action: 'block', reason: `Spend $${spend.toFixed(4)} exceeds max $${maxSpend}` };
  if (spend >= approvalThreshold) return { action: 'require_approval', reason: `Spend $${spend.toFixed(4)} >= approval threshold $${approvalThreshold}` };
  return null;
}

const moreSevereResult = (a: PolicyResult | null, b: PolicyResult | null): PolicyResult | null => {
  if (!a) return b;
  if (!b) return a;
  return sevOf(b.action) > sevOf(a.action) ? b : a;
};

/**
 * Cumulative budget tier: window spend sum + the incoming amount vs
 * budget_approval_threshold (>= require_approval) / budget_usd (> block),
 * mirroring the per-purchase pair's operators. Runs ONLY when a budget field
 * is present, so per-purchase-only policies gain zero DB queries.
 */
function x402BudgetWindow(rules: PolicyRules): { windowDays: number; scope: 'org' | 'agent' } {
  return {
    windowDays: Math.max(1, Math.min(365, parseInt(String(rules.budget_window_days), 10) || 30)),
    scope: rules.budget_scope === 'agent' ? 'agent' : 'org',
  };
}

async function x402BudgetDecision(rules: PolicyRules, context: GuardEvalContext, sql: GuardSql, orgId: string, spend: number): Promise<PolicyResult | null> {
  const budgetMax = rules.budget_usd ?? Infinity;
  const budgetApproval = rules.budget_approval_threshold ?? Infinity;
  if (budgetMax === Infinity && budgetApproval === Infinity) return null;

  const { windowDays, scope } = x402BudgetWindow(rules);
  const agentId = typeof context.agent_id === 'string' && context.agent_id ? context.agent_id : null;

  // Fail closed on unattributable spend: skipping (the rate_limit convention)
  // would make "omit agent_id" a budget bypass — tolerable for rate limiting,
  // not for money.
  if (scope === 'agent' && !agentId) {
    return { action: 'require_approval', reason: 'Agent-scoped x402 budget cannot attribute this purchase (no agent_id)' };
  }

  let windowSpend: number;
  try {
    const { sumWindowSpend } = await import('./repositories/x402.repository');
    const sinceIso = new Date(Date.now() - windowDays * 86400000).toISOString();
    windowSpend = await sumWindowSpend(sql, orgId, { sinceIso, agentId: scope === 'agent' ? agentId : null });
  } catch (err) {
    // Degradation contract: per-policy on_failure → DASHCLAW_GUARD_FALLBACK →
    // fail-closed default (require_approval). 'allow' is the explicit escape hatch.
    const degraded = resolveDegradedAction(rules.on_failure);
    console.warn('[Guard] x402 budget sum failed:', { org_id: orgId, agent_id: agentId, degraded, error: (err as Error)?.message || err });
    if (degraded === 'allow') {
      // Pass through, but leave the skipped check visible in the decision
      // ledger (not just the server log) — parity with the deadline path.
      const note = 'x402 budget check failed — skipped (on_failure: allow)';
      return { action: 'allow', reason: note, extraWarnings: [note] };
    }
    return { action: degraded, reason: `x402 budget check failed — degraded decision (${degraded})` };
  }

  const total = windowSpend + spend;
  const scopeLabel = scope === 'agent' ? `agent ${agentId}` : 'org';
  if (total > budgetMax) {
    return { action: 'block', reason: `Cumulative x402 spend $${total.toFixed(2)} over ${windowDays}d (incl. this $${spend.toFixed(2)} purchase, ${scopeLabel}) exceeds budget $${budgetMax}` };
  }
  if (total >= budgetApproval) {
    return { action: 'require_approval', reason: `Cumulative x402 spend $${total.toFixed(2)} over ${windowDays}d (incl. this $${spend.toFixed(2)} purchase, ${scopeLabel}) >= budget approval threshold $${budgetApproval}` };
  }
  return null;
}

async function evaluateX402SpendLimitPolicy({ rules, context, sql, orgId }: PolicyEvalArgs): Promise<PolicyResult | null> {
  if (context.action_type !== 'x402_purchase') return null;
  const { provider, providerId } = resolveX402Provider(context);
  const providerDecision = x402ProviderDecision(rules, provider, providerId);
  if (providerDecision) return providerDecision; // block-only — already maximal
  const spend = x402Spend(context);
  const spendDecision = x402SpendDecision(rules, spend);
  if (spendDecision?.action === 'block') return spendDecision; // already maximal — skip the budget query
  // Return the more severe of the two tiers so a budget block is never
  // shadowed by a per-purchase require_approval.
  return moreSevereResult(spendDecision, await x402BudgetDecision(rules, context, sql, orgId, spend));
}

/**
 * Post-insert budget re-verification (TOCTOU close-out; security review
 * 2026-07-02, MEDIUM). The pre-insert budget check reads the window sum
 * before the purchase row exists, so N concurrent purchases can each pass
 * against the same pre-insert sum. The x402 purchases route calls this AFTER
 * the row commits: the sum now includes the caller's own row and any
 * concurrent winners, so a breached hard budget (budget_usd) surfaces while
 * the response — and the agent's payment execution — can still be stopped.
 * Only the block tier is re-verified: the approval tier already produced its
 * interruption and pending rows count toward future sums. Best-effort by
 * design: a failure here returns null (the pre-insert gate already ran
 * fail-closed); failing every allowed purchase on a transient re-check error
 * would be a new outage mode.
 */
export async function verifyX402BudgetAfterInsert(orgId: string, context: GuardEvalContext, sql: GuardSql): Promise<{ policyId: string; reason: string } | null> {
  try {
    const agentId = typeof context.agent_id === 'string' && context.agent_id ? context.agent_id : null;
    const policies = await loadApplicablePolicies(sql, orgId, agentId);
    for (const policy of policies) {
      if (policy.policy_type !== 'x402_spend_limit') continue;
      let rules: PolicyRules;
      try { rules = JSON.parse(policy.rules); } catch { continue; }
      const budgetMax = rules.budget_usd ?? Infinity;
      if (budgetMax === Infinity) continue;
      const { windowDays, scope } = x402BudgetWindow(rules);
      if (scope === 'agent' && !agentId) continue; // the pre-insert gate already interrupted this shape
      const { sumWindowSpend } = await import('./repositories/x402.repository');
      const sinceIso = new Date(Date.now() - windowDays * 86400000).toISOString();
      const committed = await sumWindowSpend(sql, orgId, { sinceIso, agentId: scope === 'agent' ? agentId : null });
      if (committed > budgetMax) {
        const scopeLabel = scope === 'agent' ? `agent ${agentId}` : 'org';
        return {
          policyId: policy.id,
          reason: `Cumulative x402 spend $${committed.toFixed(2)} over ${windowDays}d (${scopeLabel}) exceeds budget $${budgetMax} — post-insert re-verification`,
        };
      }
    }
    return null;
  } catch (err) {
    console.warn('[Guard] x402 post-insert budget re-verification failed:', { org_id: orgId, error: (err as Error)?.message || err });
    return null;
  }
}

// One evaluator per policy type. evaluatePolicy is a thin dispatcher over this map.
const POLICY_EVALUATORS: Record<string, PolicyEvaluator> = {
  risk_threshold: ({ rules, context, effectiveRiskScore }) => {
    const threshold = rules.threshold ?? 80;
    const riskScore = effectiveRiskScore != null
      ? effectiveRiskScore
      : Math.max(0, Math.min(Number(context.risk_score) || 0, 100));
    if (riskScore >= threshold) {
      return { action: rules.action || 'block', reason: `Risk score ${riskScore} >= threshold ${threshold}` };
    }
    return null;
  },
  require_approval: ({ rules, context }) =>
    matchActionType(rules, context, 'require_approval', (t) => `Action type "${t}" requires approval`),
  block_action_type: ({ rules, context }) =>
    matchActionType(rules, context, 'block', (t) => `Action type "${t}" is blocked by policy`),
  warn_action_type: ({ rules, context }) =>
    matchActionType(rules, context, 'warn', (t) => `Action type "${t}" recorded for review`),
  allow_grant: () => null, // grants run as a post-pass (applyAllowGrants), not as a raising evaluator
  protected_path: ({ rules, context }) => {
    const paths = Array.isArray(rules.paths) ? rules.paths : [];
    if (paths.length === 0) return null;
    const candidates: string[] = [];
    if (typeof context.target === 'string' && context.target) candidates.push(context.target);
    if (Array.isArray(context.write_paths)) candidates.push(...(context.write_paths as string[]));
    const hit = candidates.find((p) => matchesProtectedPath(p, paths));
    if (hit) return { action: rules.action || 'require_approval', reason: `Protected path touched: ${hit}` };
    return null;
  },
  rate_limit: async ({ rules, context, sql, orgId }) => {
    const maxActions = rules.max_actions || 50;
    const windowMinutes = Math.max(1, Math.min(10080, parseInt(String(rules.window_minutes), 10) || 60));
    const agentId = context.agent_id;
    if (!agentId) return null;

    const rows = await sql.query(
      `SELECT COUNT(*) as cnt FROM action_records
         WHERE org_id = $1 AND agent_id = $2
         AND timestamp_start::timestamptz > NOW() - INTERVAL '1 minute' * $3`,
      [orgId, agentId, windowMinutes],
    );

    const count = parseInt((rows[0]?.cnt as string) || '0', 10);
    if (count >= maxActions) {
      return { action: rules.action || 'warn', reason: `Agent performed ${count} actions in ${windowMinutes}min (limit: ${maxActions})` };
    }
    return null;
  },
  // Handled separately after the local policy loop.
  webhook_check: () => null,
  non_fabrication: evaluateNonFabricationPolicy,
  behavioral_anomaly: evaluateBehavioralAnomalyPolicy,
  semantic_check: evaluateSemanticCheckPolicy,
  permission_escalation: evaluatePermissionEscalationPolicy,
  green_contract: ({ rules, context }) => {
    const actionTypes = rules.action_types || [];
    if (context.action_type === undefined || !actionTypes.includes(context.action_type)) return null;
    const observedLevel = context.intel?.green?.observed_level;
    const requiredLevel = rules.required_level;
    if (!observedLevel) {
      return { action: rules.action || 'block', reason: `Green contract: no test status reported, ${requiredLevel} required` };
    }
    if (rankOf(GREEN_RANK, observedLevel, -1) < rankOf(GREEN_RANK, requiredLevel, 0)) {
      return { action: rules.action || 'block', reason: `Green contract: observed ${observedLevel}, required ${requiredLevel}` };
    }
    return null;
  },
  branch_freshness: ({ rules, context }) => {
    const actionTypes = rules.action_types || [];
    if (context.action_type === undefined || !actionTypes.includes(context.action_type)) return null;
    const branch = context.intel?.branch;
    if (!branch) return null;
    const triggerFreshness = rules.freshness || ['stale', 'diverged'];
    if (triggerFreshness.includes(branch.freshness) && (branch.commits_behind ?? 0) > (rules.max_commits_behind ?? 0)) {
      return { action: rules.action || 'block', reason: `Branch ${branch.name || 'unknown'} is ${branch.freshness} (${branch.commits_behind} commits behind)` };
    }
    return null;
  },
  x402_spend_limit: evaluateX402SpendLimitPolicy,
};

// Dispatch via a Map so a user-controlled policy_type cannot reach an inherited
// prototype member (CodeQL js/unvalidated-dynamic-method-call). Object.entries
// captures only own enumerable keys; Map.get of an unknown key returns undefined.
const POLICY_EVALUATOR_MAP: ReadonlyMap<string, PolicyEvaluator> = new Map(
  Object.entries(POLICY_EVALUATORS),
);

export async function evaluatePolicy(
  policy: PolicyRow,
  rules: PolicyRules,
  context: GuardEvalContext,
  sql: GuardSql,
  orgId: string,
  effectiveRiskScore: number,
): Promise<PolicyResult | null> {
  // CodeQL js/unvalidated-dynamic-method-call: membership guard (Map.has) plus a
  // typeof-function check before the dynamic invocation — the documented sanitizer.
  // Unknown/invalid policy_type → no dispatch → return null.
  if (POLICY_EVALUATOR_MAP.has(policy.policy_type)) {
    const evaluator = POLICY_EVALUATOR_MAP.get(policy.policy_type);
    if (typeof evaluator === 'function') {
      return evaluator({ policy, rules, context, sql, orgId, effectiveRiskScore });
    }
  }
  return null;
}

/**
 * Evaluate a webhook_check policy by calling the customer's endpoint.
 * Customer decision can only upgrade severity (never downgrade).
 */
function buildWebhookPayload(context: GuardEvalContext, orgId: string, preliminary: Preliminary) {
  return {
    event: 'guard.evaluation',
    org_id: orgId,
    timestamp: new Date().toISOString(),
    context: {
      action_type: context.action_type,
      risk_score: context.risk_score ?? null,
      agent_id: context.agent_id ?? null,
      systems_touched: context.systems_touched ?? [],
      reversible: context.reversible ?? null,
      declared_goal: context.declared_goal ?? null,
    },
    preliminary_decision: preliminary.decision,
    matched_policies: preliminary.matchedPolicies,
    reasons: preliminary.reasons,
    warnings: preliminary.warnings,
  };
}

function parseCustomerLists(resp: { reasons?: unknown; warnings?: unknown }, policyName: string) {
  const customerReasons: string[] = Array.isArray(resp.reasons) ? resp.reasons : [];
  const customerWarnings: string[] = Array.isArray(resp.warnings)
    ? resp.warnings.map((w: string) => `${policyName} (webhook): ${w}`)
    : [];
  return { customerReasons, customerWarnings };
}

// A customer decision escalates only when it is a known severity strictly above
// the preliminary decision (it can upgrade, never downgrade).
function isWebhookEscalation(decision: string | undefined, preliminaryDecision: string): decision is string {
  return !!decision && hasSev(decision) && sevOf(decision) > sevOf(preliminaryDecision);
}

// Interpret a webhook response. Customer decision can only upgrade severity
// (never downgrade); otherwise pass through warnings as a warn-level result.
function interpretWebhookResponse(
  result: { success?: boolean; response?: unknown },
  policy: PolicyRow,
  preliminary: Preliminary,
  onTimeout: string,
): PolicyResult | null {
  if (!result.success || !result.response) {
    if (onTimeout === 'block' || onTimeout === 'require_approval') {
      return { action: onTimeout, reason: `Webhook check failed or timed out (on_timeout: ${onTimeout})` };
    }
    return null; // onTimeout === 'allow' — explicit fail-open escape hatch
  }

  const resp = result.response as { decision?: string; reasons?: unknown; warnings?: unknown };
  const { customerReasons, customerWarnings } = parseCustomerLists(resp, policy.name);

  if (isWebhookEscalation(resp.decision, preliminary.decision)) {
    const reason = customerReasons.length > 0 ? customerReasons.join('; ') : `Webhook escalated to ${resp.decision}`;
    return { action: resp.decision, reason: `${policy.name} (webhook): ${reason}`, extraWarnings: customerWarnings };
  }

  if (customerWarnings.length > 0) {
    return { action: 'warn', reason: customerWarnings[0] as string, extraWarnings: customerWarnings.slice(1) };
  }
  return null;
}

export async function evaluateWebhookPolicy(
  policy: PolicyRow,
  rules: PolicyRules,
  context: GuardEvalContext,
  orgId: string,
  sql: GuardSql,
  preliminary: Preliminary,
): Promise<PolicyResult | null> {
  const payload = buildWebhookPayload(context, orgId, preliminary);
  const timeoutMs = rules.timeout_ms || 5000;
  // Degradation contract: per-policy on_timeout → DASHCLAW_GUARD_FALLBACK →
  // fail-closed default (require_approval). 'allow' is the explicit escape hatch.
  const onTimeout = resolveDegradedAction(rules.on_timeout);

  const result = await deliverGuardWebhook({
    // rules.url is string|undefined on the loose policy-config type; a webhook
    // policy always has it, and deliverGuardWebhook's safeUrlWithIps(url) runs
    // inside a try/catch that already fails closed on a missing/invalid URL —
    // so passing it through preserves the original runtime behavior exactly.
    url: rules.url as string,
    policyId: policy.id,
    orgId,
    payload,
    timeoutMs,
    sql,
  });

  return interpretWebhookResponse(result, policy, preliminary, onTimeout);
}
