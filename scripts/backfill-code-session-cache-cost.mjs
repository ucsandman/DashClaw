#!/usr/bin/env node
/**
 * Operator-run re-pricing script for historical code_sessions rows.
 *
 * Recomputes `cost_usd` for every code_sessions row using the new 5-arg
 * estimateCost with cache extras. Useful when the cache pricing for a
 * model changes (e.g. opus-4-7 gets official rates), or when the org
 * adopts custom pricing and wants past sessions re-stated.
 *
 * Opt-in only. Logs every change. Never modifies action_records.
 *
 * Usage:
 *   node scripts/backfill-code-session-cache-cost.mjs           # dry run
 *   node scripts/backfill-code-session-cache-cost.mjs --apply
 */

// CLAUDE.md: every entry point must surface async rejections.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  process.exit(1);
});

import './_load-env.mjs';
import { createSqlFromEnv } from './_db.mjs';
// billing/settings migrated .js → .ts; Node 23.6+ type stripping resolves .ts.
import { estimateCost } from '../app/lib/billing.ts';
import { getModelPricing } from '../app/lib/repositories/settings.repository.ts';

const APPLY = process.argv.includes('--apply');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (add to .env.local or export it).');
  console.error('This script needs a real database connection to recompute historical');
  console.error('cost_usd values; the mock driver returns zero rows.');
  process.exit(1);
}

async function main() {
  const sql = createSqlFromEnv();
  const rows = await sql`
    SELECT id, org_id, model_primary, input_tokens, output_tokens,
           cache_read_tokens, cache_creation_tokens, cost_usd
    FROM code_sessions
  `;
  console.log(`Scanning ${rows.length} sessions...`);
  let changed = 0;
  const orgPricingCache = new Map();
  for (const r of rows) {
    let custom = orgPricingCache.get(r.org_id);
    if (custom === undefined) {
      try { custom = await getModelPricing(sql, r.org_id); }
      catch { custom = null; }
      orgPricingCache.set(r.org_id, custom);
    }
    const newCost = estimateCost(
      r.input_tokens || 0,
      r.output_tokens || 0,
      r.model_primary,
      custom,
      {
        cache_creation_tokens: r.cache_creation_tokens || 0,
        cache_read_tokens: r.cache_read_tokens || 0,
      },
    );
    const stored = Number(r.cost_usd) || 0;
    if (Math.abs(newCost - stored) < 1e-6) continue;
    console.log(`  ${r.id} ${r.model_primary || '?'} : $${stored.toFixed(4)} -> $${newCost.toFixed(4)}`);
    if (APPLY) {
      await sql`UPDATE code_sessions SET cost_usd = ${newCost} WHERE id = ${r.id}`;
    }
    changed++;
  }
  console.log(`\nDone. ${APPLY ? 'Updated' : 'Would update'} ${changed} session(s).`);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
