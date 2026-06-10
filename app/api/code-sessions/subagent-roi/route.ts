export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { computeRoiFromRows } from '../../../lib/claude-code/subagent-roi';
import type { AttributionRow } from '../../../lib/claude-code/subagent-roi';
import { listSubagentToolUseAttribution } from '../../../lib/repositories/code-sessions.repository';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project_id');
  const sql = getSql();
  const orgId = getOrgId(request);

  // The raw SQL lives in the repository per the route-level SQL guardrail; the
  // filter + ROI computation is the shared helper the project-page UI uses too.
  const rows = await listSubagentToolUseAttribution(sql, orgId, { projectId });
  return NextResponse.json({ project_id: projectId, roi: computeRoiFromRows(rows as unknown as AttributionRow[]) });
}
