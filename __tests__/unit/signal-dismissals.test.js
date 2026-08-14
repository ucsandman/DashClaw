import { describe, it, expect, vi } from 'vitest';
import { signalDismissKey } from '@/lib/signal-hash';

// Server-side dismissals: computeSignals subtracts the org's dismissed
// occurrence keys at the single choke point, so every consumer (status bar,
// signals panel, widget pulse, guard, cron) sees the same active set.

const mockListDismissKeys = vi.fn(async () => []);
vi.mock('@/lib/repositories/signal-dismissals.repository', () => ({
  listDismissKeys: (...a) => mockListDismissKeys(...a),
  addDismissals: vi.fn(),
}));

const { computeSignals } = await import('@/lib/signals.js');

// Same harness shape as signals.test.js: threshold read answered by text,
// signal queries answered by index, anything extra gets [].
function createSignalSqlMock(responses) {
  let callIndex = 0;
  return (strings) => {
    const text = strings.join(' ');
    if (text.includes('DASHCLAW_AUTONOMY_SPIKE_THRESHOLD')) return Promise.resolve([]);
    const result = responses[callIndex] || [];
    callIndex++;
    return Promise.resolve(result);
  };
}

const SPIKE_ROW = [{ agent_id: 'a1', agent_name: 'Bot', action_count: '150' }];

describe('computeSignals server-side dismissals', () => {
  it('subtracts dismissed occurrence keys', async () => {
    const sql = createSignalSqlMock([SPIKE_ROW]);
    const baseline = await computeSignals('org_1', null, sql);
    expect(baseline).toHaveLength(1);

    mockListDismissKeys.mockResolvedValueOnce([signalDismissKey(baseline[0])]);
    const signals = await computeSignals('org_1', null, createSignalSqlMock([SPIKE_ROW]));
    expect(signals).toEqual([]);
  });

  // Regression: pg drivers return Date objects for timestamptz columns
  // (e.g. MAX(timestamp_start::timestamptz) AS last_seen). The client computes
  // its dismiss key from the JSON-serialized signal (ISO string), so the
  // server-side subtraction must produce the same key from the Date object —
  // otherwise every dismissal is silently ignored on the next fetch.
  it('matches client keys when detected_at is a driver Date object', async () => {
    const rowWithDate = [{
      agent_id: 'a1', agent_name: 'Bot', action_count: '150',
      last_seen: new Date('2026-08-14T16:00:00.000Z'),
    }];
    const baseline = await computeSignals('org_1', null, createSignalSqlMock([rowWithDate]));
    expect(baseline).toHaveLength(1);

    // What the browser sees: the signal after JSON serialization.
    const clientSignal = JSON.parse(JSON.stringify(baseline[0]));
    mockListDismissKeys.mockResolvedValueOnce([signalDismissKey(clientSignal)]);
    const signals = await computeSignals('org_1', null, createSignalSqlMock([rowWithDate]));
    expect(signals).toEqual([]);
  });

  it('leaves signals with non-matching keys untouched', async () => {
    mockListDismissKeys.mockResolvedValueOnce(['some:other:occurrence:key']);
    const signals = await computeSignals('org_1', null, createSignalSqlMock([SPIKE_ROW]));
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('autonomy_spike');
  });

  it('fails open: a dismissal read error never hides signals', async () => {
    mockListDismissKeys.mockRejectedValueOnce(new Error('table missing'));
    const signals = await computeSignals('org_1', null, createSignalSqlMock([SPIKE_ROW]));
    expect(signals).toHaveLength(1);
  });
});
