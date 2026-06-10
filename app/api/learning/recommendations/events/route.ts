export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { createLearningRecommendationEvents } from '../../../../lib/repositories/learningLoop.repository';

const ALLOWED_EVENT_TYPES = new Set(['fetched', 'applied', 'overridden', 'outcome']);

function validateEvent(raw: any): string | null {
  if (!raw || typeof raw !== 'object') return 'event must be an object';
  if (typeof raw.event_type !== 'string' || !ALLOWED_EVENT_TYPES.has(raw.event_type)) {
    return `event_type must be one of: ${Array.from(ALLOWED_EVENT_TYPES).join(', ')}`;
  }
  if (raw.recommendation_id !== undefined && (typeof raw.recommendation_id !== 'string' || raw.recommendation_id.length > 128)) {
    return 'recommendation_id must be a string up to 128 chars';
  }
  if (raw.agent_id !== undefined && (typeof raw.agent_id !== 'string' || raw.agent_id.length > 128)) {
    return 'agent_id must be a string up to 128 chars';
  }
  if (raw.action_id !== undefined && (typeof raw.action_id !== 'string' || raw.action_id.length > 128)) {
    return 'action_id must be a string up to 128 chars';
  }
  if (raw.event_key !== undefined && (typeof raw.event_key !== 'string' || raw.event_key.length > 200)) {
    return 'event_key must be a string up to 200 chars';
  }
  if (raw.details !== undefined && (typeof raw.details !== 'object' || Array.isArray(raw.details))) {
    return 'details must be an object';
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json().catch(() => ({}));

    const events = Array.isArray(body.events)
      ? body.events
      : [body];

    if (events.length === 0) {
      return NextResponse.json({ error: 'At least one event is required' }, { status: 400 });
    }
    if (events.length > 100) {
      return NextResponse.json({ error: 'events exceeds maximum batch size of 100' }, { status: 400 });
    }

    const errors: string[] = [];
    events.forEach((event: any, idx: number) => {
      const err = validateEvent(event);
      if (err) errors.push(`events[${idx}]: ${err}`);
    });
    if (errors.length > 0) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    const created = await createLearningRecommendationEvents(sql, orgId, events);
    return NextResponse.json({
      created,
      created_count: created.length,
    }, { status: 201 });
  } catch (error) {
    console.error('Learning recommendation events POST error:', error);
    return NextResponse.json(
      { error: 'An error occurred while recording recommendation events' },
      { status: 500 }
    );
  }
}
