/**
 * Behavior Learning policy model — the deterministic core shared by the
 * analyzer (suggestion generation) and the simulator (replay-before-adopt).
 * Both call `evaluateRuleOverSamples` so what the Policy Coach shows in a
 * simulation is exactly how the rule classifies real samples.
 *
 * V1 is observe-only. Two rule kinds map faithfully to enforceable guard
 * policies (so an adopted draft, if later activated by the operator, behaves as
 * simulated); the other four are advisory observations the guard engine cannot
 * evaluate at a single PreToolUse (sequence- or model-aware), and never produce
 * a guard policy in V1.
 */

import { matchesProtectedPath, classifyProtectedPath, PROTECTED_PATH_GROUPS } from './path-match';
import { isBelowTier } from './model-tier';
import type { ModelTier } from './model-tier';
import { classifyTask } from './task-classifier';

export const RULE_KINDS = Object.freeze({
  DESTRUCTIVE_COMMAND_APPROVAL: 'destructive_command_approval',
  PROTECTED_PATH_APPROVAL: 'protected_path_approval',
  REPEATED_RELOAD_WARN: 'repeated_reload_warn',
  FAILED_LOOP_WARN: 'failed_loop_warn',
  MODEL_TASK_MISMATCH_WARN: 'model_task_mismatch_warn',
  AGENT_ALLOWLIST: 'agent_allowlist',
});

/** Kinds that compile to a real, faithfully-simulatable guard policy. */
export const ENFORCEABLE_KINDS = Object.freeze([
  RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL,
  RULE_KINDS.PROTECTED_PATH_APPROVAL,
]);

export const DECISIONS = Object.freeze(['allow', 'warn', 'require_approval', 'block']);

export const DEFAULTS = Object.freeze({
  destructiveRiskThreshold: 70,
  reload: { maxReloads: 3, windowMinutes: 15 },
  failure: { maxFailures: 3, windowMinutes: 30 },
  modelMinTier: 'mid',
});

/** A learned behavior rule (loosely typed — shapes vary per kind). */
export interface BehaviorRule {
  kind: string;
  action?: string;
  risk_threshold?: number | string;
  paths?: unknown[];
  min_tier?: string;
  task_classes?: unknown[];
  max_reloads?: number;
  max_failures?: number;
  window_minutes?: number;
  allow?: {
    tools?: unknown[];
    action_types?: unknown[];
    command_verbs?: unknown[];
  };
  [key: string]: unknown;
}

/** A recorded behavior sample (loosely typed — from the local JSONL store). */
export interface BehaviorSample {
  event_id?: string;
  ts?: string;
  tool?: string;
  bash_intent?: unknown;
  command_shape?: string;
  risk_score?: number | string;
  write_paths?: string[];
  read_paths?: string[];
  model?: string;
  declared_goal?: string;
  action_type?: string;
  outcome_status?: string;
  [key: string]: unknown;
}

export function isEnforceable(kind: string): boolean {
  return (ENFORCEABLE_KINDS as readonly string[]).includes(kind);
}

/** Parse a sample timestamp to epoch ms; NaN-safe (returns 0 on garbage). */
export function tsMs(sample: BehaviorSample | null | undefined): number {
  const t = Date.parse(sample && sample.ts ? sample.ts : '');
  return Number.isFinite(t) ? t : 0;
}

function isCommandSample(sample: BehaviorSample | null | undefined): boolean {
  return !!sample && (sample.tool === 'Bash' || !!sample.bash_intent || !!sample.command_shape);
}

// ── Per-sample evaluation (command / path / model / allowlist rules) ─────────

/** Decision for a single sample under a per-sample rule (not sequence rules). */
export function decideSample(rule: BehaviorRule | null | undefined, sample: BehaviorSample | null | undefined): string {
  if (!rule || !sample) return 'allow';
  switch (rule.kind) {
    case RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL: {
      // Faithful to a guard `risk_threshold` policy: fire on risk >= threshold.
      // (Destructive shell commands reliably score high via the bash classifier
      // + computeRiskScore, which is how the analyzer picks the threshold.)
      const threshold = Number(rule.risk_threshold) || DEFAULTS.destructiveRiskThreshold;
      const risk = Number(sample.risk_score) || 0;
      return risk >= threshold ? (rule.action || 'require_approval') : 'allow';
    }
    case RULE_KINDS.PROTECTED_PATH_APPROVAL: {
      const paths = Array.isArray(rule.paths) ? rule.paths : [];
      const writes = Array.isArray(sample.write_paths) ? sample.write_paths : [];
      const hit = writes.some((p) => matchesProtectedPath(p, paths));
      return hit ? (rule.action || 'require_approval') : 'allow';
    }
    case RULE_KINDS.MODEL_TASK_MISMATCH_WARN: {
      if (!sample.model) return 'allow'; // model unknown — never flag
      // rule.min_tier is a loosely-typed string from the learned rule; isBelowTier
      // falls back to 'mid' for any unrecognized tier, so the cast is safe.
      if (!isBelowTier(sample.model, (rule.min_tier || DEFAULTS.modelMinTier) as ModelTier)) return 'allow';
      const cls = classifyTask({
        text: `${sample.declared_goal || ''} ${sample.command_shape || ''}`,
        action_type: sample.action_type,
        writePaths: sample.write_paths,
        readPaths: sample.read_paths,
        tool: sample.tool,
      });
      const heavyClasses = Array.isArray(rule.task_classes) ? rule.task_classes : null;
      const matches = heavyClasses ? heavyClasses.includes(cls.task_class) : cls.heavy;
      return matches ? (rule.action || 'warn') : 'allow';
    }
    case RULE_KINDS.AGENT_ALLOWLIST: {
      // An allowlist never gates — it documents the safe envelope. Decision is
      // always 'allow'; coverage is tracked separately by sampleMatchesAllowlist.
      return 'allow';
    }
    default:
      return 'allow';
  }
}

/** True when a sample falls inside an agent_allowlist rule's safe envelope. */
export function sampleMatchesAllowlist(rule: BehaviorRule | null | undefined, sample: BehaviorSample): boolean {
  const allow = rule && rule.allow ? rule.allow : {};
  const tools = allow.tools || [];
  const actionTypes = allow.action_types || [];
  const verbs = allow.command_verbs || [];
  if (tools.includes(sample.tool)) return true;
  if (actionTypes.includes(sample.action_type)) return true;
  if (sample.command_shape) {
    const verb = String(sample.command_shape).trim().split(/\s+/)[0];
    if (verbs.includes(verb)) return true;
  }
  return false;
}

// ── Sequence detectors (reload / failure loops) ──────────────────────────────

interface ReloadOpts {
  maxReloads?: number;
  windowMinutes?: number;
}

/**
 * Detect repeated reads of the same target within a window with no intervening
 * write to that target. Returns a Set of offending sample event_ids.
 */
export function detectReloadLoops(samples: BehaviorSample[], { maxReloads, windowMinutes }: ReloadOpts = {}): Set<string | undefined> {
  const max = Number(maxReloads) || DEFAULTS.reload.maxReloads;
  const windowMs = (Number(windowMinutes) || DEFAULTS.reload.windowMinutes) * 60_000;
  const flagged = new Set<string | undefined>();
  const ordered = [...samples].sort((a, b) => tsMs(a) - tsMs(b));
  // Per target: list of {ts, event_id} reads since the last write to it.
  const reads = new Map<string, { ts: number; event_id: string | undefined }[]>();
  const writtenAt = new Map<string, number>();

  for (const s of ordered) {
    const t = tsMs(s);
    for (const w of s.write_paths || []) writtenAt.set(w, t);
    const isRead = s.tool === 'Read' || (s.read_paths && s.read_paths.length > 0);
    if (!isRead) continue;
    for (const target of (s.read_paths && s.read_paths.length ? s.read_paths : [s.command_shape || s.tool])) {
      if (!target) continue;
      // A write to the target invalidates prior reads (content changed).
      const lastWrite = writtenAt.get(target);
      let list = reads.get(target) || [];
      if (lastWrite != null) list = list.filter((r) => r.ts > lastWrite);
      // Drop reads outside the window.
      list = list.filter((r) => t - r.ts <= windowMs);
      list.push({ ts: t, event_id: s.event_id });
      reads.set(target, list);
      if (list.length >= max) {
        for (const r of list) flagged.add(r.event_id);
      }
    }
  }
  return flagged;
}

interface FailureOpts {
  maxFailures?: number;
  windowMinutes?: number;
}

/**
 * Detect repeated FAILED outcomes of the same tool/command shape within a
 * window. Returns a Set of offending sample event_ids.
 */
export function detectFailureLoops(samples: BehaviorSample[], { maxFailures, windowMinutes }: FailureOpts = {}): Set<string | undefined> {
  const max = Number(maxFailures) || DEFAULTS.failure.maxFailures;
  const windowMs = (Number(windowMinutes) || DEFAULTS.failure.windowMinutes) * 60_000;
  const flagged = new Set<string | undefined>();
  const ordered = [...samples].sort((a, b) => tsMs(a) - tsMs(b));
  const fails = new Map<string, { ts: number; event_id: string | undefined }[]>(); // key -> [{ts, event_id}]

  for (const s of ordered) {
    if (s.outcome_status !== 'failed') continue;
    const key = `${s.tool}|${s.command_shape || s.action_type || ''}`;
    const t = tsMs(s);
    const list = (fails.get(key) || []).filter((r) => t - r.ts <= windowMs);
    list.push({ ts: t, event_id: s.event_id });
    fails.set(key, list);
    if (list.length >= max) {
      for (const r of list) flagged.add(r.event_id);
    }
  }
  return flagged;
}

// ── Unified evaluation (used by analyzer + simulator) ─────────────────────────

export interface EvaluateResult {
  decisions: Map<string | undefined, string>;
  flaggedIds: (string | undefined)[];
  allowlistCovered: number;
}

/**
 * Evaluate a rule across an ordered sample set.
 * Returns { decisions: Map<event_id, decision>, flaggedIds: string[],
 *           allowlistCovered: number }.
 */
export function evaluateRuleOverSamples(rule: BehaviorRule, samples: BehaviorSample[] | null | undefined): EvaluateResult {
  const decisions = new Map<string | undefined, string>();
  const list = Array.isArray(samples) ? samples : [];

  if (rule.kind === RULE_KINDS.REPEATED_RELOAD_WARN) {
    const flagged = detectReloadLoops(list, { maxReloads: rule.max_reloads, windowMinutes: rule.window_minutes });
    for (const s of list) decisions.set(s.event_id, flagged.has(s.event_id) ? (rule.action || 'warn') : 'allow');
    return { decisions, flaggedIds: [...flagged], allowlistCovered: 0 };
  }
  if (rule.kind === RULE_KINDS.FAILED_LOOP_WARN) {
    const flagged = detectFailureLoops(list, { maxFailures: rule.max_failures, windowMinutes: rule.window_minutes });
    for (const s of list) decisions.set(s.event_id, flagged.has(s.event_id) ? (rule.action || 'warn') : 'allow');
    return { decisions, flaggedIds: [...flagged], allowlistCovered: 0 };
  }

  // Per-sample rules.
  let allowlistCovered = 0;
  const flaggedIds: (string | undefined)[] = [];
  for (const s of list) {
    const decision = decideSample(rule, s);
    decisions.set(s.event_id, decision);
    if (decision !== 'allow') flaggedIds.push(s.event_id);
    if (rule.kind === RULE_KINDS.AGENT_ALLOWLIST && sampleMatchesAllowlist(rule, s)) allowlistCovered++;
  }
  return { decisions, flaggedIds, allowlistCovered };
}

// ── Mapping to a real guard policy (enforceable kinds only) ──────────────────

export interface GuardPolicyShape {
  name: string;
  policy_type: string;
  rules: Record<string, unknown>;
  agent_ids: string | null;
}

interface GuardPolicyOpts {
  agentId?: string;
  name?: string;
}

/**
 * Translate an enforceable behavior rule into a `guard_policies`-shaped object
 * (active stays the caller's concern — adoption uses active=0). Returns null
 * for advisory kinds, which never produce a guard policy in V1.
 */
export function behaviorRuleToGuardPolicy(rule: BehaviorRule, { agentId, name }: GuardPolicyOpts = {}): GuardPolicyShape | null {
  const agentIds = agentId ? JSON.stringify([agentId]) : null;
  switch (rule.kind) {
    case RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL:
      return {
        name: name || `behavior: high-risk commands → approval (${agentId || 'all'})`,
        policy_type: 'risk_threshold',
        rules: { threshold: Number(rule.risk_threshold) || DEFAULTS.destructiveRiskThreshold, action: rule.action || 'require_approval' },
        agent_ids: agentIds,
      };
    case RULE_KINDS.PROTECTED_PATH_APPROVAL:
      return {
        name: name || `behavior: protected paths → approval (${agentId || 'all'})`,
        policy_type: 'protected_path',
        rules: { paths: Array.isArray(rule.paths) ? rule.paths : [], action: rule.action || 'require_approval' },
        agent_ids: agentIds,
      };
    default:
      return null; // advisory — no guard policy in V1
  }
}

export { classifyProtectedPath, PROTECTED_PATH_GROUPS };
