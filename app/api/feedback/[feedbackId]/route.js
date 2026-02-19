import { NextResponse } from 'next/server';
import { getFeedback, resolveFeedback, deleteFeedback } from '../../../lib/feedback.js';

export async function GET(request, { params }) {
  try {
    const fb = await getFeedback(request, params.feedbackId);
    if (!fb) return NextResponse.json({ error: 'Feedback not found' }, { status: 404 });
    return NextResponse.json(fb);
  } catch (err) {
    console.error('[feedback/detail] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch feedback' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    // PATCH = resolve feedback
    const body = await request.json();
    const updated = await resolveFeedback(request, params.feedbackId, { resolved_by: body.resolved_by });
    if (!updated) return NextResponse.json({ error: 'Feedback not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    console.error('[feedback/detail] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to resolve feedback' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    await deleteFeedback(request, params.feedbackId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('[feedback/detail] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete feedback' }, { status: 500 });
  }
}
