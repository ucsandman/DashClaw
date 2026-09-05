#!/usr/bin/env node
// The one authoritative release gate. A green run here means CI's
// build-and-test job will be green: this script runs EVERY static check CI
// runs, with the same flags. The live/server-dependent suite (auto-migrate +
// startup smoke + policy/cross-org behavioral proofs) that CI's separate
// startup-smoke job runs is gated behind --live; without it, this prints an
// explicit line that CI still covers that layer.
//
// Invoked as `npm run release:check` (canonical) or `npm run production:check`
// (alias). Writes a machine-readable release-check-report.json (gitignored).
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LABEL = 'release:check';
const wantLive = process.argv.includes('--live');
// baseUrl for the live behavioral smokes (server must already be running there)
const baseUrlIdx = process.argv.indexOf('--base-url');
const LIVE_BASE_URL = baseUrlIdx !== -1 ? process.argv[baseUrlIdx + 1] : 'http://127.0.0.1:3000';

const npmExecPath = process.env.npm_execpath;
const npmCmd = npmExecPath ? process.execPath : 'npm';
const npmPrefix = npmExecPath ? [npmExecPath] : [];
const npxCmd = npmExecPath ? process.execPath : 'npx';
const npxPrefix = npmExecPath ? [npmExecPath, 'exec', '--'] : [];

// STATIC gates. This set = union of CI build-and-test's static steps and the
// pre-existing launch gate. Each entry mirrors ci.yml exactly (same script,
// same flags), so a green static run guarantees a green CI build-and-test.
const STATIC_STEPS = [
  ['lint', npmCmd, [...npmPrefix, 'run', 'lint']],
  ['typecheck', npmCmd, [...npmPrefix, 'run', 'typecheck']],
  ['docs', npmCmd, [...npmPrefix, 'run', 'docs:check']],
  ['openapi', npmCmd, [...npmPrefix, 'run', 'openapi:check']],
  ['api-inventory', npmCmd, [...npmPrefix, 'run', 'api:inventory:check']],
  // CI: `node scripts/check-doc-counts.mjs --strict`
  ['doc-counts', process.execPath, ['scripts/check-doc-counts.mjs', '--strict']],
  ['route-sql', npmCmd, [...npmPrefix, 'run', 'route-sql:check']],
  // CI: `npm run surface:check` (anti-regrowth brake)
  ['surface', npmCmd, [...npmPrefix, 'run', 'surface:check']],
  ['version-hardcodes', npmCmd, [...npmPrefix, 'run', 'version:check']],
  ['version-sync', npmCmd, [...npmPrefix, 'run', 'version:sync:check']],
  ['contracts', npmCmd, [...npmPrefix, 'run', 'contracts:check']],
  // CI: `npm run guide:drift:check`
  ['guide-drift', npmCmd, [...npmPrefix, 'run', 'guide:drift:check']],
  // CI: `node scripts/security-scan.js`
  ['security-scan', process.execPath, ['scripts/security-scan.js']],
  ['script-syntax', npmCmd, [...npmPrefix, 'run', 'scripts:check-syntax']],
  ['vitest', npxCmd, [...npxPrefix, 'vitest', 'run']],
  ['cli-tests', npmCmd, [...npmPrefix, 'test', '--prefix', 'cli']],
  ['mcp-tests', npmCmd, [...npmPrefix, 'test', '--prefix', 'mcp-server']],
  ['mcp-typecheck', npmCmd, [...npmPrefix, 'run', 'typecheck', '--prefix', 'mcp-server']],
  // CI: `npm run sdk:integration` + `npm run sdk:integration:python`
  ['sdk-integration', npmCmd, [...npmPrefix, 'run', 'sdk:integration']],
  ['sdk-integration-python', npmCmd, [...npmPrefix, 'run', 'sdk:integration:python']],
  ['build', npmCmd, [...npmPrefix, 'run', 'build']],
  ['smoke', npmCmd, [...npmPrefix, 'run', 'test:smoke']],
  ['prod-audit', npmCmd, [...npmPrefix, 'audit', '--omit=dev', '--audit-level=moderate']],
];

// LIVE gates mirror CI's startup-smoke job. Only appended when --live is passed.
// startup:smoke self-spawns its own next server; policy/cross-org need a server
// ALREADY RUNNING at --base-url (default http://127.0.0.1:3000, e.g. `npm run start`).
const LIVE_STEPS = [
  ['live-auto-migrate', process.execPath, ['scripts/auto-migrate.mjs']],
  ['live-startup-smoke', npmCmd, [...npmPrefix, 'run', 'startup:smoke']],
  ['live-policy-smoke', process.execPath, ['scripts/policy-smoke.mjs', LIVE_BASE_URL]],
  ['live-cross-org-smoke', process.execPath, ['scripts/cross-org-smoke.mjs', LIVE_BASE_URL]],
];

function getCommitSha() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function writeReport(gates, overall) {
  const reportPath = resolve(process.cwd(), 'release-check-report.json');
  const report = {
    generatedAt: new Date().toISOString(),
    commit: getCommitSha(),
    mode: wantLive ? 'static+live' : 'static',
    liveSuite: wantLive ? 'included' : 'skipped-covered-by-ci',
    overall,
    gates,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  return reportPath;
}

function fail(gates, message, exitCode = 1) {
  process.stderr.write(`[${LABEL}] ${message}\n`);
  const reportPath = writeReport(gates, 'fail');
  process.stdout.write(`[${LABEL}] report written: ${reportPath}\n`);
  process.exit(exitCode);
}

const gates = [];

function runStep([label, command, args]) {
  process.stdout.write(`[${LABEL}] ${label}: ${command} ${args.join(' ')}\n`);
  const start = Date.now();
  const result = spawnSync(command, args, { stdio: 'inherit' });
  const durationMs = Date.now() - start;

  if (result.error) {
    gates.push({ label, command: `${command} ${args.join(' ')}`, status: 'fail', durationMs, exitCode: null });
    fail(gates, `${label} failed to start: ${result.error.message}`);
  }
  if (result.signal) {
    gates.push({ label, command: `${command} ${args.join(' ')}`, status: 'fail', durationMs, exitCode: null });
    fail(gates, `${label} terminated by signal ${result.signal}`);
  }
  if (result.status !== 0) {
    gates.push({ label, command: `${command} ${args.join(' ')}`, status: 'fail', durationMs, exitCode: result.status });
    fail(gates, `${label} failed with exit code ${result.status}`, result.status ?? 1);
  }
  gates.push({ label, command: `${command} ${args.join(' ')}`, status: 'pass', durationMs, exitCode: 0 });
}

// Run static gates.
for (const step of STATIC_STEPS) runStep(step);

if (wantLive) {
  if (!process.env.DATABASE_URL) {
    fail(gates, '--live requires DATABASE_URL (the live suite runs migrations + behavioral smokes against a real Postgres). Set DATABASE_URL and retry.');
  }
  // policy/cross-org smokes need a server already running at LIVE_BASE_URL.
  process.stdout.write(`[${LABEL}] --live: probing ${LIVE_BASE_URL}/api/health (server must already be running for the behavioral smokes)\n`);
  let healthy = false;
  try {
    const res = await fetch(`${LIVE_BASE_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
    healthy = res.ok;
  } catch {
    healthy = false;
  }
  if (!healthy) {
    fail(gates, `--live: no healthy server at ${LIVE_BASE_URL}. Start one first (npm run start) or pass --base-url <url>. The startup-smoke gate self-spawns its own server, but policy-smoke/cross-org-smoke need a running instance.`);
  }
  for (const step of LIVE_STEPS) runStep(step);
} else {
  process.stdout.write(
    `[${LABEL}] LIVE SUITE SKIPPED (auto-migrate + startup:smoke + policy-smoke + cross-org-smoke). ` +
    `Pass --live (needs DATABASE_URL + a running server) to run it locally; CI's startup-smoke job runs it on every push.\n`,
  );
}

const reportPath = writeReport(gates, 'pass');
process.stdout.write(`[${LABEL}] all ${wantLive ? 'static + live' : 'static'} release gates passed.\n`);
process.stdout.write(`[${LABEL}] report written: ${reportPath}\n`);
