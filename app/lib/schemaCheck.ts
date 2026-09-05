/**
 * Core table verification for DashClaw.
 * Used by health endpoint, setup status, and first-request startup check.
 */

import {
  CORE_SETUP_TABLES,
  REQUIRED_SETUP_TABLES,
  REQUIRED_SETUP_INDEXES,
  REQUIRED_SETUP_COLUMNS,
  getSetupMigrationCommand,
} from './setup/runtime-prerequisites.mjs';

/** Tagged-template SQL client (callable tag returning rows). */
type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

/**
 * Tables that must exist for DashClaw to function.
 * Ordered roughly by migration step.
 */
export const CORE_TABLES: string[] = [
  ...CORE_SETUP_TABLES,
  ...REQUIRED_SETUP_TABLES.filter((table) => !CORE_SETUP_TABLES.includes(table)),
];

export interface CoreTableCheck {
  ok: boolean;
  present: string[];
  missing: string[];
  presentIndexes: string[];
  missingIndexes: string[];
  presentColumns: string[];
  missingColumns: string[];
}

/**
 * Check which core tables exist in the database.
 */
export async function checkCoreTables(sql: SqlTag): Promise<CoreTableCheck> {
  const requiredIndexes = REQUIRED_SETUP_INDEXES.map((index) => index.name);
  const requiredColumns = REQUIRED_SETUP_COLUMNS.map((column) => `${column.table}.${column.name}`);
  const rows = await sql`
    SELECT ARRAY(
             SELECT table_name::text FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = ANY(${CORE_TABLES})
             ORDER BY table_name
           ) AS present_tables,
           ARRAY(
             SELECT index_class.relname::text
             FROM pg_index index_meta
             JOIN pg_class index_class ON index_class.oid = index_meta.indexrelid
             JOIN pg_class table_class ON table_class.oid = index_meta.indrelid
             JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace
             WHERE namespace.nspname = 'public'
               AND index_class.relname = ANY(${requiredIndexes})
               AND index_meta.indisunique
               AND index_meta.indpred IS NOT NULL
               AND (
                 SELECT array_agg(attribute.attname::text ORDER BY key.ordinality)
                 FROM unnest(index_meta.indkey) WITH ORDINALITY AS key(attnum, ordinality)
                 JOIN pg_attribute attribute
                   ON attribute.attrelid = index_meta.indrelid AND attribute.attnum = key.attnum
               ) = ARRAY['org_id', 'idempotency_key']::text[]
               AND pg_get_expr(index_meta.indpred, index_meta.indrelid) LIKE '%idempotency_key IS NOT NULL%'
             ORDER BY index_class.relname
           ) AS present_indexes,
           ARRAY(
             SELECT required_column
             FROM unnest(${requiredColumns}::text[]) AS required_column
             WHERE EXISTS (
               SELECT 1 FROM information_schema.columns column_meta
               WHERE column_meta.table_schema = 'public'
                 AND column_meta.table_name = split_part(required_column, '.', 1)
                 AND column_meta.column_name = split_part(required_column, '.', 2)
             )
             ORDER BY required_column
           ) AS present_columns
  `;
  const found = new Set((rows[0]?.present_tables as string[] | undefined) ?? []);
  const foundIndexes = new Set((rows[0]?.present_indexes as string[] | undefined) ?? []);
  const foundColumns = new Set((rows[0]?.present_columns as string[] | undefined) ?? []);
  const present = CORE_TABLES.filter((t) => found.has(t));
  const missing = CORE_TABLES.filter((t) => !found.has(t));
  const presentIndexes = requiredIndexes.filter((index) => foundIndexes.has(index));
  const missingIndexes = requiredIndexes.filter((index) => !foundIndexes.has(index));
  const presentColumns = requiredColumns.filter((column) => foundColumns.has(column));
  const missingColumns = requiredColumns.filter((column) => !foundColumns.has(column));
  return {
    ok: missing.length === 0 && missingIndexes.length === 0 && missingColumns.length === 0,
    present,
    missing,
    presentIndexes,
    missingIndexes,
    presentColumns,
    missingColumns,
  };
}

/**
 * Run schema check once on first DB access and log warnings.
 * Safe to call multiple times — only runs once.
 */
let _checked = false;
let _checking: Promise<void> | null = null;
export async function startupSchemaCheck(sql: SqlTag): Promise<void> {
  if (_checked) return;
  if (_checking) return _checking;
  _checking = (async () => {
    try {
      const { ok, missing, missingIndexes, missingColumns } = await checkCoreTables(sql);
      _checked = true;
      if (!ok) {
        console.warn(
          `[SCHEMA] Missing core tables: ${missing.join(', ')}; missing columns: ${missingColumns.join(', ')}; missing or incompatible indexes: ${missingIndexes.join(', ')}. Run: ${getSetupMigrationCommand('scripts/auto-migrate.mjs')}`,
        );
      }
    } catch (err) {
      console.warn('[SCHEMA] Could not verify core tables:', (err as Error)?.message);
    } finally {
      _checking = null;
    }
  })();
  return _checking;
}
