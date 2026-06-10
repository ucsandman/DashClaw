import { randomUUID } from 'node:crypto';

import type { SqlTag } from '../types/db';

interface InsertScanData {
  agent_id?: string | null;
  content_hash: string;
  findings_count: number;
  critical_count: number;
  categories: unknown;
  risk_level: string;
  recommendation: string;
  source?: string | null;
  [k: string]: unknown;
}

interface ListScansOptions {
  limit?: number;
  offset?: number;
}

export async function insertScan(
  sql: SqlTag,
  orgId: string,
  data: InsertScanData
): Promise<{ id: string; scanned_at: string }> {
  const id = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const now = new Date().toISOString();

  await sql`
    INSERT INTO prompt_injection_scans (id, org_id, agent_id, content_hash, findings_count, critical_count, categories, risk_level, recommendation, source, scanned_at)
    VALUES (${id}, ${orgId}, ${data.agent_id || null}, ${data.content_hash}, ${data.findings_count}, ${data.critical_count}, ${JSON.stringify(data.categories)}, ${data.risk_level}, ${data.recommendation}, ${data.source || null}, ${now})
  `;

  return { id, scanned_at: now };
}

export async function listScans(
  sql: SqlTag,
  orgId: string,
  { limit = 50, offset = 0 }: ListScansOptions = {}
): Promise<{ scans: Record<string, unknown>[]; total: number }> {
  const scans = await sql`
    SELECT id, agent_id, content_hash, findings_count, critical_count, categories, risk_level, recommendation, source, scanned_at
    FROM prompt_injection_scans
    WHERE org_id = ${orgId}
    ORDER BY scanned_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const countResult = await sql`
    SELECT COUNT(*)::int AS total FROM prompt_injection_scans WHERE org_id = ${orgId}
  `;

  return { scans, total: (countResult[0]?.total as number | undefined) || 0 };
}
