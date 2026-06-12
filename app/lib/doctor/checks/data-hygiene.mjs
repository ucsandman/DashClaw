// app/lib/doctor/checks/data-hygiene.mjs
// W4: detect non-ISO strings in client-written TEXT timestamp columns.
// Incident class: clients sent JS Date.toString() output (e.g. "Thu Jun 11 2026
// 14:30:00 GMT-0400 (Eastern Daylight Time)") which breaks ::timestamptz casts
// (PG 22023). validate.js normalizes NEW writes; this finds existing bad rows.
import { getSql } from '../../db';
import { getSetupStatus } from '../../setupStatus.mjs';

/**
 * Client-written TEXT timestamp columns to probe. Committed strings — safe to
 * interpolate into query text (Neon driver lacks sql.identifier()).
 * Tenancy: `org` names the table's org column; `orgVia` scopes child tables
 * through their parent. API callers are ALWAYS org-scoped (hosted deployments
 * share one DB); only the operator-local script runs instance-wide.
 */
export const TIMESTAMP_COLUMNS = [
  { table: 'action_records', column: 'timestamp_start', org: 'org_id' },
  { table: 'action_records', column: 'timestamp_end', org: 'org_id' },
  { table: 'decisions', column: 'timestamp', org: 'org_id' },
  { table: 'health_snapshots', column: 'timestamp', org: 'org_id' },
  { table: 'token_snapshots', column: 'timestamp', org: 'org_id' },
  { table: 'agent_connections', column: 'reported_at', org: 'org_id' },
  { table: 'code_sessions', column: 'started_at', org: 'org_id' },
  { table: 'code_sessions', column: 'ended_at', org: 'org_id' },
  { table: 'code_session_messages', column: 'timestamp', orgVia: { parent: 'code_sessions', fk: 'session_id' } },
  { table: 'code_session_tool_uses', column: 'timestamp', orgVia: { parent: 'code_sessions', fk: 'session_id' } },
];

/** SQL predicate scoping an entry's rows to one org ('' when entry can't scope). */
export function orgPredicate(entry, paramRef) {
  if (entry.org) return ` AND ${entry.org} = ${paramRef}`;
  if (entry.orgVia) {
    return ` AND ${entry.orgVia.fk} IN (SELECT id FROM ${entry.orgVia.parent} WHERE org_id = ${paramRef})`;
  }
  return '';
}

/** POSIX regex: value starts with an ISO-8601 date (lenient — accepts "T" or " " separators later). */
export const ISO_PREFIX_REGEX = '^\\d{4}-\\d{2}-\\d{2}';

/** Cap distinct offending values fetched per column (incident classes have few distinct values). */
const MAX_DISTINCT = 1000;

export function nonIsoGroupQuery(entry, { orgScoped = false } = {}) {
  const { table, column } = entry;
  const scope = orgScoped ? orgPredicate(entry, '$2') : '';
  return `SELECT ${column} AS value, COUNT(*)::int AS count FROM ${table} WHERE ${column} IS NOT NULL AND ${column} !~ $1${scope} GROUP BY ${column} LIMIT ${MAX_DISTINCT}`;
}

/** Classify distinct non-ISO values into parseable (fixable) vs garbage rows. */
export function classifyValues(rows) {
  let parseableRows = 0;
  let garbageRows = 0;
  const parseableValues = [];
  for (const row of rows) {
    const count = Number(row.count) || 0;
    if (Number.isNaN(new Date(row.value).getTime())) {
      garbageRows += count;
    } else {
      parseableRows += count;
      parseableValues.push(row.value);
    }
  }
  return { parseableRows, garbageRows, parseableValues };
}

/**
 * Probe every TIMESTAMP_COLUMNS entry; returns per-column findings.
 * Missing tables (older schemas) are skipped silently — covered by database checks.
 * When orgId is provided (API callers), every probe is scoped to that org;
 * unscoped probing is reserved for the operator-local script.
 */
export async function probeColumns(sql, { orgId = null } = {}) {
  const findings = [];
  for (const entry of TIMESTAMP_COLUMNS) {
    const { table, column } = entry;
    const orgScoped = !!orgId;
    const params = orgScoped ? [ISO_PREFIX_REGEX, orgId] : [ISO_PREFIX_REGEX];
    let rows;
    try {
      rows = await sql.query(nonIsoGroupQuery(entry, { orgScoped }), params);
    } catch {
      continue; // table/column may not exist — covered by database checks
    }
    if (!rows || rows.length === 0) continue;
    const { parseableRows, garbageRows, parseableValues } = classifyValues(rows);
    findings.push({ table, column, entry, parseableRows, garbageRows, parseableValues });
  }
  return findings;
}

/**
 * @param {{ env?: object, orgId?: string|null }} options - orgId scopes the
 *   probe to one tenant (set from x-org-id for API callers; null for the
 *   operator-local script, which owns the whole instance).
 */
export async function runChecks({ env = process.env, orgId = null } = {}) {
  const checks = [];

  const dbStatus = await getSetupStatus(env);
  if (!dbStatus.configured) return checks;

  let sql;
  try {
    sql = getSql();
  } catch {
    return checks;
  }

  const findings = await probeColumns(sql, { orgId });
  const fixableRows = findings.reduce((n, f) => n + f.parseableRows, 0);
  const garbageRows = findings.reduce((n, f) => n + f.garbageRows, 0);

  if (fixableRows === 0 && garbageRows === 0) {
    checks.push({
      id: 'dh_timestamp_format',
      category: 'data-hygiene',
      status: 'pass',
      title: 'Timestamp Format Hygiene',
      message: 'All client-written timestamp columns are ISO-8601',
      fix: null,
    });
    return checks;
  }

  const perColumn = findings
    .map((f) => `${f.table}.${f.column} (${f.parseableRows} fixable, ${f.garbageRows} unparseable)`)
    .join('; ');
  const garbageNote =
    garbageRows > 0
      ? ` ${garbageRows} unparseable value${garbageRows === 1 ? '' : 's'} need${garbageRows === 1 ? 's' : ''} manual review and will not be auto-modified.`
      : '';

  checks.push({
    id: 'dh_timestamp_format',
    category: 'data-hygiene',
    status: fixableRows > 0 ? 'fail' : 'warn',
    title: 'Timestamp Format Hygiene',
    message: `Non-ISO timestamp values found: ${perColumn}.${garbageNote}`,
    fix:
      fixableRows > 0
        ? {
            type: 'auto',
            description: 'Normalize parseable non-ISO timestamp values to ISO-8601',
            action: 'normalize_timestamps',
          }
        : null,
  });

  return checks;
}
