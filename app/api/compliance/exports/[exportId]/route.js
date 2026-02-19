import { NextResponse } from 'next/server';
import { getExport, deleteExport } from '../../../../../lib/compliance/exporter.js';

export async function GET(request, { params }) {
  try {
    const exp = await getExport(request, params.exportId);
    if (!exp) return NextResponse.json({ error: 'Export not found' }, { status: 404 });
    return NextResponse.json(exp);
  } catch (err) {
    console.error('[compliance/exports/detail] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch export' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    await deleteExport(request, params.exportId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('[compliance/exports/detail] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete export' }, { status: 500 });
  }
}
