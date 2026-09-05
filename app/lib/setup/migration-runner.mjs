import { createHash } from 'node:crypto';
import { splitSqlStatements } from './sql-statements.mjs';
import {
  REQUIRED_SETUP_TABLES,
  REQUIRED_SETUP_INDEXES,
  REQUIRED_SETUP_COLUMNS,
} from './runtime-prerequisites.mjs';

export const MIGRATION_ADVISORY_LOCK_KEY = 0x44415348434c4157n;

export const MIGRATION_LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

const IGNORABLE_MIGRATION_CODES = new Set([
  '42P07', // duplicate_table / duplicate relation name
  '42701', // duplicate_column
  '42710', // duplicate_object (constraint, policy, trigger, etc.)
]);

export function isIgnorableMigrationError(error) {
  return IGNORABLE_MIGRATION_CODES.has(String(error?.code || ''));
}

export function migrationChecksum(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function primaryTargetTable(statement) {
  const patterns = [
    /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+"?(\w+)"?/i,
    /CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?(?:\s+IF\s+NOT\s+EXISTS)?\s+\S+\s+ON\s+"?(\w+)"?/i,
    /ALTER\s+TABLE(?:\s+IF\s+EXISTS)?\s+"?(\w+)"?/i,
    /DROP\s+TABLE(?:\s+IF\s+EXISTS)?\s+"?(\w+)"?/i,
  ];
  for (const pattern of patterns) {
    const match = statement.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export async function inspectMigrationConflicts(sql) {
  const existence = await sql`
    SELECT to_regclass('public.action_records') IS NOT NULL AS action_records_exists,
           EXISTS (
             SELECT 1
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'action_records'
               AND column_name = 'idempotency_key'
           ) AS idempotency_key_exists
  `;
  if (
    existence[0]?.action_records_exists !== true
    || existence[0]?.idempotency_key_exists !== true
  ) {
    return { conflicts: [] };
  }

  const rows = await sql`
    SELECT COUNT(*)::int AS duplicate_groups,
           COALESCE(SUM(row_count), 0)::int AS conflicting_rows
    FROM (
      SELECT COUNT(*)::int AS row_count
      FROM action_records
      WHERE idempotency_key IS NOT NULL
      GROUP BY org_id, idempotency_key
      HAVING COUNT(*) > 1
    ) duplicates
  `;
  const groups = Number(rows[0]?.duplicate_groups ?? 0);
  if (groups === 0) return { conflicts: [] };
  return {
    conflicts: [{
      index: 'action_records_idempotency_idx',
      duplicateGroups: groups,
      conflictingRows: Number(rows[0]?.conflicting_rows ?? 0),
    }],
  };
}

export async function validateRequiredSchema(sql, expectedMigrations = []) {
  const requiredTableNames = REQUIRED_SETUP_TABLES;
  const requiredIndexNames = REQUIRED_SETUP_INDEXES.map((index) => index.name);
  const requiredColumns = REQUIRED_SETUP_COLUMNS.map((column) => `${column.table}.${column.name}`);
  const rows = await sql`
    WITH required_tables(name) AS (
      SELECT unnest(${requiredTableNames}::text[])
    ), required_indexes(name) AS (
      SELECT unnest(${requiredIndexNames}::text[])
    ), required_columns(name) AS (
      SELECT unnest(${requiredColumns}::text[])
    ), valid_required_indexes AS (
      SELECT index_class.relname AS name
      FROM pg_index index_meta
      JOIN pg_class index_class ON index_class.oid = index_meta.indexrelid
      JOIN pg_class table_class ON table_class.oid = index_meta.indrelid
      JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace
      WHERE namespace.nspname = 'public'
        AND index_class.relname = 'action_records_idempotency_idx'
        AND table_class.relname = 'action_records'
        AND index_meta.indisunique
        AND index_meta.indpred IS NOT NULL
        AND (
          SELECT array_agg(attribute.attname::text ORDER BY key.ordinality)
          FROM unnest(index_meta.indkey) WITH ORDINALITY AS key(attnum, ordinality)
          JOIN pg_attribute attribute
            ON attribute.attrelid = index_meta.indrelid AND attribute.attnum = key.attnum
        ) = ARRAY['org_id', 'idempotency_key']::text[]
        AND pg_get_expr(index_meta.indpred, index_meta.indrelid) LIKE '%idempotency_key IS NOT NULL%'
    )
    SELECT ARRAY(
             SELECT name FROM required_tables
             WHERE to_regclass('public.' || name) IS NULL
             ORDER BY name
           ) AS missing_tables,
           ARRAY(
             SELECT name FROM required_indexes
             WHERE name NOT IN (SELECT name FROM valid_required_indexes)
             ORDER BY name
           ) AS missing_indexes,
           ARRAY(
             SELECT name FROM required_columns
             WHERE NOT EXISTS (
               SELECT 1 FROM information_schema.columns column_meta
               WHERE column_meta.table_schema = 'public'
                 AND column_meta.table_name = split_part(required_columns.name, '.', 1)
                 AND column_meta.column_name = split_part(required_columns.name, '.', 2)
             )
             ORDER BY name
           ) AS missing_columns
  `;
  const missingTables = Array.isArray(rows[0]?.missing_tables) ? rows[0].missing_tables : [];
  const missingIndexes = Array.isArray(rows[0]?.missing_indexes) ? rows[0].missing_indexes : [];
  const missingColumns = Array.isArray(rows[0]?.missing_columns) ? rows[0].missing_columns : [];
  if (missingTables.length > 0 || missingIndexes.length > 0 || missingColumns.length > 0) {
    throw new Error(
      `Schema postcondition failed: missing tables [${missingTables.join(', ')}]; missing columns [${missingColumns.join(', ')}]; missing or incompatible indexes [${missingIndexes.join(', ')}]`,
    );
  }

  if (expectedMigrations.length > 0) {
    const filenames = expectedMigrations.map((migration) => migration.filename);
    const appliedRows = await sql`
      SELECT filename, checksum FROM schema_migrations WHERE filename = ANY(${filenames})
    `;
    const applied = new Map(appliedRows.map((row) => [String(row.filename), String(row.checksum)]));
    const missing = expectedMigrations.filter((migration) => !applied.has(migration.filename));
    const drifted = expectedMigrations.filter((migration) => {
      const checksum = applied.get(migration.filename);
      return checksum !== undefined && checksum !== migration.checksum;
    });
    if (missing.length > 0 || drifted.length > 0) {
      throw new Error(
        `Migration ledger postcondition failed: missing [${missing.map((m) => m.filename).join(', ')}]; checksum drift [${drifted.map((m) => m.filename).join(', ')}]`,
      );
    }
  }
}

async function executeStatement(tx, statement) {
  try {
    await tx.savepoint((savepoint) => savepoint.unsafe(statement));
    return 'applied';
  } catch (error) {
    if (isIgnorableMigrationError(error)) return 'already_applied';
    throw error;
  }
}

async function reconcileLegacyColumns(tx, statements, skippedTables) {
  let reconciled = 0;
  for (const statement of statements) {
    const tableMatch = statement.match(/^CREATE TABLE\s+"(\w+)"\s*\(/i);
    if (!tableMatch || skippedTables.has(tableMatch[1])) continue;
    const table = tableMatch[1];
    const body = statement.slice(statement.indexOf('(') + 1, statement.lastIndexOf(')'));
    const lines = body.split('\n').map((line) => line.trim().replace(/,\s*$/, ''));
    for (const line of lines) {
      if (!line.startsWith('"')) continue;
      const columnMatch = line.match(/^"(\w+)"\s+(.+)/);
      if (!columnMatch) continue;
      const column = columnMatch[1];
      const definition = columnMatch[2].replace(/\s*PRIMARY KEY.*/i, '').replace(/,\s*$/, '');
      await tx.unsafe(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${definition}`);
      reconciled++;
    }
  }
  return reconciled;
}

export async function runSchemaMigrations(sql, migrations, { recordMigrations = true } = {}) {
  const prepared = migrations.map((migration) => ({
    ...migration,
    checksum: migrationChecksum(migration.content),
    statements: splitSqlStatements(migration.content),
  }));

  const conflictReport = await inspectMigrationConflicts(sql);
  if (conflictReport.conflicts.length > 0) {
    const conflict = conflictReport.conflicts[0];
    throw new Error(
      `Migration preflight found incompatible data for ${conflict.index}: ${conflict.duplicateGroups} duplicate group(s), ${conflict.conflictingRows} conflicting row(s). No rows were changed.`,
    );
  }

  if (typeof sql.begin !== 'function') {
    throw new Error('Migration runner requires a transaction-capable Postgres client.');
  }

  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${MIGRATION_ADVISORY_LOCK_KEY})`;
    await tx.unsafe(MIGRATION_LEDGER_DDL);

    const existingRows = recordMigrations
      ? await tx`SELECT filename, checksum FROM schema_migrations`
      : [];
    const existing = new Map(existingRows.map((row) => [String(row.filename), String(row.checksum)]));
    const changed = prepared.filter((migration) => {
      const checksum = existing.get(migration.filename);
      if (checksum && checksum !== migration.checksum) {
        throw new Error(`Applied migration ${migration.filename} has checksum drift.`);
      }
      return !checksum;
    });

    let appliedStatements = 0;
    let alreadyAppliedStatements = 0;
    let pgvectorAvailable = null;
    const skippedTables = new Set();
    const allStatements = [];

    for (const migration of changed) {
      for (const statement of migration.statements) {
        allStatements.push(statement);
        const needsVector = statement.includes('vector(') && !statement.startsWith('CREATE EXTENSION');
        if (needsVector && pgvectorAvailable === null) {
          try {
            await tx.savepoint((savepoint) => savepoint.unsafe('CREATE EXTENSION IF NOT EXISTS vector'));
            pgvectorAvailable = true;
          } catch {
            pgvectorAvailable = false;
          }
        }
        if (needsVector && pgvectorAvailable === false) {
          const target = primaryTargetTable(statement);
          if (target) skippedTables.add(target);
          alreadyAppliedStatements++;
          continue;
        }
        const target = primaryTargetTable(statement);
        if (target && skippedTables.has(target)) {
          alreadyAppliedStatements++;
          continue;
        }
        try {
          const outcome = await executeStatement(tx, statement);
          if (outcome === 'applied') appliedStatements++;
          else alreadyAppliedStatements++;
        } catch (error) {
          const code = String(error?.code || 'unknown');
          throw new Error(
            `Migration ${migration.filename} failed (${code}): ${String(error?.message || error).slice(0, 300)}`,
            { cause: error },
          );
        }
      }
      if (recordMigrations) {
        await tx`
          INSERT INTO schema_migrations (filename, checksum)
          VALUES (${migration.filename}, ${migration.checksum})
          ON CONFLICT (filename) DO NOTHING
        `;
      }
    }

    const reconciledColumns = await reconcileLegacyColumns(tx, allStatements, skippedTables);
    const expected = recordMigrations
      ? prepared.map(({ filename, checksum }) => ({ filename, checksum }))
      : [];
    await validateRequiredSchema(tx, expected);

    return {
      migrationsApplied: changed.length,
      migrationsAlreadyApplied: prepared.length - changed.length,
      appliedStatements,
      alreadyAppliedStatements,
      reconciledColumns,
      pgvectorAvailable,
    };
  });
}
