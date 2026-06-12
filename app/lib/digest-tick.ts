// W3 digest cadence without cron: piggyback on request traffic with a
// claimed settings marker (drift-tick pattern). Fail-quiet — never affects
// the request that triggered it (callers run it inside after()).
import { getSettings, upsertSetting } from './repositories/settings.repository';
import { composeFleetDigest } from './fleet-digest';
import { deliverNativeNotifications } from './notification-adapters/index';
import type { SqlTag } from './types/db';

export const DIGEST_TICK_MARKER_KEY = 'DIGEST_TICK_LAST_RUN_AT';
const DEFAULT_INTERVAL_HOURS = 24;

export interface DigestTickResult {
  ran: boolean;
  reason?: 'no_adapters' | 'disabled' | 'debounced' | 'marker_write_failed' | 'error';
  delivered?: number;
}

interface SettingRowLike {
  key?: unknown;
  value?: unknown;
  category?: unknown;
}

export async function maybeRunDigestTick(sql: SqlTag, orgId: string): Promise<DigestTickResult> {
  try {
    // ONE settings read serves every gate (this runs inside after() on the
    // actions hot path — hundreds of calls/hr; the debounced steady state
    // must stay a single query).
    const rows = (await getSettings(sql, orgId, {})) as SettingRowLike[];
    const byKey = new Map(rows.map((r) => [String(r.key), r]));

    const intervalRaw = byKey.get('DASHCLAW_DIGEST_INTERVAL_HOURS')?.value;
    const intervalHours = intervalRaw == null ? DEFAULT_INTERVAL_HOURS : Number(intervalRaw);
    if (!Number.isFinite(intervalHours) || intervalHours <= 0) return { ran: false, reason: 'disabled' };

    const markerRaw = byKey.get(DIGEST_TICK_MARKER_KEY)?.value != null
      ? String(byKey.get(DIGEST_TICK_MARKER_KEY)?.value)
      : null;
    const lastRunAt = markerRaw ? Date.parse(markerRaw) : NaN;
    if (Number.isFinite(lastRunAt) && Date.now() - lastRunAt < intervalHours * 3_600_000) {
      return { ran: false, reason: 'debounced' };
    }

    const integration = rows.filter((r) => r.category === 'integration');
    if (!integration.length) return { ran: false, reason: 'no_adapters' };

    // Claim before running (thundering-herd guard, same as drift-tick).
    try {
      await upsertSetting(sql, orgId, { key: DIGEST_TICK_MARKER_KEY, value: new Date().toISOString(), category: 'system' });
    } catch (err) {
      console.warn('[digest-tick] marker claim failed — skipping run:', (err as Error)?.message);
      return { ran: false, reason: 'marker_write_failed' };
    }

    const digest = await composeFleetDigest(sql, orgId);
    // The quiet digest still ships: a daily heartbeat is the feature — silence
    // would be indistinguishable from broken delivery. 'amber' is the lowest
    // severity the adapters render; the label carries the "all clear" meaning.
    const signal = {
      severity: digest.quiet ? 'amber' : 'red',
      label: digest.quiet ? 'Daily fleet digest' : 'Daily fleet digest — needs attention',
      detail: digest.text,
    };
    const results = await deliverNativeNotifications(
      orgId,
      [signal],
      integration as Array<{ key: string; value: string | null; encrypted?: boolean | null }>,
      sql,
    );
    const delivered = results.filter((r) => r.success).length;

    if (delivered === 0 && results.length > 0) {
      // Total failure: restore the previous marker so the next traffic retries.
      try {
        await upsertSetting(sql, orgId, {
          key: DIGEST_TICK_MARKER_KEY,
          value: markerRaw ?? new Date(0).toISOString(),
          category: 'system',
        });
      } catch { /* next interval catches up */ }
      console.warn('[digest-tick] all deliveries failed — marker rolled back');
    }
    return { ran: true, delivered };
  } catch (err) {
    console.warn('[digest-tick] failed:', (err as Error)?.message);
    return { ran: false, reason: 'error' };
  }
}
