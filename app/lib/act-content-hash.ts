/**
 * Act-content hash — the operator-approval grant binding digest (drizzle/0056).
 *
 * One server-side computation shared by the two sides of the grant: the
 * pending record stamps digestJson(act) at creation, and the guard's grant
 * match recomputes it from the retry's act. The hash binds an approval to
 * the exact act payload (shell/http/sql/file — the evidence-first guard
 * wire shape) the operator saw, so approving act X can never authorize a
 * different act Y that shares the same agent + declared_goal + action_type.
 *
 * NOT the JWT action-binding hash: guard_decisions.act_hash (act-binding.ts)
 * is the issuer-minted hash over the (action_type, target, declared_goal)
 * tuple. This one digests the raw act payload and lives on action_records.
 *
 * Best-effort by design: a missing or non-object act returns null, which
 * leaves the row on the pre-binding tuple-match behavior — the binding only
 * ever tightens a grant, it never loosens one.
 */
import { digestJson } from './integrity/canonicalize';

export function computeActContentHash(act: unknown): string | null {
  if (!act || typeof act !== 'object' || Array.isArray(act)) return null;
  try {
    return digestJson(act);
  } catch {
    return null;
  }
}
