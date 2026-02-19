import { NextResponse } from 'next/server';
import { getPromptStats } from '../../../lib/prompt.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const templateId = searchParams.get('template_id') || undefined;
    const stats = await getPromptStats(request, { template_id: templateId });
    return NextResponse.json(stats);
  } catch (err) {
    console.error('[prompts/stats] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch prompt stats' }, { status: 500 });
  }
}
