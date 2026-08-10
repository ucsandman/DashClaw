/**
 * Multi-tenant org helpers.
 * Reads org context injected by middleware via request headers.
 */

export function getOrgId(request: Request): string {
  return request.headers.get('x-org-id') || 'org_default';
}

export function getOrgRole(request: Request): string {
  return request.headers.get('x-org-role') || 'member';
}

export function getUserId(request: Request): string {
  return request.headers.get('x-user-id') || '';
}
