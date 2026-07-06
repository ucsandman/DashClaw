/**
 * Activity logging helper.
 * Fire-and-forget — never blocks the caller.
 */

import crypto from 'crypto';
import type { SqlTag } from './types/db';

export interface LogActivityOptions {
  orgId: string;
  actorId: string;
  actorType?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: unknown;
  request?: Request;
}

function insertActivityRow(
  { orgId, actorId, actorType = 'user', action, resourceType, resourceId, details, request }: LogActivityOptions,
  sql: SqlTag
): Promise<unknown> {
  const id = `al_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  // SECURITY: prefer middleware-derived trusted IP; fallback is best-effort only.
  const ip = request?.headers?.get?.('x-client-ip') ||
    request?.headers?.get?.('x-forwarded-for')?.split(',')[0]?.trim() ||
    null;
  const detailsStr = details ? JSON.stringify(details) : null;

  return sql`
    INSERT INTO activity_logs (id, org_id, actor_id, actor_type, action, resource_type, resource_id, details, ip_address, created_at)
    VALUES (${id}, ${orgId}, ${actorId}, ${actorType}, ${action}, ${resourceType || null}, ${resourceId || null}, ${detailsStr}, ${ip}, ${now})
  ` as unknown as Promise<unknown>;
}

/**
 * Log an activity event to the activity_logs table.
 *
 * Best-effort telemetry: never blocks or fails the caller. On serverless
 * (Vercel) the insert can be dropped if the function freezes at response
 * time — call sites where losing the row matters must either wrap this in
 * `after(() => logActivity(...))` or use `logActivityStrict` below.
 *
 * @param opts
 * @param opts.orgId
 * @param opts.actorId - user ID, 'system', or 'cron'
 * @param opts.actorType='user' - user|system|api_key|cron
 * @param opts.action - e.g. 'key.created', 'alert.email_sent'
 * @param opts.resourceType - api_key|invite|member|setting|webhook|signal|usage
 * @param opts.resourceId
 * @param opts.details - arbitrary JSON-serializable details
 * @param opts.request - optional request for IP extraction
 * @param sql - neon sql tagged template
 */
export function logActivity(opts: LogActivityOptions, sql: SqlTag): void {
  insertActivityRow(opts, sql).catch((err: unknown) => {
    console.error('[AUDIT] Failed to log activity:', (err as Error)?.message);
  });
}

/**
 * Awaited, throwing variant for writes that are themselves the audit
 * guarantee (e.g. the erasure record written BEFORE deleting governed
 * history). A caller that cannot write this row must fail the operation —
 * silence here is exactly the audit gap the fire-and-forget path permits.
 */
export async function logActivityStrict(opts: LogActivityOptions, sql: SqlTag): Promise<void> {
  await insertActivityRow(opts, sql);
}
