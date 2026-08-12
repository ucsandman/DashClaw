// app/lib/policy-shapes.ts
// Action "shapes" — the shared coordinate system for allow_grant matching and
// review-feed grouping. A shape is (action_type, normalized target prefix):
// URLs normalize to their host; file paths group by their first two segments.

export interface ActionShape {
  action_type: string;
  target_prefix: string | null;
  /** Stable grouping key: `${action_type}::${target_prefix ?? ''}` */
  key: string;
  /** Human label for the review feed, e.g. "api → api.stripe.com". */
  label: string;
}

/** URL → hostname (port-stripped); anything else → trimmed string; empty → null. */
export function normalizeTarget(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) {
    try {
      return new URL(t).hostname || null;
    } catch {
      return t;
    }
  }
  return t;
}

export function shapeKey(actionType: string, targetPrefix: string | null): string {
  return `${actionType}::${targetPrefix ?? ''}`;
}

/**
 * May this shape become an allow_grant?
 *
 * A grant must name WHAT it covers. grantMatches() below returns true for any
 * action of the type when rules.target_prefix is absent, so a target-less grant
 * silently nullifies every require_approval policy for that action type — the
 * F1 finding of the governance gap audit 2026-08-05, where one org had
 * accumulated 19 of them.
 *
 * This is the ONE place that rule lives. The review verdict route rejects what
 * this returns false for, and the /policies triage inbox uses it to not offer
 * the verb at all — a button whose only outcome is a 400 is not a choice.
 * Whitespace counts as absent: `prefixMatches` fails closed on it, so a grant
 * scoped to " " would be a dead row that reads as a resolved one.
 */
export function shapeIsGrantable(targetPrefix: string | null | undefined): boolean {
  return typeof targetPrefix === 'string' && targetPrefix.trim().length > 0;
}

// A hostname segment: labels joined by dots, no leading dot, no drive colon.
// `github.com` and `api.stripe.com` match; `.next`, `C:`, `Users`, `..` do not.
const HOST_SEGMENT_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/i;

/**
 * Reduce a URL-ish path to `host/first-segment/` so deep trees group sanely.
 *
 * ONLY hosts shorten. Collapsing a FILESYSTEM path to its first two segments
 * is a grant-widening bug: `C:/Users/sandm/Documents` became `C:/Users/`, and
 * because a grant's target_prefix is a prefix match, a single approval on one
 * file under the profile authorized every action of that type across the whole
 * user tree. Live repro 2026-08-11 on my-dashclaw.vercel.app: grant
 * gp_02ad86b4b16645fb94e4667d, `security -> C:/Users/`, which downgraded the
 * risk-100 require_approval rail to allow for anything under C:/Users.
 * (Backslash paths never hit this because targetPrefixOf only shortens when
 * the target contains `/` — the bug fired exactly on forward-slash targets.)
 *
 * Filesystem paths now keep their exact target, which is the tighten-only
 * direction: a grant covers what was approved and nothing more.
 */
function pathPrefix(p: string): string {
  const parts = p.split('/').filter(Boolean);
  if (parts.length <= 2) return p;
  if (p.startsWith('/')) return p;
  if (!HOST_SEGMENT_RE.test(parts[0] ?? '')) return p;
  return `${parts[0]}/${parts[1]}/`;
}

/** Reduce a normalized target to its grouping prefix (hosts stay whole, paths shorten). */
export function targetPrefixOf(normalized: string | null): string | null {
  if (!normalized) return null;
  return normalized.includes('/') ? pathPrefix(normalized) : normalized;
}

interface GrantRules {
  action_type?: unknown;
  target_prefix?: unknown;
  expires_at?: unknown;
  /** Precedent grants only — see PRECEDENT_ELIGIBLE below. */
  precedent_flags?: unknown;
}

interface GrantContext {
  action_type?: unknown;
  declared_action_type?: unknown;
  target?: unknown;
  write_paths?: unknown;
  /** SERVER-SET-ONLY (guard/types.ts). Never populated from request input. */
  evidence_flags?: unknown;
}

/** Default grant lifetime (F1, governance gap audit 2026-08-05): grants
 *  accumulated for months with no expiry and silently nullified every
 *  require_approval policy in the org. New grants are stamped with an
 *  explicit rules.expires_at at creation; legacy grants age out from their
 *  row's created_at. */
export const GRANT_DEFAULT_TTL_DAYS = 30;

/**
 * When this grant stops applying. rules.expires_at (ISO string, stamped at
 * creation since v5.8.0) wins; a legacy grant without one expires — version-hardcode-allowed
 * GRANT_DEFAULT_TTL_DAYS after its row's created_at. Returns null only when
 * neither is available (synthetic rows in tests) — those never expire, but
 * every real guard_policies row carries created_at.
 */
export function grantExpiresAt(rules: GrantRules, createdAt?: unknown): Date | null {
  if (typeof rules.expires_at === 'string' && rules.expires_at) {
    const d = new Date(rules.expires_at);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (createdAt != null) {
    const c = new Date(createdAt as string | number | Date);
    if (!Number.isNaN(c.getTime())) {
      return new Date(c.getTime() + GRANT_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000);
    }
  }
  return null;
}

/** True when the grant's lifetime has lapsed (never true without expiry info). */
export function grantIsExpired(rules: GrantRules, createdAt?: unknown, now: Date = new Date()): boolean {
  const exp = grantExpiresAt(rules, createdAt);
  return exp != null && exp.getTime() <= now.getTime();
}

/** Boundary-aware prefix match: hosts match exactly or as a dot-separated
 *  subdomain suffix; paths match exactly or at a `/` segment boundary.
 *  Empty prefixes never match (fail closed). */
export function prefixMatches(prefix: string, candidate: string): boolean {
  if (!prefix || !candidate) return false;
  if (candidate === prefix) return true;
  if (prefix.includes('/')) {
    const withSlash = prefix.endsWith('/') ? prefix : `${prefix}/`;
    return candidate.startsWith(withSlash);
  }
  // host semantics: grant for stripe.com also covers api.stripe.com
  return candidate.endsWith(`.${prefix}`);
}

/** Does this guard context's target (or any write path) match a target prefix? */
export function targetPrefixMatches(prefix: string, context: GrantContext): boolean {
  const candidates: string[] = [];
  const t = normalizeTarget(typeof context.target === 'string' ? context.target : null);
  if (t) candidates.push(t);
  if (Array.isArray(context.write_paths)) {
    for (const p of context.write_paths) {
      const n = normalizeTarget(typeof p === 'string' ? p : null);
      if (n) candidates.push(n);
    }
  }
  return candidates.some((c) => prefixMatches(prefix, c));
}

/** Does an allow_grant's shape match this guard context? */
export function grantMatches(rules: GrantRules, context: GrantContext): boolean {
  // No grant applies across a reclassification (F1, governance gap audit
  // 2026-08-05): when the evidence fold swapped the evaluation onto a derived
  // action_type (declared_action_type records the original), the declared
  // intent and the observed act disagree — a grant scoped to either single
  // type cannot cover both, and letting one match is how a policy written on
  // `post` was downgraded by a grant on `api` (live repro
  // act_gd_a710f056c50d4eb8). Restrictive policies match through the swap;
  // permissive grants fail closed on it.
  if (
    typeof context.declared_action_type === 'string'
    && context.declared_action_type
    && context.declared_action_type !== context.action_type
  ) {
    return false;
  }
  if (typeof rules.action_type !== 'string' || rules.action_type !== context.action_type) {
    return false;
  }
  // Precedent grants are scoped by the SERVER's own evidence flag set, never by
  // an operator-supplied target prefix. This branch is entered only when the
  // field is present, so every pre-existing grant behaves byte-identically.
  if (rules.precedent_flags !== undefined && rules.precedent_flags !== null) {
    return precedentGrantMatches(rules.precedent_flags, context);
  }
  if (rules.target_prefix === undefined || rules.target_prefix === null) return true;
  return targetPrefixMatches(String(rules.target_prefix), context);
}

// ── Precedent grants ────────────────────────────────────────────────────────
// A precedent is an ordinary allow_grant whose scope is an exact
// server-computed evidence flag set instead of a target prefix. It exists so a
// shape the operator has personally waved through many times stops asking —
// without ever becoming the kind of open-ended authorization that
// `security -> C:/Users/` was (see pathPrefix above for that live incident).
//
// Three structural safety properties, in order of importance:
//
//  1. CLOSED ALLOWLIST. A shape not enumerated in PRECEDENT_ELIGIBLE can never
//     be learned, at any approval count, by any code path. Adding an entry is a
//     deliberate, reviewed act — not something evidence can do on its own.
//  2. EXACT FLAG-SET EQUALITY. A superset never matches. An act carrying any
//     additional property (a protected target, a privilege escalation) is a
//     different kind of act and falls outside the precedent by construction.
//  3. SERVER-AUTHORED SCOPE. The flags come from context.evidence_flags, which
//     validate() strips from client input (guard/types.ts). A compromised agent
//     cannot describe itself into a precedent's scope.
//
// ADMISSION RULE for PRECEDENT_ELIGIBLE, recorded so future edits are held to
// it: a shape may be listed only if its worst case over EVERY input the
// classifier grades into it is recoverable by re-running a build command, AND
// its flag set alone proves workspace-boundedness.
export const PRECEDENT_ELIGIBLE: ReadonlySet<string> = new Set([
  // `regenerable_artifact` is set only when EVERY delete target passes
  // isRegenerableArtifactTarget (guard/evidence.ts), which rejects globs,
  // absolute paths, `~`, drive-qualified paths and `..`. So this shape is
  // workspace-bounded BY CONSTRUCTION and needs no separate reach classifier.
  'cleanup|destructive,regenerable_artifact',
]);

// Redundant denylist. PRECEDENT_ELIGIBLE alone is sufficient — this is a second
// gate so that ADDING a bad entry above is not enough to open a hole by itself.
export const NEVER_PRECEDENTED: ReadonlySet<string> = new Set([
  'protected_target', 'device_write', 'interpreter_destructive', 'remote_exec',
  'secret_exposure', 'sensitive_path', 'privilege', 'deploy', 'vcs_dangerous',
]);

/** Precedent grant lifetime. Deliberately shorter than GRANT_DEFAULT_TTL_DAYS:
 *  a learned relaxation should have to re-earn itself. */
export const PRECEDENT_TTL_DAYS = 14;

/** Sorted, de-duplicated, non-empty string flags — or null when malformed. */
export function normalizeFlags(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const clean = raw.filter((f): f is string => typeof f === 'string' && f.length > 0);
  if (clean.length === 0) return null;
  return [...new Set(clean)].sort();
}

/** Stable precedent identity: `${action_type}|${sorted,flags}`. */
export function precedentKey(actionType: string, flags: string[]): string {
  return `${actionType}|${[...flags].sort().join(',')}`;
}

/** May this (action_type, flag set) EVER become a precedent? */
export function precedentEligible(actionType: string, flags: string[]): boolean {
  if (flags.some((f) => NEVER_PRECEDENTED.has(f))) return false;
  return PRECEDENT_ELIGIBLE.has(precedentKey(actionType, flags));
}

function precedentGrantMatches(rawGrantFlags: unknown, context: GrantContext): boolean {
  const grantFlags = normalizeFlags(rawGrantFlags);
  if (!grantFlags) return false;
  // No server-classified flags on this call means no evidence that it is the
  // learned shape. Fail closed rather than fall through to a looser check.
  const actFlags = normalizeFlags(context.evidence_flags);
  if (!actFlags) return false;
  const actionType = typeof context.action_type === 'string' ? context.action_type : '';
  // Re-checked at MATCH time, not only at creation: narrowing the allowlist
  // must retire already-stored precedents immediately, without a migration.
  if (!precedentEligible(actionType, grantFlags)) return false;
  if (grantFlags.length !== actFlags.length) return false;
  return grantFlags.every((f, i) => f === actFlags[i]);
}

/** Shape of a stored guard_decisions row (action_type column + context JSON text). */
export function extractDecisionShape(row: { action_type?: unknown; context?: unknown }): ActionShape {
  const actionType = typeof row.action_type === 'string' && row.action_type ? row.action_type : 'unknown';
  let target: string | null = null;
  if (typeof row.context === 'string' && row.context) {
    try {
      const ctx = JSON.parse(row.context) as { target?: unknown };
      target = normalizeTarget(typeof ctx.target === 'string' ? ctx.target : null);
    } catch {
      target = null;
    }
  }
  const prefix = targetPrefixOf(target);
  return {
    action_type: actionType,
    target_prefix: prefix,
    key: shapeKey(actionType, prefix),
    label: prefix ? `${actionType} → ${prefix}` : actionType,
  };
}
