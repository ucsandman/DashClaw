export const SUPPORTED_OAUTH_SCOPES = ['governance:read', 'governance:write'] as const;

export type OAuthScope = (typeof SUPPORTED_OAUTH_SCOPES)[number];

const SUPPORTED_SCOPE_SET = new Set<string>(SUPPORTED_OAUTH_SCOPES);

export function normalizeOAuthScope(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const requested = value.trim().split(/\s+/).filter(Boolean);
  if (requested.length === 0 || requested.some((scope) => !SUPPORTED_SCOPE_SET.has(scope))) {
    return null;
  }
  const unique = new Set(requested);
  return SUPPORTED_OAUTH_SCOPES.filter((scope) => unique.has(scope)).join(' ');
}

export function oauthScopeAllows(scopeValue: string, required: OAuthScope): boolean {
  const scopes = new Set(scopeValue.split(' '));
  return scopes.has('governance:write') || scopes.has(required);
}

export function oauthScopeIsSubset(requested: string, allowed: string): boolean {
  const allowedScopes = new Set(allowed.split(' '));
  return requested.split(' ').every((scope) => allowedScopes.has(scope));
}
