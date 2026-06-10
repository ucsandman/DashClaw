export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { isHostedMode } from '../../../lib/hosted/flag';
import { findExpiredWorkspaces, deleteHostedWorkspace } from '../../../lib/repositories/hosted-workspace.repository';
import { getSql } from '../../../lib/db';
import { timingSafeCompare } from '../../../lib/timing-safe';

function requireAdminOrCronSecret(request: Request): boolean {
  const role = request.headers.get('x-org-role');
  if (role === 'owner' || role === 'admin') return true;

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

export async function POST(request: Request) {
  if (!isHostedMode()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!requireAdminOrCronSecret(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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
