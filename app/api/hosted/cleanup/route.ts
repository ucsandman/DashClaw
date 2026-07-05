export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { isHostedMode } from '../../../lib/hosted/flag';
import { findExpiredWorkspaces, deleteHostedWorkspace } from '../../../lib/repositories/hosted-workspace.repository';
import { getSql } from '../../../lib/db';
import { timingSafeCompare } from '../../../lib/timing-safe';
import { denyTrialPrincipal } from '../../../lib/hosted/trial-principal';

// Secret-based auth for the cron/operator sweep. Does NOT include the
// admin-role path: cleanup deletes expired workspaces across ALL tenants, so
// it is an operator/cron surface, not an org-admin one. Before v5.1 the role
// path was harmless (no untrusted admin sessions existed on hosted); a trial
// session now makes it a cross-tenant destructive hole. The admin-role path
// is preserved separately in POST, gated behind denyTrialPrincipal so the
// operator (non-trial org) keeps the dashboard-triggerable convenience.
function hasCleanupSecret(request: Request): boolean {
  // Path 1: explicit x-cleanup-secret header (used by GH Actions + manual curl).
  // timingSafeCompare — `===` on a secret leaks byte-wise equality via branch
  // timing. Practically a weak signal for a long secret, but every other
  // secret comparison in the codebase uses the safe helper.
  const xSecret = request.headers.get('x-cleanup-secret');
  if (xSecret && process.env.HOSTED_CLEANUP_SECRET && timingSafeCompare(xSecret, process.env.HOSTED_CLEANUP_SECRET)) {
    return true;
  }

  // Path 2: Authorization: Bearer <CRON_SECRET> (Vercel cron convention)
  const auth = request.headers.get('authorization');
  if (auth && process.env.CRON_SECRET) {
    const prefix = 'Bearer ';
    if (auth.startsWith(prefix) && timingSafeCompare(auth.slice(prefix.length), process.env.CRON_SECRET)) {
      return true;
    }
  }

  return false;
}

async function requireCleanupAuth(request: Request): Promise<NextResponse | null> {
  if (hasCleanupSecret(request)) return null;

  // Operator-admin fallback (dashboard/manual): admin role AND a non-trial
  // org. A trial principal is denied even though it holds x-org-role: admin.
  const role = request.headers.get('x-org-role');
  if (role === 'owner' || role === 'admin') {
    return denyTrialPrincipal(request);
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export async function POST(request: Request) {
  if (!isHostedMode()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const denied = await requireCleanupAuth(request);
  if (denied) return denied;

  const sql = getSql();
  const expired = await findExpiredWorkspaces(sql, { now: new Date(), limit: 100 });
  let deleted = 0;
  const errors = [];
  for (const orgId of expired) {
    try {
      const r = await deleteHostedWorkspace(sql, orgId as string);
      if (r.deleted) deleted += 1;
    } catch (err) {
      errors.push({ orgId, error: (err as Error).message });
    }
  }
  return NextResponse.json({ found: expired.length, deleted, errors });
}
