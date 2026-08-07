// Webhooks repository — centralises all SQL for the webhooks and
// webhook_deliveries tables. Routes pass their getSql() instance in; query
// text is unchanged from the former inline route SQL.
import type { SqlTag } from '../types/db';

/** List webhooks for an org (secrets masked by the caller). */
export async function listWebhooksByOrg(
  sql: SqlTag,
  orgId: string,
): Promise<Record<string, unknown>[]> {
  return sql`
      SELECT id, url, secret, events, active, failure_count, last_triggered_at, created_at, created_by
      FROM webhooks
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC
    `;
}

/** Insert a new webhook. */
export async function insertWebhook(
  sql: SqlTag,
  params: {
    webhookId: string;
    orgId: string;
    url: string;
    secret: string;
    events: string[];
    userId: string | null;
    now: string;
  },
): Promise<void> {
  const { webhookId, orgId, url, secret, events, userId, now } = params;
  await sql`
      INSERT INTO webhooks (id, org_id, url, secret, events, active, created_by, failure_count, created_at)
      VALUES (${webhookId}, ${orgId}, ${url}, ${secret}, ${JSON.stringify(events)}, 1, ${userId}, 0, ${now})
    `;
}

/** Fetch a webhook id scoped to an org (existence/ownership check). */
export async function findWebhookById(
  sql: SqlTag,
  webhookId: string,
  orgId: string,
): Promise<Record<string, unknown>[]> {
  return sql`
      SELECT id FROM webhooks WHERE id = ${webhookId} AND org_id = ${orgId}
    `;
}

/** Delete a webhook scoped to an org. */
export async function deleteWebhook(
  sql: SqlTag,
  webhookId: string,
  orgId: string,
): Promise<void> {
  await sql`DELETE FROM webhooks WHERE id = ${webhookId} AND org_id = ${orgId}`;
}

/**
 * Recent deliveries for a webhook. payload + response_body are redacted at
 * write time (redactForStorage in app/lib/webhooks.ts logWebhookDelivery), so
 * exposing them read-only is safe and lets users debug deliveries without
 * external tooling.
 */
export async function listWebhookDeliveries(
  sql: SqlTag,
  webhookId: string,
  orgId: string,
): Promise<Record<string, unknown>[]> {
  return sql`
      SELECT id, event_type, status, response_status, attempted_at, duration_ms, payload, response_body
      FROM webhook_deliveries
      WHERE webhook_id = ${webhookId} AND org_id = ${orgId}
      ORDER BY attempted_at DESC
      LIMIT 20
    `;
}

/** Fetch a webhook's id/url/secret/failure_count scoped to an org (for test delivery). */
export async function findWebhookForDelivery(
  sql: SqlTag,
  webhookId: string,
  orgId: string,
): Promise<Record<string, unknown>[]> {
  return sql`
      SELECT id, url, secret, failure_count FROM webhooks WHERE id = ${webhookId} AND org_id = ${orgId}
    `;
}
