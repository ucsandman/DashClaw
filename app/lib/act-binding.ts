/**
 * Action binding (Phase 2c, issue #121 — design by @piiiico, scoped + corrected
 * in review).
 *
 * Phase 2 verifies *who* signed a token. Phase 2b stops *reusing* one. Phase 2c
 * narrows *what* a single token can do: an issuer commits the token to one
 * intended (action, target, goal) tuple at mint time, and the guard records
 * whether the incoming call matches — so a token minted to `read` a record
 * can't be repurposed to `delete` a different one (e.g. by a prompt-injected
 * agent holding an over-broad token).
 *
 * This module is the SINGLE SOURCE OF TRUTH for canonicalization + digest. The
 * issuer (which mints the claim) and the verifier (which recomputes it) must
 * agree byte-for-byte, so both sides go through here. It exists as its own file
 * precisely so those two halves cannot drift.
 *
 * Binding claim — namespaced to dodge the RFC 8693 `act` collision:
 *
 *   "urn:dashclaw:act-binding": {
 *     "typ":  "action-binding/v1",
 *     "hash": "sha256:<base64url-digest>"
 *   }
 *
 * Digest — a constrained RFC 8785 (JSON Canonicalization Scheme) profile with
 * string-only, NFC-normalized values and lexicographically ordered keys.
 */

import { createHash } from 'node:crypto';

// Namespaced claim name. Deliberately NOT `act` — see module header.
export const ACT_BINDING_CLAIM = 'urn:dashclaw:act-binding';

// Default accepted `typ`. Schema evolution rides on the suffix.
const DEFAULT_TYP = 'action-binding/v1';

const MODES = ['off', 'best_effort', 'required'] as const;
export type ActBindingMode = (typeof MODES)[number];

export type ActStatus =
  | 'not_applicable'
  | 'not_present'
  | 'unsupported_typ'
  | 'ctx_incomplete'
  | 'match'
  | 'mismatch';

interface ActBinding {
  typ: string;
  hash: string;
}

interface ActVerification {
  verification_status?: string;
  act?: ActBinding | null;
  act_typ_supported?: boolean;
}

interface ActContext {
  action_type?: string;
  target?: string;
  declared_goal?: string;
}

/**
 * Enforcement mode. Default `best_effort` (v3.6, 2026-07-04): the only status
 * it blocks is `mismatch`, which requires a PRESENT binding claim — issuers
 * that don't mint the claim see zero behavior change, while an actually
 * repurposed token starts blocking. `required` stays opt-in: it blocks
 * `not_present`, which would make minting the claim a precondition for JWKS
 * adoption at all; flip it once your issuer mints bindings (watch for
 * act_status='match' in guard_decisions — computed in every mode for exactly
 * this readiness signal).
 */
export function getActBindingMode(): ActBindingMode {
  const raw = (process.env.DASHCLAW_ACT_BINDING || 'best_effort').toLowerCase();
  return (MODES as readonly string[]).includes(raw) ? (raw as ActBindingMode) : 'best_effort';
}

/**
 * Accepted `typ` values (comma-separated env, defaults to action-binding/v1).
 */
export function getSupportedTyps(): string[] {
  const raw = process.env.DASHCLAW_ACT_BINDING_TYP || DEFAULT_TYP;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Canonicalize the (action, target, goal) tuple to the exact byte string the
 * digest is taken over. Both issuer and guard call this so the bytes match.
 *
 * Throws an error with `code: 'CTX_INCOMPLETE'` when any field is missing or
 * not a non-empty string.
 */
export function canonicalizeActionTuple(
  { action, target, goal }: { action?: string; target?: string; goal?: string } = {},
): string {
  if (typeof action !== 'string' || action.length === 0) {
    throw Object.assign(new Error('canonicalizeActionTuple: action must be a non-empty string'), { code: 'CTX_INCOMPLETE' });
  }
  if (typeof target !== 'string' || target.length === 0) {
    throw Object.assign(new Error('canonicalizeActionTuple: target must be a non-empty string'), { code: 'CTX_INCOMPLETE' });
  }
  if (typeof goal !== 'string' || goal.length === 0) {
    throw Object.assign(new Error('canonicalizeActionTuple: goal must be a non-empty string'), { code: 'CTX_INCOMPLETE' });
  }
  // Keys inserted in lexicographic order (action < goal < target). Values are
  // NFC-normalized per spec.
  const ordered = {
    action: action.normalize('NFC'),
    goal: goal.normalize('NFC'),
    target: target.normalize('NFC'),
  };
  return JSON.stringify(ordered);
}

/**
 * "sha256:" + base64url(sha256(utf8(canonical))).
 */
export function computeActBindingHash(tuple: { action?: string; target?: string; goal?: string }): string {
  const canonical = canonicalizeActionTuple(tuple);
  return 'sha256:' + createHash('sha256').update(canonical, 'utf8').digest('base64url');
}

/**
 * Parse the binding claim from a JWT payload. The caller MUST have already
 * verified the signature — this only reads, it does not trust.
 *
 * A present-but-malformed claim is treated as absent (`act: null`).
 */
export function parseActBinding(payload: Record<string, unknown> | null | undefined): {
  act: ActBinding | null;
  actTypSupported: boolean;
} {
  const raw = payload?.[ACT_BINDING_CLAIM] as { typ?: unknown; hash?: unknown } | null | undefined;
  if (
    raw == null ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    typeof raw.typ !== 'string' ||
    typeof raw.hash !== 'string'
  ) {
    return { act: null, actTypSupported: false };
  }
  return {
    act: { typ: raw.typ, hash: raw.hash },
    actTypSupported: getSupportedTyps().includes(raw.typ),
  };
}

/**
 * Resolve act_status for a guard call. Pure and mode-independent: the mode
 * governs only the *block* decision (in guard.js), never the status itself.
 */
export function resolveActStatus(verification: ActVerification | null | undefined, ctx: ActContext): ActStatus {
  // Binding only means anything on a cryptographically verified token.
  if (!verification || verification.verification_status !== 'verified') return 'not_applicable';
  if (!verification.act) return 'not_present';
  if (!verification.act_typ_supported) return 'unsupported_typ';

  let computed: string;
  try {
    computed = computeActBindingHash({
      action: ctx.action_type,
      target: ctx.target,
      goal: ctx.declared_goal,
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'CTX_INCOMPLETE') return 'ctx_incomplete';
    throw err;
  }
  return verification.act.hash === computed ? 'match' : 'mismatch';
}
