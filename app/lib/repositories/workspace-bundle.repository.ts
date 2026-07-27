// v7.2 graduation path (spec docs/superpowers/specs/2026-07-05-graduation-path-v72.md):
// export an org's durable governance record as a portable bundle; import it
// into another instance. Column lists are derived from schema/schema.js at
// runtime so they cannot drift, minus explicit deny-lists; a unit test forces
// every NEW schema column through a conscious export/deny classification.
//
// Never in a bundle, by class: credentials and credential-equivalents
// (api_keys.key_hash, OAuth token/code hashes, the instance signing key),
// managed secret values (write-only invariant; AAD-bound ciphertext), and
// ephemeral telemetry. Those tables simply are not listed here.

import { getTableConfig } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  guardPolicies,
  guardDecisions,
  actionRecords,
  openLoops,
  assumptions,
  agentIdentities,
} from '../../../schema/schema.js';
import type { SqlTag } from '../types/db';

export const BUNDLE_FORMAT = 'dashclaw-workspace-bundle';
export const BUNDLE_VERSION = 1;
/** Abuse backstop for the import route, not a product limit. */
export const MAX_BUNDLE_ROWS = 250_000;

export type BundleTableSpec = {
  name: string;
  table: PgTable;
  /** Column that identifies a row for idempotent import, unique within an org. */
  dedupeKey: string;
  /**
   * When the dedupe key is backed by a GLOBAL unique constraint/index, import
   * uses ON CONFLICT (…) DO NOTHING — org-scoped NOT EXISTS alone would let a
   * cross-org id collision on the same instance surface as a PK violation.
   * Tables without a unique index on the key (serial-PK tables) fall back to
   * org-scoped WHERE NOT EXISTS.
   */
  conflictTarget?: string;
  /**
   * Secondary org-scoped natural key backed by a per-org unique constraint
   * (e.g. guard_policies (org_id, name)). A bundle row carries a foreign id,
   * so ON CONFLICT (id) never fires when the target org already has the same
   * row under a different id — the insert then dies on the org-scoped
   * constraint instead. Rows whose value already exists in the org are
   * skipped.
   */
  orgUniqueKey?: string;
  /** Table-specific columns that never leave the instance. */
  deny: string[];
};

// org_id is re-scoped by the importer; instance-local serial PKs are
// regenerated. Both are stripped from every exported row.
const BASE_DENY = ['org_id'];

export const BUNDLE_TABLES: BundleTableSpec[] = [
  { name: 'guard_policies', table: guardPolicies, dedupeKey: 'id', conflictTarget: '(id)', orgUniqueKey: 'name', deny: [] },
  // jti is a replay nonce, forensic to the source instance.
  { name: 'guard_decisions', table: guardDecisions, dedupeKey: 'id', conflictTarget: '(id)', deny: ['jti'] },
  // signature/verified attest to the SOURCE instance's signing key — on the
  // target they cannot re-verify and must never render as natively verified
  // (security review, 2026-07-05). Imported rows get schema defaults instead.
  // containment_* (drizzle/0064) are DENIED: containment_ref names a git
  // worktree branch that only exists on the exporting instance's filesystem;
  // an imported awaiting_promotion/contained row would point an operator's
  // Promote click at a ref that never existed on the target. Imported rows
  // get schema defaults (NULL) instead.
  { name: 'action_records', table: actionRecords, dedupeKey: 'action_id', conflictTarget: '(action_id)', deny: ['id', 'signature', 'verified', 'containment_status', 'containment_ref', 'containment_resolved_by', 'containment_resolved_at'] },
  { name: 'open_loops', table: openLoops, dedupeKey: 'loop_id', deny: ['id'] },
  { name: 'assumptions', table: assumptions, dedupeKey: 'assumption_id', deny: ['id'] },
  { name: 'agent_identities', table: agentIdentities, dedupeKey: 'agent_id', conflictTarget: '(org_id, agent_id)', deny: [] },
];

type ColumnInfo = { name: string; sqlType: string };

function tableColumns(spec: BundleTableSpec): ColumnInfo[] {
  const denied = new Set([...BASE_DENY, ...spec.deny]);
  return getTableConfig(spec.table)
    .columns.map((c) => ({ name: c.name, sqlType: c.getSQLType() }))
    .filter((c) => !denied.has(c.name));
}

/** Exported (snake_case) column names for a bundle table — pinned by the classification test. */
export function exportedColumns(spec: BundleTableSpec): string[] {
  return tableColumns(spec).map((c) => c.name);
}

export type WorkspaceBundle = {
  format: string;
  version: number;
  exported_at: string;
  org: { id: string; name: string | null };
  counts: Record<string, number>;
  tables: Record<string, Array<Record<string, unknown>>>;
};

export async function exportWorkspaceBundle(sql: SqlTag, orgId: string): Promise<WorkspaceBundle> {
  const orgRows = (await sql.query(
    'SELECT id, name FROM organizations WHERE id = $1',
    [orgId],
  )) as Array<{ id: string; name: string | null }>;
  const org = orgRows[0];
  if (!org) throw new Error(`org not found: ${orgId}`);

  const tables: WorkspaceBundle['tables'] = {};
  const counts: Record<string, number> = {};
  for (const spec of BUNDLE_TABLES) {
    const cols = exportedColumns(spec).map((c) => `"${c}"`).join(', ');
    const rows = (await sql.query(
      `SELECT ${cols} FROM ${spec.name} WHERE org_id = $1`,
      [orgId],
    )) as Array<Record<string, unknown>>;
    tables[spec.name] = rows;
    counts[spec.name] = rows.length;
  }

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exported_at: new Date().toISOString(),
    org: { id: org.id, name: org.name },
    counts,
    tables,
  };
}

/**
 * Graduation stamp: first successful export of a hosted trial. Earliest
 * stamp wins (idempotent); non-hosted orgs are never stamped.
 * Returns true when the org is a hosted trial (stamped now or earlier).
 */
export async function stampTrialExported(sql: SqlTag, orgId: string): Promise<boolean> {
  const rows = (await sql.query(
    `UPDATE organizations
     SET trial_exported_at = COALESCE(trial_exported_at, NOW())
     WHERE id = $1 AND hosted_mode = TRUE
     RETURNING trial_exported_at`,
    [orgId],
  )) as unknown[];
  return rows.length > 0;
}

/** Thrown for malformed bundles; routes map it to a 400. */
export class BundleValidationError extends Error {}

function assertValidBundle(bundle: unknown): asserts bundle is WorkspaceBundle {
  const b = bundle as Partial<WorkspaceBundle> | null;
  if (!b || typeof b !== 'object') throw new BundleValidationError('bundle must be a JSON object');
  if (b.format !== BUNDLE_FORMAT) {
    throw new BundleValidationError(`bundle.format must be "${BUNDLE_FORMAT}"`);
  }
  if (b.version !== BUNDLE_VERSION) {
    throw new BundleValidationError(`unsupported bundle.version (expected ${BUNDLE_VERSION})`);
  }
  if (!b.tables || typeof b.tables !== 'object') {
    throw new BundleValidationError('bundle.tables missing');
  }
  let total = 0;
  for (const spec of BUNDLE_TABLES) {
    const rows = (b.tables as Record<string, unknown>)[spec.name];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) {
      throw new BundleValidationError(`bundle.tables.${spec.name} must be an array`);
    }
    total += rows.length;
  }
  if (total > MAX_BUNDLE_ROWS) {
    throw new BundleValidationError(`bundle exceeds ${MAX_BUNDLE_ROWS} rows`);
  }
}

export type ImportCounts = Record<string, { imported: number; skipped: number }>;

/**
 * Import a bundle into the target org. Idempotent: a row whose dedupe key
 * already exists in the target org is skipped, so re-importing the same
 * bundle is safe. Unknown row keys are dropped (never trusted); missing
 * columns insert as NULL/defaults so older-instance bundles still import.
 */
export async function importWorkspaceBundle(
  sql: SqlTag,
  orgId: string,
  bundle: unknown,
): Promise<{ counts: ImportCounts }> {
  assertValidBundle(bundle);

  const counts: ImportCounts = {};
  for (const spec of BUNDLE_TABLES) {
    const rows = bundle.tables[spec.name] ?? [];
    let imported = 0;
    let skipped = 0;
    const allowed = tableColumns(spec);
    for (const row of rows) {
      const key = row?.[spec.dedupeKey];
      if (key === null || key === undefined || typeof row !== 'object') {
        skipped += 1;
        continue;
      }
      const present = allowed.filter((c) => row[c.name] !== undefined);
      const insertCols = ['org_id', ...present.map((c) => `"${c.name}"`)].join(', ');
      const values = present.map((c) =>
        c.sqlType === 'jsonb' && row[c.name] !== null ? JSON.stringify(row[c.name]) : row[c.name],
      );
      // Explicit ::casts keep jsonb/timestamptz round-trips driver-agnostic.
      // Every declared placeholder must be referenced, so the two branches
      // lay out their params differently.
      let insertSql: string;
      let params: unknown[];
      if (spec.conflictTarget) {
        // $1 = org, values start at $2; the orgUniqueKey param (if any) rides
        // last. ON CONFLICT covers a same-id re-import; the NOT EXISTS covers
        // the same org-scoped identity arriving under a foreign id.
        const valueExprs = ['$1', ...present.map((c, i) => `$${i + 2}::${c.sqlType}`)].join(', ');
        const orgKeyGuard = spec.orgUniqueKey
          ? ` WHERE NOT EXISTS (
             SELECT 1 FROM ${spec.name} WHERE org_id = $1 AND "${spec.orgUniqueKey}" = $${present.length + 2}
           )`
          : '';
        insertSql = `INSERT INTO ${spec.name} (${insertCols})
           SELECT ${valueExprs}${orgKeyGuard}
           ON CONFLICT ${spec.conflictTarget} DO NOTHING
           RETURNING 1`;
        params = spec.orgUniqueKey ? [orgId, ...values, row[spec.orgUniqueKey]] : [orgId, ...values];
      } else {
        // $1 = org, $2 = dedupe key, values start at $3.
        const valueExprs = ['$1', ...present.map((c, i) => `$${i + 3}::${c.sqlType}`)].join(', ');
        insertSql = `INSERT INTO ${spec.name} (${insertCols})
           SELECT ${valueExprs}
           WHERE NOT EXISTS (
             SELECT 1 FROM ${spec.name} WHERE org_id = $1 AND "${spec.dedupeKey}" = $2
           )
           RETURNING 1`;
        params = [orgId, key, ...values];
      }
      const result = (await sql.query(insertSql, params)) as unknown[];
      if (result.length > 0) imported += 1;
      else skipped += 1;
    }
    counts[spec.name] = { imported, skipped };
  }
  return { counts };
}
