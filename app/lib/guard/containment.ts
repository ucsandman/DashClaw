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

export function finalizeContainment(
  context: GuardEvalContext,
  acc: GuardAccumulator,
  riskBreakdown: Record<string, unknown>,
): { containment?: { status: 'contained'; basis: string } } {
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
  return { containment: { status: 'contained', basis: eligibility.basis } };
}

export function buildPromotionGoal(containedActionId: string): string {
  return `containment promote ${containedActionId}`;
}

export function buildPromotionAct(containmentRef: string): { kind: 'shell'; command: string } {
  return { kind: 'shell', command: `git merge --no-ff ${containmentRef}` };
}
