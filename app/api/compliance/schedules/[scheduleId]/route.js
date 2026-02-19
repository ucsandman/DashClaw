import { NextResponse } from 'next/server';
import { updateSchedule, deleteSchedule } from '../../../../../lib/compliance/exporter.js';

export async function PATCH(request, { params }) {
  try {
    const body = await request.json();
    const updated = await updateSchedule(request, params.scheduleId, body);
    if (!updated) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    console.error('[compliance/schedules/detail] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update schedule' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    await deleteSchedule(request, params.scheduleId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('[compliance/schedules/detail] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete schedule' }, { status: 500 });
  }
}
