#!/usr/bin/env node

/**
 * Diagnose guard-deadline degradations (owner roadmap v2.1; spec
 * docs/plans/2026-07-02-guard-deadline-noise.md).
 *
 * Three views over guard_decisions:
 *
 *   1. Per-day degradation rate — how often the 3500ms evaluation deadline
 *      fired (column `degraded`, plus the reason-ILIKE fallback for rows
 *      persisted before drizzle/0037).
 *   2. Per-phase timing percentiles (p50/p95/max) from context._timings —
 *      which sub-evaluation eats the budget, steady-state vs degraded.
 *      Only rows written after the v2.1 instrumentation carry _timings.
 *   3. Cold-start heuristic — minutes since the org's previous decision for
 *      each degraded row. Long gaps point at serverless/Neon cold start,
 *      short gaps at genuinely slow phases.
 *
 * Auto-discovers orgs; `--org <org_id>` targets one, `--days N` sets the
 * lookback (default 7).
 *
 * Usage:
 *   node scripts/diagnose-guard-deadline.mjs [--org org_xxx] [--days 7]
 */

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

import './_load-env.mjs';
import { createSqlFromEnv } from './_db.mjs';

function getArg(name) {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const targetOrg = getArg('org');
const days = Number(getArg('days')) || 7;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (add to .env.local or export it)');
  process.exit(1);
}

const sql = createSqlFromEnv();

const IS_DEGRADED = `(gd.degraded OR COALESCE(gd.reason, '') ILIKE '%exceeded deadline%')`;

const orgs = targetOrg
  ? [{ org_id: targetOrg }]
  : await sql`SELECT DISTINCT org_id FROM guard_decisions WHERE created_at::timestamptz > NOW() - make_interval(days => ${days}) ORDER BY org_id`;

if (orgs.length === 0) {
  console.log(`No guard decisions in the last ${days} day(s).`);
  process.exit(0);
}

function pctl(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

for (const { org_id } of orgs) {
  console.log(`\n=== ${org_id} — last ${days} day(s) ===`);

  // 1. Per-day degradation rate
  const byDay = await sql.query(
    `SELECT gd.created_at::timestamptz::date::text AS day,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE ${IS_DEGRADED})::int AS degraded
     FROM guard_decisions gd
     WHERE gd.org_id = $1 AND gd.created_at::timestamptz > NOW() - make_interval(days => $2::int)
     GROUP BY 1 ORDER BY 1 DESC`,
    [org_id, days],
  );
  console.log('\nday          total  degraded  rate');
  for (const r of byDay) {
    const rate = r.total > 0 ? ((r.degraded / r.total) * 100).toFixed(1) + '%' : '-';
    console.log(`${r.day}  ${String(r.total).padStart(5)}  ${String(r.degraded).padStart(8)}  ${rate.padStart(5)}`);
  }

  // 2. Per-phase timing percentiles from context._timings (post-v2.1 rows).
  // context is TEXT — pull candidate rows and lift the JSON in JS (the
  // established pattern for _risk_breakdown; never `->` on this column).
  const timingRows = await sql.query(
    `SELECT gd.context, ${IS_DEGRADED} AS is_degraded
     FROM guard_decisions gd
     WHERE gd.org_id = $1
       AND gd.created_at::timestamptz > NOW() - make_interval(days => $2::int)
       AND gd.context LIKE '%"_timings"%'`,
    [org_id, days],
  );
  const phases = new Map(); // phase -> { normal: [], degraded: [] }
  for (const row of timingRows) {
    let timings;
    try {
      timings = JSON.parse(row.context)?._timings;
    } catch {
      continue;
    }
    if (!timings || typeof timings !== 'object') continue;
    for (const [phase, ms] of Object.entries(timings)) {
      if (typeof ms !== 'number') continue;
      if (!phases.has(phase)) phases.set(phase, { normal: [], degraded: [] });
      phases.get(phase)[row.is_degraded ? 'degraded' : 'normal'].push(ms);
    }
  }
  if (phases.size === 0) {
    console.log('\nNo _timings rows yet (instrumentation ships with v2.1 — rerun once new traffic lands).');
  } else {
    console.log(`\nphase timings (ms) over ${timingRows.length} instrumented rows — normal | degraded`);
    console.log('phase            n     p50    p95    max   | n    p50    p95    max');
    for (const [phase, buckets] of [...phases.entries()].sort()) {
      const n = buckets.normal.sort((a, b) => a - b);
      const d = buckets.degraded.sort((a, b) => a - b);
      const fmt = (v) => (v == null ? '-' : String(Math.round(v))).padStart(6);
      console.log(
        `${phase.padEnd(15)} ${String(n.length).padStart(4)} ${fmt(pctl(n, 0.5))} ${fmt(pctl(n, 0.95))} ${fmt(n[n.length - 1])}  | ${String(d.length).padStart(3)} ${fmt(pctl(d, 0.5))} ${fmt(pctl(d, 0.95))} ${fmt(d[d.length - 1])}`,
      );
    }
  }

  // 3. Cold-start heuristic: gap since the org's previous decision.
  const gaps = await sql.query(
    `SELECT sub.gap_minutes
     FROM (
       SELECT ${IS_DEGRADED} AS is_degraded,
              EXTRACT(EPOCH FROM (gd.created_at::timestamptz
                - LAG(gd.created_at::timestamptz) OVER (ORDER BY gd.created_at::timestamptz))) / 60 AS gap_minutes
       FROM guard_decisions gd
       WHERE gd.org_id = $1 AND gd.created_at::timestamptz > NOW() - make_interval(days => $2::int)
     ) sub
     WHERE sub.is_degraded AND sub.gap_minutes IS NOT NULL
     ORDER BY sub.gap_minutes`,
    [org_id, days],
  );
  if (gaps.length > 0) {
    const mins = gaps.map((g) => Number(g.gap_minutes));
    const cold = mins.filter((m) => m >= 10).length;
    console.log(
      `\ncold-start heuristic: ${gaps.length} degraded rows — gap since previous decision p50 ${pctl(mins, 0.5).toFixed(1)}m, max ${mins[mins.length - 1].toFixed(0)}m; ${cold} (${Math.round((cold / gaps.length) * 100)}%) after a ≥10m quiet gap`,
    );
  } else {
    console.log('\nNo degraded rows in the window — nothing to attribute.');
  }
}

process.exit(0);
