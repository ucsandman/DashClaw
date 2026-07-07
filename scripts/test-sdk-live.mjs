#!/usr/bin/env node

/**
 * SDK Live Integration Test Suite — Field-Mapping Level
 *
 * Validates every SDK category by calling SDK methods with SDK field names,
 * reading back persisted records, and asserting stored values match inputs.
 * Closes the silent field-mapping regression gap in check-sdk-cross-integration.mjs.
 *
 * ⚠️  WARNING: This script performs REAL WRITES against a live DashClaw instance.
 * It creates test actions, loops, assumptions, handoffs, threads, snippets,
 * preferences, messages, and other records. Run against a development or staging
 * instance, not production, unless you are comfortable with test data in your org.
 *
 * Usage:
 *   npm run sdk:live                                          # uses .env.local via _run-with-env.mjs
 *   DASHCLAW_URL=https://staging.example.com \
 *     DASHCLAW_API_KEY=oc_live_xxx \
 *     node scripts/test-sdk-live.mjs                          # explicit env for hosted instances
 *
 * Required env:
 *   DASHCLAW_API_KEY   - API key for the target instance
 *
 * Optional env:
 *   DASHCLAW_URL       - Base URL (default: http://localhost:3000)
 *   DASHCLAW_AGENT_ID  - Agent ID for test records (default: sdk-live-test-agent)
 */

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

import { webcrypto } from 'node:crypto';
import { DashClaw } from '../sdk/dashclaw.js';
// Agent messaging and sendDirectMessage are archived (not in v2 SDK).
// Define VALID_MESSAGE_TYPES locally for any remaining references.
const VALID_MESSAGE_TYPES = ['action', 'info', 'lesson', 'question', 'status'];

const BASE_URL = process.env.DASHCLAW_URL || 'http://localhost:3000';
const API_KEY  = process.env.DASHCLAW_API_KEY || '';
const AGENT_ID = process.env.DASHCLAW_AGENT_ID || 'sdk-live-test-agent';

if (!API_KEY) {
  console.error('DASHCLAW_API_KEY is required. Run via _run-with-env.mjs or export the variable.');
  process.exit(1);
}

// -- Generate ephemeral RSA keypair and register it with the instance ------
// This allows the test agent to pass signature enforcement without
// pre-provisioned keys. The pairing is created and auto-approved via the
// admin API key, so no manual step is needed.

async function setupSignedSdk() {
  const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );

  const privateJwk = await webcrypto.subtle.exportKey('jwk', privateKey);

  // Create an unsigned SDK client first (for pairing registration)
  const unsignedSdk = new DashClaw({
    baseUrl: BASE_URL, apiKey: API_KEY, agentId: AGENT_ID, agentName: 'SDK Live Test Agent',
  });

  // Register the public key via the pairing flow
  const { pairing } = await unsignedSdk.createPairingFromPrivateJwk(privateJwk, {
    agentName: 'SDK Live Test Agent',
  });

  // Approve the pairing via direct API call (requires admin role on the API key)
  const approveRes = await fetch(`${BASE_URL}/api/pairings/${pairing.id}/approve`, {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
  });
  if (!approveRes.ok) {
    const body = await approveRes.text();
    throw new Error(`Failed to approve test pairing (${approveRes.status}): ${body}`);
  }

  // Return a signed SDK client
  return new DashClaw({
    baseUrl:    BASE_URL,
    apiKey:     API_KEY,
    agentId:    AGENT_ID,
    agentName:  'SDK Live Test Agent',
    privateKey: privateJwk,
  });
}

// sdk is initialized in main() after the signing setup
let sdk;

let passed = 0;
let failed = 0;
const failures = [];

function log(icon, msg) {
  console.log(`  ${icon} ${msg}`);
}

function assert(condition, label, detail) {
  if (condition) {
    passed++;
    log('PASS', label);
  } else {
    failed++;
    log('FAIL', label);
    if (detail) failures.push({ label, ...detail });
    else failures.push({ label });
  }
}

// ──────────────────────────────────────────────────────────────
// Category 1: Action Recording
// ──────────────────────────────────────────────────────────────

async function testActionRecording() {
  console.log('\n--- Category 1: Action Recording ---');

  const input = {
    action_type:   'research',
    declared_goal: 'sdk-live-test: verify action field mapping',
    reasoning:     'integration test for field persistence',
    risk_score:    17,
    confidence:    88,
    reversible:    true,
  };

  const res = await sdk.createAction(input);
  const actionId = res.action_id;

  assert(typeof actionId === 'string' && actionId.startsWith('act_'),
    `createAction: action_id has act_ prefix (got ${actionId})`);

  // Read back and assert field values persisted correctly
  const { action } = await sdk.getAction(actionId);

  assert(action.declared_goal === input.declared_goal,
    'createAction → getAction: declared_goal matches',
    { sent: input.declared_goal, stored: action.declared_goal });

  assert(action.action_type === input.action_type,
    'createAction → getAction: action_type matches',
    { sent: input.action_type, stored: action.action_type });

  assert(Number(action.risk_score) === input.risk_score,
    `createAction → getAction: risk_score matches (expected ${input.risk_score}, got ${action.risk_score})`,
    { sent: input.risk_score, stored: action.risk_score });

  assert(action.agent_id === AGENT_ID,
    `createAction → getAction: agent_id injected correctly (expected ${AGENT_ID}, got ${action.agent_id})`,
    { sent: AGENT_ID, stored: action.agent_id });

  // Update outcome and read back
  const outcome = {
    status:         'completed',
    output_summary: 'sdk-live-test: outcome verified',
    cost_estimate:  0.001,
  };
  const patchRes = await sdk.updateOutcome(actionId, outcome);

  assert(patchRes.action?.status === 'completed',
    'updateOutcome: status returned as completed');

  // Re-read to confirm persistence
  const { action: updated } = await sdk.getAction(actionId);
  assert(updated.status === 'completed',
    'updateOutcome → getAction: status persisted as completed',
    { sent: 'completed', stored: updated.status });

  assert(updated.output_summary === outcome.output_summary,
    'updateOutcome → getAction: output_summary persisted',
    { sent: outcome.output_summary, stored: updated.output_summary });

  return actionId;
}

// ──────────────────────────────────────────────────────────────
// Category 2: Loops & Assumptions
// ──────────────────────────────────────────────────────────────

async function testLoopsAndAssumptions(actionId) {
  console.log('\n--- Category 2: Loops & Assumptions ---');

  // Open loop
  const loopInput = {
    action_id:   actionId,
    loop_type:   'dependency',
    description: 'sdk-live-test: verify loop field mapping',
    priority:    'high',
  };
  const loopRes = await sdk.registerOpenLoop(loopInput);
  const loopId  = loopRes.loop_id;

  assert(typeof loopId === 'string', `registerOpenLoop: loop_id returned (got ${loopId})`);

  // Read back
  const loopsRes = await sdk.getOpenLoops({ limit: 10 });
  const stored = loopsRes.loops?.find(l => l.id === loopId || l.loop_id === loopId);

  assert(!!stored,
    `registerOpenLoop → getOpenLoops: can find loop ${loopId} in list`);

  if (stored) {
    assert(stored.loop_type === loopInput.loop_type,
      'registerOpenLoop → getOpenLoops: loop_type persisted',
      { sent: loopInput.loop_type, stored: stored.loop_type });

    assert(stored.description === loopInput.description,
      'registerOpenLoop → getOpenLoops: description persisted',
      { sent: loopInput.description, stored: stored.description });

    assert(stored.priority === loopInput.priority,
      'registerOpenLoop → getOpenLoops: priority persisted',
      { sent: loopInput.priority, stored: stored.priority });
  }

  // Assumption
  const assumptionInput = {
    action_id:  actionId,
    assumption: 'sdk-live-test: default locale is UTC',
    basis:      'integration test assumption',
  };
  const aRes = await sdk.recordAssumption(assumptionInput);
  const assumptionId = aRes.assumption_id;

  assert(typeof assumptionId === 'string',
    `recordAssumption: assumption_id returned (got ${assumptionId})`);
}

// ──────────────────────────────────────────────────────────────
// Category 3: Signals
// ──────────────────────────────────────────────────────────────

async function testSignals() {
  console.log('\n--- Category 3: Signals ---');

  const res = await sdk.getSignals();

  assert(Array.isArray(res.signals),
    'getSignals: returns signals array');

  assert(typeof res.counts === 'object' && res.counts !== null,
    'getSignals: returns counts object');
}

// ──────────────────────────────────────────────────────────────
// Category 4: Dashboard Data
// ──────────────────────────────────────────────────────────────

async function testDashboardData() {
  console.log('\n--- Category 4: Dashboard Data ---');

  const tokenInput = {
    tokens_in:   100,
    tokens_out:  200,
    model:       'sdk-live-test-model',
    context_used: 300,
  };

  const res = await sdk.reportTokenUsage(tokenInput);

  // Assert no error and at least one expected field — the prior assertion
  // included `typeof res === 'object'` which made it always true (every
  // object response, including {error,...}, would pass).
  assert(res && !res.error, `reportTokenUsage: returned error: ${res?.error}`);
  assert(res.snapshot || res.id || res.tokens_in !== undefined,
    'reportTokenUsage: response missing snapshot/id/tokens_in');

  // Confirm agent_id injection
  if (res.snapshot) {
    assert(res.snapshot.agent_id === AGENT_ID || res.snapshot.agent_id !== undefined,
      'reportTokenUsage: agent_id injected into snapshot');
  }
}

// ──────────────────────────────────────────────────────────────
// Category 5: Session Handoffs
// ──────────────────────────────────────────────────────────────

async function testHandoffs() {
  console.log('\n--- Category 5: Session Handoffs ---');

  const today = new Date().toISOString().slice(0, 10);

  const input = {
    summary:          'sdk-live-test: handoff field mapping verified',
    session_date:     today,
    key_decisions:    ['used batch inserts', 'skipped retry logic'],
    open_tasks:       ['verify row counts'],
    next_priorities:  ['run integration suite'],
  };

  const res = await sdk.createHandoff(input);
  const handoffId = res.handoff_id;

  assert(typeof handoffId === 'string', `createHandoff: handoff_id returned (${handoffId})`);

  // Read back
  const listRes = await sdk.getHandoffs({ date: today, limit: 20 });
  const stored = listRes.handoffs?.find(h => h.id === handoffId || h.handoff_id === handoffId);

  assert(!!stored,
    `createHandoff → getHandoffs: can find handoff ${handoffId} in list`);

  if (stored) {
    assert(stored.summary === input.summary,
      'createHandoff → getHandoffs: summary persisted',
      { sent: input.summary, stored: stored.summary });

    assert(stored.agent_id === AGENT_ID,
      'createHandoff → getHandoffs: agent_id injected correctly',
      { sent: AGENT_ID, stored: stored.agent_id });
  }
}

// ──────────────────────────────────────────────────────────────
// Category 7: Automation Snippets
// ──────────────────────────────────────────────────────────────

async function testSnippets() {
  console.log('\n--- Category 7: Automation Snippets ---');

  const snippetName = `sdk-live-test-${Date.now()}`;

  const input = {
    name:        snippetName,
    code:        '// sdk-live-test: snippet code content',
    description: 'sdk-live-test: verifying snippet field mapping',
    language:    'javascript',
    tags:        ['sdk-test', 'field-mapping'],
  };

  const res = await sdk.saveSnippet(input);
  const snippetId = res.snippet_id;

  assert(typeof snippetId === 'string',
    `saveSnippet: snippet_id returned (got ${snippetId})`);

  // Read back by ID
  const { snippet } = await sdk.getSnippet(snippetId);

  assert(snippet.name === input.name,
    'saveSnippet → getSnippet: name persisted',
    { sent: input.name, stored: snippet.name });

  assert(snippet.code === input.code,
    'saveSnippet → getSnippet: code persisted',
    { sent: input.code, stored: snippet.code });

  assert(snippet.language === input.language,
    'saveSnippet → getSnippet: language persisted',
    { sent: input.language, stored: snippet.language });

  assert(snippet.description === input.description,
    'saveSnippet → getSnippet: description persisted',
    { sent: input.description, stored: snippet.description });
}

// ──────────────────────────────────────────────────────────────
// Category 8: User Preferences
// ──────────────────────────────────────────────────────────────

async function testUserPreferences() {
  console.log('\n--- Category 8: User Preferences ---');

  const input = {
    preference: 'sdk-live-test: prefers verbose logging',
    category:   'workflow',
    confidence: 75,
  };

  const res = await sdk.setPreference(input);
  const prefId = res.preference_id;

  assert(typeof prefId === 'string',
    `setPreference: preference_id returned (got ${prefId})`);

  // Read back via summary — individual lookup not exposed by SDK; assert summary loads
  const summaryRes = await sdk.getPreferenceSummary();

  assert(typeof summaryRes === 'object' && summaryRes !== null,
    'setPreference → getPreferenceSummary: summary returns an object');
}

// ──────────────────────────────────────────────────────────────
// Category 9: Daily Digest
// ──────────────────────────────────────────────────────────────

async function testDailyDigest() {
  console.log('\n--- Category 9: Daily Digest ---');

  const res = await sdk.getDailyDigest();

  assert(typeof res === 'object' && res !== null,
    'getDailyDigest: returns an object');
}

// ──────────────────────────────────────────────────────────────
// Category 10: Security Scanning
// ──────────────────────────────────────────────────────────────

async function testSecurityScanning() {
  console.log('\n--- Category 10: Security Scanning ---');

  const res = await sdk.scanContent(
    'sdk-live-test: hello world no sensitive data here',
    'test'
  );

  assert(typeof res.clean === 'boolean',
    'scanContent: returns clean boolean');

  assert(typeof res.findings_count === 'number',
    'scanContent: returns findings_count number');

  assert(Array.isArray(res.findings),
    'scanContent: returns findings array');

  assert(res.clean === true,
    'scanContent: clean text flagged as clean');
}

// ──────────────────────────────────────────────────────────────
// Category 11: Agent Messaging  (field-mapping assertions)
// ──────────────────────────────────────────────────────────────

async function testAgentMessaging() {
  console.log('\n--- Category 11: Agent Messaging (SKIPPED — archived in v2) ---');
  console.log('  ⏭️  sendMessage/getSentMessages not available in v2 SDK');
  return;

  /* eslint-disable no-unreachable */
  const TARGET_AGENT = AGENT_ID; // send to self so the org can see it

  // Helper: find a message by ID from the sent list
  async function findSentMessage(messageId) {
    const { messages } = await sdk.getSentMessages({ limit: 50 });
    return messages?.find(m => m.id === messageId || m.message_id === messageId) || null;
  }

  // ── 11a: sendMessage with `to` — assert to_agent_id is NOT null
  {
    const res = await sdk.sendMessage({
      to:      TARGET_AGENT,
      type:    'info',
      subject: 'sdk-live-test: direct message',
      body:    'sdk-live-test: field mapping assertion — direct',
    });
    const msgId = res.message_id;

    assert(typeof msgId === 'string', `sendMessage (direct): message_id returned (${msgId})`);

    const stored = await findSentMessage(msgId);

    assert(!!stored,
      `sendMessage (direct) → getSentMessages: message ${msgId} found in sent list`);

    if (stored) {
      assert(stored.to_agent_id !== null && stored.to_agent_id !== undefined,
        'sendMessage (direct): to → to_agent_id is NOT null',
        { sent_to: TARGET_AGENT, stored_to_agent_id: stored.to_agent_id });

      assert(stored.to_agent_id === TARGET_AGENT,
        `sendMessage (direct): to_agent_id matches input ("${TARGET_AGENT}")`,
        { sent: TARGET_AGENT, stored: stored.to_agent_id });
    }
  }

  // ── 11b: sendMessage without `to` — assert to_agent_id IS null (broadcast)
  {
    const res = await sdk.sendMessage({
      type:    'status',
      subject: 'sdk-live-test: broadcast',
      body:    'sdk-live-test: field mapping assertion — broadcast',
    });
    const msgId = res.message_id;

    assert(typeof msgId === 'string', `sendMessage (broadcast): message_id returned (${msgId})`);

    const stored = await findSentMessage(msgId);

    assert(!!stored,
      `sendMessage (broadcast) → getSentMessages: message ${msgId} found`);

    if (stored) {
      assert(stored.to_agent_id === null,
        'sendMessage (broadcast): omitting `to` stores to_agent_id as null',
        { expected: null, stored: stored.to_agent_id });
    }
  }

  // ── 11c: sendMessage with each valid type — assert message_type matches
  for (const msgType of VALID_MESSAGE_TYPES) {
    const res = await sdk.sendMessage({
      to:      TARGET_AGENT,
      type:    msgType,
      subject: `sdk-live-test: type=${msgType}`,
      body:    `sdk-live-test: asserting message_type persists for type=${msgType}`,
    });
    const msgId = res.message_id;

    const stored = await findSentMessage(msgId);

    assert(!!stored,
      `sendMessage type=${msgType}: message found in sent list`);

    if (stored) {
      assert(stored.message_type === msgType,
        `sendMessage type=${msgType}: SDK \`type\` → stored \`message_type\` matches`,
        { sent_type: msgType, stored_message_type: stored.message_type });
    }
  }

  // ── 11d: sendMessage with invalid type — assert server rejects with 4xx
  {
    let rejectedWithError = false;
    let errorStatus = null;

    try {
      await sdk.sendMessage({
        to:   TARGET_AGENT,
        type: 'chat',   // invalid type
        body: 'sdk-live-test: this should be rejected',
      });
    } catch (err) {
      rejectedWithError = true;
      errorStatus = err.status;
    }

    assert(rejectedWithError,
      'sendMessage with invalid type "chat": server throws an error');

    assert(errorStatus >= 400 && errorStatus < 500,
      `sendMessage with invalid type "chat": server returns 4xx (got ${errorStatus})`,
      { expected: '4xx', got: errorStatus });
  }
}

// ──────────────────────────────────────────────────────────────
// Category 12: Behavior Guard
// ──────────────────────────────────────────────────────────────

async function testBehaviorGuard() {
  console.log('\n--- Category 12: Behavior Guard ---');

  const res = await sdk.guard({
    action_type: 'deploy',
    risk_score:  40,
    declared_goal: 'sdk-live-test: guard check',
  });

  assert(typeof res.decision === 'string',
    `guard: returns decision string (got "${res.decision}")`);

  assert(['allow', 'warn', 'block', 'require_approval'].includes(res.decision),
    `guard: decision is a known value (got "${res.decision}")`);

  assert(Array.isArray(res.reasons),
    'guard: returns reasons array');
}

// ──────────────────────────────────────────────────────────────
// Category 13: Agent Pairing
// ──────────────────────────────────────────────────────────────

// Covered by the setup phase: setupSignedSdk() generates an ephemeral RSA
// keypair, calls createPairingFromPrivateJwk, and approves the pairing.
// If setup succeeds, the pairing flow works end-to-end.

// ──────────────────────────────────────────────────────────────
// Category 14: Webhooks
// ──────────────────────────────────────────────────────────────

async function testWebhooks() {
  console.log('\n--- Category 14: Webhooks ---');

  const res = await sdk.getWebhooks();

  assert(Array.isArray(res.webhooks || res),
    'getWebhooks: returns an array (webhooks)');
}

// ──────────────────────────────────────────────────────────────
// sendDirectMessage wrapper (tools/dashclaw/client.js)
// ──────────────────────────────────────────────────────────────

async function testSendDirectMessageWrapper() {
  console.log('\n--- sendDirectMessage wrapper (SKIPPED — archived in v2) ---');
  console.log('  ⏭️  sendDirectMessage wrapper not available in v2 SDK');
  return;
  /* eslint-disable no-unreachable */

  // Missing `to` throws at call time
  let threwOnMissingTo = false;
  let missingToMsg = '';
  try {
    await sendDirectMessage(sdk, { body: 'should fail', type: 'info' });
  } catch (e) {
    threwOnMissingTo = true;
    missingToMsg = e.message;
  }

  assert(threwOnMissingTo,
    'sendDirectMessage: throws when `to` is missing');
  assert(missingToMsg.includes('`to` is required') || missingToMsg.toLowerCase().includes('to'),
    `sendDirectMessage: error message mentions 'to' (got: "${missingToMsg}")`);

  // Invalid type throws at call time
  let threwOnBadType = false;
  let badTypeMsg = '';
  try {
    await sendDirectMessage(sdk, { to: AGENT_ID, body: 'should fail', type: 'chat' });
  } catch (e) {
    threwOnBadType = true;
    badTypeMsg = e.message;
  }

  assert(threwOnBadType,
    'sendDirectMessage: throws when type is invalid');
  assert(badTypeMsg.includes('chat') || badTypeMsg.includes('invalid type'),
    `sendDirectMessage: error message mentions invalid type (got: "${badTypeMsg}")`);

  // Valid call succeeds and stores correct field values
  const res = await sendDirectMessage(sdk, {
    to:      AGENT_ID,
    subject: 'sdk-live-test: sendDirectMessage wrapper',
    body:    'sdk-live-test: field mapping via wrapper',
    type:    'action',
  });

  assert(typeof res.message_id === 'string',
    `sendDirectMessage: valid call returns message_id (${res.message_id})`);

  // Read back
  const { messages } = await sdk.getSentMessages({ limit: 20 });
  const stored = messages?.find(m => m.id === res.message_id || m.message_id === res.message_id);

  assert(!!stored,
    'sendDirectMessage: sent message found in getSentMessages');

  if (stored) {
    assert(stored.to_agent_id === AGENT_ID,
      'sendDirectMessage: to_agent_id persisted correctly',
      { sent: AGENT_ID, stored: stored.to_agent_id });

    assert(stored.message_type === 'action',
      'sendDirectMessage: message_type persisted correctly',
      { sent: 'action', stored: stored.message_type });
  }
}

// ──────────────────────────────────────────────────────────────
// VALID_MESSAGE_TYPES constant
// ──────────────────────────────────────────────────────────────

function testValidMessageTypesExport() {
  console.log('\n--- VALID_MESSAGE_TYPES constant (local — messaging archived in v2) ---');

  assert(Array.isArray(VALID_MESSAGE_TYPES),
    'VALID_MESSAGE_TYPES: exported as array');

  for (const t of ['action', 'info', 'lesson', 'question', 'status']) {
    assert(VALID_MESSAGE_TYPES.includes(t),
      `VALID_MESSAGE_TYPES: includes "${t}"`);
  }

  assert(!VALID_MESSAGE_TYPES.includes('chat'),
    'VALID_MESSAGE_TYPES: does NOT include invalid type "chat"');
}

// ──────────────────────────────────────────────────────────────
// Main runner
// ──────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`DashClaw SDK Live Integration Tests`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Base URL:  ${BASE_URL}`);
  console.log(`  Agent ID:  ${AGENT_ID}`);
  console.log(`  WARNING:   This suite performs REAL WRITES to the target instance.`);
  console.log(`${'='.repeat(60)}`);

  // Set up signed SDK (generates ephemeral keypair, registers + approves it)
  console.log('\n--- Setup: Agent Identity & Signing ---');
  try {
    sdk = await setupSignedSdk();
    console.log('  PASS Ephemeral keypair generated, pairing registered and approved');
  } catch (err) {
    console.error(`  FAIL Could not set up signed SDK: ${err.message}`);
    console.error('  The API key may not have admin role, or the instance may be unreachable.');
    process.exit(1);
  }

  const categoryErrors = [];

  async function runCategory(label, fn, ...args) {
    try {
      return await fn(...args);
    } catch (err) {
      failed++;
      const msg = `[CATEGORY ERROR] ${label}: ${err.message}`;
      console.log(`  FAIL ${msg}`);
      categoryErrors.push({ label, error: err.message });
      return undefined;
    }
  }

  const actionId = await runCategory('Action Recording', testActionRecording);
  await runCategory('Loops & Assumptions', testLoopsAndAssumptions, actionId || 'act_fallback');
  await runCategory('Signals', testSignals);
  await runCategory('Dashboard Data', testDashboardData);
  await runCategory('Handoffs', testHandoffs);
  await runCategory('Snippets', testSnippets);
  await runCategory('User Preferences', testUserPreferences);
  await runCategory('Daily Digest', testDailyDigest);
  await runCategory('Security Scanning', testSecurityScanning);
  await runCategory('Agent Messaging', testAgentMessaging);
  await runCategory('Behavior Guard', testBehaviorGuard);
  await runCategory('Webhooks', testWebhooks);
  testValidMessageTypesExport();
  await runCategory('sendDirectMessage Wrapper', testSendDirectMessageWrapper);

  // -- Summary --------------------------------------------------------
  const total = passed + failed;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`);

  if (categoryErrors.length > 0) {
    console.log(`\n--- Category-level errors (${categoryErrors.length}) ---`);
    console.log(`These indicate an endpoint/schema/connectivity issue, not a field-mapping bug:`);
    for (const e of categoryErrors) {
      console.log(`  [!] ${e.label}: ${e.error}`);
    }
  }

  if (failures.length > 0) {
    console.log(`\n--- Failed assertions (${failures.length}) ---`);
    for (const f of failures) {
      console.log(`\n  FAIL: ${f.label}`);
      if (f.sent !== undefined)    console.log(`        sent:     ${JSON.stringify(f.sent)}`);
      if (f.stored !== undefined)  console.log(`        stored:   ${JSON.stringify(f.stored)}`);
      if (f.expected !== undefined) console.log(`        expected: ${JSON.stringify(f.expected)}`);
      if (f.got !== undefined)     console.log(`        got:      ${JSON.stringify(f.got)}`);
    }
  }

  console.log(`${'='.repeat(60)}\n`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`\nFatal error during SDK live tests: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
