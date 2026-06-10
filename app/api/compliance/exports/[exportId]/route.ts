import { NextResponse } from 'next/server';
import { getExport, deleteExport } from '../../../../lib/compliance/exporter';

export async function GET(request: Request, { params }: { params: Promise<{ exportId: string }> }) {
  try {
    const { exportId } = await params;
    const exp = await getExport(request, exportId);
    if (!exp) return NextResponse.json({ error: 'Export not found' }, { status: 404 });
    return NextResponse.json(exp);
  } catch (err) {
    console.error('[compliance/exports/detail] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch export' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ exportId: string }> }) {
  try {
    const { exportId } = await params;
    await deleteExport(request, exportId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('[compliance/exports/detail] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete export' }, { status: 500 });
  }
}
