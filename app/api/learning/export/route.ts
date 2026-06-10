export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { listDecisions } from '../../../lib/repositories/learning.repository';
import { listLearningRecommendations } from '../../../lib/repositories/learningLoop.repository';
import { renderLearningExport } from '../../../lib/learning-export';

const isMissingTable = (err: unknown) =>
  String((err as { code?: string })?.code || '').includes('42P01') ||
  String((err as Error)?.message || '').includes('does not exist');

// GET /api/learning/export?format=agents|claude[&agent_id=...]
// Renders an AGENTS.md / CLAUDE.md operating-notes file from recorded decisions
// + learned recommendations and returns it as a downloadable markdown attachment.
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const format = (searchParams.get('format') || 'agents').toLowerCase() === 'claude' ? 'claude' : 'agents';
    const agentId = searchParams.get('agent_id');

    let decisions: Record<string, unknown>[] = [];
    try {
      decisions = await listDecisions(sql, orgId, { agentId, limit: 200 });
    } catch (err) {
      if (!isMissingTable(err)) throw err;
    }

    let recommendations: Record<string, unknown>[] = [];
    try {
      recommendations = await listLearningRecommendations(sql, orgId, agentId ? { agentId, limit: 200 } : { limit: 200 });
    } catch (err) {
      if (!isMissingTable(err)) throw err;
    }

    const markdown = renderLearningExport({
      format,
      decisions,
      recommendations,
      generatedAt: new Date().toISOString(),
    });

    const filename = format === 'claude' ? 'CLAUDE.md' : 'AGENTS.md';
    return new NextResponse(markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Learning export error:', error);
    return NextResponse.json({ error: 'An error occurred generating the export' }, { status: 500 });
  }
}
