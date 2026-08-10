import type { SqlTag } from '../types/db';

// Per-occurrence signal dismissals (see drizzle/0071_signal_dismissals.sql).
// ensureTable mirrors the identities.repository pattern so deploys that
// haven't run db:migrate yet still work — the canonical schema and migration
// carry the same DDL for fresh installs.
let _tableChecked = false;

async function ensureTable(sql: SqlTag): Promise<void> {
  if (_tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS signal_dismissals (
      id SERIAL PRIMARY KEY,
      org_id TEXT NOT NULL,
      dismiss_key TEXT NOT NULL,
      dismissed_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS signal_dismissals_org_key_unique
    ON signal_dismissals (org_id, dismiss_key)
  `;
  _tableChecked = true;
}

export async function listDismissKeys(sql: SqlTag, orgId: string): Promise<string[]> {
  await ensureTable(sql);
  const rows = await sql`
    SELECT dismiss_key FROM signal_dismissals WHERE org_id = ${orgId}
  `;
  return (rows as Array<{ dismiss_key: string }>).map((r) => r.dismiss_key);
}

// Bulk-tolerant: used both for single dismiss clicks and the one-time
// localStorage migration each browser runs. Conflicts (already dismissed)
// are silently absorbed so the migration is idempotent.
export async function addDismissals(
  sql: SqlTag,
  orgId: string,
  dismissKeys: string[],
  dismissedBy: string | null = null,
): Promise<number> {
  if (dismissKeys.length === 0) return 0;
  await ensureTable(sql);
  let added = 0;
  for (const key of dismissKeys) {
    const rows = await sql`
      INSERT INTO signal_dismissals (org_id, dismiss_key, dismissed_by)
      VALUES (${orgId}, ${key}, ${dismissedBy})
      ON CONFLICT (org_id, dismiss_key) DO NOTHING
      RETURNING id
    `;
    added += (rows as unknown[]).length;
  }
  return added;
}
