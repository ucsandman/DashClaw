#!/usr/bin/env node
// Mine the guard-decision ledger + behavior samples for calibration-vector
// candidates (owner roadmap item 3). READ-ONLY: issues only SELECTs, never
// writes to the DB or the fixture. Run via: npm run calibration:mine
// Spec: docs/superpowers/specs/2026-07-02-calibration-corpus-v2-mining.md
//
// Usage:
//   npm run calibration:mine                       # last 60 days, stdout summary
//   npm run calibration:mine -- --days 90 --out report.json
//   npm run calibration:mine -- --min-approvals 5
//   npm run calibration:mine -- --propose --out p.json --summary s.md   # v2.6 proposal artifact
//   npm run calibration:mine -- --propose --top 0                       # lift the top-15-per-rule cap
//   npm run calibration:mine -- --include-synthetic                     # disable the synthetic filter
//
// Synthetic platform traffic (policy-smoke, up-smoke, sdk-live, demo/dev
// suites) is excluded by default — see isSyntheticEvent. v2.6 spec:
// docs/superpowers/specs/2026-07-02-calibration-flywheel-automation.md

import './_load-env.mjs';
import fs from 'node:fs';
import { createSqlFromEnv } from './_db.mjs';
import {
  mineOverScoredBenign,
  mineUnderScoredDanger,
  mineRepeatedApprovals,
  isSyntheticEvent,
  buildProposals,
  renderProposalSummary,
  decisionRowToEvent as decisionToEvent,
  sampleRowToEvent as sampleToEvent,
} from './lib/calibration-mining.mjs';

const DECISION_LIMIT = 50000;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

async function loadDecisionEvents(sql, days) {
  // Extract only the needed context fields server-side: shipping whole
  // context blobs for 50k rows exceeds the Neon HTTP driver's 64MB response
  // cap (observed live, HTTP 507). Guard writes context via JSON.stringify
  // (buildGuardDecisionRow), so the LIKE '{%' validity guard is cheap.
  // ::json (not ::jsonb) + stripping literal \u0000 escapes: some contexts
  // embed file contents containing "\u0000", which jsonb rejects (22P05).
  // pg_input_is_valid gates the cast: a malformed row degrades to ctx NULL
  // instead of failing the whole run (2026-09-08: the same poison row 500'd
  // /api/calibration/proposals).
  const rows = await sql.query(
    `WITH src AS (
       SELECT gd.*,
              -- pg_input_is_valid (PG16+, the CI/self-host baseline): one
              -- malformed context row used to fail the whole query with
              -- 22P02. Poison rows now degrade to ctx NULL instead.
              CASE WHEN gd.context LIKE '{%'
                        AND pg_input_is_valid(replace(gd.context, chr(92) || 'u0000', ''), 'json')
                   THEN replace(gd.context, chr(92) || 'u0000', '')::json
              END AS ctx
       FROM guard_decisions gd
       -- ::timestamptz: created_at is TEXT on fresh drizzle schemas; the
       -- uncast comparison is 42883 on self-host Postgres (CI caught this
       -- via the org-scoped port in calibration.repository.ts).
       WHERE gd.created_at::timestamptz > NOW() - make_interval(days => $1::int)
     )
     SELECT gd.id, gd.decision, gd.risk_score, gd.action_type, gd.agent_id,
            gd.ctx -> '_risk_breakdown' AS risk_breakdown,
            gd.ctx ->> 'declared_goal' AS context_goal,
            gd.ctx #>> '{intel,bash,intent}' AS bash_intent,
            ar.action_id, ar.declared_goal, ar.outcome_status,
            (ar.approved_by IS NOT NULL) AS approved,
            (ar.approved_by IS NULL AND ar.reasoning LIKE '%[HITL Decision: DENY%') AS denied
     FROM src gd
     LEFT JOIN action_records ar
       ON ar.guard_decision_id = gd.id AND ar.org_id = gd.org_id
     ORDER BY gd.created_at::timestamptz DESC
     LIMIT $2`,
    [days, DECISION_LIMIT],
  );
  return { events: rows.map(decisionToEvent), truncated: rows.length === DECISION_LIMIT };
}

async function loadUploadedSampleEvents(sql, days) {
  const rows = await sql.query(
    `SELECT event_id, agent_id, risk_score, guard_decision, outcome_status, bash_intent,
            action_type, command_shape
     FROM behavior_samples
     WHERE ts::timestamptz > NOW() - make_interval(days => $1::int)`,
    [days],
  );
  return rows.map(sampleToEvent);
}

async function main() {
  const days = parseInt(arg('days', '60'), 10);
  const minApprovals = parseInt(arg('min-approvals', '3'), 10);
  const outPath = arg('out');

  const sql = createSqlFromEnv();

  const { events: decisionEvents, truncated } = await loadDecisionEvents(sql, days);
  // The guard-decision ledger is the calibration flywheel's constitutional
  // input. The retired behavior_samples table is a secondary fallback source
  // (the local-JSONL behavior recorder was removed in the v5 cull); it is
  // read-only and returns nothing on installs past the cull.
  const sampleEvents = await loadUploadedSampleEvents(sql, days);

  const allEvents = decisionEvents.concat(sampleEvents);
  // Synthetic platform traffic is excluded by default (v2.6) — it is designed
  // to trip policies, so mining it calibrates the scorer against a fiction.
  const includeSynthetic = hasFlag('include-synthetic');
  const events = includeSynthetic ? allEvents : allEvents.filter((e) => !isSyntheticEvent(e));
  const syntheticExcluded = allEvents.length - events.length;

  const candidates = {
    over_scored_benign: mineOverScoredBenign(events),
    under_scored_danger: mineUnderScoredDanger(events),
    repeated_approvals: mineRepeatedApprovals(events, { minCount: minApprovals }),
  };

  const report = {
    generated_by: 'scripts/mine-calibration-candidates.mjs',
    generated_at: new Date().toISOString(),
    window_days: days,
    inputs: {
      decisions: decisionEvents.length,
      decisions_truncated_at_limit: truncated,
      // The local-JSONL recorder was removed in the v5 cull; report 0 rather
      // than dropping the key so the artifact shape stays stable.
      local_samples: 0,
      local_samples_at_cap: false,
      uploaded_samples: sampleEvents.length,
      synthetic_excluded: includeSynthetic ? 0 : syntheticExcluded,
      synthetic_filter: !includeSynthetic,
    },
    candidates,
  };

  if (hasFlag('propose') || arg('summary')) {
    // Top-N strongest per rule keeps the weekly batch reviewable; --top 0 lifts the cap.
    report.proposals = buildProposals(candidates, {
      windowDays: days,
      generatedAt: report.generated_at,
      topPerRule: parseInt(arg('top', '15'), 10),
    });
  }

  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  }
  const summaryPath = arg('summary');
  if (summaryPath) {
    fs.writeFileSync(summaryPath, renderProposalSummary(report));
  }

  const { inputs } = report;
  console.log(`Mined ${inputs.decisions} decisions, ${inputs.local_samples} local samples, ${inputs.uploaded_samples} uploaded samples (last ${days}d).`);
  if (inputs.synthetic_filter) {
    console.log(`Excluded ${inputs.synthetic_excluded} synthetic platform-traffic event(s) (smoke/self-test); --include-synthetic to keep them.`);
  } else {
    console.log('Synthetic filter DISABLED (--include-synthetic).');
  }
  if (inputs.decisions_truncated_at_limit) console.log(`NOTE: decision query hit the ${DECISION_LIMIT}-row limit — narrow --days for full coverage.`);
  if (inputs.local_samples_at_cap) console.log('NOTE: local samples hit the 20000-row store cap — older samples not scanned.');
  console.log('');

  for (const [rule, list] of Object.entries(candidates)) {
    console.log(`${rule}: ${list.length} candidate shape(s)`);
    for (const c of list.slice(0, 15)) {
      const rep = c.representative;
      const what = rep.command_shape || rep.declared_goal || rep.action_type || '(no shape)';
      console.log(`  ${c.id}  count=${c.count}  risk=${c.risk_min}${c.risk_max !== c.risk_min ? `-${c.risk_max}` : ''}  [${c.evidence_tier}]  ${String(what).slice(0, 90)}`);
    }
    if (list.length > 15) console.log(`  ... ${list.length - 15} more (use --out for the full report)`);
  }
  if (report.proposals) console.log(`\nProposals: ${report.proposals.length} (${report.proposals.filter((p) => p.ratify_command).length} with a ready ratify command)`);
  if (outPath) console.log(`Full report: ${outPath}`);
  if (summaryPath) console.log(`Markdown summary: ${summaryPath}`);

  if (typeof sql.end === 'function') await sql.end();
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
