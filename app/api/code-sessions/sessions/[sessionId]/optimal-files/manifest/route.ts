export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../../lib/db';
import { getOrgId } from '../../../../../../lib/org';
import {
  buildOptimalFilesBundle,
  planBundleSelections,
} from '../../../../../../lib/claude-code/optimal-files/bundle';
import {
  getSessionDetail,
  getProjectMedianCost,
  getSimilarSessionCount,
  saveManifest,
} from '../../../../../../lib/repositories/code-sessions.repository';

// `.claude/agentlens/` is the legacy (pre-rename) prefix, kept so manifests
// minted by an older client still apply within their 24h TTL.
const ALLOWED_PREFIXES = ['CLAUDE.md', '.claude/dashclaw/', '.claude/agentlens/', '.claude/rules/', '.claude/hooks/', '.claude/skills/'];

function isAllowedPath(p: unknown): boolean {
  if (!p) return false;
  const path = p as string;
  if (path.startsWith('..') || path.includes('..\\') || path.includes('../')) return false;
  return ALLOWED_PREFIXES.some(pref => path === pref || path.startsWith(pref));
}

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const selections = Array.isArray(body?.selections) ? body.selections : null;
  if (!selections) return NextResponse.json({ error: 'missing_selections' }, { status: 400 });

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
    projectFiles: null,
    now: undefined,
    existingPaths: null,
  });

  // Validate every selected path is in the bundle and matches the allowlist.
  for (const sel of selections) {
    if (!sel?.path || !isAllowedPath(sel.path)) {
      return NextResponse.json({ error: 'invalid_path', path: sel?.path }, { status: 400 });
    }
    const inBundle = built.bundle.find((f: any) => f.path === sel.path);
    if (!inBundle) return NextResponse.json({ error: 'path_not_in_bundle', path: sel.path }, { status: 400 });
  }

  const plan = planBundleSelections({
    bundle: built.bundle,
    projectCwd: session.project_cwd || '.',
    selections,
  });

  // Apply caller-supplied content overrides. The path is already
  // allowlist-validated above, so editing content cannot smuggle a write
  // outside the .claude tree. The CLI re-runs the secret scan at apply
  // time, so server-side rescan is best-effort — we skip it to keep the
  // contract narrow.
  const contentOverrides = new Map();
  for (const sel of selections) {
    if (typeof sel.content === 'string') contentOverrides.set(sel.path, sel.content);
  }
  if (contentOverrides.size > 0) {
    for (const result of plan.results) {
      if (contentOverrides.has(result.path)) {
        result.content = contentOverrides.get(result.path);
        result.edited = true;
      }
    }
  }

  // Backfill content for every entry. The 'safe'/unknown-existence plan branch
  // omits it, but the CLI writes entry.content and skips entries without it
  // (no_content). Each path was validated against the bundle above, so the body
  // is available there — a manifest is only applyable if it carries content.
  const bundleContentByPath = new Map<string, unknown>(
    built.bundle.map((f: any) => [f.path as string, f.content]),
  );
  for (const result of plan.results as Array<Record<string, unknown>>) {
    if (typeof result.content !== 'string') {
      const c = bundleContentByPath.get(result.path as string);
      if (typeof c === 'string') result.content = c;
    }
  }

  const saved = (await saveManifest(sql, orgId, sessionId, session.project_cwd || '', plan.results, 24)) as { id: string; expires_at: unknown };
  return NextResponse.json({
    manifest_id: saved.id,
    expires_at: saved.expires_at,
    apply_command: `dashclaw code apply ${saved.id} --dest=${session.project_cwd || '<project-cwd>'}`,
  });
}
