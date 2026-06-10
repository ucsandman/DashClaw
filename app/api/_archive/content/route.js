export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { enforceFieldLimits } from '../../../lib/validate.js';
import { scanSensitiveData } from '../../../lib/security';

// sql initialized inside handler for serverless compatibility

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id');

    // Get all content (optionally filtered by agent)
    const content = agentId
      ? await sql`SELECT * FROM content WHERE org_id = ${orgId} AND agent_id = ${agentId} ORDER BY created_at DESC`
      : await sql`SELECT * FROM content WHERE org_id = ${orgId} ORDER BY created_at DESC`;

    // Calculate stats by platform
    const byPlatform = {};
    content.forEach(c => {
      const platform = c.platform || 'other';
      if (!byPlatform[platform]) byPlatform[platform] = { count: 0, published: 0, draft: 0 };
      byPlatform[platform].count += 1;
      if (c.status === 'published') byPlatform[platform].published += 1;
      if (c.status === 'draft') byPlatform[platform].draft += 1;
    });

    const stats = {
      totalContent: content.length,
      published: content.filter(c => c.status === 'published').length,
      draft: content.filter(c => c.status === 'draft').length,
      byPlatform
    };

    return NextResponse.json({
      content,
      stats,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    // SECURITY: Log detailed error server-side, return generic message to client
    console.error('Content API error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching content data', content: [], stats: {} }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { ok, errors: fieldErrors } = enforceFieldLimits(body, { title: 500, platform: 100, body: 50000, url: 2000, status: 50 });
    if (!ok) {
      return NextResponse.json({ error: 'Validation failed', details: fieldErrors }, { status: 400 });
    }

    const { title, platform, status, url, body: contentBodyRaw, agent_id } = body;

    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const bodyScan = contentBodyRaw ? scanSensitiveData(contentBodyRaw) : { clean: true, findings: [], redacted: contentBodyRaw };
    const contentBody = bodyScan.redacted;

    const result = await sql`
      INSERT INTO content (org_id, title, platform, status, url, body, agent_id, created_at)
      VALUES (
        ${orgId},
        ${title},
        ${platform || null},
        ${status || 'draft'},
        ${url || null},
        ${contentBody || null},
        ${agent_id || null},
        ${new Date().toISOString()}
      )
      RETURNING *
    `;

    return NextResponse.json({
      content: result[0],
      security: {
        clean: bodyScan.clean,
        findings_count: bodyScan.findings.length,
        critical_count: bodyScan.findings.filter(f => f.severity === 'critical').length,
        categories: [...new Set(bodyScan.findings.map(f => f.category))],
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Content API POST error:', error);
    return NextResponse.json({ error: 'An error occurred while creating content' }, { status: 500 });
  }
}

