#!/usr/bin/env node
// Calibration-vector forge (owner roadmap item 3): turn an action_id or a raw
// command into a golden-vector fixture entry with provenance, running BOTH
// scorers (client classify_bash via Python, server computeRiskScore via tsx)
// to suggest bounds. Run via: npm run calibration:add
// Spec: docs/superpowers/specs/2026-07-02-calibration-corpus-v2-mining.md
//
// Usage:
//   npm run calibration:add -- --command "git show --stat HEAD" --label benign \
//     --name git-show-stat --source "mined 2026-07-02: R1 candidate cv_..."
//   npm run calibration:add -- --action ar_abc123 --label benign --name ... --source "..."
//   Add --write to append to the fixture (default: print only).

import './_load-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { computeRiskScore } from '../app/lib/guard.js';
import {
  suggestBounds,
  buildVectorEntry,
  appendVectorToFixtureText,
} from './lib/calibration-mining.mjs';

const FIXTURE_PATH = path.join(process.cwd(), '__tests__', 'fixtures', 'risk-calibration-golden-vectors.json');

// Mirrors hooks/dashclaw_pretool.py _INTENT_TO_ACTION (:134). The hook's
// bounded-single-file-rm → "cleanup" special case (:324) is NOT mirrored —
// hand-edit action_type if forging that shape.
const INTENT_TO_ACTION = {
  readonly: 'review',
  write: 'apply',
  destructive: 'security',
  network: 'api',
  process_management: 'security',
  package_management: 'build',
  system_admin: 'deploy',
  interpreter: 'build',
  unknown: 'other',
};

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

// Interpreter discovery mirrors scripts/run-python-unittest.mjs.
function pythonCandidates() {
  const out = [];
  if (process.env.PYTHON && process.env.PYTHON.trim()) out.push({ cmd: process.env.PYTHON.trim(), args: [] });
  if (process.platform === 'win32') {
    const miniconda = 'C:\\ProgramData\\miniconda3\\python.exe';
    if (fs.existsSync(miniconda)) out.push({ cmd: miniconda, args: [] });
    out.push({ cmd: 'py', args: ['-3'] });
    out.push({ cmd: 'python', args: [] });
  } else {
    out.push({ cmd: 'python3', args: [] });
    out.push({ cmd: 'python', args: [] });
  }
  return out;
}

const CLASSIFY_SNIPPET = [
  'import json, sys',
  'from dashclaw_agent_intel.bash_classifier import classify_bash',
  'r = classify_bash(sys.argv[1])',
  'print(json.dumps({"intent": r["intent"], "risk_score": r["risk_score"], "reversible": r["reversible"]}))',
].join('\n');

function runClientScorer(command) {
  const env = { ...process.env, PYTHONPATH: path.join(process.cwd(), 'hooks') };
  for (const candidate of pythonCandidates()) {
    const result = spawnSync(candidate.cmd, [...candidate.args, '-c', CLASSIFY_SNIPPET, command], {
      encoding: 'utf8',
      shell: false,
      env,
    });
    if (typeof result.status !== 'number' || result.status !== 0) continue;
    const line = String(result.stdout || '').trim().split('\n').pop();
    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }
  throw new Error('No Python interpreter could run classify_bash. Set PYTHON to a valid interpreter path.');
}

function safeJsonParse(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function loadActionContext(actionId) {
  const { createSqlFromEnv } = await import('./_db.mjs');
  const sql = createSqlFromEnv();
  const rows = await sql.query(
    `SELECT ar.action_id, ar.action_type, ar.declared_goal, ar.reversible,
            ar.systems_touched, gd.id AS decision_id,
            gd.risk_score AS decision_risk, gd.context
     FROM action_records ar
     LEFT JOIN guard_decisions gd
       ON gd.id = ar.guard_decision_id AND gd.org_id = ar.org_id
     WHERE ar.action_id = $1
     LIMIT 1`,
    [actionId],
  );
  if (typeof sql.end === 'function') await sql.end();
  if (!rows.length) throw new Error(`action not found: ${actionId}`);
  return rows[0];
}

async function main() {
  const label = arg('label');
  const name = arg('name');
  const source = arg('source');
  const rawCommand = arg('command');
  const actionId = arg('action');

  if (!label || !name || !source || (!rawCommand && !actionId)) {
    console.error('Required: --label benign|risky --name <kebab-case> --source "<provenance>" and one of --command "<shell>" | --action <action_id>');
    process.exit(1);
  }

  let bashCommand = rawCommand;
  let serverContext;
  let ledger = null;

  if (actionId) {
    const row = await loadActionContext(actionId);
    const context = safeJsonParse(row.context) || {};
    serverContext = {
      action_type: row.action_type,
      declared_goal: row.declared_goal,
      reversible: row.reversible !== 0,
      ...(row.systems_touched ? { systems_touched: safeJsonParse(row.systems_touched) || undefined } : {}),
    };
    ledger = {
      decision_id: row.decision_id,
      persisted_risk: row.decision_risk,
      risk_breakdown: context._risk_breakdown || null,
    };
    // A "Bash: <cmd>" goal lets the client layer be pinned too.
    if (!bashCommand && typeof row.declared_goal === 'string' && row.declared_goal.startsWith('Bash: ')) {
      bashCommand = row.declared_goal.slice('Bash: '.length);
    }
  }

  let client = null;
  if (bashCommand) {
    client = runClientScorer(bashCommand);
    if (!serverContext) {
      // Build the server context the way the pretool hook would declare it
      // (hooks/dashclaw_pretool.py _enrich_bash).
      serverContext = {
        action_type: INTENT_TO_ACTION[client.intent] || 'other',
        declared_goal: 'Bash: ' + bashCommand.slice(0, 120),
        reversible: Boolean(client.reversible),
        systems_touched: ['execution'],
      };
    }
  }

  const serverScore = computeRiskScore(serverContext);
  const bounds = suggestBounds(label, {
    clientScore: client ? client.risk_score : null,
    serverScore,
  });

  const entry = buildVectorEntry({
    name,
    label,
    source,
    bash_command: bashCommand || null,
    client_expected: client
      ? label === 'benign'
        ? { intent: client.intent, ...bounds.client_expected }
        : bounds.client_expected
      : null,
    server_context: serverContext,
    server_expected: bounds.server_expected,
  });

  console.log('Observed scores:');
  if (client) console.log(`  client classify_bash: intent=${client.intent} risk=${client.risk_score} reversible=${client.reversible}`);
  console.log(`  server computeRiskScore: ${serverScore}`);
  if (ledger) {
    console.log(`  ledger: decision=${ledger.decision_id} persisted_risk=${ledger.persisted_risk}`);
    if (ledger.risk_breakdown) console.log(`  risk_breakdown: ${JSON.stringify(ledger.risk_breakdown)}`);
  }
  console.log('\nVector entry:\n');
  console.log(JSON.stringify(entry, null, 2));

  if (bounds.requires_model_fix) {
    console.log('\nREQUIRES MODEL FIX: the observed score contradicts the label — the suggested');
    console.log('bound is the band edge, so appending this vector makes the golden suite RED');
    console.log('until the scorer is fixed. Ship the fix and the vector in the same commit.');
  }

  if (hasFlag('write')) {
    const fixtureText = fs.readFileSync(FIXTURE_PATH, 'utf8');
    fs.writeFileSync(FIXTURE_PATH, appendVectorToFixtureText(fixtureText, entry));
    console.log(`\nAppended to ${path.relative(process.cwd(), FIXTURE_PATH)}. Run both golden runners before committing.`);
  } else {
    console.log('\nDry run (no --write): fixture not modified.');
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
