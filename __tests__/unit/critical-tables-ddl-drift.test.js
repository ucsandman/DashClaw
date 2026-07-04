/**
 * Drift gate for CRITICAL_TABLES_DDL (v3.7 item 5a ride-along).
 *
 * CRITICAL_TABLES_DDL in app/api/setup/migrate/route.ts is the fallback
 * schema used when the drizzle migration files aren't in the serverless
 * bundle. It once fell badly out of sync with schema/schema.js (guard_decisions
 * was missing verification_status, replay_status, jti, act_status, act_hash,
 * evidence, degraded, agent_name) — any deploy that ever took the fallback
 * branch would hard-fail the required audit INSERT with 42703. This test
 * pins every schema.js-backed table's column set so that regression can never
 * silently recur: it fails the moment someone adds/renames a column in
 * schema.js without updating the fallback DDL alongside it.
 *
 * `settings` is the one table in CRITICAL_TABLES_DDL with no pgTable object
 * in schema.js (it's declared only in drizzle/0000_clammy_falcon.sql), so it
 * is checked against that migration file instead of schema.js.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  organizations, users, apiKeys, actionRecords, guardPolicies, guardDecisions,
} from '../../schema/schema.js';
import { CRITICAL_TABLES_DDL } from '@/api/setup/migrate/route.js';

/** Extract the column names declared in a `CREATE TABLE "name" ( ... )` block. */
function extractDdlColumns(ddlText, tableName) {
  const statements = ddlText.split('--> statement-breakpoint').map((s) => s.trim());
  const re = new RegExp(`^CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?"${tableName}"\\s*\\(`, 'i');
  const stmt = statements.find((s) => re.test(s));
  if (!stmt) throw new Error(`No CREATE TABLE "${tableName}" statement found`);

  const body = stmt.slice(stmt.indexOf('(') + 1, stmt.lastIndexOf(')'));
  const columns = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('"')) continue; // skip CONSTRAINT/PRIMARY KEY lines
    const match = line.match(/^"(\w+)"/);
    if (match) columns.push(match[1]);
  }
  return columns.sort();
}

/** Column DB names (snake_case) as declared on a drizzle pgTable object. */
function schemaColumns(table) {
  return getTableConfig(table).columns.map((c) => c.name).sort();
}

const SCHEMA_BACKED_TABLES = [
  ['organizations', organizations],
  ['users', users],
  ['api_keys', apiKeys],
  ['action_records', actionRecords],
  ['guard_policies', guardPolicies],
  ['guard_decisions', guardDecisions],
];

describe('CRITICAL_TABLES_DDL column-set drift gate', () => {
  it.each(SCHEMA_BACKED_TABLES)('"%s" matches schema/schema.js exactly', (tableName, table) => {
    const ddlColumns = extractDdlColumns(CRITICAL_TABLES_DDL, tableName);
    const expected = schemaColumns(table);
    expect(ddlColumns).toEqual(expected);
  });

  it('"settings" matches drizzle/0000_clammy_falcon.sql (no pgTable object exists for it)', () => {
    const migrationPath = resolve(process.cwd(), 'drizzle', '0000_clammy_falcon.sql');
    const migrationSql = readFileSync(migrationPath, 'utf8').replace(/--> statement-breakpoint/g, '\n--> statement-breakpoint\n');
    const ddlColumns = extractDdlColumns(CRITICAL_TABLES_DDL, 'settings');
    const expected = extractDdlColumns(migrationSql, 'settings');
    expect(ddlColumns).toEqual(expected);
  });
});
