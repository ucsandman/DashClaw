import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { listPromptRuns } from '../../../lib/repositories/prompts.repository.js';

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const templateId = searchParams.get('template_id');
    const versionId = searchParams.get('version_id');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);

    const runs = await listPromptRuns(sql, orgId, { templateId, versionId, limit });

    return NextResponse.json({ runs });
  } catch (err) {
    console.error('[prompts/runs] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch runs' }, { status: 500 });
  }
}
