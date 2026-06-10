import { NextResponse } from 'next/server';
import { getOrgRole, getUserId } from '../../../../lib/org';
import { acknowledgeAlert, deleteAlert } from '../../../../lib/drift';

function requireAdmin(request: Request) {
  if (getOrgRole(request) !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  return null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ alertId: string }> }) {
  const gate = requireAdmin(request);
  if (gate) return gate;
  try {
    const { alertId } = await params;
    // Store the REAL audit identity (session user); API-key admins fall back
    // to a labeled principal inside acknowledgeAlert.
    const updated = await acknowledgeAlert(request, alertId, getUserId(request) || undefined);
    if (!updated) return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    console.error('[drift/alerts/detail] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to acknowledge alert' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ alertId: string }> }) {
  const gate = requireAdmin(request);
  if (gate) return gate;
  try {
    const { alertId } = await params;
    await deleteAlert(request, alertId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('[drift/alerts/detail] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete alert' }, { status: 500 });
  }
}
