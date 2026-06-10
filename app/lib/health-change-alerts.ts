/**
 * Health state-change alerts — fires webhooks + native notifications when an
 * integration's health transitions (healthy → error, error → healthy, etc.).
 *
 * Wired into both the /api/cron/integration-health Bearer endpoint and the
 * admin-triggered /api/integrations/health/refresh endpoint. Delivery runs
 * fire-and-forget so the calling handler never stalls.
 *
 * Default behavior is always-on; per-channel opt-out uses the existing
 * DASHCLAW_ALERTS_<CHANNEL>=false settings the adapters already respect.
 */

import { EVENTS, publishOrgEvent } from './events';
import { fireWebhooksForOrg } from './webhooks';
import { deliverNativeNotifications } from './notification-adapters/index';
import type { SettingRow } from './notification-adapters/index';
import { getSettings } from './repositories/settings.repository';
import type { SqlTag } from './types/db';

type Severity = 'red' | 'amber';

interface HealthTransition {
  provider: string;
  // upsertHealth returns prev_status as string | null (null for a brand-new
  // provider row). Match that shape so callers can pass the result directly.
  prev_status: string | null;
  new_status: string;
  message?: string;
}

interface HealthChangeSignal {
  type: 'integration_health_changed';
  severity: Severity;
  label: string;
  detail: string;
  provider: string;
  prev_status: string | null;
  new_status: string;
}

/**
 * Severity for a health transition. Exposed for tests.
 *   any → error      → red (something broke)
 *   any → degraded   → amber (partial outage)
 *   error/degraded → healthy → amber (recovery — noteworthy, not critical)
 *   healthy → healthy (shouldn't happen; covered defensively) → null
 */
export function severityFor(prev: string, next: string): Severity | null {
  if (next === 'error') return 'red';
  if (next === 'degraded') return 'amber';
  if (next === 'healthy' && (prev === 'error' || prev === 'degraded')) return 'amber';
  return null;
}

export function buildHealthChangeSignal({
  provider,
  prev_status,
  new_status,
  message,
}: HealthTransition): HealthChangeSignal | null {
  // null prev (brand-new provider) is harmless to severityFor: it only matches
  // prev against 'error'/'degraded', so '' and null behave identically.
  const severity = severityFor(prev_status ?? '', new_status);
  if (!severity) return null;
  const recovery = new_status === 'healthy';
  const label = recovery
    ? `Integration recovered: ${provider}`
    : `Integration degraded: ${provider} is ${new_status}`;
  const detail = recovery
    ? `${provider} is back to healthy (was ${prev_status}).` + (message ? ` ${message}` : '')
    : `${provider} flipped from ${prev_status} to ${new_status}.` + (message ? ` ${message}` : '');
  return {
    type: 'integration_health_changed',
    severity,
    label,
    detail,
    provider,
    prev_status,
    new_status,
  };
}

/**
 * Fire webhooks + native notifications for the batch of changes produced by
 * one health-check run. Accepts an array of `{ provider, prev_status,
 * new_status, message }` — same shape upsertHealth returns (plus provider +
 * message).
 *
 * Never throws. Returns `{ fired: N }` where N is the count of delivered
 * signals (0 if the batch produced no deliverable transitions).
 */
export async function fireHealthChangeAlerts(
  sql: SqlTag,
  orgId: string,
  transitions: HealthTransition[] | null | undefined,
): Promise<{ fired: number }> {
  try {
    if (!transitions || transitions.length === 0) return { fired: 0 };

    const signals = transitions
      .map((t) => buildHealthChangeSignal(t))
      .filter(Boolean) as HealthChangeSignal[];
    if (signals.length === 0) return { fired: 0 };

    // One settings fetch covers both adapter creds and any per-channel
    // DASHCLAW_ALERTS_* toggles.
    const settings = await getSettings(sql, orgId, {});

    void fireWebhooksForOrg(orgId, signals, sql).catch((err: unknown) => {
      console.warn('[HEALTH ALERT] webhook delivery failed:', (err as { message?: unknown })?.message || err);
    });
    void deliverNativeNotifications(orgId, signals, settings as unknown as SettingRow[], sql).catch((err: unknown) => {
      console.warn('[HEALTH ALERT] native notification delivery failed:', (err as { message?: unknown })?.message || err);
    });
    void publishOrgEvent(EVENTS.SIGNAL_DETECTED, { orgId, signals });

    return { fired: signals.length };
  } catch (err) {
    console.warn('[HEALTH ALERT] fire failed:', (err as { message?: unknown })?.message || err);
    return { fired: 0 };
  }
}
