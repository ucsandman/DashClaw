export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../../lib/db';
import { getOrgId } from '../../../../../../lib/org';
import { buildOptimalFilesBundle } from '../../../../../../lib/claude-code/optimal-files/bundle';
import {
  getSessionDetail,
  getProjectMedianCost,
  getSimilarSessionCount,
} from '../../../../../../lib/repositories/code-sessions.repository';

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const sql = getSql();
  const orgId = getOrgId(request);
  const detail = await getSessionDetail(sql, orgId, sessionId);
  if (!detail) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { toolUses } = detail;
  const session = detail.session as Record<string, any>;

  const [projectMedianCost, similarSessionCount] = await Promise.all([
    getProjectMedianCost(sql, orgId, session.project_id, sessionId),
    getSimilarSessionCount(sql, orgId, session.project_id, session),
  ]);
  const toolEvents = toolUses.map((t: any) => ({ name: t.name, target: t.target, requestId: t.request_id }));

  const built = buildOptimalFilesBundle({
    session,
    project: { id: session.project_id, slug: session.project_slug, cwd: session.project_cwd },
    toolEvents,
    projectCwd: session.project_cwd,
    projectMedianCost: projectMedianCost as null | undefined,
    similarSessionCount,
    projectFiles: null, // server cannot read user's filesystem
    now: undefined,
    existingPaths: null, // -> overwriteRisk='unknown'
  });

  return NextResponse.json({
    session_id: sessionId,
    bundle: built.bundle.map((f: any) => ({
      path: f.path, kind: f.kind, title: f.title, reason: f.reason,
      confidence: f.confidence, group: f.group,
      commit_recommendation: f.commitRecommendation,
      content: f.content,
      secret_scan: f.secretScan,
      overwrite_risk: f.overwriteRisk,
      virtual: !!f.virtual,
    })),
    groups: built.groups,
    analysis: built.analysis,
  });
}
