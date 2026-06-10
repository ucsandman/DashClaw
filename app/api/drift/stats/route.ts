import { NextResponse } from 'next/server';
import { getDriftStats } from '../../../lib/drift';
import { maybeRunDriftTick } from '../../../lib/drift-tick';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    // Opportunistic tick: stats is loaded by the drift page and the dashboard
    // DriftCard, so it is the natural non-hot-path host (never the guard).
    // Debounced to once per 24h per org with a hard time budget, so at most
    // one stats request per day pays the (bounded) detection latency. Failures
    // never break stats. This is system maintenance of org-derived data, so it
    // runs regardless of the caller's role (manual "Run detection" stays
    // admin-only).
    const tick = await maybeRunDriftTick(request).catch((err) => {
      console.warn('[drift/stats] tick failed:', (err as Error)?.message);
      return null;
    });

    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id') || undefined;
    const stats = await getDriftStats(request, { agent_id: agentId });
    return NextResponse.json({ ...stats, auto_tick: tick });
  } catch (err) {
    console.error('[drift/stats] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch drift stats' }, { status: 500 });
  }
}
