export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { isHostedMode } from '../../../../lib/hosted/flag';
import { getHostedWorkspace, deleteHostedWorkspace } from '../../../../lib/repositories/hosted-workspace.repository';
import { getSql } from '../../../../lib/db';
import { denyTrialPrincipal } from '../../../../lib/hosted/trial-principal';

function requireAdmin(request: Request): boolean {
  const role = request.headers.get('x-org-role');
  return role === 'owner' || role === 'admin';
}

// SECURITY (v5.1): inspect/delete-any-workspace are INSTANCE OPERATOR ops —
// they read/destroy an arbitrary org by id. A hosted-trial session is
// x-org-role: admin of its OWN org, so role alone would let trial A read or
// delete trial B (cross-tenant destruction). The operator (non-trial org)
// still passes; a trial principal is denied.
async function requireOperator(request: Request): Promise<NextResponse | null> {
  if (!requireAdmin(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return denyTrialPrincipal(request);
}

export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  if (!isHostedMode()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const denied = await requireOperator(request);
  if (denied) return denied;

  const { workspaceId } = await params;
  const sql = getSql();
  const ws = await getHostedWorkspace(sql, workspaceId);
  if (!ws || !ws.hostedMode) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({
    workspace_id: ws.orgId,
    name: ws.name,
    trial_ends_at: ws.trialEndsAt,
    trial_action_cap: ws.trialActionCap,
    trial_actions_used: ws.trialActionsUsed,
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  if (!isHostedMode()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const denied = await requireOperator(request);
  if (denied) return denied;

  const { workspaceId } = await params;
  const sql = getSql();
  try {
    const result = await deleteHostedWorkspace(sql, workspaceId);
    if (!result.deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ deleted: true, workspace_id: workspaceId });
  } catch (err) {
    if (/not a hosted/.test((err as Error).message)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    console.error('[HOSTED] delete failed:', err);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
