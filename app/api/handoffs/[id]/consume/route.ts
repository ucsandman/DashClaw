import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { consumeHandoff } from '../../../../lib/repositories/code-session-handoffs.repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sql = getSql();
    const orgId = getOrgId(req);

    const body = await req.json().catch(() => ({}));
    const row = await consumeHandoff(sql, orgId, id, body.session_id || null);
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    return NextResponse.json({ id: row.id, consumed_at: row.consumed_at });
  } catch (err) {
    return apiErrorResponse(err, 'HANDOFFS_CONSUME');
  }
}
