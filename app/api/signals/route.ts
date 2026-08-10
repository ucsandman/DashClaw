export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql as getDbSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { computeSignals } from '../../lib/signals';
import { addDismissals } from '../../lib/repositories/signal-dismissals.repository';

const MAX_DISMISS_KEYS = 1000;
const MAX_KEY_LENGTH = 600;

let _sql: ReturnType<typeof getDbSql> | undefined;
function getSql() {
  if (_sql) return _sql;
  _sql = getDbSql();
  return _sql;
}

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const filterAgentId = searchParams.get('agent_id');

    const filteredSignals = await computeSignals(orgId, filterAgentId, sql);

    return NextResponse.json({
      signals: filteredSignals,
      counts: {
        red: filteredSignals.filter((s: { severity: string }) => s.severity === 'red').length,
        amber: filteredSignals.filter((s: { severity: string }) => s.severity === 'amber').length,
        total: filteredSignals.length
      },
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Risk Signals API error:', error);
    return NextResponse.json(
      { error: 'An error occurred while computing risk signals', signals: [], counts: { red: 0, amber: 0, total: 0 } },
      { status: 500 }
    );
  }
}

// Dismiss signal occurrences server-side. Body: { dismiss_keys: string[] }
// where each key is the signalDismissKey of the occurrence being dismissed.
// Idempotent (re-dismissing is a no-op), bulk-tolerant so browsers can
// migrate their legacy localStorage dismissed set in one call.
export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
    }

    const rawKeys = (body as { dismiss_keys?: unknown })?.dismiss_keys;
    if (!Array.isArray(rawKeys) || rawKeys.length === 0) {
      return NextResponse.json({ error: 'dismiss_keys must be a non-empty array of strings' }, { status: 400 });
    }
    if (rawKeys.length > MAX_DISMISS_KEYS) {
      return NextResponse.json({ error: `dismiss_keys is limited to ${MAX_DISMISS_KEYS} entries per request` }, { status: 400 });
    }
    const keys = rawKeys.filter(
      (k): k is string => typeof k === 'string' && k.length > 0 && k.length <= MAX_KEY_LENGTH,
    );
    if (keys.length !== rawKeys.length) {
      return NextResponse.json({ error: `Every dismiss key must be a string of at most ${MAX_KEY_LENGTH} characters` }, { status: 400 });
    }

    const added = await addDismissals(sql, orgId, keys);
    return NextResponse.json({ dismissed: added, received: keys.length });
  } catch (error) {
    console.error('Signal dismissal API error:', error);
    return NextResponse.json({ error: 'An error occurred while dismissing signals' }, { status: 500 });
  }
}
