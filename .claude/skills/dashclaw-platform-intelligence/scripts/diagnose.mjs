#!/usr/bin/env node

/**
 * DashClaw Diagnostic Tool
 *
 * Collects diagnostic info when something is broken. Traces the full
 * request lifecycle and identifies the failure point.
 *
 * Usage:
 *   node .claude/skills/dashclaw-platform-intelligence/scripts/diagnose.mjs \
 *     --base-url http://localhost:3000 \
 *     --api-key oc_live_... \
 *     [--error "403 Forbidden"] \
 *     [--endpoint "/api/actions"]
 *
 * Flags:
 *   --base-url    DashClaw server URL (default: http://localhost:3000)
 *   --api-key     API key (default: DASHCLAW_API_KEY env var)
 *   --error       Error message or status code to diagnose
 *   --endpoint    Specific endpoint that is failing
 *   --json        Output as JSON
 */

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const args = process.argv.slice(2);
function getFlag(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return args[idx + 1] || fallback;
}
const hasFlag = (name) => args.includes(`--${name}`);

const BASE_URL = (getFlag('base-url', process.env.DASHCLAW_BASE_URL || 'http://localhost:3000')).replace(/\/$/, '');
const API_KEY = getFlag('api-key', process.env.DASHCLAW_API_KEY || '');
const ERROR_HINT = getFlag('error', '');
const ENDPOINT = getFlag('endpoint', '');
const JSON_OUTPUT = hasFlag('json');

const report = {
  timestamp: new Date().toISOString(),
  server: BASE_URL,
  apiKeyPresent: !!API_KEY,
  apiKeyPrefix: API_KEY ? API_KEY.slice(0, 12) + '...' : null,
  checks: {},
  diagnosis: [],
  suggestions: [],
};

function log(msg) {
  if (!JSON_OUTPUT) console.log(msg);
}

async function probe(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['x-api-key'] = API_KEY;

  const start = Date.now();
  try {
    const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
    const elapsed = Date.now() - start;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    return {
      status: res.status, ok: res.ok, elapsed, json,
      error: json?.error || null,
      headers: Object.fromEntries(res.headers.entries()),
    };
  } catch (err) {
    return {
      status: 0, ok: false, elapsed: Date.now() - start, json: null,
      error: err.message, connectionFailed: true,
    };
  }
}

async function run() {
  log('');
  log('DashClaw Diagnostic Report');
  log('='.repeat(50));
  log(`Timestamp: ${report.timestamp}`);
  log(`Server:    ${BASE_URL}`);
  if (ERROR_HINT) log(`Error:     ${ERROR_HINT}`);
  if (ENDPOINT) log(`Endpoint:  ${ENDPOINT}`);
  log('');

  // Phase 1: Connectivity
  log('--- Phase 1: Server Connectivity ---');
  const health = await probe('/api/health');
  report.checks.health = health;

  if (health.connectionFailed) {
    log(`  [FAIL] Cannot connect to ${BASE_URL}`);
    report.diagnosis.push('Server is unreachable');
    report.suggestions.push(
      'Check that the DashClaw server is running (npm run dev)',
      `Verify the URL is correct: ${BASE_URL}`,
      'Check for firewall or network issues',
      'If using Docker, verify port mapping'
    );
    return finish();
  }

  if (health.ok) {
    log(`  [OK] Server healthy (${health.elapsed}ms)`);
    if (health.json?.version) log(`  [OK] Version: ${health.json.version}`);
  } else {
    log(`  [WARN] Health endpoint returned ${health.status}`);
    report.diagnosis.push(`Health endpoint returned non-200: ${health.status}`);
  }

  // Phase 2: Authentication
  log('');
  log('--- Phase 2: Authentication ---');

  if (!API_KEY) {
    log('  [WARN] No API key provided');
    report.diagnosis.push('No API key configured');
    report.suggestions.push(
      'Set DASHCLAW_API_KEY environment variable',
      'Or pass --api-key flag',
      'Generate a key at your-dashboard/api-keys or POST /api/keys'
    );
  } else {
    const authTest = await probe('/api/actions?limit=1');
    report.checks.auth = authTest;

    if (authTest.ok) {
      log(`  [OK] API key valid (${authTest.elapsed}ms)`);
    } else if (authTest.status === 401) {
      log('  [FAIL] API key rejected (401 Unauthorized)');
      report.diagnosis.push('API key is invalid or not recognized');
      report.suggestions.push(
        'Verify the API key value is correct',
        'Check if the key has been revoked',
        'Try generating a new key via the dashboard'
      );
    } else if (authTest.status === 403) {
      log(`  [FAIL] Forbidden (403): ${authTest.error || 'unknown'}`);
      report.diagnosis.push(`Access forbidden: ${authTest.error}`);
      if (authTest.error?.includes('onboarding')) {
        report.suggestions.push('Complete onboarding: visit /setup on the dashboard');
      } else if (authTest.error?.includes('readonly')) {
        report.suggestions.push('This API key has readonly access. Use an admin key for writes.');
      } else if (authTest.error?.includes('Demo mode')) {
        report.suggestions.push('You are hitting a demo instance. Use a self-hosted instance.');
      }
    } else if (authTest.status === 429) {
      log('  [FAIL] Rate limited (429)');
      report.diagnosis.push('Rate limit exceeded');
      report.suggestions.push('Wait 60 seconds and try again', 'Increase DASHCLAW_RATE_LIMIT_MAX');
    } else if (authTest.status === 503) {
      log(`  [FAIL] Server misconfigured (503): ${authTest.error || ''}`);
      report.diagnosis.push('Server configuration error');
      report.suggestions.push(authTest.error || 'Check server logs', 'Run database migrations');
    }
  }

  // Phase 3: Specific endpoint test
  if (ENDPOINT && API_KEY) {
    log('');
    log(`--- Phase 3: Endpoint Test (${ENDPOINT}) ---`);
    const epTest = await probe(ENDPOINT);
    report.checks.endpoint = epTest;

    if (epTest.ok) {
      log(`  [OK] ${ENDPOINT} responds (${epTest.elapsed}ms)`);
    } else {
      log(`  [FAIL] ${ENDPOINT} returned ${epTest.status}: ${epTest.error || 'no details'}`);
      report.diagnosis.push(`${ENDPOINT} failed with status ${epTest.status}`);
    }
  }

  // Phase 4: Latency profile
  log('');
  log('--- Phase 4: Latency Profile ---');
  const latencyEndpoints = ['/api/health', '/api/actions?limit=1', '/api/guard?limit=1', '/api/analytics'];
  for (const ep of latencyEndpoints) {
    if (!API_KEY && ep !== '/api/health') continue;
    const res = await probe(ep);
    const status = res.ok ? 'OK' : `${res.status}`;
    log(`  ${ep.padEnd(30)} ${String(res.elapsed).padStart(5)}ms [${status}]`);
    report.checks[`latency:${ep}`] = { elapsed: res.elapsed, status: res.status };
  }

  // Phase 5: Error-specific diagnosis
  if (ERROR_HINT) {
    log('');
    log(`--- Phase 5: Error Analysis ("${ERROR_HINT}") ---`);
    const hint = ERROR_HINT.toLowerCase();
    if (hint.includes('403') || hint.includes('forbidden')) {
      report.suggestions.push(
        'Check if DASHCLAW_MODE=demo (blocks writes)',
        'Check if API key role is "readonly"',
        'Check if user is on org_default (needs onboarding)',
        'Check if behavior guard is blocking'
      );
    } else if (hint.includes('401') || hint.includes('unauthorized')) {
      report.suggestions.push(
        'Verify x-api-key header is being sent',
        'Check API key value matches server config',
        'If using session auth, ensure same-origin request'
      );
    } else if (hint.includes('429') || hint.includes('rate')) {
      report.suggestions.push(
        'Default: 100 req/min (prod), 1000 req/min (dev)',
        'Increase: DASHCLAW_RATE_LIMIT_MAX env var',
        'Dev bypass: DASHCLAW_DISABLE_RATE_LIMIT=true'
      );
    } else if (hint.includes('econnrefused') || hint.includes('connection')) {
      report.suggestions.push('Server not running or unreachable', 'Check base URL and port', 'Run: npm run dev');
    } else if (hint.includes('redirect') || hint.includes('callback')) {
      report.suggestions.push(
        'OAuth callback URL missing from provider app',
        'GitHub: http://localhost:3000/api/auth/callback/github',
        'Google: http://localhost:3000/api/auth/callback/google'
      );
    }
    for (const s of report.suggestions) log(`  -> ${s}`);
  }

  finish();
}

function finish() {
  log('');
  log('='.repeat(50));
  if (report.diagnosis.length === 0) {
    log('No issues detected.');
    report.diagnosis.push('No issues detected');
  } else {
    log('Diagnosis:');
    for (const d of report.diagnosis) log(`  - ${d}`);
  }
  if (report.suggestions.length > 0) {
    log('');
    log('Suggested fixes:');
    for (const s of report.suggestions) log(`  -> ${s}`);
  }
  if (JSON_OUTPUT) console.log(JSON.stringify(report, null, 2));
  const hasFailure = report.diagnosis.some(d => d !== 'No issues detected');
  process.exit(hasFailure ? 1 : 0);
}

run();
