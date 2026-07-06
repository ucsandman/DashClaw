#!/usr/bin/env node
// Fresh-machine entry-path drill (roadmap v8.3) — Linux container twin.
//
// Proves the DISTRIBUTION path (`npx dashclaw up` resolving the published npm
// CLI + GitHub release tarball) inside a disposable, factory-fresh Linux
// container. This is a MAINTAINER instrument — no product UI, not run in CI
// (the CI up-smoke workflow runs from-source on dev-imaged runners; this is
// the distribution-path counterpart, run on demand from the maintainer host).
//
// Usage:
//   node scripts/drills/fresh-linux.mjs [--cli <spec>] [--image <image>] [--timeout-min <n>]
//
//   --cli          npm package spec for the CLI, e.g. @dashclaw/cli@latest (default)
//                   or @dashclaw/cli@0.7.2 to seed a known-broken version.
//   --image        Docker base image (default node:20-bookworm).
//   --timeout-min  minutes to wait for the platform to become healthy (default 20).
//
// Exits 0 on DRILL_VERDICT PASS, 1 on FAIL, 2 if Docker isn't available.

import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';

function parseArgs(argv) {
  const args = { cli: '@dashclaw/cli@latest', image: 'node:20-bookworm', timeoutMin: 20, asRoot: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--cli') args.cli = argv[++i];
    else if (a.startsWith('--cli=')) args.cli = a.slice('--cli='.length);
    else if (a === '--image') args.image = argv[++i];
    else if (a.startsWith('--image=')) args.image = a.slice('--image='.length);
    else if (a === '--timeout-min') args.timeoutMin = Number(argv[++i]);
    else if (a.startsWith('--timeout-min=')) args.timeoutMin = Number(a.slice('--timeout-min='.length));
    else if (a === '--as-root') args.asRoot = true;
  }
  return args;
}

// Runs inside the container via `bash -lc <SCRIPT> drill <cliSpec> <timeoutSecs>`.
// $1 = cliSpec, $2 = timeoutSecs (positional args after the script string).
// Uses `node -e` instead of curl so it works on any node:* base image without
// extra package installs. Avoids bash `${...}` brace expansion so this string
// can live in a JS template literal without JS trying to interpolate it.
const CONTAINER_SCRIPT = `
set -u
CLI_SPEC="$1"
TIMEOUT_SECS="$2"
echo "DRILL_STEP config PASS cliSpec=$CLI_SPEC image=$(uname -a)"

npm exec --yes --package="$CLI_SPEC" -- dashclaw up --yes --db embedded --no-browser > /tmp/up.log 2>&1 &
UP_PID=$!
echo "DRILL_STEP up_launch PASS launched pid=$UP_PID"

HEALTHY=0
DEADLINE=$(( $(date +%s) + TIMEOUT_SECS ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if node -e "require('http').get('http://localhost:3000/api/health', (r) => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"; then
    HEALTHY=1
    break
  fi
  if ! kill -0 "$UP_PID" 2>/dev/null; then
    echo "DRILL_STEP health_poll FAIL the up process exited before the platform became healthy"
    echo '--- up.log tail ---'
    tail -50 /tmp/up.log || true
    echo "DRILL_VERDICT FAIL"
    exit 1
  fi
  sleep 5
done

if [ "$HEALTHY" -ne 1 ]; then
  echo "DRILL_STEP health_poll FAIL never became healthy within $TIMEOUT_SECS seconds"
  echo '--- up.log tail ---'
  tail -50 /tmp/up.log || true
  echo "DRILL_VERDICT FAIL"
  exit 1
fi
echo "DRILL_STEP health_poll PASS GET /api/health returned 200"

API_KEY=$(node -e "try { console.log(JSON.parse(require('fs').readFileSync(require('os').homedir() + '/.dashclaw/instance.json', 'utf8')).apiKey || '') } catch (e) { console.log('') }")
if [ -z "$API_KEY" ]; then
  echo "DRILL_STEP read_instance_key FAIL could not read apiKey from ~/.dashclaw/instance.json"
  tail -50 /tmp/up.log || true
  echo "DRILL_VERDICT FAIL"
  exit 1
fi
echo "DRILL_STEP read_instance_key PASS read apiKey from instance.json"

HTTP_CODE=$(API_KEY="$API_KEY" node -e "
const http = require('http');
const data = JSON.stringify({agent_id:'smoke-drill-fresh',action_type:'smoke.drill',declared_goal:'v8.3 fresh-machine drill: first governed action'});
const req = http.request('http://localhost:3000/api/actions', { method: 'POST', headers: { 'x-api-key': process.env.API_KEY, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
  let body = '';
  res.on('data', (c) => { body += c; });
  res.on('end', () => { process.stderr.write(body); console.log(res.statusCode); });
});
req.on('error', (e) => { process.stderr.write(e.message); console.log('0'); });
req.write(data);
req.end();
")

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
  echo "DRILL_STEP post_action PASS POST /api/actions returned $HTTP_CODE"
  echo "DRILL_VERDICT PASS"
  exit 0
else
  echo "DRILL_STEP post_action FAIL POST /api/actions returned $HTTP_CODE"
  tail -50 /tmp/up.log || true
  echo "DRILL_VERDICT FAIL"
  exit 1
fi
`;

async function main() {
  const args = parseArgs(process.argv);

  const dockerCheck = spawnSync('docker', ['version'], { stdio: 'ignore' });
  if (dockerCheck.error || dockerCheck.status !== 0) {
    console.error('FAIL: Docker is not available (docker version failed).');
    console.error('Install Docker Desktop (Windows/Mac) or the docker engine (Linux), then re-run this drill.');
    process.exitCode = 2;
    return;
  }

  const timeoutSecs = String(Math.round(args.timeoutMin * 60));
  console.log(`[drill] image: ${args.image}`);
  console.log(`[drill] cli spec: ${args.cli}`);
  console.log(`[drill] timeout: ${args.timeoutMin}m`);
  console.log('[drill] running container...');

  // Default persona = the documented QUICK-START stranger: a normal user
  // account with Node 20 (the node:* images ship user `node`). --as-root
  // models a fresh root VPS instead — the class the first-ever run of this
  // drill caught live: embedded Postgres refuses root, and CLI <=0.7.4
  // didn't set embedded-postgres's createPostgresUser escape hatch
  // (fixed in 0.7.5).
  const userArgs = args.asRoot ? [] : ['--user', 'node', '-e', 'HOME=/home/node', '-w', '/home/node'];
  const dockerArgs = ['run', '--rm', ...userArgs, args.image, 'bash', '-lc', CONTAINER_SCRIPT, 'drill', args.cli, timeoutSecs];
  const child = spawn('docker', dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  const steps = [];
  let verdict = null;

  const rlOut = readline.createInterface({ input: child.stdout });
  rlOut.on('line', (line) => {
    console.log(line);
    const stepMatch = line.match(/^DRILL_STEP (\S+) (PASS|FAIL) ?(.*)$/);
    if (stepMatch) {
      steps.push({ id: stepMatch[1], status: stepMatch[2], detail: stepMatch[3] });
    }
    const verdictMatch = line.match(/^DRILL_VERDICT (PASS|FAIL)$/);
    if (verdictMatch) verdict = verdictMatch[1];
  });

  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  const exitCode = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? 1));
  });

  console.log('');
  console.log('=== Fresh-Linux Drill Result ===');
  for (const step of steps) {
    console.log(`  [${step.status}] ${step.id} — ${step.detail}`);
  }
  console.log(`verdict: ${verdict || (exitCode === 0 ? 'PASS' : 'FAIL')}`);
  console.log(`container exit code: ${exitCode}`);

  process.exitCode = exitCode === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(`FAIL: ${err.stack || err.message}`);
  process.exitCode = 1;
});
