export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { scanForPromptInjection } from '../../../lib/promptInjection';
import { insertScan, listScans } from '../../../lib/repositories/promptInjection.repository';
import { createHash } from 'node:crypto';

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { text, source, agent_id, store } = body;

    if (!text) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }
    if (typeof text !== 'string') {
      return NextResponse.json({ error: 'text must be a string' }, { status: 400 });
    }

    const result = scanForPromptInjection(text);

    const criticalCount = result.findings.filter((f: { severity: string }) => f.severity === 'critical').length;

    const response = {
      clean: result.clean,
      risk_level: result.risk_level,
      recommendation: result.recommendation,
      findings_count: result.findings_count,
      critical_count: criticalCount,
      categories: result.categories,
      findings: result.findings,
      source: source || null,
    };

    // Optionally store metadata (never the actual content)
    if (store !== false && result.findings_count > 0) {
      const contentHash = createHash('sha256').update(text).digest('hex');
      await insertScan(sql, orgId, {
        agent_id: agent_id || null,
        content_hash: contentHash,
        findings_count: result.findings_count,
        critical_count: criticalCount,
        categories: result.categories,
        risk_level: result.risk_level,
        recommendation: result.recommendation,
        source: source || null,
      }).catch((err: unknown) => console.error('Failed to store prompt injection scan metadata:', (err as Error).message));
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Prompt injection scan POST error:', error);
    return NextResponse.json({ error: 'An error occurred during prompt injection scan' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
    const rawOffset = parseInt(searchParams.get('offset') || '0', 10);
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

    const { scans, total } = await listScans(sql, orgId, { limit, offset });

    return NextResponse.json({ scans, total });
  } catch (error) {
    console.error('Prompt injection scan GET error:', error);
    return NextResponse.json({ error: 'An error occurred fetching prompt injection scans' }, { status: 500 });
  }
}
