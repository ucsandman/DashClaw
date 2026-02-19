import { NextResponse } from 'next/server';
import { listAlerts, detectDrift, computeBaselines, recordSnapshots } from '../../../lib/drift.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const alerts = await listAlerts(request, {
      agent_id: searchParams.get('agent_id') || undefined,
      severity: searchParams.get('severity') || undefined,
      acknowledged: searchParams.get('acknowledged') || undefined,
      metric: searchParams.get('metric') || undefined,
      limit: searchParams.get('limit'),
      offset: searchParams.get('offset'),
    });
    return NextResponse.json({ alerts, total: alerts.length });
  } catch (err) {
    console.error('[drift/alerts] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch drift alerts' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const action = body.action || 'detect';
    let result;

    if (action === 'compute_baselines') {
      result = await computeBaselines(request, { agent_id: body.agent_id, lookback_days: body.lookback_days });
    } else if (action === 'record_snapshots') {
      result = await recordSnapshots(request);
    } else {
      result = await detectDrift(request, { agent_id: body.agent_id, window_days: body.window_days, baseline_days: body.baseline_days });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error('[drift/alerts] POST error:', err);
    return NextResponse.json({ error: 'Drift operation failed' }, { status: 500 });
  }
}
