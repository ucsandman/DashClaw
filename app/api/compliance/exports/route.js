import { NextResponse } from 'next/server';
import { createExportRecord, listExports, generateExport } from '../../../../lib/compliance/exporter.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const exports = await listExports(request, { limit: searchParams.get('limit') });
    return NextResponse.json({ exports });
  } catch (err) {
    console.error('[compliance/exports] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch exports' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.frameworks || body.frameworks.length === 0) {
      return NextResponse.json({ error: 'frameworks array is required' }, { status: 400 });
    }
    const record = await createExportRecord(request, body);

    // Generate the export inline (synchronous for now)
    try {
      await generateExport(request, record.id);
    } catch (genErr) {
      console.error('[compliance/exports] Generation error:', genErr);
      // Export record already marked as failed by generateExport
    }

    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    console.error('[compliance/exports] POST error:', err);
    return NextResponse.json({ error: 'Failed to create export' }, { status: 500 });
  }
}
