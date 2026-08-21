/**
 * Policy evaluation: the per-type evaluator map, the evaluatePolicy dispatcher,
 * the webhook_check evaluator, and the shared guard-degradation contract.
 */

import { baseAgentId } from '../agent-identity-resolve';
import { deliverGuardWebhook } from '../webhooks';
import { matchesProtectedPath } from './protected-path';
import { targetPrefixMatches } from '../policy-shapes';
import { isContainableAct } from './containment';
import { gitPushPredicateMatches, parseGitPush, commandTextOf } from './git-push';
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

// Restrictive policies match the effective action_type AND the caller's
// declared type when the evidence mismatch swap replaced it (evaluate.ts):
// declaring social_post while the classifier derives "other" must not dodge a
// social_post rule. Permissive surfaces (allow grants, approval reuse binding)
// intentionally stay on the effective type only, so a declaration can never
// widen a grant.
function contextActionTypes(context: GuardEvalContext): string[] {
  const types: string[] = [];
  if (typeof context.action_type === 'string') types.push(context.action_type);
  if (typeof context.declared_action_type === 'string' && !types.includes(context.declared_action_type)) {
    types.push(context.declared_action_type);
  }
  // Provider gateways (offlocal MCP) name the same real-world act differently
  // per tool — a domain buy arrives as "provider_purchase", a Stripe charge as
  // "stripe_live_write" — while carrying the coarse capability in metadata. A
  // rule that enumerates action_type spellings is therefore a deny-list: it
  // protects against the strings someone remembered and nothing else. Folding
  // the capability in makes "purchase" match every purchase regardless of the
  // tool's private vocabulary. Additive by construction, so a caller-supplied
  // capability can only ever add a gate, never remove one.
  const capability = typeof context.metadata === 'object' && context.metadata !== null
    ? (context.metadata as Record<string, unknown>).capability
    : undefined;
  if (typeof capability === 'string' && capability && !types.includes(capability)) {
    types.push(capability);
  }
  return types;
}

// require_approval / block_action_type share action_type matching; only the
// decision and reason wording differ.
function matchActionType(
  rules: PolicyRules,
  context: GuardEvalContext,
  action: string,
  reason: (type: string) => string,
): PolicyResult | null {
  const actionTypes = rules.action_types || [];
  // Optional narrowing on the actual command text: `rules.git_push` gates the
  // rule on a branch-aware git-push predicate. A rule carrying git_push and no
  // action_types matches on the command ALONE — action_type spellings are a
  // deny-list of remembered strings, and a force-push arrives under several.
  const gitPred = rules.git_push && typeof rules.git_push === 'object' ? rules.git_push : null;
  if (gitPred && !gitPushPredicateMatches(gitPred, commandTextOf(context))) return null;
  let matchedType: string | undefined;
  if (actionTypes.length > 0 || !gitPred) {
    matchedType = contextActionTypes(context).find((t) => actionTypes.includes(t));
    if (matchedType === undefined) {
      return null;
    }
  }
  // Optional narrowing: a rule born from a targeted shape (review-feed
  // "tighten") only fires when the action's target matches the prefix —
  // without this, a narrow tighten gates the whole action_type org-wide.
  if (typeof rules.target_prefix === 'string' && rules.target_prefix &&
      !targetPrefixMatches(rules.target_prefix, context)) {
    return null;
  }
  if (matchedType !== undefined) return { action, reason: reason(matchedType) };
  const parsed = parseGitPush(commandTextOf(context));
  const verb = parsed?.force ? 'Force-push' : 'Push';
  const over = parsed?.branch ? ` over "${parsed.branch}"` : '';
  const consequence = action === 'block' ? 'is blocked by policy' : action === 'warn' ? 'recorded for review' : 'requires approval';
  return { action, reason: `${verb}${over} ${consequence}` };
}

// ── non_fabrication evaluation (decomposed) ──

function nonFabAppliesTo(rules: PolicyRules, context: GuardEvalContext): boolean {
  const actionTypes = Array.isArray(rules.action_types) ? rules.action_types : null;
  if (!actionTypes || actionTypes.length === 0) return true;
  return contextActionTypes(context).some((t) => actionTypes.includes(t));
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

const GREEN_RANK: Record<string, number> = { targeted: 0, package: 1, workspace: 2, merge_ready: 3 };

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
    // Carve-out: `block` always wins the severity merge (evaluate.ts
    // raiseDecision), so a HOLD line can never out-vote this one. Excluding a
    // class here is the only way another Short List line can own it — the
    // catastrophe-only pack excludes force-pushes so they hold instead of dying.
    // STRICT on purpose: dropping a block is the dangerous direction, so the
    // command must BE a push, not merely contain one
    // (`rm -rf / && git push --force origin main` stays blocked).
    if (rules.except_git_push && typeof rules.except_git_push === 'object' &&
        gitPushPredicateMatches(rules.except_git_push, commandTextOf(context), { strict: true })) {
      return null;
    }
    // Evidence gate: fire only when the server-side classifier tagged the act
    // with one of these flags (context.evidence_flags is server-set — validate()
    // strips any client copy). A risk score saturates at 100 for mundane shapes
    // (`cat .env.example` = secret_exposure, a heredoc line containing `dd ` or
    // `truncate`), so a bare threshold-100 line cannot tell "wipe the disk" from
    // "read a placeholder file". The default packs pin their mass-destructive
    // line to `protected_target` (rm/find on root/home/system/drive, raw device
    // write, mkfs) — everything else runs and is logged (2026-08-21).
    if (Array.isArray(rules.only_evidence_flags) && rules.only_evidence_flags.length > 0) {
      const actFlags = Array.isArray(context.evidence_flags) ? context.evidence_flags : [];
      if (!rules.only_evidence_flags.some((f) => actFlags.includes(f))) return null;
    }
    if (riskScore >= threshold) {
      return { action: rules.action || 'block', reason: `Risk score ${riskScore} >= threshold ${threshold}` };
    }
    // Containment band (RFC 2026-07-06-containment-verdicts): only meaningful on
    // interrupt policies; validator enforces contain_above < threshold + action
    // require_approval. Ineligible acts in the band interrupt (deliberate tighten).
    if (
      typeof rules.contain_above === 'number' &&
      rules.action === 'require_approval' &&
      riskScore >= rules.contain_above
    ) {
      const eligibility = isContainableAct(context);
      if (eligibility.eligible) {
        return { action: 'allow_contained', reason: `Risk score ${riskScore} in containment band [${rules.contain_above}, ${threshold}) — execute contained (${eligibility.basis})` };
      }
      return { action: 'require_approval', reason: `Risk score ${riskScore} in containment band but act not containable (${eligibility.basis})` };
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
    if (!contextActionTypes(context).some((t) => actionTypes.includes(t))) return null;
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
    if (!contextActionTypes(context).some((t) => actionTypes.includes(t))) return null;
    const branch = context.intel?.branch;
    if (!branch) return null;
    const triggerFreshness = rules.freshness || ['stale', 'diverged'];
    if (triggerFreshness.includes(branch.freshness) && (branch.commits_behind ?? 0) > (rules.max_commits_behind ?? 0)) {
      return { action: rules.action || 'block', reason: `Branch ${branch.name || 'unknown'} is ${branch.freshness} (${branch.commits_behind} commits behind)` };
    }
    return null;
  },
  require_evidence: evaluateRequireEvidencePolicy,
  // Scoped delegation constraints (governed-autonomy feature 2, RFC
  // 2026-07-06): a composed subagent's authority is a provable subset of its
  // parent's. Fires ONLY on composed identities (agent_id containing the
  // reserved ':' delimiter) — plain parents and provenance-mode callers
  // (base id + intel.subagent) are out of scope by design, so this is a
  // hard no-op for every existing single-agent fleet. Tighten-only: it can
  // escalate to require_approval or block, never grant. effectiveRiskScore
  // arrives POST-predictive (evaluate.ts passes the final adjusted score to
  // runLocalPolicies), so the risk ceiling checks the same number the
  // decision itself is judged on. Matching is on the id STRING — an
  // unpaired composed id (no agent_identities row) is still constrained;
  // the base-fallback identity lookup cannot defeat attenuation.
  delegation_constraint: ({ rules, context, effectiveRiskScore }) => {
    const agentId = typeof context.agent_id === 'string' ? context.agent_id : '';
    const sep = agentId.indexOf(':');
    if (sep <= 0) return null; // non-composed caller — no-op
    const parent = agentId.slice(0, sep);
    const childSegments = agentId.slice(sep + 1).split(':').filter(Boolean);

    const ruleParent = typeof rules.parent === 'string' ? rules.parent : '*';
    if (ruleParent !== '*' && ruleParent !== parent) return null;
    const childTypes = Array.isArray(rules.child_types) ? rules.child_types : ['*'];
    const childMatch = childTypes.includes('*') || childSegments.some((s) => childTypes.includes(s));
    if (!childMatch) return null;

    const escalate = rules.escalate_action === 'block' ? 'block' : 'require_approval';

    if (typeof rules.max_depth === 'number' && childSegments.length > rules.max_depth) {
      return { action: escalate, reason: `spawn depth ${childSegments.length} exceeds max_depth ${rules.max_depth} for ${agentId}` };
    }
    if (typeof rules.max_risk_score === 'number') {
      const risk = effectiveRiskScore != null
        ? effectiveRiskScore
        : Math.max(0, Math.min(Number(context.risk_score) || 0, 100));
      if (risk > rules.max_risk_score) {
        return { action: escalate, reason: `risk ${risk} exceeds the delegated ceiling ${rules.max_risk_score} for ${agentId}` };
      }
    }
    const actionType = typeof context.action_type === 'string' ? context.action_type : '';
    if (Array.isArray(rules.blocked_action_types) && actionType && rules.blocked_action_types.includes(actionType)) {
      return { action: escalate, reason: `action type "${actionType}" is outside ${agentId}'s delegated authority (blocked)` };
    }
    if (Array.isArray(rules.allowed_action_types) && actionType && !rules.allowed_action_types.includes(actionType)) {
      return { action: escalate, reason: `action type "${actionType}" is outside ${agentId}'s delegated allowlist` };
    }
    if (Array.isArray(rules.blocked_path_globs) && rules.blocked_path_globs.length > 0) {
      const candidates: string[] = [];
      if (typeof context.target === 'string' && context.target) candidates.push(context.target);
      if (Array.isArray(context.write_paths)) candidates.push(...(context.write_paths as string[]));
      const hit = candidates.find((p) => matchesProtectedPath(p, rules.blocked_path_globs));
      if (hit) {
        return { action: escalate, reason: `path ${hit} is outside ${agentId}'s delegated scope` };
      }
    }
    if (rules.require_verified_parent === true) {
      const status = typeof context.verification_status === 'string' ? context.verification_status : 'unverified';
      if (status !== 'verified') {
        return { action: escalate, reason: `unverified caller identity (${status}) — this constraint requires a verified parent` };
      }
    }
    return null;
  },
  // Role constraints ("workbenches", 2026-08-10 spec): a named authority
  // bundle for TOP-LEVEL agents — delegation_constraint's shape without the
  // composed-id gate or depth check. Membership is the policy row's agent_ids
  // scoping (loadApplicablePolicies), not evaluator matching, so composed
  // children inherit their parent's role for free. Tighten-only: escalates to
  // require_approval/block, never grants — an outside-the-role attempt lands
  // in the Approvals inbox instead of silently dropping.
  role_constraint: ({ policy, rules, context, effectiveRiskScore }) => {
    const escalate = rules.escalate_action === 'block' ? 'block' : 'require_approval';
    const role = policy.name || 'role';

    const actionType = typeof context.action_type === 'string' ? context.action_type : '';
    if (Array.isArray(rules.blocked_action_types) && actionType && rules.blocked_action_types.includes(actionType)) {
      return { action: escalate, reason: `action type "${actionType}" is blocked for the "${role}" role` };
    }
    if (Array.isArray(rules.allowed_action_types) && rules.allowed_action_types.length > 0 && actionType
      && !rules.allowed_action_types.includes(actionType)) {
      return { action: escalate, reason: `action type "${actionType}" is outside the "${role}" role's allowlist` };
    }
    if (typeof rules.max_risk_score === 'number') {
      const risk = effectiveRiskScore != null
        ? effectiveRiskScore
        : Math.max(0, Math.min(Number(context.risk_score) || 0, 100));
      if (risk > rules.max_risk_score) {
        return { action: escalate, reason: `risk ${risk} exceeds the "${role}" role's ceiling ${rules.max_risk_score}` };
      }
    }
    if (Array.isArray(rules.blocked_path_globs) && rules.blocked_path_globs.length > 0) {
      const candidates: string[] = [];
      if (typeof context.target === 'string' && context.target) candidates.push(context.target);
      if (Array.isArray(context.write_paths)) candidates.push(...(context.write_paths as string[]));
      const hit = candidates.find((p) => matchesProtectedPath(p, rules.blocked_path_globs));
      if (hit) {
        return { action: escalate, reason: `path ${hit} is outside the "${role}" role's scope` };
      }
    }
    return null;
  },
  // Deviation response (RFC 2026-08-11-plan-deviation-events §7): per-kind
  // consequence for the plan-vs-actual deviation the detector attached to
  // this evaluation. Input arrives via context._plan_deviation_finding — a
  // transient SERVER-SET stash written by runDeviationCheck AFTER the grant
  // passes and deleted before the context is persisted — so this evaluator is
  // a structural no-op inside runLocalPolicies and for every agent without a
  // live plan. Tighten-only: warn/require_approval/block, never grants.
  // Detection and recording are unconditional and policy-free (D1/D2); this
  // maps kinds to consequences, nothing more. escalate_action is a CEILING —
  // block requires the operator's explicit opt-in.
  deviation_response: ({ policy, rules, context }) => {
    const finding = (context as Record<string, unknown>)._plan_deviation_finding as
      { kind?: string; severity?: string } | undefined;
    if (!finding || typeof finding.kind !== 'string') return null;
    const SEV_ORDER: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3 };
    const minSeverity = typeof rules.min_severity === 'string' && rules.min_severity in SEV_ORDER
      ? rules.min_severity : 'info';
    const severity = typeof finding.severity === 'string' && finding.severity in SEV_ORDER
      ? finding.severity : 'info';
    if (SEV_ORDER[severity]! < SEV_ORDER[minSeverity]!) return null;
    const onKind = rules.on_kind && typeof rules.on_kind === 'object' ? rules.on_kind : null;
    const consequence = onKind ? onKind[finding.kind] : undefined;
    if (consequence !== 'warn' && consequence !== 'require_approval' && consequence !== 'block') return null;
    const ACTION_ORDER: Record<string, number> = { warn: 1, require_approval: 2, block: 3 };
    const ceiling = typeof rules.escalate_action === 'string' && ACTION_ORDER[rules.escalate_action]
      ? rules.escalate_action : 'require_approval';
    const action = ACTION_ORDER[consequence]! > ACTION_ORDER[ceiling]! ? ceiling : consequence;
    return {
      action,
      reason: `plan deviation ${finding.kind} (${finding.severity}) — "${policy.name || 'deviation policy'}" escalates to ${action}`,
    };
  },
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
