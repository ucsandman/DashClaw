#!/usr/bin/env node

/**
 * Rebuild the per-org monthly metering rollup (usage_rollups) from
 * action_records (hosted paid tier, G4).
 *
 * The rollup is normally maintained inline by createActionRecord; this script
 * seeds history from before the rollup existed and reconciles any gap left by
 * a failed inline increment. It is a full recount, grouped by org and by the
 * UTC month of created_at, and it OVERWRITES the counters with the recount
 * (the actions table is the source of truth). Idempotent; safe to re-run.
 *
 * Usage:
 *   node scripts/backfill-usage-rollups.mjs           # apply
 *   node scripts/backfill-usage-rollups.mjs --dry-run # print, change nothing
 */
import './_load-env.mjs';
import { createSqlFromEnv } from './_db.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const sql = createSqlFromEnv();

  const counts = await sql`
    SELECT
      org_id,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS period,
      COUNT(*)::int AS governed_actions,
      COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked_actions
    FROM action_records
    WHERE created_at IS NOT NULL
    GROUP BY org_id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM')
    ORDER BY org_id, period
  `;

  if (counts.length === 0) {
    console.log('[backfill-usage-rollups] No action records found. Nothing to do.');
    return;
  }

  console.log(`[backfill-usage-rollups] ${counts.length} org-month rows from action_records${dryRun ? ' (dry run)' : ''}:`);
  for (const row of counts) {
    console.log(`  ${row.org_id}  ${row.period}  governed=${row.governed_actions}  blocked=${row.blocked_actions}`);
  }
  if (dryRun) return;

  let written = 0;
  for (const row of counts) {
    // Recount wins: the rollup must match what action_records actually holds.
    // Skips orgs that no longer exist (FK) — their actions are orphans.
    try {
      await sql`
        INSERT INTO usage_rollups (org_id, period, governed_actions, blocked_actions, updated_at)
        VALUES (${row.org_id}, ${row.period}, ${row.governed_actions}, ${row.blocked_actions}, now())
        ON CONFLICT (org_id, period) DO UPDATE SET
          governed_actions = EXCLUDED.governed_actions,
          blocked_actions = EXCLUDED.blocked_actions,
          updated_at = now()
      `;
      written += 1;
    } catch (err) {
      if (String(err?.code) === '23503') {
        console.warn(`  skipped ${row.org_id} ${row.period}: org no longer exists`);
      } else {
        throw err;
      }
    }
  }
  console.log(`[backfill-usage-rollups] Wrote ${written}/${counts.length} rollup rows.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[backfill-usage-rollups] Failed:', err);
  process.exit(1);
});
