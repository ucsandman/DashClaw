export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { getThreadById } from '../../../../lib/repositories/messagesContext.repository';

export async function GET(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { threadId } = await params;

    if (!threadId || !threadId.startsWith('mt_')) {
      return NextResponse.json({ error: 'Valid thread_id required' }, { status: 400 });
    }

    const thread = await getThreadById(sql, orgId, threadId);
    if (!thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    return NextResponse.json({ thread });
  } catch (error) {
    console.error('Message thread GET error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching thread' }, { status: 500 });
  }
}
