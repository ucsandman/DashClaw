export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { getActionTimeBounds } from '../../../../lib/repositories/actions.repository';
import { getMessagesByActionId, getMessagesInTimeWindow, getMessageSummaryByActionId } from '../../../../lib/repositories/messagesContext.repository';

export async function GET(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { actionId } = await params;

    if (!actionId || (!actionId.startsWith('ar_') && !actionId.startsWith('act_'))) {
      return NextResponse.json({ error: 'Valid action_id required' }, { status: 400 });
    }

    // Summary mode: return aggregated stats instead of full message list
    if ((request as Request & { nextUrl: URL }).nextUrl.searchParams.get('summary') === 'true') {
      const row = await getMessageSummaryByActionId(sql, orgId, actionId);
      const total = Number(row.total) || 0;
      const rawParticipants = (row.participants as string) || '';
      const participants = rawParticipants
        ? [...new Set(rawParticipants.split(',').filter(Boolean))]
        : [];
      return NextResponse.json({
        total,
        participants,
        correlation: total > 0 ? 'explicit' : 'none',
        first_message_at: row.first_message_at || null,
        last_message_at: row.last_message_at || null,
      });
    }

    // Strategy 1: Explicit matches (messages tagged with this action_id)
    const explicit = await getMessagesByActionId(sql, orgId, actionId);

    if (explicit.length > 0) {
      return NextResponse.json({
        messages: explicit.map((m: Record<string, unknown>) => ({ ...m, match_type: 'explicit' })),
        correlation: 'explicit',
        total: explicit.length,
      });
    }

    // Strategy 2: Time-window correlation fallback
    const action = await getActionTimeBounds(sql, orgId, actionId);

    if (!action) {
      return NextResponse.json({ messages: [], correlation: 'none', total: 0 });
    }

    const windowStart = (action.timestamp_start || new Date().toISOString()) as string;
    const windowEnd = (action.timestamp_end || new Date().toISOString()) as string;

    const correlated = await getMessagesInTimeWindow(sql, orgId, action.agent_id as string, windowStart, windowEnd);

    return NextResponse.json({
      messages: correlated.map((m: Record<string, unknown>) => ({ ...m, match_type: 'time_window' })),
      correlation: correlated.length > 0 ? 'time_window' : 'none',
      total: correlated.length,
    });
  } catch (error) {
    console.error('[ACTIONS/MESSAGES] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}
