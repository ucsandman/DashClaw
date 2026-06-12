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

/** Path → first two segments (with trailing slash) so deep trees group sanely. */
function pathPrefix(p: string): string {
  const parts = p.split('/').filter(Boolean);
  if (parts.length <= 2) return p;
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
}

interface GrantContext {
  action_type?: unknown;
  target?: unknown;
  write_paths?: unknown;
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
  if (typeof rules.action_type !== 'string' || rules.action_type !== context.action_type) {
    return false;
  }
  if (rules.target_prefix === undefined || rules.target_prefix === null) return true;
  return targetPrefixMatches(String(rules.target_prefix), context);
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
