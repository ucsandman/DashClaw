import { NextResponse } from 'next/server';
import { getExport } from '../../../../../../lib/compliance/exporter.js';

export async function GET(request, { params }) {
  try {
    const exp = await getExport(request, params.exportId);
    if (!exp) return NextResponse.json({ error: 'Export not found' }, { status: 404 });
    if (exp.status !== 'completed') return NextResponse.json({ error: 'Export not ready' }, { status: 409 });

    const contentType = exp.format === 'json' ? 'application/json' : 'text/markdown';
    const ext = exp.format === 'json' ? 'json' : 'md';
    const filename = `${exp.name.replace(/[^a-zA-Z0-9-_]/g, '_')}_${new Date(exp.completed_at).toISOString().split('T')[0]}.${ext}`;

    return new NextResponse(exp.report_content, {
      headers: {
        'Content-Type': `${contentType}; charset=utf-8`,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error('[compliance/exports/download] GET error:', err);
    return NextResponse.json({ error: 'Failed to download export' }, { status: 500 });
  }
}
