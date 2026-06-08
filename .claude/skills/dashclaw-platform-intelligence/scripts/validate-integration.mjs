#!/usr/bin/env node

/**
 * DashClaw Integration Validator
 *
 * Verifies that an agent's DashClaw integration is correctly configured
 * and all critical endpoints are reachable.
 *
 * Usage:
 *   node .claude/skills/dashclaw-platform-intelligence/scripts/validate-integration.mjs \
 *     --base-url http://localhost:3000 \
 *     --api-key oc_live_... \
 *     --agent-id my-agent
 *
 * Flags:
 *   --base-url   DashClaw server URL (default: http://localhost:3000)
 *   --api-key    API key (default: DASHCLAW_API_KEY env var)
 *   --agent-id   Agent ID to test with (default: integration-test)
 *   --full       Run full validation including write tests (creates test data)
 *   --json       Output results as JSON
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
const AGENT_ID = getFlag('agent-id', 'integration-test');
const FULL = hasFlag('full');
const JSON_OUTPUT = hasFlag('json');
const CAPTURE_PROOF = hasFlag('capture-setup-proof');

const results = [];
let passed = 0;
let failed = 0;
let skipped = 0;

function log(msg) {
  if (!JSON_OUTPUT) console.log(msg);
}

function record(name, status, detail) {
  results.push({ name, status, detail });
  if (status === 'pass') passed++;
  else if (status === 'fail') failed++;
  else skipped++;

  if (!JSON_OUTPUT) {
    const icon = status === 'pass' ? '[PASS]' : status === 'fail' ? '[FAIL]' : '[SKIP]';
    console.log(`  ${icon} ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['x-api-key'] = API_KEY;

  const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, ok: res.ok };
}

async function run() {
  log('');
  log('DashClaw Integration Validator');
  log('='.repeat(50));
  log(`Server:   ${BASE_URL}`);
  log(`Agent:    ${AGENT_ID}`);
  log(`API Key:  ${API_KEY ? API_KEY.slice(0, 12) + '...' : '(not set)'}`);
  log(`Mode:     ${FULL ? 'Full (writes enabled)' : 'Read-only'}`);
  log('');

  // 1. Health check (no auth needed)
  log('--- Connectivity ---');
  try {
    const res = await request('/api/health');
    if (res.ok && res.json?.status === 'healthy') {
      record('Health endpoint', 'pass', `Server healthy (${res.json.version || 'unknown version'})`);
    } else {
      record('Health endpoint', 'fail', `Status ${res.status}: ${res.text?.slice(0, 100)}`);
    }
  } catch (err) {
    record('Health endpoint', 'fail', `Connection failed: ${err.message}`);
    log('\nServer unreachable. Aborting remaining checks.');
    return printSummary();
  }

  // 2. API key validation
  log('');
  log('--- Authentication ---');
  if (!API_KEY) {
    record('API key configured', 'fail', 'No API key provided. Set --api-key or DASHCLAW_API_KEY env var.');
    log('\nNo API key. Skipping authenticated checks.');
    return printSummary();
  }
  record('API key configured', 'pass', `API key is set (length: ${API_KEY.length} characters)`);

  // 3. Authenticated endpoint test
  try {
    const res = await request('/api/actions?limit=1');
    if (res.ok) {
      record('API key authentication', 'pass', 'Key resolves to valid org');
    } else if (res.status === 401) {
      record('API key authentication', 'fail', 'Key rejected (401). Check key value and server DASHCLAW_API_KEY.');
    } else if (res.status === 403) {
      record('API key authentication', 'fail', `Forbidden (403): ${res.json?.error || 'unknown'}`);
    } else {
      record('API key authentication', 'fail', `Unexpected status ${res.status}`);
    }
  } catch (err) {
    record('API key authentication', 'fail', err.message);
  }

  // 4. Core read endpoints
  log('');
  log('--- Core Endpoints (Read) ---');
  const readEndpoints = [
    ['/api/actions?limit=1', 'Actions'],
    ['/api/guard?limit=1', 'Guard decisions'],
    ['/api/policies', 'Policies'],
    ['/api/messages/threads?limit=1', 'Message threads'],
    ['/api/messages?limit=1', 'Messages'],
    ['/api/assumptions?limit=1', 'Assumptions'],
    ['/api/signals', 'Signals'],
    ['/api/analytics', 'Analytics'],
  ];

  for (const [path, name] of readEndpoints) {
    try {
      const res = await request(path);
      if (res.ok) {
        record(`GET ${name}`, 'pass');
      } else {
        record(`GET ${name}`, 'fail', `Status ${res.status}: ${(res.json?.error || res.text || '').slice(0, 80)}`);
      }
    } catch (err) {
      record(`GET ${name}`, 'fail', err.message);
    }
  }

  // 5. Write tests (only in full mode)
  if (FULL) {
    log('');
    log('--- Write Tests ---');

    try {
      const res = await request('/api/actions', {
        method: 'POST',
        body: JSON.stringify({
          agent_id: AGENT_ID,
          agent_name: 'Integration Test',
          action_type: 'test',
          declared_goal: 'Validate DashClaw integration',
          risk_score: 5,
          metadata: { test: true, timestamp: new Date().toISOString() },
        }),
      });
      if (res.ok && res.json?.action_id) {
        record('Create action', 'pass', `action_id: ${res.json.action_id}`);

        const updateRes = await request(`/api/actions/${res.json.action_id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'completed', output_summary: 'Integration test passed' }),
        });
        record('Update action outcome', updateRes.ok ? 'pass' : 'fail',
          updateRes.ok ? 'Outcome updated' : `Status ${updateRes.status}`);
      } else if (res.status === 401 && res.json?.code === 'SIGNATURE_REQUIRED') {
        record('Create action', 'pass', 'Signature required (expected in production)');
      } else {
        record('Create action', 'fail', `Status ${res.status}: ${(res.json?.error || '').slice(0, 80)}`);
      }
    } catch (err) {
      record('Create action', 'fail', err.message);
    }

    try {
      const res = await request('/api/guard', {
        method: 'POST',
        body: JSON.stringify({
          agent_id: AGENT_ID, action_type: 'integration_test',
          content: 'Test guard check', risk_score: 10,
        }),
      });
      if (res.ok && res.json?.decision) {
        record('Guard check', 'pass', `Decision: ${res.json.decision}`);
      } else {
        record('Guard check', 'fail', `Status ${res.status}: ${(res.json?.error || '').slice(0, 80)}`);
      }
    } catch (err) {
      record('Guard check', 'fail', err.message);
    }

    try {
      const res = await request('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          from_agent_id: AGENT_ID, to_agent_id: 'dashboard',
          message_type: 'status', body: 'Integration test message',
        }),
      });
      record('Send message', res.ok ? 'pass' : 'fail',
        res.ok ? 'Message sent' : `Status ${res.status}`);
    } catch (err) {
      record('Send message', 'fail', err.message);
    }
  } else {
    log('');
    log('--- Write Tests (skipped, use --full to enable) ---');
    record('Create action', 'skip', 'Use --full flag');
    record('Guard check', 'skip', 'Use --full flag');
    record('Send message', 'skip', 'Use --full flag');
  }

  await printSummary();
}

async function printSummary() {
  const total = passed + failed + skipped;
  const score = total > 0 ? Math.round((passed / (passed + failed)) * 100) : 0;

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ results, summary: { passed, failed, skipped, score } }, null, 2));
    return;
  }

  log('');
  log('='.repeat(50));
  log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  log(`Integration health: ${score}%`);

  if (failed === 0 && skipped === 0) {
    log('\nAll checks passed. Integration is healthy.');
  } else if (failed === 0) {
    log('\nRead checks passed. Run with --full to test writes.');
  } else {
    log('\nSome checks failed. Review the output above.');
  }

  if (CAPTURE_PROOF && API_KEY) {
    log('\nCapturing setup proof...');
    try {
      const payload = {
        validator: 'node-sdk-helper',
        tool: 'node',
        mode: FULL ? 'full' : 'read_only',
        summary: { passed, failed, skipped, score },
        checks: results.map(r => ({ name: r.name, status: r.status }))
      };
      const proofRes = await fetch(`${BASE_URL}/api/setup/live-proof`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify(payload)
      });
      if (proofRes.ok) {
        log('Proof captured successfully! Your dashboard should now show a green checkmark.');
      } else {
        const text = await proofRes.text();
        log(`Failed to capture proof. Status: ${proofRes.status}. ${text.slice(0, 100)}`);
      }
    } catch (err) {
      log(`Error capturing proof: ${err.message}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

run();
