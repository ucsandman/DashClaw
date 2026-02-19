import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const templateId = searchParams.get('template_id');
    const versionId = searchParams.get('version_id');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);

    let runs;
    if (templateId) {
      runs = await sql`
        SELECT pr.*, pt.name AS template_name, pv.version
        FROM prompt_runs pr
        JOIN prompt_templates pt ON pt.id = pr.template_id
        JOIN prompt_versions pv ON pv.id = pr.version_id
        WHERE pr.org_id = ${orgId} AND pr.template_id = ${templateId}
        ORDER BY pr.created_at DESC
        LIMIT ${limit}
      `;
    } else if (versionId) {
      runs = await sql`
        SELECT pr.*, pt.name AS template_name, pv.version
        FROM prompt_runs pr
        JOIN prompt_templates pt ON pt.id = pr.template_id
        JOIN prompt_versions pv ON pv.id = pr.version_id
        WHERE pr.org_id = ${orgId} AND pr.version_id = ${versionId}
        ORDER BY pr.created_at DESC
        LIMIT ${limit}
      `;
    } else {
      runs = await sql`
        SELECT pr.*, pt.name AS template_name, pv.version
        FROM prompt_runs pr
        JOIN prompt_templates pt ON pt.id = pr.template_id
        JOIN prompt_versions pv ON pv.id = pr.version_id
        WHERE pr.org_id = ${orgId}
        ORDER BY pr.created_at DESC
        LIMIT ${limit}
      `;
    }

    return NextResponse.json({ runs });
  } catch (err) {
    console.error('[prompts/runs] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch runs' }, { status: 500 });
  }
}
