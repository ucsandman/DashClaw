import { NextResponse } from 'next/server';
import { isHostedMode } from './flag';
import { getSql } from '../db';
import { getOrgId } from '../org';
import { getHostedWorkspace } from '../repositories/hosted-workspace.repository';

/**
 * Operator/cross-tenant guard for hosted instances (v5.1).
 *
 * v5.1 gave hosted-trial workspaces a browser session with `x-org-role:
 * admin` — admin of the *trial's own org*, exactly like an OAuth personal
 * org. But "admin" alone gates several routes that are really INSTANCE
 * OPERATOR surfaces (inspect/delete any trial, create new tenants, run the
 * cleanup sweep, reveal the bootstrap key). Before v5.1 no untrusted
 * stranger ever held an admin session on the hosted instance, so role-only
 * gating was safe; now it is a cross-tenant hole. This helper draws the line
 * the role no longer can: a hosted-trial principal may never perform an
 * operator/cross-tenant operation.
 *
 * Returns a 403 NextResponse to short-circuit with, or null to proceed.
 *
 * - Off-hosted (self-host / the maintainer's instance): no trial principals
 *   exist, so this is a mechanical no-op — the operator keeps full access
 *   and un-migrated self-host schemas are never queried.
 * - On hosted: the caller may proceed ONLY if their own org is positively
 *   confirmed non-trial (the operator org is not `hosted_mode`). A trial org
 *   is denied; a lookup failure is denied too (fail closed — we never let an
 *   unverifiable caller through an operator-power route).
 */
export async function denyTrialPrincipal(request: Request): Promise<NextResponse | null> {
  if (!isHostedMode()) return null;
  try {
    const org = await getHostedWorkspace(getSql(), getOrgId(request));
    if (org && !org.hostedMode) return null; // confirmed operator / non-trial org
    return NextResponse.json(
      { error: 'Not available for trial workspaces' },
      { status: 403 },
    );
  } catch {
    return NextResponse.json(
      { error: 'Unable to verify workspace' },
      { status: 403 },
    );
  }
}
