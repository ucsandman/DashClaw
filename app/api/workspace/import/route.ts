export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getOrgRole } from '../../../lib/org';
import {
  importWorkspaceBundle,
  BundleValidationError,
} from '../../../lib/repositories/workspace-bundle.repository';

/**
 * POST /api/workspace/import — ingest a workspace carry-out bundle
 * (roadmap v7.2) into THIS org. Idempotent: rows already present (by
 * per-table dedupe key, org-scoped) are skipped, so re-import is safe.
 * Body: the JSON produced by GET /api/workspace/export.
 * API keys, OAuth tokens, and secret values never ride a bundle.
 */
export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const role = getOrgRole(request);

    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    let bundle: unknown;
    try {
      bundle = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body must be a workspace bundle (JSON)' }, { status: 400 });
    }

    const { counts } = await importWorkspaceBundle(sql, orgId, bundle);
    const totals = Object.values(counts).reduce(
      (acc, c) => ({ imported: acc.imported + c.imported, skipped: acc.skipped + c.skipped }),
      { imported: 0, skipped: 0 },
    );
    return NextResponse.json({ ...totals, counts }, { status: 201 });
  } catch (err) {
    if (err instanceof BundleValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[WORKSPACE/IMPORT] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
