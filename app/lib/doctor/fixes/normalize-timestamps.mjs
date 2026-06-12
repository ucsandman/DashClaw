// app/lib/doctor/fixes/normalize-timestamps.mjs
// Remote-scope fix: rewrite parseable non-ISO TEXT timestamp values to ISO-8601.
// Unparseable (garbage) values are reported, never mutated. Idempotent by
// construction — normalized values match the ISO prefix regex and are never
// re-selected on a second run.
import { getSql } from '../../db';
import { orgPredicate, probeColumns } from '../checks/data-hygiene.mjs';

/**
 * @param {{ orgId?: string|null }} [params] - orgId scopes every UPDATE to one
 *   tenant. The API fix route ALWAYS supplies it (hosted deployments share one
 *   DB); only the operator-local script may run unscoped.
 */
export async function apply(params = {}) {
  const orgId = params.orgId || null;
  let sql;
  try {
    sql = getSql();
  } catch (err) {
    return { applied: false, description: `Database not available: ${err.message}` };
  }

  let findings;
  try {
    findings = await probeColumns(sql, { orgId });
  } catch (err) {
    return { applied: false, description: `Timestamp probe failed: ${err.message}` };
  }

  const changed = [];
  const garbage = [];
  let totalChanged = 0;

  for (const finding of findings) {
    const { table, column, entry, parseableValues, garbageRows } = finding;
    if (garbageRows > 0) garbage.push({ table, column, rows: garbageRows });

    const scope = orgId ? orgPredicate(entry, '$3') : '';
    let rowsChanged = 0;
    for (const value of parseableValues) {
      const iso = new Date(value).toISOString();
      try {
        const rows = await sql.query(
          `UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2${scope} RETURNING 1`,
          orgId ? [iso, value, orgId] : [iso, value],
        );
        rowsChanged += rows?.length ?? 0;
      } catch (err) {
        return {
          applied: false,
          description: `Normalization failed on ${table}.${column}: ${err.message}`,
          details: { changed, garbage },
        };
      }
    }
    if (rowsChanged > 0) {
      changed.push({ table, column, rowsChanged });
      totalChanged += rowsChanged;
    }
  }

  const garbageNote =
    garbage.length > 0
      ? ` ${garbage.reduce((n, g) => n + g.rows, 0)} unparseable value(s) left for manual review.`
      : '';

  if (totalChanged === 0) {
    return {
      applied: false,
      description: `Nothing to normalize (0 rows changed).${garbageNote}`,
      details: { changed, garbage },
    };
  }

  return {
    applied: true,
    description: `Normalized ${totalChanged} timestamp value(s) across ${changed.length} column(s) to ISO-8601.${garbageNote}`,
    details: { changed, garbage },
  };
}
