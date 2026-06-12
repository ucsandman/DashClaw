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

async function readSetting(sql: SqlTag, orgId: string, key: string): Promise<string | null> {
  try {
    const rows = await getSettings(sql, orgId, { key });
    return rows[0]?.value != null ? String(rows[0].value) : null;
  } catch {
    return null;
  }
}

export async function maybeRunDigestTick(sql: SqlTag, orgId: string): Promise<DigestTickResult> {
  try {
    // Cheapest checks first: creds, then interval, then marker.
    const integration = await getSettings(sql, orgId, { category: 'integration' });
    if (!integration.length) return { ran: false, reason: 'no_adapters' };

    const intervalRaw = await readSetting(sql, orgId, 'DASHCLAW_DIGEST_INTERVAL_HOURS');
    const intervalHours = intervalRaw === null ? DEFAULT_INTERVAL_HOURS : Number(intervalRaw);
    if (!Number.isFinite(intervalHours) || intervalHours <= 0) return { ran: false, reason: 'disabled' };

    const markerRaw = await readSetting(sql, orgId, DIGEST_TICK_MARKER_KEY);
    const lastRunAt = markerRaw ? Date.parse(markerRaw) : NaN;
    if (Number.isFinite(lastRunAt) && Date.now() - lastRunAt < intervalHours * 3_600_000) {
      return { ran: false, reason: 'debounced' };
    }

    // Claim before running (thundering-herd guard, same as drift-tick).
    try {
      await upsertSetting(sql, orgId, { key: DIGEST_TICK_MARKER_KEY, value: new Date().toISOString(), category: 'system' });
    } catch (err) {
      console.warn('[digest-tick] marker claim failed — skipping run:', (err as Error)?.message);
      return { ran: false, reason: 'marker_write_failed' };
    }

    const digest = await composeFleetDigest(sql, orgId);
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
