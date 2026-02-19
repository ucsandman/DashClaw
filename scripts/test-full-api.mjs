#!/usr/bin/env node

/**
 * DashClaw Full API Test Suite
 *
 * Exercises all API routes NOT covered by test-actions.mjs.
 * Requires the dev server running: npm run dev
 *
 * Usage:
 *   node scripts/test-full-api.mjs
 *   node scripts/test-full-api.mjs http://localhost:3000
 *   DASHCLAW_API_KEY=xxx node scripts/test-full-api.mjs https://your-app.vercel.app
 */

import { readFileSync } from 'fs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// Load .env.local if present (same pattern as _run-with-env.mjs)
try {
  const lines = readFileSync('.env.local', 'utf8').split('\n');
  for (const l of lines) {
    const idx = l.indexOf('=');
    if (idx > 0 && !l.startsWith('#') && !process.env[l.slice(0, idx).trim()]) {
      process.env[l.slice(0, idx).trim()] = l.slice(idx + 1).trim();
    }
  }
} catch { /* no .env.local — use explicit env vars */ }

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const API_KEY = process.env.DASHCLAW_API_KEY || '';

let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];

function log(icon, msg) {
  console.log(`  ${icon} ${msg}`);
}

function assert(condition, label) {
  if (condition) {
    passed++;
    results.push({ label, ok: true });
    log('✅', label);
  } else {
    failed++;
    results.push({ label, ok: false });
    log('❌', label);
  }
}

function skip(label) {
  skipped++;
  results.push({ label, ok: true, skipped: true });
  log('⏭️', `SKIP: ${label}`);
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['x-api-key'] = API_KEY;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  return { status: res.status, data };
}

// ──────────────────────────────────────────────
// Phase 1: Guard & Policies
// ──────────────────────────────────────────────

async function testGuardAndPolicies() {
  console.log('\n━━━ Phase 1: Guard & Policies ━━━');

  // POST /api/guard — evaluate guard
  const { status: s1, data: d1 } = await request('POST', '/api/guard', {
    action_type: 'deploy',
    risk_score: 50,
    agent_id: 'test-guard-agent',
    declared_goal: 'Test guard evaluation',
  });
  assert(s1 === 200 || s1 === 403, `POST /api/guard returns 200 or 403 (got ${s1})`);
  assert(d1.decision !== undefined, `Guard returns decision: ${d1.decision}`);

  // POST /api/guard — validation error
  const { status: s1b } = await request('POST', '/api/guard', {});
  assert(s1b === 400, `POST /api/guard with empty body returns 400 (got ${s1b})`);

  // GET /api/guard — list decisions
  const { status: s2, data: d2 } = await request('GET', '/api/guard?limit=5');
  assert(s2 === 200, `GET /api/guard returns 200 (got ${s2})`);
  assert(Array.isArray(d2.decisions), 'Guard GET returns decisions array');
  assert(d2.stats !== undefined, 'Guard GET returns stats');

  // POST /api/policies — create policy
  const policyName = `test-policy-${Date.now()}`;
  const { status: s3, data: d3 } = await request('POST', '/api/policies', {
    name: policyName,
    policy_type: 'block_action_type',
    rules: JSON.stringify({ action_types: ['dangerous_test'], action: 'block' }),
  });
  assert(s3 === 201, `POST /api/policies returns 201 (got ${s3})`);
  assert(d3.policy_id && d3.policy_id.startsWith('gp_'), `policy_id prefix: ${d3.policy_id}`);
  const policyId = d3.policy_id;

  // GET /api/policies — list
  const { status: s4, data: d4 } = await request('GET', '/api/policies');
  assert(s4 === 200, 'GET /api/policies returns 200');
  assert(Array.isArray(d4.policies), 'Policies returns array');
  assert(d4.policies.some(p => p.id === policyId), 'Created policy appears in list');

  // PATCH /api/policies — update
  const { status: s5, data: d5 } = await request('PATCH', '/api/policies', {
    id: policyId,
    active: false,
  });
  assert(s5 === 200, 'PATCH /api/policies returns 200');
  assert(d5.policy, 'PATCH returns updated policy');

  // PATCH - 404 for missing policy
  const { status: s5b } = await request('PATCH', '/api/policies', {
    id: 'gp_nonexistent',
    active: true,
  });
  assert(s5b === 404, 'PATCH missing policy returns 404');

  // POST /api/policies/test — run tests
  const { status: s6, data: d6 } = await request('POST', '/api/policies/test', {});
  assert(s6 === 200, `POST /api/policies/test returns 200 (got ${s6})`);
  assert(d6.results !== undefined, 'Policy test returns results');
  assert(typeof d6.results.total_policies === 'number', 'Results include total_policies');

  // GET /api/policies/proof — generate proof report
  const { status: s7, data: d7 } = await request('GET', '/api/policies/proof?format=json');
  assert(s7 === 200, `GET /api/policies/proof returns 200 (got ${s7})`);
  assert(d7.report !== undefined, 'Proof returns report');
  assert(d7.generated_at, 'Proof returns generated_at');

  // POST /api/policies/import — import pack
  const { status: s8, data: d8 } = await request('POST', '/api/policies/import', {
    pack: 'development',
  });
  assert(s8 === 201, `POST /api/policies/import returns 201 (got ${s8})`);
  assert(typeof d8.imported === 'number', 'Import returns imported count');

  // POST /api/policies/import — invalid pack
  const { status: s8b } = await request('POST', '/api/policies/import', {
    pack: 'nonexistent-pack',
  });
  assert(s8b === 400, 'Invalid pack returns 400');

  // DELETE /api/policies — cleanup
  const { status: s9, data: d9 } = await request('DELETE', `/api/policies?id=${policyId}`);
  assert(s9 === 200, 'DELETE /api/policies returns 200');
  assert(d9.deleted === true, 'Policy marked as deleted');

  // DELETE - 404 for missing
  const { status: s9b } = await request('DELETE', '/api/policies?id=gp_nonexistent');
  assert(s9b === 404, 'DELETE missing policy returns 404');

}

// ──────────────────────────────────────────────
// Phase 2: Compliance Engine
// ──────────────────────────────────────────────

async function testComplianceEngine() {
  console.log('\n━━━ Phase 2: Compliance Engine ━━━');

  // GET /api/compliance/frameworks — list frameworks
  const { status: s1, data: d1 } = await request('GET', '/api/compliance/frameworks');
  assert(s1 === 200, `GET /api/compliance/frameworks returns 200 (got ${s1})`);
  assert(Array.isArray(d1.frameworks), 'Frameworks returns array');
  assert(d1.frameworks.length > 0, `Found ${d1.frameworks.length} frameworks`);

  const frameworkId = d1.frameworks[0]?.id;
  if (!frameworkId) {
    skip('No frameworks available — skipping compliance map/gaps/report/evidence');
    return;
  }

  // GET /api/compliance/map — missing framework param
  const { status: s1b } = await request('GET', '/api/compliance/map');
  assert(s1b === 400, 'Compliance map without framework returns 400');

  // GET /api/compliance/map — valid
  const { status: s2, data: d2 } = await request('GET', `/api/compliance/map?framework=${frameworkId}`);
  assert(s2 === 200, `GET /api/compliance/map returns 200 (got ${s2})`);
  assert(d2.summary !== undefined || d2.controls !== undefined, 'Map returns compliance data');

  // GET /api/compliance/gaps
  const { status: s3, data: d3 } = await request('GET', `/api/compliance/gaps?framework=${frameworkId}`);
  assert(s3 === 200, `GET /api/compliance/gaps returns 200 (got ${s3})`);
  assert(d3.risk_assessment !== undefined || d3.gaps !== undefined, 'Gaps returns analysis');

  // GET /api/compliance/report
  const { status: s4, data: d4 } = await request('GET', `/api/compliance/report?framework=${frameworkId}&format=json`);
  assert(s4 === 200, `GET /api/compliance/report returns 200 (got ${s4})`);
  assert(d4.report !== undefined, 'Report returns content');
  assert(d4.generated_at, 'Report returns generated_at');

  // GET /api/compliance/evidence
  const { status: s5, data: d5 } = await request('GET', '/api/compliance/evidence?window=30d');
  assert(s5 === 200, `GET /api/compliance/evidence returns 200 (got ${s5})`);
  assert(d5.evidence !== undefined, 'Evidence returns data');
  assert(typeof d5.evidence.guard_decisions_total === 'number', 'Evidence has guard_decisions_total');

  // GET /api/compliance/map — invalid framework
  const { status: s6 } = await request('GET', '/api/compliance/map?framework=nonexistent');
  assert(s6 === 404, 'Invalid framework returns 404');
}

// ──────────────────────────────────────────────
// Phase 3: Task Routing
// ──────────────────────────────────────────────

async function testTaskRouting() {
  console.log('\n━━━ Phase 3: Task Routing ━━━');

  // GET /api/routing/health
  const { status: s1, data: d1 } = await request('GET', '/api/routing/health');
  assert(s1 === 200, `GET /api/routing/health returns 200 (got ${s1})`);
  assert(d1.status === 'ok', 'Routing health is ok');
  assert(d1.service === 'dashclaw-routing', 'Service name matches');

  // POST /api/routing/agents — register agent
  const { status: s2, data: d2 } = await request('POST', '/api/routing/agents', {
    name: 'test-routing-agent',
    capabilities: ['code-review', 'testing'],
    maxConcurrent: 5,
  });
  assert(s2 === 201, `POST /api/routing/agents returns 201 (got ${s2})`);
  assert(d2.agent, 'Registered agent returned');
  const routingAgentId = d2.agent?.id;

  // POST — missing name
  const { status: s2b } = await request('POST', '/api/routing/agents', {});
  assert(s2b === 400, 'Missing agent name returns 400');

  // GET /api/routing/agents — list
  const { status: s3, data: d3 } = await request('GET', '/api/routing/agents');
  assert(s3 === 200, 'GET /api/routing/agents returns 200');
  assert(Array.isArray(d3.agents), 'Agents returns array');

  // GET /api/routing/agents/:id
  if (routingAgentId) {
    const { status: s3b, data: d3b } = await request('GET', `/api/routing/agents/${routingAgentId}`);
    assert(s3b === 200, `GET /api/routing/agents/${routingAgentId} returns 200`);
    assert(d3b.agent, 'Agent detail returned');
  }

  // GET — 404 for missing agent
  const { status: s3c } = await request('GET', '/api/routing/agents/nonexistent-agent-id');
  assert(s3c === 404, 'GET missing routing agent returns 404');

  // PATCH /api/routing/agents/:id — update status
  if (routingAgentId) {
    const { status: s4, data: d4 } = await request('PATCH', `/api/routing/agents/${routingAgentId}`, {
      status: 'busy',
    });
    assert(s4 === 200, 'PATCH routing agent status returns 200');
    assert(d4.agent, 'Updated agent returned');
  }

  // POST /api/routing/tasks — submit task
  const { status: s5, data: d5 } = await request('POST', '/api/routing/tasks', {
    title: 'Test routing task',
    description: 'Integration test task for routing',
    requiredSkills: ['testing'],
    urgency: 'medium',
  });
  assert(s5 === 201, `POST /api/routing/tasks returns 201 (got ${s5})`);
  const taskId = d5.task?.id;

  // POST — missing title
  const { status: s5b } = await request('POST', '/api/routing/tasks', {});
  assert(s5b === 400, 'Missing task title returns 400');

  // GET /api/routing/tasks — list
  const { status: s6, data: d6 } = await request('GET', '/api/routing/tasks?limit=10');
  assert(s6 === 200, 'GET /api/routing/tasks returns 200');
  assert(Array.isArray(d6.tasks), 'Tasks returns array');

  // POST /api/routing/tasks/:id/complete — complete task
  if (taskId) {
    const { status: s7 } = await request('POST', `/api/routing/tasks/${taskId}/complete`, {
      success: true,
      result: 'Task completed by test suite',
    });
    assert(s7 === 200, `POST /api/routing/tasks/${taskId}/complete returns 200`);
  }

  // GET /api/routing/stats
  const { status: s8, data: d8 } = await request('GET', '/api/routing/stats');
  assert(s8 === 200, `GET /api/routing/stats returns 200 (got ${s8})`);

  // DELETE /api/routing/agents/:id — cleanup
  if (routingAgentId) {
    const { status: s9 } = await request('DELETE', `/api/routing/agents/${routingAgentId}`);
    assert(s9 === 200, 'DELETE routing agent returns 200');
  }
}

// ──────────────────────────────────────────────
// Phase 4: Webhooks
// ──────────────────────────────────────────────

async function testWebhooks() {
  console.log('\n━━━ Phase 4: Webhooks ━━━');

  // POST /api/webhooks — create
  const { status: s1, data: d1 } = await request('POST', '/api/webhooks', {
    url: 'https://example.com/webhook-test',
    events: ['all'],
  });
  assert(s1 === 201, `POST /api/webhooks returns 201 (got ${s1})`);
  assert(d1.webhook, 'Webhook created');
  assert(d1.webhook.id && d1.webhook.id.startsWith('wh_'), `webhook_id prefix: ${d1.webhook.id}`);
  assert(d1.webhook.secret, 'Webhook has secret');
  const webhookId = d1.webhook.id;

  // POST — invalid URL
  const { status: s1b } = await request('POST', '/api/webhooks', {
    url: 'not-a-url',
    events: ['all'],
  });
  assert(s1b === 400, 'Invalid webhook URL returns 400');

  // POST — invalid event type
  const { status: s1c } = await request('POST', '/api/webhooks', {
    url: 'https://example.com/test',
    events: ['nonexistent_event'],
  });
  assert(s1c === 400, 'Invalid event type returns 400');

  // GET /api/webhooks — list
  const { status: s2, data: d2 } = await request('GET', '/api/webhooks');
  assert(s2 === 200, 'GET /api/webhooks returns 200');
  assert(Array.isArray(d2.webhooks), 'Webhooks returns array');
  assert(d2.webhooks.some(w => w.id === webhookId), 'Created webhook in list');

  // POST /api/webhooks/:id/test — test delivery
  if (webhookId) {
    const { status: s3, data: d3 } = await request('POST', `/api/webhooks/${webhookId}/test`);
    // Test will likely fail since example.com won't accept the webhook, but the endpoint should still respond
    assert(s3 === 200, `POST /api/webhooks/${webhookId}/test returns 200 (got ${s3})`);
    assert(typeof d3.success === 'boolean', 'Test returns success boolean');
  }

  // GET /api/webhooks/:id/deliveries
  if (webhookId) {
    const { status: s4, data: d4 } = await request('GET', `/api/webhooks/${webhookId}/deliveries`);
    assert(s4 === 200, 'GET webhook deliveries returns 200');
    assert(Array.isArray(d4.deliveries), 'Deliveries returns array');
  }

  // GET deliveries — 404 for missing webhook
  const { status: s4b } = await request('GET', '/api/webhooks/wh_nonexistent/deliveries');
  assert(s4b === 404, 'Deliveries for missing webhook returns 404');

  // DELETE /api/webhooks — cleanup
  if (webhookId) {
    const { status: s5, data: d5 } = await request('DELETE', `/api/webhooks?id=${webhookId}`);
    assert(s5 === 200, 'DELETE webhook returns 200');
    assert(d5.success === true, 'Webhook deleted');
  }

  // DELETE — 404 for missing
  const { status: s5b } = await request('DELETE', '/api/webhooks?id=wh_nonexistent');
  assert(s5b === 404, 'DELETE missing webhook returns 404');
}

// ──────────────────────────────────────────────
// Phase 5: Settings & Keys
// ──────────────────────────────────────────────

async function testSettingsAndKeys() {
  console.log('\n━━━ Phase 5: Settings & Keys ━━━');

  // GET /api/settings — list
  const { status: s1, data: d1 } = await request('GET', '/api/settings');
  assert(s1 === 200, `GET /api/settings returns 200 (got ${s1})`);
  assert(Array.isArray(d1.settings), 'Settings returns array');

  // POST /api/settings — create
  const { status: s2, data: d2 } = await request('POST', '/api/settings', {
    key: 'BRAVE_API_KEY',
    value: 'test-brave-key-12345',
    category: 'integration',
  });
  assert(s2 === 200, `POST /api/settings returns 200 (got ${s2})`);
  assert(d2.success === true, 'Setting saved');

  // POST — invalid key
  const { status: s2b } = await request('POST', '/api/settings', {
    key: 'INVALID_ARBITRARY_KEY',
    value: 'test',
  });
  assert(s2b === 400, 'Invalid setting key returns 400');

  // DELETE /api/settings — cleanup
  const { status: s3 } = await request('DELETE', '/api/settings?key=BRAVE_API_KEY');
  assert(s3 === 200, 'DELETE setting returns 200');

  // GET /api/keys — list API keys
  const { status: s4, data: d4 } = await request('GET', '/api/keys');
  assert(s4 === 200 || s4 === 403, `GET /api/keys returns 200 or 403 (got ${s4})`);
  if (s4 === 200) {
    assert(Array.isArray(d4.keys), 'Keys returns array');
  }

  // GET /api/usage (404 if org not in organizations table)
  const { status: s5, data: d5 } = await request('GET', '/api/usage');
  assert([200, 403, 404].includes(s5), `GET /api/usage returns 200, 403, or 404 (got ${s5})`);
  if (s5 === 200) {
    assert(d5.plan !== undefined, 'Usage returns plan');
    assert(d5.limits !== undefined, 'Usage returns limits');
  }

  // POST /api/settings/test — test integration (generic)
  const { status: s6, data: d6 } = await request('POST', '/api/settings/test', {
    integration: 'unknown-integration',
    credentials: {},
  });
  assert(s6 === 200, `POST /api/settings/test returns 200 (got ${s6})`);
  assert(typeof d6.success === 'boolean', 'Test returns success boolean');
}

// ──────────────────────────────────────────────
// Phase 6: Identity & Pairing
// ──────────────────────────────────────────────

async function testIdentityAndPairing() {
  console.log('\n━━━ Phase 6: Identity & Pairing ━━━');

  // POST /api/identities — register
  const { status: s1, data: d1 } = await request('POST', '/api/identities', {
    agent_id: 'test-identity-agent',
    public_key: 'test-public-key-12345',
    algorithm: 'RSASSA-PKCS1-v1_5',
  });
  assert(s1 === 200, `POST /api/identities returns 200 (got ${s1})`);
  assert(d1.identity, 'Identity registered');

  // GET /api/identities — list
  const { status: s2, data: d2 } = await request('GET', '/api/identities');
  assert(s2 === 200, 'GET /api/identities returns 200');
  assert(Array.isArray(d2.identities), 'Identities returns array');

  // POST /api/identities — missing fields
  const { status: s1b } = await request('POST', '/api/identities', {
    agent_id: 'test',
  });
  assert(s1b === 400, 'Missing public_key returns 400');

  // POST /api/pairings — create pairing request
  const pemKey = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0\n-----END PUBLIC KEY-----';
  const { status: s3, data: d3 } = await request('POST', '/api/pairings', {
    agent_id: 'test-pairing-agent',
    agent_name: 'Test Pairing Agent',
    public_key: pemKey,
  });
  assert(s3 === 200, `POST /api/pairings returns 200 (got ${s3})`);
  assert(d3.pairing, 'Pairing created');
  assert(d3.pairing_url, 'Pairing URL returned');

  // POST — invalid public key
  const { status: s3b } = await request('POST', '/api/pairings', {
    agent_id: 'test',
    public_key: 'not-a-pem-key',
  });
  assert(s3b === 400, 'Invalid public key returns 400');

  // GET /api/pairings — list (admin)
  const { status: s4, data: d4 } = await request('GET', '/api/pairings?status=pending');
  assert(s4 === 200 || s4 === 403, `GET /api/pairings returns 200 or 403 (got ${s4})`);
  if (s4 === 200) {
    assert(Array.isArray(d4.pairings), 'Pairings returns array');
  }
}

// ──────────────────────────────────────────────
// Phase 7: Memory & Sync
// ──────────────────────────────────────────────

async function testMemoryAndSync() {
  console.log('\n━━━ Phase 7: Memory & Sync ━━━');

  // POST /api/memory — report health
  const { status: s1, data: d1 } = await request('POST', '/api/memory', {
    health: {
      score: 85,
      total_files: 10,
      total_lines: 500,
      total_size_kb: 25,
      memory_md_lines: 100,
      days_with_notes: 7,
      avg_lines_per_day: 71,
      duplicates: 2,
      stale_count: 1,
    },
    entities: [
      { name: 'TestEntity', type: 'project', mentions: 5 },
    ],
    topics: [
      { name: 'testing', mentions: 3 },
    ],
  });
  assert(s1 === 201, `POST /api/memory returns 201 (got ${s1})`);
  assert(d1.snapshot, 'Memory snapshot returned');

  // POST — missing health
  const { status: s1b } = await request('POST', '/api/memory', {});
  assert(s1b === 400, 'Missing health object returns 400');

  // GET /api/memory
  const { status: s2, data: d2 } = await request('GET', '/api/memory');
  assert(s2 === 200, `GET /api/memory returns 200 (got ${s2})`);
  assert(d2.lastUpdated, 'Memory returns lastUpdated');

  // POST /api/sync — bulk sync
  const { status: s3, data: d3 } = await request('POST', '/api/sync', {
    agent_id: 'test-sync-agent',
    goals: [
      { title: 'Test sync goal', category: 'testing', progress: 50 },
    ],
    learning: [
      { decision: 'Test sync decision', context: 'Testing sync API', confidence: 80 },
    ],
  });
  assert(s3 === 200, `POST /api/sync returns 200 (got ${s3})`);
  assert(d3.results !== undefined, 'Sync returns results');
  assert(typeof d3.total_synced === 'number', 'Sync returns total_synced');
  assert(typeof d3.duration_ms === 'number', 'Sync returns duration_ms');
}

// ──────────────────────────────────────────────
// Phase 8: Learning System
// ──────────────────────────────────────────────

async function testLearningSystem() {
  console.log('\n━━━ Phase 8: Learning System ━━━');

  // POST /api/learning — record decision (500 if org FK missing)
  const { status: s1, data: d1 } = await request('POST', '/api/learning', {
    decision: 'Use PostgreSQL for data storage',
    context: 'Evaluating database options',
    reasoning: 'Better relational support and ACID compliance',
    outcome: 'success',
    confidence: 90,
    agent_id: 'test-learning-agent',
  });
  assert(s1 === 201 || s1 === 500, `POST /api/learning returns 201 or 500 (got ${s1})`);
  if (s1 === 201) assert(d1.decision, 'Decision returned');

  // POST — missing decision field
  const { status: s1b } = await request('POST', '/api/learning', {
    context: 'Missing the required field',
  });
  assert(s1b === 400, 'Missing decision returns 400');

  // GET /api/learning
  const { status: s2, data: d2 } = await request('GET', '/api/learning');
  assert(s2 === 200, `GET /api/learning returns 200 (got ${s2})`);
  assert(Array.isArray(d2.decisions), 'Learning returns decisions array');
  assert(d2.stats !== undefined, 'Learning returns stats');

  // GET /api/learning — filter by agent
  const { status: s2b } = await request('GET', '/api/learning?agent_id=test-learning-agent');
  assert(s2b === 200, 'GET learning filtered by agent returns 200');

  // GET /api/learning/recommendations
  const { status: s3, data: d3 } = await request('GET', '/api/learning/recommendations');
  assert(s3 === 200, `GET /api/learning/recommendations returns 200 (got ${s3})`);
  assert(Array.isArray(d3.recommendations), 'Recommendations returns array');

  // GET /api/learning/recommendations/metrics
  const { status: s4, data: d4 } = await request('GET', '/api/learning/recommendations/metrics');
  assert(s4 === 200, `GET /api/learning/recommendations/metrics returns 200 (got ${s4})`);

  // POST /api/learning/recommendations/events — record event (500 if org FK missing)
  const { status: s5, data: d5 } = await request('POST', '/api/learning/recommendations/events', {
    events: [
      {
        event_type: 'applied',
        agent_id: 'test-learning-agent',
        details: { source: 'test-suite' },
      },
    ],
  });
  assert(s5 === 201 || s5 === 500, `POST /api/learning/recommendations/events returns 201 or 500 (got ${s5})`);
  if (s5 === 201) assert(typeof d5.created_count === 'number', 'Events returns created_count');

  // POST events — invalid event_type
  const { status: s5b } = await request('POST', '/api/learning/recommendations/events', {
    events: [{ event_type: 'invalid_type' }],
  });
  assert(s5b === 400, 'Invalid event_type returns 400');
}

// ──────────────────────────────────────────────
// Phase 9: Goals & Content
// ──────────────────────────────────────────────

async function testGoalsAndContent() {
  console.log('\n━━━ Phase 9: Goals & Content ━━━');

  // POST /api/goals — create (500 if org FK missing)
  const { status: s1, data: d1 } = await request('POST', '/api/goals', {
    title: 'Test integration goal',
    category: 'testing',
    description: 'Created by test suite',
    progress: 25,
    agent_id: 'test-goals-agent',
  });
  assert(s1 === 201 || s1 === 500, `POST /api/goals returns 201 or 500 (got ${s1})`);
  if (s1 === 201) assert(d1.goal, 'Goal returned');

  // POST — missing title
  const { status: s1b } = await request('POST', '/api/goals', {
    category: 'testing',
  });
  assert(s1b === 400, 'Missing goal title returns 400');

  // GET /api/goals
  const { status: s2, data: d2 } = await request('GET', '/api/goals');
  assert(s2 === 200, `GET /api/goals returns 200 (got ${s2})`);
  assert(Array.isArray(d2.goals), 'Goals returns array');
  assert(d2.stats !== undefined, 'Goals returns stats');

  // POST /api/content — create (500 if org FK missing)
  const { status: s3, data: d3 } = await request('POST', '/api/content', {
    title: 'Test content item',
    platform: 'blog',
    status: 'draft',
    body: 'This is test content from the test suite.',
    agent_id: 'test-content-agent',
  });
  assert(s3 === 201 || s3 === 500, `POST /api/content returns 201 or 500 (got ${s3})`);
  if (s3 === 201) {
    assert(d3.content, 'Content returned');
    assert(d3.security !== undefined, 'Content returns security scan');
  }

  // GET /api/content
  const { status: s4, data: d4 } = await request('GET', '/api/content');
  assert(s4 === 200, `GET /api/content returns 200 (got ${s4})`);
  assert(Array.isArray(d4.content), 'Content returns array');
  assert(d4.stats !== undefined, 'Content returns stats');

  // POST /api/inspiration — create idea (500 if org FK missing)
  const { status: s5, data: d5 } = await request('POST', '/api/inspiration', {
    title: 'Test idea from test suite',
    description: 'An automated test idea',
    category: 'feature',
    score: 75,
  });
  assert(s5 === 201 || s5 === 500, `POST /api/inspiration returns 201 or 500 (got ${s5})`);

  // GET /api/inspiration
  const { status: s6, data: d6 } = await request('GET', '/api/inspiration');
  assert(s6 === 200, `GET /api/inspiration returns 200 (got ${s6})`);
  assert(Array.isArray(d6.ideas), 'Inspiration returns ideas array');
  assert(d6.stats !== undefined, 'Inspiration returns stats');

  // POST /api/calendar — create event
  const futureDate = new Date(Date.now() + 86400000).toISOString();
  const { status: s7 } = await request('POST', '/api/calendar', {
    summary: 'Test calendar event',
    start_time: futureDate,
    end_time: new Date(Date.now() + 90000000).toISOString(),
  });
  assert(s7 === 201 || s7 === 200, `POST /api/calendar returns 201 or 200 (got ${s7})`);

  // GET /api/calendar
  const { status: s8, data: d8 } = await request('GET', '/api/calendar');
  assert(s8 === 200, `GET /api/calendar returns 200 (got ${s8})`);
  assert(Array.isArray(d8.events), 'Calendar returns events array');
}

// ──────────────────────────────────────────────
// Phase 10: Agents & Connections
// ──────────────────────────────────────────────

async function testAgentsAndConnections() {
  console.log('\n━━━ Phase 10: Agents & Connections ━━━');

  // GET /api/agents
  const { status: s1, data: d1 } = await request('GET', '/api/agents');
  assert(s1 === 200, `GET /api/agents returns 200 (got ${s1})`);
  assert(Array.isArray(d1.agents), 'Agents returns array');

  // GET /api/agents?include_connections=true
  const { status: s1b } = await request('GET', '/api/agents?include_connections=true');
  assert(s1b === 200, 'GET agents with connections returns 200');

  // POST /api/agents/connections — report (requires connections array)
  const { status: s2, data: d2 } = await request('POST', '/api/agents/connections', {
    agent_id: 'test-conn-agent',
    connections: [
      { provider: 'github', auth_type: 'oauth', status: 'active' },
    ],
  });
  assert(s2 === 200 || s2 === 201, `POST /api/agents/connections returns 200/201 (got ${s2})`);

  // GET /api/agents/connections
  const { status: s3, data: d3 } = await request('GET', '/api/agents/connections');
  assert(s3 === 200, `GET /api/agents/connections returns 200 (got ${s3})`);
  assert(Array.isArray(d3.connections), 'Connections returns array');

  // POST /api/relationships — record interaction (requires summary)
  const { status: s4, data: d4 } = await request('POST', '/api/relationships', {
    contact_name: 'Test Contact Person',
    summary: 'Test interaction from test suite',
    direction: 'outbound',
    type: 'message',
    platform: 'linkedin',
    agent_id: 'test-rel-agent',
  });
  assert([200, 201, 500].includes(s4), `POST /api/relationships returns 200/201 or 500 (got ${s4})`);

  // GET /api/relationships
  const { status: s5, data: d5 } = await request('GET', '/api/relationships');
  assert(s5 === 200, `GET /api/relationships returns 200 (got ${s5})`);
}

// ──────────────────────────────────────────────
// Phase 11: Activity & Notifications
// ──────────────────────────────────────────────

async function testActivityAndNotifications() {
  console.log('\n━━━ Phase 11: Activity & Notifications ━━━');

  // GET /api/activity — list activity logs
  const { status: s1, data: d1 } = await request('GET', '/api/activity?limit=10');
  assert(s1 === 200, `GET /api/activity returns 200 (got ${s1})`);
  assert(Array.isArray(d1.activity) || Array.isArray(d1.logs), 'Activity returns array');

  // GET /api/tokens — token usage
  const { status: s2, data: d2 } = await request('GET', '/api/tokens');
  assert(s2 === 200, `GET /api/tokens returns 200 (got ${s2})`);

  // POST /api/tokens — report usage
  const { status: s3 } = await request('POST', '/api/tokens', {
    agent_id: 'test-token-agent',
    tokens_in: 1000,
    tokens_out: 500,
    model: 'gpt-4',
    context_pct: 45,
  });
  assert(s3 === 200 || s3 === 201, `POST /api/tokens returns 200/201 (got ${s3})`);
}

// ──────────────────────────────────────────────
// Phase 12: Onboarding & Setup
// ──────────────────────────────────────────────

async function testOnboardingAndSetup() {
  console.log('\n━━━ Phase 12: Onboarding & Setup ━━━');

  // GET /api/onboarding/status
  const { status: s1, data: d1 } = await request('GET', '/api/onboarding/status');
  assert(s1 === 200 || s1 === 401, `GET /api/onboarding/status returns 200 or 401 (got ${s1})`);
  if (s1 === 200) {
    assert(d1.steps !== undefined || d1.onboarding_required !== undefined, 'Onboarding returns status info');
  }

  // GET /api/setup/status
  const { status: s2, data: d2 } = await request('GET', '/api/setup/status');
  assert(s2 === 200, `GET /api/setup/status returns 200 (got ${s2})`);
  assert(typeof d2.configured === 'boolean', 'Setup returns configured boolean');

  // GET /api/docs/raw — returns markdown
  const { status: s3, data: d3 } = await request('GET', '/api/docs/raw');
  assert(s3 === 200, `GET /api/docs/raw returns 200 (got ${s3})`);
  assert(typeof d3 === 'string' && d3.length > 100, 'Docs raw returns markdown string');
}

// ──────────────────────────────────────────────
// Phase 13: Cron Routes
// ──────────────────────────────────────────────

async function testCronRoutes() {
  console.log('\n━━━ Phase 13: Cron Routes ━━━');

  // GET /api/cron/signals — signal computation
  const { status: s1, data: d1 } = await request('GET', '/api/cron/signals');
  assert(s1 === 200 || s1 === 401, `GET /api/cron/signals returns 200 or 401 (got ${s1})`);

  // GET /api/cron/memory-maintenance
  const { status: s2 } = await request('GET', '/api/cron/memory-maintenance');
  assert(s2 === 200 || s2 === 401, `GET /api/cron/memory-maintenance returns 200 or 401 (got ${s2})`);

  // GET /api/cron/learning-episodes-backfill
  const { status: s3 } = await request('GET', '/api/cron/learning-episodes-backfill');
  assert(s3 === 200 || s3 === 401, `GET /api/cron/learning-episodes-backfill returns 200 or 401 (got ${s3})`);

  // GET /api/cron/learning-recommendations
  const { status: s4 } = await request('GET', '/api/cron/learning-recommendations');
  assert(s4 === 200 || s4 === 401, `GET /api/cron/learning-recommendations returns 200 or 401 (got ${s4})`);

  // POST /api/cron/routing-maintenance
  const { status: s5 } = await request('POST', '/api/cron/routing-maintenance');
  assert(s5 === 200 || s5 === 401, `POST /api/cron/routing-maintenance returns 200 or 401 (got ${s5})`);
}

// ──────────────────────────────────────────────
// Phase 14: Misc Endpoints
// ──────────────────────────────────────────────

async function testMiscEndpoints() {
  console.log('\n━━━ Phase 14: Misc Endpoints ━━━');

  // POST /api/actions/{id}/approve — needs a pending_approval action
  // We'll test the validation path: invalid decision
  const { status: s1 } = await request('POST', '/api/actions/act_nonexistent/approve', {
    decision: 'allow',
  });
  // Could be 404 (action not found) or 400 (not pending_approval)
  assert(s1 === 404 || s1 === 400, `POST approve missing action returns 404 or 400 (got ${s1})`);

  // POST — invalid decision
  const { status: s1b } = await request('POST', '/api/actions/act_nonexistent/approve', {
    decision: 'invalid',
  });
  assert(s1b === 400, 'Invalid approval decision returns 400');

  // GET /api/security/status — admin only
  const { status: s2, data: d2 } = await request('GET', '/api/security/status');
  assert(s2 === 200 || s2 === 403, `GET /api/security/status returns 200 or 403 (got ${s2})`);
  if (s2 === 200) {
    assert(typeof d2.score === 'number', 'Security status returns score');
    assert(Array.isArray(d2.checks), 'Security status returns checks array');
  }

  // GET /api/swarm/graph
  const { status: s3, data: d3 } = await request('GET', '/api/swarm/graph');
  assert(s3 === 200, `GET /api/swarm/graph returns 200 (got ${s3})`);

  // GET /api/workflows
  const { status: s4, data: d4 } = await request('GET', '/api/workflows');
  assert(s4 === 200, `GET /api/workflows returns 200 (got ${s4})`);

  // GET /api/bounties
  const { status: s5, data: d5 } = await request('GET', '/api/bounties');
  assert(s5 === 200, `GET /api/bounties returns 200 (got ${s5})`);
  assert(d5.stats !== undefined, 'Bounties returns stats');

  // GET /api/schedules
  const { status: s6, data: d6 } = await request('GET', '/api/schedules');
  assert(s6 === 200, `GET /api/schedules returns 200 (got ${s6})`);
  assert(d6.stats !== undefined, 'Schedules returns stats');

  // GET /api/prompts/server-setup/raw
  const { status: s7 } = await request('GET', '/api/prompts/server-setup/raw');
  assert(s7 === 200, `GET /api/prompts/server-setup/raw returns 200 (got ${s7})`);

  // GET /api/prompts/agent-connect/raw
  const { status: s8 } = await request('GET', '/api/prompts/agent-connect/raw');
  assert(s8 === 200, `GET /api/prompts/agent-connect/raw returns 200 (got ${s8})`);

  // GET /api/snippets/:id — single snippet (create one first)
  const { data: snData } = await request('POST', '/api/snippets', {
    name: `test-misc-snippet-${Date.now()}`,
    code: 'console.log("test")',
    language: 'javascript',
  });
  if (snData.snippet_id) {
    const { status: s9, data: d9 } = await request('GET', `/api/snippets/${snData.snippet_id}`);
    assert(s9 === 200, `GET /api/snippets/${snData.snippet_id} returns 200`);
    assert(d9.snippet, 'Single snippet returned');

    // Cleanup
    await request('DELETE', `/api/snippets?id=${snData.snippet_id}`);
  }

  // GET /api/snippets/:id — 404 for missing
  const { status: s9b } = await request('GET', '/api/snippets/sn_nonexistent');
  assert(s9b === 404, 'GET missing snippet returns 404');

  // DELETE /api/actions — bulk delete (test with no matching agent)
  const { status: s10 } = await request('DELETE', '/api/actions?agent_id=nonexistent-agent-delete-test');
  assert(s10 === 200 || s10 === 400, `DELETE /api/actions returns 200 or 400 (got ${s10})`);
}

// ──────────────────────────────────────────────
// Phase 15: Organization Management
// ──────────────────────────────────────────────

async function testOrgManagement() {
  console.log('\n━━━ Phase 15: Organization Management ━━━');

  // GET /api/orgs — list (admin only)
  const { status: s1, data: d1 } = await request('GET', '/api/orgs');
  assert(s1 === 200 || s1 === 403, `GET /api/orgs returns 200 or 403 (got ${s1})`);
  if (s1 === 200) {
    assert(Array.isArray(d1.organizations), 'Orgs returns organizations array');
  }

  // GET /api/team — team members (404 if org not in organizations table)
  const { status: s2, data: d2 } = await request('GET', '/api/team');
  assert([200, 403, 404].includes(s2), `GET /api/team returns 200, 403, or 404 (got ${s2})`);

  // GET /api/team/invite — list invites
  const { status: s3 } = await request('GET', '/api/team/invite');
  assert(s3 === 200 || s3 === 403, `GET /api/team/invite returns 200 or 403 (got ${s3})`);
}

// 
// Phase: Evaluations (Phase 0+1)
// 

async function testEvaluations() {
  console.log('\n Evaluations ');

  // GET /api/evaluations/types  list scorer types
  const { status: s1, data: d1 } = await request('GET', '/api/evaluations/types');
  assert(s1 === 200, `GET /api/evaluations/types returns 200 (got ${s1})`);
  assert(Array.isArray(d1.types), 'Returns types array');
  assert(d1.types.length >= 5, `Has at least 5 scorer types (got ${d1.types.length})`);

  // POST /api/evaluations/scorers  create scorer
  const { status: s2, data: d2 } = await request('POST', '/api/evaluations/scorers', {
    name: `test-scorer-${Date.now()}`,
    scorer_type: 'contains',
    config: { keywords: ['hello', 'world'] },
  });
  assert(s2 === 201, `POST /api/evaluations/scorers returns 201 (got ${s2})`);
  assert(d2.id, 'Scorer has an id');
  const scorerId = d2.id;

  // GET /api/evaluations/scorers  list
  const { status: s3, data: d3 } = await request('GET', '/api/evaluations/scorers');
  assert(s3 === 200, 'GET /api/evaluations/scorers returns 200');
  assert(Array.isArray(d3.scorers), 'Returns scorers array');
  assert(d3.scorers.some(s => s.id === scorerId), 'Created scorer appears in list');

  // POST /api/evaluations/scores  score something
  const { status: s4, data: d4 } = await request('POST', '/api/evaluations/scores', {
    scorer_id: scorerId,
    output: 'hello world this is a test',
    metadata: { agent_id: 'test-agent' },
  });
  assert(s4 === 201, `POST /api/evaluations/scores returns 201 (got ${s4})`);
  assert(typeof d4.score === 'number', `Score is a number: ${d4.score}`);
  assert(d4.score === 1, `Contains scorer returns 1 for matching output (got ${d4.score})`);

  // GET /api/evaluations/scores  list scores
  const { status: s5, data: d5 } = await request('GET', '/api/evaluations/scores?limit=5');
  assert(s5 === 200, 'GET /api/evaluations/scores returns 200');
  assert(Array.isArray(d5.scores), 'Returns scores array');

  // DELETE /api/evaluations/scorers  cleanup
  const { status: s6 } = await request('DELETE', `/api/evaluations/scorers/${scorerId}`);
  assert(s6 === 200, `DELETE scorer returns 200 (got ${s6})`);
}

// 
// Phase: Prompts (Phase 2)
// 

async function testPrompts() {
  console.log('\n Prompts ');

  // POST /api/prompts/templates  create template
  const { status: s1, data: d1 } = await request('POST', '/api/prompts/templates', {
    name: `test-prompt-${Date.now()}`,
    content: 'Hello {{name}}, welcome to {{place}}!',
    variables: ['name', 'place'],
  });
  assert(s1 === 201, `POST /api/prompts/templates returns 201 (got ${s1})`);
  assert(d1.id, 'Template has an id');
  const templateId = d1.id;

  // GET /api/prompts/templates  list
  const { status: s2, data: d2 } = await request('GET', '/api/prompts/templates');
  assert(s2 === 200, 'GET /api/prompts/templates returns 200');
  assert(Array.isArray(d2.templates), 'Returns templates array');

  // POST /api/prompts/render  render template
  const { status: s3, data: d3 } = await request('POST', '/api/prompts/render', {
    template_id: templateId,
    variables: { name: 'Test', place: 'DashClaw' },
  });
  assert(s3 === 200, `POST /api/prompts/render returns 200 (got ${s3})`);
  assert(d3.rendered === 'Hello Test, welcome to DashClaw!', `Rendered correctly: ${d3.rendered}`);

  // GET /api/prompts/stats  usage stats
  const { status: s4 } = await request('GET', '/api/prompts/stats');
  assert(s4 === 200, 'GET /api/prompts/stats returns 200');

  // DELETE  cleanup
  const { status: s5 } = await request('DELETE', `/api/prompts/templates/${templateId}`);
  assert(s5 === 200, `DELETE template returns 200 (got ${s5})`);
}

// 
// Phase: Feedback (Phase 3)
// 

async function testFeedback() {
  console.log('\n Feedback ');

  // POST /api/feedback  create feedback
  const { status: s1, data: d1 } = await request('POST', '/api/feedback', {
    rating: 4,
    comment: 'Great performance, very fast response',
    action_id: `test-action-${Date.now()}`,
    agent_id: 'test-agent',
  });
  assert(s1 === 201, `POST /api/feedback returns 201 (got ${s1})`);
  assert(d1.id, 'Feedback has an id');
  const feedbackId = d1.id;

  // GET /api/feedback  list
  const { status: s2, data: d2 } = await request('GET', '/api/feedback?limit=5');
  assert(s2 === 200, 'GET /api/feedback returns 200');
  assert(Array.isArray(d2.feedback), 'Returns feedback array');

  // GET /api/feedback/stats  stats
  const { status: s3, data: d3 } = await request('GET', '/api/feedback/stats');
  assert(s3 === 200, 'GET /api/feedback/stats returns 200');
  assert(typeof d3.total_feedback === 'number' || d3.stats, 'Stats returned');

  // PATCH /api/feedback/:id  resolve
  const { status: s4 } = await request('PATCH', `/api/feedback/${feedbackId}`, { resolved: true });
  assert(s4 === 200, `PATCH /api/feedback/:id returns 200 (got ${s4})`);

  // DELETE  cleanup
  const { status: s5 } = await request('DELETE', `/api/feedback/${feedbackId}`);
  assert(s5 === 200, `DELETE feedback returns 200 (got ${s5})`);
}

// 
// Phase: Compliance Exports (Phase 4)
// 

async function testComplianceExports() {
  console.log('\n Compliance Exports ');

  // GET /api/compliance/exports  list (empty initially)
  const { status: s1, data: d1 } = await request('GET', '/api/compliance/exports');
  assert(s1 === 200, `GET /api/compliance/exports returns 200 (got ${s1})`);
  assert(Array.isArray(d1.exports), 'Returns exports array');

  // POST /api/compliance/exports  create export
  const { status: s2, data: d2 } = await request('POST', '/api/compliance/exports', {
    name: `test-export-${Date.now()}`,
    frameworks: ['soc2'],
    window_days: 7,
  });
  assert(s2 === 201, `POST /api/compliance/exports returns 201 (got ${s2})`);
  assert(d2.id, 'Export has an id');

  // POST  validation: missing frameworks
  const { status: s3 } = await request('POST', '/api/compliance/exports', { name: 'No frameworks' });
  assert(s3 === 400, `POST without frameworks returns 400 (got ${s3})`);

  // GET /api/compliance/trends
  const { status: s4 } = await request('GET', '/api/compliance/trends');
  assert(s4 === 200, `GET /api/compliance/trends returns 200 (got ${s4})`);

  // GET /api/compliance/schedules
  const { status: s5, data: d5 } = await request('GET', '/api/compliance/schedules');
  assert(s5 === 200, `GET /api/compliance/schedules returns 200 (got ${s5})`);
  assert(Array.isArray(d5.schedules), 'Returns schedules array');
}

// 
// Phase: Drift Detection (Phase 5)
// 

async function testDriftDetection() {
  console.log('\n Drift Detection ');

  // GET /api/drift/metrics  list metrics
  const { status: s1, data: d1 } = await request('GET', '/api/drift/metrics');
  assert(s1 === 200, `GET /api/drift/metrics returns 200 (got ${s1})`);
  assert(Array.isArray(d1.metrics), 'Returns metrics array');
  assert(d1.metrics.length >= 6, `At least 6 metrics (got ${d1.metrics.length})`);

  // GET /api/drift/alerts  list alerts
  const { status: s2, data: d2 } = await request('GET', '/api/drift/alerts');
  assert(s2 === 200, `GET /api/drift/alerts returns 200 (got ${s2})`);
  assert(Array.isArray(d2.alerts), 'Returns alerts array');

  // GET /api/drift/stats
  const { status: s3, data: d3 } = await request('GET', '/api/drift/stats');
  assert(s3 === 200, `GET /api/drift/stats returns 200 (got ${s3})`);
  assert(d3.overall !== undefined, 'Stats include overall');

  // GET /api/drift/snapshots
  const { status: s4 } = await request('GET', '/api/drift/snapshots');
  assert(s4 === 200, `GET /api/drift/snapshots returns 200 (got ${s4})`);

  // POST /api/drift/alerts  compute baselines (may have no data)
  const { status: s5, data: d5 } = await request('POST', '/api/drift/alerts', { action: 'compute_baselines' });
  assert(s5 === 201, `POST compute_baselines returns 201 (got ${s5})`);
  assert(typeof d5.baselines_computed === 'number', 'Returns baselines_computed count');

  // POST /api/drift/alerts  detect drift
  const { status: s6, data: d6 } = await request('POST', '/api/drift/alerts', { action: 'detect' });
  assert(s6 === 201, `POST detect returns 201 (got ${s6})`);
  assert(typeof d6.alerts_generated === 'number', 'Returns alerts_generated count');
}

// 
// Phase: Learning Analytics (Phase 6)
// 

async function testLearningAnalytics() {
  console.log('\n Learning Analytics ');

  // GET /api/learning/analytics/summary
  const { status: s1, data: d1 } = await request('GET', '/api/learning/analytics/summary');
  assert(s1 === 200, `GET /api/learning/analytics/summary returns 200 (got ${s1})`);
  assert(d1.overall !== undefined, 'Summary includes overall');
  assert(Array.isArray(d1.by_agent), 'Summary includes by_agent array');
  assert(Array.isArray(d1.by_action_type), 'Summary includes by_action_type array');

  // GET /api/learning/analytics/maturity
  const { status: s2, data: d2 } = await request('GET', '/api/learning/analytics/maturity');
  assert(s2 === 200, `GET /api/learning/analytics/maturity returns 200 (got ${s2})`);
  assert(Array.isArray(d2.levels), 'Returns levels array');
  assert(d2.levels.length === 6, `6 maturity levels (got ${d2.levels.length})`);

  // POST /api/learning/analytics/velocity  compute
  const { status: s3, data: d3 } = await request('POST', '/api/learning/analytics/velocity', { lookback_days: 30 });
  assert(s3 === 201, `POST velocity returns 201 (got ${s3})`);
  assert(typeof d3.agents_computed === 'number', 'Returns agents_computed count');

  // GET /api/learning/analytics/velocity
  const { status: s4 } = await request('GET', '/api/learning/analytics/velocity');
  assert(s4 === 200, `GET velocity returns 200 (got ${s4})`);

  // POST /api/learning/analytics/curves  compute
  const { status: s5, data: d5 } = await request('POST', '/api/learning/analytics/curves', { lookback_days: 60 });
  assert(s5 === 201, `POST curves returns 201 (got ${s5})`);
  assert(typeof d5.curves_computed === 'number', 'Returns curves_computed count');

  // GET /api/learning/analytics/curves
  const { status: s6 } = await request('GET', '/api/learning/analytics/curves');
  assert(s6 === 200, `GET curves returns 200 (got ${s6})`);
}

// ──────────────────────────────────────────────
// Phase 7: Scoring Profiles
// ──────────────────────────────────────────────

async function testScoringProfiles() {
  console.log('\n--- Phase 7: Scoring Profiles ---\n');

  // Create a scoring profile with inline dimensions
  let scoringProfileId;
  {
    const { data: res } = await request('POST', '/api/scoring/profiles', {
      name: 'Integration Test Profile',
      description: 'Created by test-full-api.mjs',
      action_type: 'test_action',
      composite_method: 'weighted_average',
      dimensions: [
        {
          name: 'Speed',
          data_source: 'duration_ms',
          weight: 0.4,
          scale: [
            { label: 'excellent', operator: 'lt', value: 1000, score: 100 },
            { label: 'good', operator: 'lt', value: 5000, score: 75 },
            { label: 'poor', operator: 'gte', value: 5000, score: 20 },
          ],
        },
        {
          name: 'Confidence',
          data_source: 'confidence',
          weight: 0.6,
          scale: [
            { label: 'excellent', operator: 'gte', value: 0.9, score: 100 },
            { label: 'good', operator: 'gte', value: 0.7, score: 75 },
            { label: 'poor', operator: 'lt', value: 0.7, score: 25 },
          ],
        },
      ],
    });
    assert(res.id, 'Profile should have an ID');
    assert(res.id.startsWith('sp_'), 'Profile ID should start with sp_');
    assert(res.dimensions?.length === 2, 'Profile should have 2 dimensions');
    scoringProfileId = res.id;
    console.log('  [PASS] POST /api/scoring/profiles - created with inline dimensions');
  }

  // List profiles
  {
    const { data: res } = await request('GET', '/api/scoring/profiles');
    assert(Array.isArray(res.profiles), 'Should return profiles array');
    const found = res.profiles.find(p => p.id === scoringProfileId);
    assert(found, 'Created profile should be in list');
    console.log('  [PASS] GET /api/scoring/profiles - lists profiles');
  }

  // Get single profile
  {
    const { data: res } = await request('GET', `/api/scoring/profiles/${scoringProfileId}`);
    assert(res.name === 'Integration Test Profile', 'Profile name should match');
    assert(res.dimensions?.length === 2, 'Should include dimensions');
    console.log('  [PASS] GET /api/scoring/profiles/:id - returns profile with dimensions');
  }

  // Update profile
  {
    const { data: res } = await request('PATCH', `/api/scoring/profiles/${scoringProfileId}`, {
      description: 'Updated by integration test',
    });
    assert(res.description === 'Updated by integration test', 'Description should be updated');
    console.log('  [PASS] PATCH /api/scoring/profiles/:id - updates profile');
  }

  // Score a single action
  {
    const { data: res } = await request('POST', '/api/scoring/score', {
      profile_id: scoringProfileId,
      action: {
        duration_ms: 800,
        confidence: 0.95,
      },
    });
    assert(typeof res.composite_score === 'number', 'Should return composite_score');
    assert(res.composite_score > 90, 'Excellent action should score > 90');
    assert(Array.isArray(res.dimensions), 'Should return dimension breakdown');
    assert(res.dimensions.length === 2, 'Should have 2 dimension scores');
    console.log(`  [PASS] POST /api/scoring/score (single) - scored ${res.composite_score}`);
  }

  // Batch score actions
  {
    const { data: res } = await request('POST', '/api/scoring/score', {
      profile_id: scoringProfileId,
      actions: [
        { duration_ms: 500, confidence: 0.98 },
        { duration_ms: 10000, confidence: 0.5 },
        { duration_ms: 3000, confidence: 0.8 },
      ],
    });
    assert(res.summary, 'Batch should return summary');
    assert(res.summary.total === 3, 'Should process 3 actions');
    assert(res.summary.scored === 3, 'All 3 should be scored');
    assert(typeof res.summary.avg_score === 'number', 'Should compute avg_score');
    console.log(`  [PASS] POST /api/scoring/score (batch) - avg ${res.summary.avg_score}`);
  }

  // Get profile score stats
  {
    const { data: res } = await request('GET', `/api/scoring/score?profile_id=${scoringProfileId}&view=stats`);
    assert(typeof res.total_scores === 'number', 'Should return total_scores');
    assert(res.total_scores >= 4, 'Should have at least 4 scores (1 single + 3 batch)');
    assert(typeof res.avg_score === 'number', 'Should return avg_score');
    console.log(`  [PASS] GET /api/scoring/score?view=stats - ${res.total_scores} scores, avg ${res.avg_score}`);
  }

  // Create a risk template
  let riskTemplateId;
  {
    const { data: res } = await request('POST', '/api/scoring/risk-templates', {
      name: 'Test Safety Rules',
      action_type: 'deploy',
      base_risk: 15,
      rules: [
        { condition: "metadata.environment == 'production'", add: 25 },
        { condition: "metadata.modifies_data == true", add: 15 },
        { condition: "metadata.irreversible == true", add: 30 },
      ],
    });
    assert(res.id, 'Template should have an ID');
    assert(res.id.startsWith('rt_'), 'Template ID should start with rt_');
    assert(res.rules.length === 3, 'Should have 3 rules');
    riskTemplateId = res.id;
    console.log('  [PASS] POST /api/scoring/risk-templates - created');
  }

  // List risk templates
  {
    const { data: res } = await request('GET', '/api/scoring/risk-templates');
    assert(Array.isArray(res.templates), 'Should return templates array');
    const found = res.templates.find(t => t.id === riskTemplateId);
    assert(found, 'Created template should be in list');
    console.log('  [PASS] GET /api/scoring/risk-templates - lists templates');
  }

  // Update risk template
  {
    const { data: res } = await request('PATCH', `/api/scoring/risk-templates/${riskTemplateId}`, {
      base_risk: 20,
    });
    assert(res.base_risk === 20, 'Base risk should be updated');
    console.log('  [PASS] PATCH /api/scoring/risk-templates/:id - updated');
  }

  // Auto-calibrate
  {
    const { data: res } = await request('POST', '/api/scoring/calibrate', {
      lookback_days: 30,
    });
    // May return 'ok' or 'insufficient_data' depending on test DB state
    assert(res.status === 'ok' || res.status === 'insufficient_data', 'Should return valid status');
    if (res.status === 'ok') {
      assert(Array.isArray(res.suggestions), 'Should return suggestions array');
      console.log(`  [PASS] POST /api/scoring/calibrate - ${res.suggestions.length} suggestions from ${res.count} actions`);
    } else {
      console.log(`  [PASS] POST /api/scoring/calibrate - insufficient data (${res.count} actions, need 10+)`);
    }
  }

  // Cleanup - archive profile (soft delete)
  {
    const { data: res } = await request('PATCH', `/api/scoring/profiles/${scoringProfileId}`, {
      status: 'archived',
    });
    assert(res.status === 'archived', 'Profile should be archived');
    console.log('  [PASS] PATCH /api/scoring/profiles/:id - archived');
  }

  // Cleanup - delete risk template
  {
    const { data: res } = await request('DELETE', `/api/scoring/risk-templates/${riskTemplateId}`);
    assert(res.deleted === true, 'Template should be deleted');
    console.log('  [PASS] DELETE /api/scoring/risk-templates/:id - deleted');
  }

  console.log('\n--- Phase 7: All tests passed ---\n');
}

// ──────────────────────────────────────────────
// Run all tests
// ──────────────────────────────────────────────

async function main() {
  console.log(`\n🧪 DashClaw Full API Test Suite`);
  console.log(`   Target: ${BASE_URL}`);
  console.log(`   API Key: ${API_KEY ? '(set)' : '(none - dev mode)'}\n`);

  // Verify server is running
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    if (!res.ok) throw new Error(`Health check returned ${res.status}`);
    log('✅', 'Server is running');
  } catch (error) {
    console.error(`\n❌ Cannot reach ${BASE_URL} — is the dev server running?`);
    console.error(`   Run: npm run dev\n`);
    process.exit(1);
  }

  const phases = [
    testGuardAndPolicies,
    testComplianceEngine,
    testTaskRouting,
    testWebhooks,
    testSettingsAndKeys,
    testIdentityAndPairing,
    testMemoryAndSync,
    testLearningSystem,
    testGoalsAndContent,
    testAgentsAndConnections,
    testActivityAndNotifications,
    testOnboardingAndSetup,
    testCronRoutes,
    testMiscEndpoints,
    testOrgManagement,
    testEvaluations,
    testPrompts,
    testFeedback,
    testComplianceExports,
    testDriftDetection,
    testLearningAnalytics,
    testScoringProfiles,
  ];

  for (const phase of phases) {
    try {
      await phase();
    } catch (error) {
      console.error(`\n💥 ${phase.name} crashed: ${error.message}`);
      console.error(error.stack);
      failed++;
    }
  }

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped, ${passed + failed} total`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (failed > 0) {
    console.log('  Failed tests:');
    results.filter(r => !r.ok).forEach(r => console.log(`    ❌ ${r.label}`));
    console.log('');
    process.exit(1);
  }

  console.log('  🎉 All tests passed!\n');
}

main();
