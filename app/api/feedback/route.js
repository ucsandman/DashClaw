import { NextResponse } from 'next/server';
import { listFeedback, createFeedback } from '../../lib/feedback.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const feedback = await listFeedback(request, {
      action_id: searchParams.get('action_id') || undefined,
      agent_id: searchParams.get('agent_id') || undefined,
      category: searchParams.get('category') || undefined,
      sentiment: searchParams.get('sentiment') || undefined,
      resolved: searchParams.get('resolved') || undefined,
      limit: searchParams.get('limit'),
      offset: searchParams.get('offset'),
    });
    return NextResponse.json({ feedback, total: feedback.length });
  } catch (err) {
    console.error('[feedback] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch feedback' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.rating && !body.comment) {
      return NextResponse.json({ error: 'rating or comment is required' }, { status: 400 });
    }
    if (body.rating && (body.rating < 1 || body.rating > 5)) {
      return NextResponse.json({ error: 'rating must be 1-5' }, { status: 400 });
    }
    const result = await createFeedback(request, body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error('[feedback] POST error:', err);
    return NextResponse.json({ error: 'Failed to create feedback' }, { status: 500 });
  }
}
