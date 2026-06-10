/**
 * P14: statistical drift alerts must reach the operator — computeSignals
 * emits a `drift_alert` signal for open warning/critical drift_alerts (which
 * also makes them webhook-deliverable via fireWebhooksForOrg's type filter),
 * and the event type is registered in both event-type contracts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeSignals } from '@/lib/signals.js';
import { VALID_SIGNAL_TYPES } from '@/lib/contracts/notifications';

// Text-routed mock: only the drift_alerts query returns rows; everything else
// (including nested filter fragments) resolves empty. Robust to query
// reordering, unlike index-aligned mocks.
function sqlReturningDriftAlerts(rows) {
  return (strings) => {
    const text = strings.join(' ');
    if (text.includes('FROM drift_alerts')) return Promise.resolve(rows);
    return Promise.resolve([]);
  };
}

describe('drift_alert signal', () => {
  it('emits red for critical and amber for warning open drift alerts', async () => {
    const t = '2026-06-10T09:00:00.000Z';
    const sql = sqlReturningDriftAlerts([
      { id: 'da1', agent_id: 'a1', metric: 'risk_score', severity: 'critical', direction: 'increasing', pct_change: 60, z_score: 3.2, description: 'Risk Score for a1 has increased by 60% (z-score: 3.2).', created_at: t },
      { id: 'da2', agent_id: 'a2', metric: 'cost_estimate', severity: 'warning', direction: 'decreasing', pct_change: -35, z_score: -2.1, description: null, created_at: t },
    ]);
    const signals = await computeSignals('org_1', null, sql);
    const drift = signals.filter((s) => s.type === 'drift_alert');
    expect(drift).toHaveLength(2);
    expect(drift[0].severity).toBe('red');
    expect(drift[0].agent_id).toBe('a1');
    expect(drift[0].detected_at).toBe(t);
    expect(drift[0].detail).toContain('z-score: 3.2');
    expect(drift[1].severity).toBe('amber');
    // Fallback detail for rows without a stored description.
    expect(drift[1].detail).toContain('cost_estimate');
  });

  it('is registered as a webhook event type and a notification signal type', () => {
    expect(VALID_SIGNAL_TYPES).toContain('drift_alert');
    const webhooksRoute = readFileSync(
      path.resolve(__dirname, '..', '..', 'app', 'api', 'webhooks', 'route.ts'),
      'utf8',
    );
    expect(webhooksRoute).toMatch(/'drift_alert'/);
    const webhooksPage = readFileSync(
      path.resolve(__dirname, '..', '..', 'app', 'webhooks', 'page.tsx'),
      'utf8',
    );
    expect(webhooksPage).toMatch(/'drift_alert'/);
  });
});
