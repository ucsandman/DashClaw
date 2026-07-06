/**
 * Policy evaluation: the per-type evaluator map, the evaluatePolicy dispatcher,
 * the webhook_check evaluator, and the shared guard-degradation contract.
 */

import { baseAgentId } from '../agent-identity-resolve';
import { deliverGuardWebhook } from '../webhooks';
import { matchesProtectedPath } from './protected-path';
import { grantMatches, targetPrefixMatches } from '../policy-shapes';
import { verify } from '../integrity/verify';
import type { SourceOfTruth } from '../integrity/verify';
import { issueReceipt } from '../integrity/receipt';
import { getServerSigningKey } from '../integrity/server-key';
import { sevOf, hasSev } from './internal';
import type { GuardSql, GuardEvalContext, PolicyRow, PolicyRules, PolicyResult, Preliminary } from './types';

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

/** Lookup into a rank table by an untrusted key, with a fallback. */
const rankOf = (table: Record<string, number>, key: unknown, fallback: number): number =>
  (typeof key === 'string' ? table[key] : undefined) ?? fallback;

// Resolve a dotted field path into the guard context. Returns undefined for any missing segment.
function getByPath(obj: unknown, path: unknown): unknown {
  if (obj == null || typeof path !== 'string') return undefined;
  return path.split('.').reduce<unknown>((acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key]), obj);
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
export function x402BudgetWindow(rules: PolicyRules): { windowDays: number; scope: 'org' | 'agent' } {
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

  // Agent-scoped budgets bind the identity FAMILY: a composed sub-agent id
  // (<parent>:<type>) is normalized to its base so the parent's budget
  // captures delegated spend, and sumWindowSpend counts the whole family.
  const budgetAgentId = agentId ? (baseAgentId(agentId) ?? agentId) : null;

  let windowSpend: number;
  try {
    const { sumWindowSpend } = await import('../repositories/x402.repository');
    const sinceIso = new Date(Date.now() - windowDays * 86400000).toISOString();
    windowSpend = await sumWindowSpend(sql, orgId, { sinceIso, agentId: scope === 'agent' ? budgetAgentId : null });
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
  const scopeLabel = scope === 'agent' ? `agent ${budgetAgentId}` : 'org';
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

// ── require_evidence evaluation ──
// Demands that a matching call was graded from an attached act (evidence),
// not from self-declared intent. Modeled on non_fabrication's fail-closed
// template: when evidence is absent it RAISES the decision to `enforcement`
// (raiseDecision never downgrades). intent_source is computed once in
// evaluateGuard and threaded onto the context before local policies run.
function evaluateRequireEvidencePolicy({ rules, context }: PolicyEvalArgs): PolicyResult | null {
  const actionTypes = Array.isArray(rules.action_types) ? rules.action_types : [];
  const matches = actionTypes.length === 0
    || (context.action_type !== undefined && actionTypes.includes(context.action_type));
  if (!matches) return null;
  if (context.intent_source === 'evidence') return null;
  const enforcement = rules.enforcement === 'block' || rules.enforcement === 'require_approval'
    ? rules.enforcement
    : 'warn';
  const label = context.action_type ?? 'action';
  return { action: enforcement, reason: `Evidence required for "${label}" but the call was graded from self-declared intent (no act attached)` };
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
  agent_allowlist: ({ rules, context }) => {
    // Behavior Learning: warn (default) when an agent uses an action type outside
    // its observed safe envelope. Fires only on NOVEL action types by construction
    // (the envelope is the learned allow-set), so it is precision-at-volume safe.
    const allowed = Array.isArray(rules.allowed_action_types) ? rules.allowed_action_types : [];
    if (allowed.length === 0) return null;
    const actionType = context.action_type;
    if (!actionType) return null;
    if (!allowed.includes(actionType)) {
      return { action: rules.action || 'warn', reason: `Action type "${actionType}" is outside the agent's allowlist` };
    }
    return null;
  },
  rate_limit: async ({ rules, context, sql, orgId }) => {
    const maxActions = rules.max_actions || 50;
    const windowMinutes = Math.max(1, Math.min(10080, parseInt(String(rules.window_minutes), 10) || 60));
    const agentId = context.agent_id;
    if (!agentId) return null;

    // Counts guard_decisions — every evaluation — not action_records: a
    // guard-only integration (no ?record=true) writes zero action rows, so
    // the runaway valve never tripped for exactly the callers most likely to
    // loop (ADR Phase 2 / arch-review). Idempotent replays don't write new
    // rows, so retries never double-count. Bare created_at comparison is
    // safe post-drizzle/0043 (no TEXT timestamps remain) and stays on the
    // (org_id, agent_id, created_at) index from drizzle/0045.
    const rows = await sql.query(
      `SELECT COUNT(*) as cnt FROM guard_decisions
         WHERE org_id = $1 AND agent_id = $2
         AND created_at > NOW() - INTERVAL '1 minute' * $3`,
      [orgId, agentId, windowMinutes],
    );

    const count = parseInt((rows[0]?.cnt as string) || '0', 10);
    if (count >= maxActions) {
      return { action: rules.action || 'warn', reason: `Agent made ${count} guard evaluations in ${windowMinutes}min (limit: ${maxActions})` };
    }
    return null;
  },
  // Handled separately after the local policy loop.
  webhook_check: () => null,
  non_fabrication: evaluateNonFabricationPolicy,
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
  require_evidence: evaluateRequireEvidencePolicy,
};

// Dispatch via a Map so a user-controlled policy_type cannot reach an inherited
// prototype member (CodeQL js/unvalidated-dynamic-method-call). Object.entries
// captures only own enumerable keys; Map.get of an unknown key returns undefined.
const POLICY_EVALUATOR_MAP: ReadonlyMap<string, PolicyEvaluator> = new Map(
  Object.entries(POLICY_EVALUATORS),
);

/**
 * The set of policy_type values the engine can actually dispatch. Exported so
 * the evaluation loop and the doctor's policy-integrity check can tell an
 * active-but-unenforceable policy (unknown type → silently null here) apart
 * from a policy that evaluated and simply didn't match.
 */
export const KNOWN_POLICY_TYPES: readonly string[] = [...POLICY_EVALUATOR_MAP.keys()];

export function isKnownPolicyType(policyType: string): boolean {
  return POLICY_EVALUATOR_MAP.has(policyType);
}

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
