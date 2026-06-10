export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { enforceFieldLimits } from '../../../lib/validate.js';
import { scanSensitiveData } from '../../../lib/security';
import { randomUUID } from 'node:crypto';

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const tag = searchParams.get('tag');
    const language = searchParams.get('language');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

    const conditions = ['org_id = $1'];
    const params = [orgId];
    let idx = 2;

    if (search) {
      conditions.push(`(name ILIKE $${idx} OR description ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (tag) {
      conditions.push(`tags ILIKE $${idx}`);
      params.push(`%${tag}%`);
      idx++;
    }
    if (language) {
      conditions.push(`language = $${idx}`);
      params.push(language);
      idx++;
    }

    const where = conditions.join(' AND ');
    const rows = await sql.query(
      `SELECT * FROM snippets WHERE ${where} ORDER BY use_count DESC, created_at DESC LIMIT $${idx}`,
      [...params, limit]
    );

    return NextResponse.json({ snippets: rows, total: rows.length });
  } catch (error) {
    console.error('Snippets GET error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching snippets' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { ok, errors: fieldErrors } = enforceFieldLimits(body, { name: 200, code: 50000, description: 2000, language: 50 });
    if (!ok) {
      return NextResponse.json({ error: 'Validation failed', details: fieldErrors }, { status: 400 });
    }

    const { name, code: codeRaw, description: descriptionRaw, language, tags, agent_id } = body;

    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    if (!codeRaw) return NextResponse.json({ error: 'code is required' }, { status: 400 });

    // SECURITY: redact secrets in code/description before storing.
    const codeScan = scanSensitiveData(codeRaw);
    const descScan = descriptionRaw ? scanSensitiveData(descriptionRaw) : { clean: true, findings: [], redacted: descriptionRaw };
    const code = codeScan.redacted;
    const description = descScan.redacted;

    const id = `sn_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const now = new Date().toISOString();
    const tagsJson = tags ? JSON.stringify(tags) : null;

    const result = await sql`
      INSERT INTO snippets (id, org_id, agent_id, name, description, code, language, tags, created_at)
      VALUES (${id}, ${orgId}, ${agent_id || null}, ${name}, ${description || null}, ${code}, ${language || null}, ${tagsJson}, ${now})
      ON CONFLICT (org_id, name)
      DO UPDATE SET code = EXCLUDED.code, description = COALESCE(EXCLUDED.description, snippets.description),
        language = COALESCE(EXCLUDED.language, snippets.language), tags = COALESCE(EXCLUDED.tags, snippets.tags),
        agent_id = COALESCE(EXCLUDED.agent_id, snippets.agent_id)
      RETURNING *
    `;

    const findings = [...(codeScan.findings || []), ...(descScan.findings || [])];
    return NextResponse.json({
      snippet: result[0],
      snippet_id: result[0].id,
      security: {
        clean: findings.length === 0,
        findings_count: findings.length,
        critical_count: findings.filter(f => f.severity === 'critical').length,
        categories: [...new Set(findings.map(f => f.category))],
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Snippets POST error:', error);
    return NextResponse.json({ error: 'An error occurred while saving snippet' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) return NextResponse.json({ error: 'id query param is required' }, { status: 400 });

    const result = await sql`
      DELETE FROM snippets WHERE id = ${id} AND org_id = ${orgId} RETURNING id
    `;

    if (result.length === 0) {
      return NextResponse.json({ error: 'Snippet not found' }, { status: 404 });
    }

    return NextResponse.json({ deleted: true, id });
  } catch (error) {
    console.error('Snippets DELETE error:', error);
    return NextResponse.json({ error: 'An error occurred while deleting snippet' }, { status: 500 });
  }
}
