export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getOrgRole } from '../../../lib/org';
import {
  exportWorkspaceBundle,
  stampTrialExported,
} from '../../../lib/repositories/workspace-bundle.repository';

/**
 * GET /api/workspace/export — the workspace carry-out (roadmap v7.2).
 * Downloads the org's durable governance record as a portable bundle;
 * import it into an owned instance with `dashclaw import <file>` or
 * POST /api/workspace/import. Never contains credentials or secret values.
 * First export of a hosted trial stamps graduation (funnel truth).
 */
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const role = getOrgRole(request);

    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const bundle = await exportWorkspaceBundle(sql, orgId);
    // Stamp after a successful export build; hosted trials only, first wins.
    await stampTrialExported(sql, orgId);

    const datePart = bundle.exported_at.slice(0, 10);
    const orgPart = orgId.replace(/^org_/, '').slice(0, 8) || 'workspace';
    return NextResponse.json(bundle, {
      headers: {
        'content-disposition': `attachment; filename="dashclaw-workspace-${orgPart}-${datePart}.json"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[WORKSPACE/EXPORT] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
