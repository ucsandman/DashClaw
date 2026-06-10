export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { sampleStatus, recentSamples } from '../../../lib/behavior/sample-store';
import { DEFAULT_OPTIONS } from '../../../lib/behavior/analyzer';

/**
 * GET /api/behavior/samples — status of the LOCAL behavior-sample log that the
 * Policy Coach analyzes. Reports recorder enablement, directory, counts,
 * observed agents, and the captured window.
 *
 * With `?list=N`, instead returns the N most recent REDACTED sample records
 * (event_id, ts, tool, action_type, command_shape, paths, risk, guard_decision,
 * outcome) for the "Recent samples" browser. Reads local files only; never
 * touches the database and never uploads samples. @beta
 */
export async function GET(request: Request) {
  try {
    const listParam = new URL(request.url).searchParams.get('list');
    if (listParam !== null) {
      const n = Math.min(Math.max(parseInt(listParam, 10) || 25, 1), 200);
      const samples = await recentSamples(n);
      return NextResponse.json({ samples, count: samples.length });
    }
    const status = await sampleStatus();
    const minSamples = DEFAULT_OPTIONS.minSamples;
    const ready = status.agents.some((a: { count: number }) => a.count >= minSamples);
    return NextResponse.json({ ...status, ready, min_samples: minSamples });
  } catch (err) {
    console.error('[behavior/samples] GET error:', (err as Error).message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
