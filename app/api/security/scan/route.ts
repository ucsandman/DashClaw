export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { scanSensitiveData } from '../../../lib/security';
import { createHash, randomUUID } from 'node:crypto';

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { text, destination, agent_id, store } = body;

    if (!text) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }
    if (typeof text !== 'string') {
      return NextResponse.json({ error: 'text must be a string' }, { status: 400 });
    }

    const { findings, redacted, clean } = scanSensitiveData(text);

    const criticalCount = findings.filter((f: { severity: string }) => f.severity === 'critical').length;
    const categories = [...new Set(findings.map((f: { category: string }) => f.category))];

    const result = {
      clean,
      findings_count: findings.length,
      critical_count: criticalCount,
      categories,
      findings,
      redacted_text: redacted,
      destination: destination || null,
    };

    // Optionally store metadata (never the actual content)
    if (store !== false && findings.length > 0) {
      const contentHash = createHash('sha256').update(text).digest('hex');
      const id = `sf_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
      const now = new Date().toISOString();

      await sql`
        INSERT INTO security_findings (id, org_id, agent_id, content_hash, findings_count, critical_count, categories, scanned_at)
        VALUES (${id}, ${orgId}, ${agent_id || null}, ${contentHash}, ${findings.length}, ${criticalCount}, ${JSON.stringify(categories)}, ${now})
      `.catch((err: unknown) => console.error('Failed to store security finding metadata:', (err as Error).message));
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Security scan POST error:', error);
    return NextResponse.json({ error: 'An error occurred during security scan' }, { status: 500 });
  }
}
