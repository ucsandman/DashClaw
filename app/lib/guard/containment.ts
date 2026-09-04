/**
 * Containment Verdicts (allow_contained) — server-side eligibility, capability
 * negotiation, and the canonical promotion act. RFC 2026-07-06-containment-verdicts,
 * extended to database staging by RFC 2026-09-04-database-containment.
 *
 * Invariants enforced here:
 *  - only provably file-scoped acts (basis `file` / `shell_file_ops`) or
 *    provably database-scoped acts (basis `db_branch`) are containable;
 *  - a caller that does not advertise support for THAT BASIS never sees
 *    allow_contained (negotiation converts to require_approval — version skew
 *    only tightens).
 */
import { classifyAct } from './evidence';
import type { GuardEvalContext } from './types';
import type { GuardAccumulator } from './evaluate';

const CAPABILITY = 'allow_contained';
/**
 * Second capability string (RFC 2026-09-04). Advertised only by a hook that
 * can stage the act on an ephemeral database branch; `allow_contained` alone
 * keeps its exact original meaning (file bases only), so an old hook can never
 * receive a `db_branch` verdict.
 */
const DB_CAPABILITY = 'allow_contained:db';
export const DB_BASIS = 'db_branch';
/** Ref prefix every consumer (route, CLI, hook, card) branches on. */
export const DB_REF_PREFIX = 'dashclaw/contained-db-';
// git subcommands that touch the network — file-scoped proof fails even though
// the shell classifier grades them 'apply'.
const GIT_NETWORK_RE = /\bgit\s+(push|pull|fetch)\b/i;

// Evidence flags that disqualify a `database` shell act from db containment:
// each one names an effect the ephemeral branch does NOT contain. `ddl` and
// `whereless` are deliberately absent — those are exactly the acts containment
// exists for (RFC 2026-09-04, Eligibility).
const DB_DISQUALIFYING_FLAGS = [
  'destructive', 'secret_exposure', 'remote_exec', 'vcs_dangerous',
  'deploy', 'privilege', 'sensitive_path', 'device_write', 'protected_target',
];

export function isContainableAct(context: GuardEvalContext): { eligible: boolean; basis: string } {
  const act = context.act as { kind?: string; command?: string } | undefined;
  if (!act || typeof act !== 'object') return { eligible: false, basis: 'no act attached' };
  if (act.kind === 'file') return { eligible: true, basis: 'file' };
  // A declared SQL act stages on a database branch (RFC 2026-09-04). Only
  // callers advertising `allow_contained:db` can receive it, so this branch is
  // reachable for SDK callers only after a later RFC gives them a staging path.
  if (act.kind === 'sql') return { eligible: true, basis: DB_BASIS };
  if (act.kind !== 'shell') return { eligible: false, basis: `act kind ${String(act.kind)} is never containable` };
  const cls = classifyAct(context.act);
  if (!cls) return { eligible: false, basis: 'unclassifiable shell act' };
  // Database shell acts, checked BEFORE the file-ops rule: the classifier's
  // `database` flag proves the effect lands in Postgres, which the branch
  // contains — as long as the act carries no OTHER effect class.
  if (cls.flags.includes('database')) {
    const blocking = cls.flags.filter((f) => DB_DISQUALIFYING_FLAGS.includes(f));
    if (blocking.length > 0) {
      return { eligible: false, basis: `database act carries non-database effects [${blocking.join(',')}]` };
    }
    return { eligible: true, basis: DB_BASIS };
  }
  if (cls.derived_action_type !== 'apply' || cls.flags.length > 0) {
    return { eligible: false, basis: `shell class ${cls.derived_action_type}${cls.flags.length ? ` [${cls.flags.join(',')}]` : ''} not provably file-scoped` };
  }
  if (typeof act.command === 'string' && GIT_NETWORK_RE.test(act.command)) {
    return { eligible: false, basis: 'git network subcommand' };
  }
  return { eligible: true, basis: 'shell_file_ops' };
}

/**
 * Capability string a basis requires. File bases keep `allow_contained`; the
 * database basis requires the distinct `allow_contained:db` (RFC 2026-09-04) so
 * a hook that only knows how to stage files can never be handed a db verdict.
 */
export function requiredCapabilityForBasis(basis?: string): string {
  return basis === DB_BASIS ? DB_CAPABILITY : CAPABILITY;
}

/**
 * True when the caller advertised support for the basis about to be emitted.
 * The basis argument is optional so the pre-db signature (file semantics)
 * stays byte-compatible for existing callers.
 */
export function clientAdvertisesContainment(context: GuardEvalContext, basis?: string): boolean {
  const caps = context.client_capabilities;
  return Array.isArray(caps) && caps.includes(requiredCapabilityForBasis(basis));
}

/** Server-derived db refs, the one shape that means "staged on a db branch". */
export function isDbContainmentRef(ref: unknown): boolean {
  return typeof ref === 'string' && ref.startsWith(DB_REF_PREFIX);
}

/**
 * Mirror of hooks/dashclaw_pretool.py `_safe_branch_segment` — the two MUST
 * sanitize identically (sub → strip → [:64] → fallback), because the server
 * stamps `containment_ref` from the payload's harness_session_id at guard
 * ?record=true time while the hook derives its worktree branch from the same
 * id locally; a divergence 409s every legitimate awaiting_promotion flip.
 */
export function safeBranchSegment(sessionId: unknown): string {
  const raw = typeof sessionId === 'string' ? sessionId : '';
  const subbed = raw.replace(/[^A-Za-z0-9-]/g, '-');
  // Index-based strip('-') — regex trims (`/^-+/`, `/-+$/`) are quadratic on
  // adversarial all-dash input (CodeQL js/polynomial-redos).
  let start = 0;
  let end = subbed.length;
  while (start < end && subbed[start] === '-') start++;
  while (end > start && subbed[end - 1] === '-') end--;
  return subbed.slice(start, end).slice(0, 64) || 'session';
}

/**
 * Instance discriminator (co-installed hook instances): the hook's
 * `_INSTANCE_STATE_SUFFIX` (sha256(base_url|agent_id)[:12]), sent as
 * `containment_instance` on the guard payload. Two hook installations firing
 * for the SAME harness session (global ~/.claude hooks + a project's local
 * hooks) would otherwise derive the SAME branch/worktree — the second
 * instance's `git worktree add` fails and its containment permanently
 * interrupts. Sanitized to alnum ≤16; anything else means "no discriminator"
 * (legacy hook), which keeps the pre-suffix derivation byte-for-byte.
 */
export function safeInstanceSegment(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
  return cleaned || null;
}

export function buildContainmentRef(sessionId: unknown, instance?: unknown, basis?: string): string {
  const inst = safeInstanceSegment(instance);
  const base = safeBranchSegment(sessionId);
  // Database staging (RFC 2026-09-04) gets its own `db-` prefix INSIDE the
  // ref's segment, so a session's database branch is distinct from its file
  // worktree and every consumer can branch on the prefix alone. The ref-shape
  // regex (`{1,64}`) is unchanged, so the segment budget shrinks by three.
  const prefix = basis === DB_BASIS ? 'db-' : '';
  const budget = 64 - prefix.length;
  if (!inst) {
    // No-instance file derivation is byte-for-byte what it always was (the
    // hook mirrors it); only the db path pays the prefix truncation.
    if (!prefix) return `dashclaw/contained-${base}`;
    return `dashclaw/contained-${prefix}${base.slice(0, budget).replace(/-+$/, '')}`;
  }
  // Cap the combined segment at 64 chars — the ref-shape regexes on the PATCH
  // flip route, the hook, and the CLI all enforce {1,64}, and the segment
  // doubles as the worktree directory name.
  const seg = base.slice(0, budget - inst.length - 1).replace(/-+$/, '');
  return `dashclaw/contained-${prefix}${seg}-${inst}`;
}

export function finalizeContainment(
  context: GuardEvalContext,
  acc: GuardAccumulator,
  riskBreakdown: Record<string, unknown>,
): { containment?: { status: 'contained'; basis: string; ref: string } } {
  if (acc.highestDecision !== CAPABILITY) return {};
  const eligibility = isContainableAct(context);
  if (!eligibility.eligible) {
    acc.highestDecision = 'require_approval';
    acc.reasons.push(`Containment ineligible (${eligibility.basis}) — interrupting instead`);
    riskBreakdown._containment = { downgraded_to_interrupt: true, reason: eligibility.basis };
    return {};
  }
  if (!clientAdvertisesContainment(context, eligibility.basis)) {
    acc.highestDecision = 'require_approval';
    acc.warnings.push(`Verdict was allow_contained but the caller does not advertise ${requiredCapabilityForBasis(eligibility.basis)} — emitted require_approval (skew only tightens)`);
    riskBreakdown._containment = { downgraded_to_interrupt: true, reason: 'client capability not advertised' };
    return {};
  }
  // Server-derived merge target (security follow-up, RFC 2026-07-06): the ref
  // is computed HERE — from the harness session id already on the payload —
  // never accepted from a later client flip, so a containment flip carries no
  // attacker-controllable merge target. The instance discriminator namespaces
  // co-installed hook instances; it is client-supplied but only selects the
  // caller's own ref namespace (the session id segment always was).
  return {
    containment: {
      status: 'contained',
      basis: eligibility.basis,
      ref: buildContainmentRef(context.harness_session_id, context.containment_instance, eligibility.basis),
    },
  };
}

export function buildPromotionGoal(containedActionId: string): string {
  return `containment promote ${containedActionId}`;
}

/**
 * The act the operator's Promote pre-approves, act-content-hash bound.
 *
 *  - file ref → the canonical `git merge --no-ff <ref>` (unchanged);
 *  - db ref   → the action's ORIGINAL recorded act, byte-for-byte. The guard
 *    recorded the pre-rewrite command, so the replay target is the production
 *    database the agent originally addressed (RFC 2026-09-04, Promotion).
 *
 * A db ref with no original act throws rather than falling back to the merge
 * command: `git merge --no-ff dashclaw/contained-db-…` would be a merge of a
 * branch that does not exist, minted under an operator's signature. Callers
 * check availability first and refuse the promotion (CONTAINMENT_ACT_MISSING).
 */
export function buildPromotionAct(
  containmentRef: string,
  originalAct?: unknown,
): { kind: 'shell'; command: string } | Record<string, unknown> {
  if (isDbContainmentRef(containmentRef)) {
    if (!originalAct || typeof originalAct !== 'object' || Array.isArray(originalAct)) {
      throw new Error('db containment promotion requires the original recorded act');
    }
    return originalAct as Record<string, unknown>;
  }
  return { kind: 'shell', command: `git merge --no-ff ${containmentRef}` };
}
