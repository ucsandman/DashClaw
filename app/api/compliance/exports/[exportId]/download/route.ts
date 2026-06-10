import { NextResponse } from 'next/server';
import { getExport } from '../../../../../lib/compliance/exporter';

export async function GET(request: Request, { params }: { params: Promise<{ exportId: string }> }) {
  try {
    const { exportId } = await params;
    const exp = await getExport(request, exportId);
    if (!exp) return NextResponse.json({ error: 'Export not found' }, { status: 404 });
    if (exp.status !== 'completed') return NextResponse.json({ error: 'Export not ready' }, { status: 409 });

    // report_content is now a signed, hash-chained compliance bundle (JSON). The
    // old unsigned markdown/JSON path is gone — the human-readable report lives
    // in bundle.payload.report, and the whole bundle re-verifies via
    // POST /api/integrity/verify or GET /.well-known/jwks.json.
    const filename = `${(exp.name as string).replace(/[^a-zA-Z0-9-_]/g, '_')}_${new Date(exp.completed_at as string).toISOString().split('T')[0]}.dcbundle.json`;

    return new NextResponse(exp.report_content as string, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error('[compliance/exports/download] GET error:', err);
    return NextResponse.json({ error: 'Failed to download export' }, { status: 500 });
  }
}
