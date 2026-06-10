export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { enforceFieldLimits } from '../../../../lib/validate.js';
import { scanSensitiveData } from '../../../../lib/security';
import { randomUUID } from 'node:crypto';

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const docId = searchParams.get('id');
    const search = searchParams.get('search');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);

    if (docId) {
      const rows = await sql`SELECT * FROM shared_docs WHERE id = ${docId} AND org_id = ${orgId}`;
      if (rows.length === 0) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }
      return NextResponse.json({ doc: rows[0] });
    }

    if (search) {
      const rows = await sql.query(
        `SELECT * FROM shared_docs WHERE org_id = $1 AND name ILIKE $2 ORDER BY updated_at DESC LIMIT $3`,
        [orgId, `%${search}%`, limit]
      );
      return NextResponse.json({ docs: rows, total: rows.length });
    }

    const rows = await sql`SELECT * FROM shared_docs WHERE org_id = ${orgId} ORDER BY updated_at DESC LIMIT ${limit}`;
    return NextResponse.json({ docs: rows, total: rows.length });
  } catch (error) {
    console.error('Shared docs GET error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching documents' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { ok, errors: fieldErrors } = enforceFieldLimits(body, { name: 500, content: 100000 });
    if (!ok) {
      return NextResponse.json({ error: 'Validation failed', details: fieldErrors }, { status: 400 });
    }

    const { name, content: contentRaw, agent_id } = body;

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!contentRaw) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }
    if (!agent_id) {
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });
    }

    // SECURITY: prevent storing raw secrets in shared docs (redact on write).
    const scan = scanSensitiveData(contentRaw);
    const content = scan.redacted;

    const id = `sd_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const now = new Date().toISOString();

    const result = await sql`
      INSERT INTO shared_docs (id, org_id, name, content, created_by, last_edited_by, version, created_at, updated_at)
      VALUES (${id}, ${orgId}, ${name}, ${content}, ${agent_id}, ${agent_id}, 1, ${now}, ${now})
      ON CONFLICT (org_id, name)
      DO UPDATE SET content = EXCLUDED.content, last_edited_by = EXCLUDED.last_edited_by,
        version = shared_docs.version + 1, updated_at = EXCLUDED.updated_at
      RETURNING *
    `;

    return NextResponse.json({
      doc: result[0],
      doc_id: result[0].id,
      security: {
        clean: scan.clean,
        findings_count: scan.findings.length,
        critical_count: scan.findings.filter(f => f.severity === 'critical').length,
        categories: [...new Set(scan.findings.map(f => f.category))],
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Shared docs POST error:', error);
    return NextResponse.json({ error: 'An error occurred while saving document' }, { status: 500 });
  }
}
