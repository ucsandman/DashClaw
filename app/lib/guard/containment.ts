/**
 * Containment Verdicts (allow_contained) — server-side eligibility, capability
 * negotiation, and the canonical promotion act. RFC 2026-07-06-containment-verdicts.
 *
 * Invariants enforced here:
 *  - only provably file-scoped acts are containable (eligibility);
 *  - a caller that does not advertise support NEVER sees allow_contained
 *    (negotiation converts to require_approval — version skew only tightens).
 */
import { classifyAct } from './evidence';
import type { GuardEvalContext } from './types';
import type { GuardAccumulator } from './evaluate';

const CAPABILITY = 'allow_contained';
// git subcommands that touch the network — file-scoped proof fails even though
// the shell classifier grades them 'apply'.
const GIT_NETWORK_RE = /\bgit\s+(push|pull|fetch)\b/i;

export function isContainableAct(context: GuardEvalContext): { eligible: boolean; basis: string } {
  const act = context.act as { kind?: string; command?: string } | undefined;
  if (!act || typeof act !== 'object') return { eligible: false, basis: 'no act attached' };
  if (act.kind === 'file') return { eligible: true, basis: 'file' };
  if (act.kind !== 'shell') return { eligible: false, basis: `act kind ${String(act.kind)} is never containable` };
  const cls = classifyAct(context.act);
  if (!cls) return { eligible: false, basis: 'unclassifiable shell act' };
  if (cls.derived_action_type !== 'apply' || cls.flags.length > 0) {
    return { eligible: false, basis: `shell class ${cls.derived_action_type}${cls.flags.length ? ` [${cls.flags.join(',')}]` : ''} not provably file-scoped` };
  }
  if (typeof act.command === 'string' && GIT_NETWORK_RE.test(act.command)) {
    return { eligible: false, basis: 'git network subcommand' };
  }
  return { eligible: true, basis: 'shell_file_ops' };
}

export function clientAdvertisesContainment(context: GuardEvalContext): boolean {
  const caps = context.client_capabilities;
  return Array.isArray(caps) && caps.includes(CAPABILITY);
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
  const cleaned = raw.replace(/[^A-Za-z0-9-]/g, '-').replace(/^-+/, '').replace(/-+$/, '');
  return cleaned.slice(0, 64) || 'session';
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

export function buildContainmentRef(sessionId: unknown, instance?: unknown): string {
  const inst = safeInstanceSegment(instance);
  const base = safeBranchSegment(sessionId);
  if (!inst) return `dashclaw/contained-${base}`;
  // Cap the combined segment at 64 chars — the ref-shape regexes on the PATCH
  // flip route, the hook, and the CLI all enforce {1,64}, and the segment
  // doubles as the worktree directory name.
  const seg = base.slice(0, 64 - inst.length - 1).replace(/-+$/, '');
  return `dashclaw/contained-${seg}-${inst}`;
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
  if (!clientAdvertisesContainment(context)) {
    acc.highestDecision = 'require_approval';
    acc.warnings.push('Verdict was allow_contained but the caller does not advertise containment support — emitted require_approval (skew only tightens)');
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
      ref: buildContainmentRef(context.harness_session_id, context.containment_instance),
    },
  };
}

export function buildPromotionGoal(containedActionId: string): string {
  return `containment promote ${containedActionId}`;
}

export function buildPromotionAct(containmentRef: string): { kind: 'shell'; command: string } {
  return { kind: 'shell', command: `git merge --no-ff ${containmentRef}` };
}
