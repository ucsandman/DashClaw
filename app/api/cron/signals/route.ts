export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { computeSignals } from '../../../lib/signals';
import { fireWebhooksForOrg } from '../../../lib/webhooks';
import { sendSignalAlertEmail } from '../../../lib/notifications';
import { logActivity } from '../../../lib/audit';
import { getSql } from '../../../lib/db';
import crypto from 'crypto';
import { timingSafeCompare } from '../../../lib/timing-safe';
import { publishOrgEvent, EVENTS } from '../../../lib/events';
import { claimNewSignalSnapshots } from '../../../lib/repositories/signals.repository';
import { isHostedMode } from '../../../lib/hosted/flag';
import { listOrganizations } from '../../../lib/repositories/orgs.repository';

/**
 * Hash a signal into a stable identifier for deduplication.
 * Uses type + relevant IDs to create a unique fingerprint.
 */
export function hashSignal(signal: {
  type: string;
  agent_id?: string | null;
  action_id?: string | null;
  loop_id?: string | null;
  assumption_id?: string | null;
  session_id?: string | null;
  provider?: string | null;
  policy_id?: string | null;
}): string {
  // Include every resource-id-like field that might uniquely distinguish
  // signals of the same type for the same agent. session_stalled carried
  // session_id but it wasn't hashed — so multiple stalled sessions for
  // one agent deduped to a single alert. integration_mismatch carries a
  // provider field (added by F62) with the same collision risk. Keeping
  // all slots unconditionally means adding a new signal type later is
  // one-line: append its id field.
  const parts = [
    signal.type,
    signal.agent_id || '',
    signal.action_id || '',
    signal.loop_id || '',
    signal.assumption_id || '',
    signal.session_id || '',
    signal.provider || '',
    signal.policy_id || '',
  ].join(':');
  // SHA-256 (not MD5): this is a dedup fingerprint, but using a non-broken
  // digest keeps the codebase free of weak-crypto findings. Truncate to 32 hex
  // chars so the stored fingerprint length is unchanged from the MD5 era.
  return crypto.createHash('sha256').update(parts).digest('hex').slice(0, 32);
}

// GET /api/cron/signals - Vercel Cron handler
export async function GET(request: Request) {
  try {
    // SECURITY: Always require CRON_SECRET — no dev bypass
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
    }
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !timingSafeCompare(authHeader, `Bearer ${cronSecret}`)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sql = getSql();
    const summary = { orgs_processed: 0, new_signals: 0, emails_sent: 0, webhooks_fired: 0, native_notifications: 0 };

    // Load active orgs. org_default is only excluded on the HOSTED deployment,
    // where it is the shared legacy bucket rather than a tenant. On a
    // self-hosted deploy the operator's org IS org_default (auth.ts promotes
    // the first user into it) — excluding it there meant signals.detected
    // webhooks and email alerts could never fire for self-hosted operators.
    const orgs = await listOrganizations(sql, { includeDefault: !isHostedMode() });

    for (const org of orgs) {
      // orgs rows come from a SqlTag query (Record<string, unknown>); these
      // columns are non-null per the SELECT. Narrow once for the loop body.
      const orgId = org.id as string;
      const orgName = org.name as string;
      try {
        const signals = await computeSignals(orgId, null, sql);
        if (signals.length === 0) {
          summary.orgs_processed++;
          continue;
        }

        // Hash each signal
        const currentHashes = signals.map((s) => ({ ...s, _hash: hashSignal(s as Parameters<typeof hashSignal>[0]) } as Record<string, any>));

        // Atomically claim which of these signals are NEW for this org, and
        // write the snapshot BEFORE any notification fires. Only the run that
        // wins the underlying INSERT ON CONFLICT DO NOTHING for a signal_hash
        // gets it back here — so two overlapping invocations (Vercel cron
        // retry, manual re-trigger) can no longer both classify the same
        // signal as new and both notify. If this process dies between this
        // write and the notification below, that signal is never re-notified
        // (at-most-once, not at-least-once) — acceptable and intended.
        const now = new Date().toISOString();
        const insertedHashes = await claimNewSignalSnapshots(
          sql,
          orgId,
          currentHashes as Parameters<typeof claimNewSignalSnapshots>[2],
          now
        );
        const insertedSet = new Set(insertedHashes);
        const newSignals = currentHashes.filter((s: Record<string, any>) => insertedSet.has(s._hash));

        if (newSignals.length === 0) {
          summary.orgs_processed++;
          continue;
        }

        summary.new_signals += newSignals.length;

        // Clean _hash before sending
        const cleanSignals = newSignals.map(({ _hash, ...rest }: Record<string, any>) => rest);

        // Log signal detection
        logActivity({
          orgId, actorId: 'cron', actorType: 'cron',
          action: 'signal.detected', resourceType: 'signal',
          details: { count: cleanSignals.length, types: [...new Set(cleanSignals.map((s: Record<string, any>) => s.type))] },
        }, sql);

        // Fire webhooks
        const whResults = await fireWebhooksForOrg(orgId, cleanSignals, sql);
        const whFired = whResults.filter((r) => r.success).length;
        summary.webhooks_fired += whFired;

        if (whFired > 0) {
          logActivity({
            orgId, actorId: 'system', actorType: 'system',
            action: 'webhook.fired', resourceType: 'webhook',
            details: { count: whFired, signal_count: cleanSignals.length },
          }, sql);
        }

        // Native notifications via configured integrations
        try {
          const { deliverNativeNotifications } = await import('../../../lib/notification-adapters/index');
          const { getSettings } = await import('../../../lib/repositories/settings.repository');
          const settings = await getSettings(sql, orgId, { category: 'integration' });
          const nativeResults = await deliverNativeNotifications(orgId, cleanSignals as Parameters<typeof deliverNativeNotifications>[1], settings as unknown as Parameters<typeof deliverNativeNotifications>[2], sql);
          for (const r of nativeResults) {
            if (r.success) {
              summary.native_notifications++;
              logActivity({
                orgId, actorId: 'system', actorType: 'system',
                action: `notification.${r.provider}.sent`, resourceType: 'notification',
                details: { provider: r.provider, signals: cleanSignals.length, message: r.message },
              }, sql);
            }
          }
        } catch (nativeErr) {
          console.error(`[CRON] Native notification error for ${orgId}:`, (nativeErr as Error).message);
        }

        // Publish SSE events for realtime UI updates
        for (const signal of cleanSignals) {
          void publishOrgEvent(EVENTS.SIGNAL_DETECTED, {
            orgId,
            signal,
          });
        }

        // Send email alerts to opted-in users
        const prefs = await sql`
          SELECT np.user_id, np.signal_types, u.email
          FROM notification_preferences np
          JOIN users u ON np.user_id = u.id
          WHERE np.org_id = ${org.id}
            AND np.channel = 'email'
            AND np.enabled = 1
            AND u.org_id = ${org.id}
        `;

        for (const pref of prefs) {
          let subscribedTypes;
          try {
            subscribedTypes = JSON.parse(pref.signal_types as string);
          } catch {
            subscribedTypes = ['all'];
          }

          const relevantSignals = subscribedTypes.includes('all')
            ? cleanSignals
            : cleanSignals.filter((s: Record<string, any>) => subscribedTypes.includes(s.type));

          if (relevantSignals.length === 0) continue;

          const sent = await sendSignalAlertEmail(pref.email as string, orgName, relevantSignals as Parameters<typeof sendSignalAlertEmail>[2]);
          if (sent) {
            summary.emails_sent++;
            logActivity({
              orgId, actorId: 'system', actorType: 'system',
              action: 'alert.email_sent', resourceType: 'signal',
              details: { to: pref.email, signal_count: relevantSignals.length },
            }, sql);
          }
        }

        summary.orgs_processed++;
      } catch (err) {
        console.error(`[CRON] Error processing org ${org.id}:`, (err as Error).message);
        summary.orgs_processed++;
      }
    }

    return NextResponse.json({ success: true, summary });
  } catch (error) {
    console.error('Cron signals error:', error);
    return NextResponse.json({ error: 'Cron job failed' }, { status: 500 });
  }
}
