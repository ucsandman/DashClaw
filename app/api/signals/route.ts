export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql as getDbSql } from '../../lib/db';
import { getOrgId, getOrgRole, getUserId } from '../../lib/org';
import { computeSignals } from '../../lib/signals';
import { addDismissals, removeDismissals } from '../../lib/repositories/signal-dismissals.repository';
import { isWellFormedDismissKey, signalDismissKey } from '../../lib/signal-hash';

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

    // Signals suppressed by a dismissal land in `muted` instead of vanishing —
    // the panel renders the count and a per-entry Restore, so a durable mute is
    // always visible and always reversible.
    const muted: Array<Record<string, unknown>> = [];
    const filteredSignals = await computeSignals(orgId, filterAgentId, sql, muted as never);

    return NextResponse.json({
      signals: filteredSignals,
      muted: muted.map((s) => ({
        type: s.type,
        label: s.label,
        agent_id: s.agent_id ?? null,
        // Part of the dismiss key for mcp_degraded, so the panel can re-mint
        // the same key from a muted entry as it does from a live signal.
        mcp_server: s.mcp_server ?? null,
        severity: s.severity,
        dismiss_key: signalDismissKey(s as Parameters<typeof signalDismissKey>[0]),
      })),
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
      { error: 'An error occurred while computing risk signals', signals: [], muted: [], counts: { red: 0, amber: 0, total: 0 } },
      { status: 500 }
    );
  }
}

// Dismiss signal occurrences server-side. Body: { dismiss_keys: string[] }
// where each key is the signalDismissKey of the occurrence being dismissed.
// Idempotent (re-dismissing is a no-op), bulk-tolerant so browsers can
// migrate their legacy localStorage dismissed set in one call.
// Shared by POST (mute) and DELETE (restore): both take the same body shape,
// so both enforce the same caps. Returns the validated keys or a 400 response.
async function readDismissKeys(request: Request): Promise<{ keys: string[] } | { response: NextResponse }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 }) };
  }

  const rawKeys = (body as { dismiss_keys?: unknown })?.dismiss_keys;
  if (!Array.isArray(rawKeys) || rawKeys.length === 0) {
    return { response: NextResponse.json({ error: 'dismiss_keys must be a non-empty array of strings' }, { status: 400 }) };
  }
  if (rawKeys.length > MAX_DISMISS_KEYS) {
    return { response: NextResponse.json({ error: `dismiss_keys is limited to ${MAX_DISMISS_KEYS} entries per request` }, { status: 400 }) };
  }
  const keys = rawKeys.filter(
    (k): k is string => typeof k === 'string' && k.length > 0 && k.length <= MAX_KEY_LENGTH,
  );
  if (keys.length !== rawKeys.length) {
    return { response: NextResponse.json({ error: `Every dismiss key must be a string of at most ${MAX_KEY_LENGTH} characters` }, { status: 400 }) };
  }
  // Shape gate: a key that isn't the six-slot form signalDismissKey mints, led
  // by a real signal type, can never match a computed signal — persisting it
  // would only grow the table with rows nothing ever reads.
  if (!keys.every(isWellFormedDismissKey)) {
    return { response: NextResponse.json({ error: 'Every dismiss key must be a signal dismiss key' }, { status: 400 }) };
  }
  return { keys };
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    // Muting a signal hides a live risk condition from everyone in the org, so
    // it is an admin act — same gate as /api/approval-pause.
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const parsed = await readDismissKeys(request);
    if ('response' in parsed) return parsed.response;

    const added = await addDismissals(sql, orgId, parsed.keys, getUserId(request) || null);
    return NextResponse.json({ dismissed: added, received: parsed.keys.length });
  } catch (error) {
    console.error('Signal dismissal API error:', error);
    return NextResponse.json({ error: 'An error occurred while dismissing signals' }, { status: 500 });
  }
}

// Restore (un-mute) dismissed occurrences. Body: { dismiss_keys: string[] }.
// Sampled-time signal types mute durably on (type, agent) rather than per
// occurrence, so this is the operator's way back to a signal they silenced.
// Idempotent — restoring a key that was never dismissed is a no-op.
export async function DELETE(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const parsed = await readDismissKeys(request);
    if ('response' in parsed) return parsed.response;

    const removed = await removeDismissals(sql, orgId, parsed.keys);
    return NextResponse.json({ restored: removed, received: parsed.keys.length });
  } catch (error) {
    console.error('Signal restore API error:', error);
    return NextResponse.json({ error: 'An error occurred while restoring signals' }, { status: 500 });
  }
}
