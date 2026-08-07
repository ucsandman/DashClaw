#!/usr/bin/env node
/**
 * regen-platform-guide-examples.mjs — re-captures the platform guide's liveExamples
 * against a running local instance and rewrites public/guides/platform-guide-data.json.
 *
 * The guide's 421 catalog items (areas) are inventory-derived and gated by
 * check-platform-guide-drift.mjs; this script only refreshes the captured
 * request/response examples (http / mcp / sdkNode / sdkPython), meta.generatedAt,
 * and meta.counts. Run it when the drift check reports the captured examples are
 * stale (their /api/health version has fallen behind package.json).
 *
 * Prereqs: a built instance running locally (npx next build && npx next start -p 3001)
 * and DASHCLAW_API_KEY in .env.local. Python 3 on PATH for the sdkPython examples
 * (skip with --skip-python).
 *
 * Usage: node scripts/regen-platform-guide-examples.mjs [--base-url http://localhost:3001] [--skip-python]
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argVal = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = argVal('--base-url', 'http://localhost:3001');
const SKIP_PY = args.includes('--skip-python');
const TRUNC = 4000;
const today = new Date().toISOString().slice(0, 10);
const AGENT = 'guide-capture-agent';

const sanitizeText = (s) => s
  .replace(/act_gd_[a-f0-9]{8,}/g, 'act_gd_<ID>')
  .replace(/act_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, 'act_<UUID>')
  .replace(/asm_[a-f0-9-]{20,}/g, 'asm_<UUID>')
  .replace(/cap_[a-f0-9-]{20,}/g, 'cap_<UUID>')
  .replace(/gp_[a-f0-9]{8,}/g, 'gp_<ID>')
  // {8,} matches the leak scanner's threshold below — the auto-provisioned
  // self-host key id is key_<hash16>, which the old {20,} rule missed while
  // the scanner (correctly) failed closed on it.
  .replace(/key_[a-f0-9-]{8,}/g, 'key_<ID>')
  .replace(/org_[a-f0-9-]{20,}/g, 'org_<ID>')
  .replace(/C:\\\\(?:Users|Projects)\\\\[^"]+/g, 'C:\\\\<LOCAL_PATH>');

const trimCapturedLists = (obj) => {
  if (Array.isArray(obj?.policies)) {
    obj.policies = obj.policies.filter((p) => !String(p.name ?? '').startsWith('[Grant]')).slice(0, 2);
  }
  for (const k of ['actions', 'agents', 'decisions', 'signals', 'capabilities']) {
    if (Array.isArray(obj?.[k]) && obj[k].length > 2) obj[k] = obj[k].slice(0, 2);
  }
  return obj;
};

const sanitizeResponse = (raw) => {
  try {
    return sanitizeText(JSON.stringify(trimCapturedLists(JSON.parse(raw))));
  } catch {
    return sanitizeText(raw);
  }
};

const env = {};
for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
if (!env.DASHCLAW_API_KEY) {
  console.error('DASHCLAW_API_KEY missing from .env.local');
  process.exit(1);
}

// ─── HTTP examples ──────────────────────────────────────────────────────────
async function captureHttp() {
  async function call({ id, method, path, body, keyKind }) {
    const headers = {};
    if (keyKind === 'agent') headers['x-api-key'] = env.DASHCLAW_API_KEY;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    const cleanText = sanitizeResponse(text);
    const truncated = cleanText.length > TRUNC;
    // command string shown to readers — env placeholder, never the key value
    let command = `curl.exe -X ${method} "${BASE}${path}"`;
    if (keyKind === 'agent') command += ' -H "x-api-key: $env:DASHCLAW_API_KEY"';
    if (body) command += ` -H "Content-Type: application/json" -d '${JSON.stringify(body)}'`;
    return {
      entry: {
        id, method, path, command,
        request: body ? JSON.stringify(body) : '',
        status: String(res.status),
      response: truncated ? JSON.stringify({ truncated: true, excerpt: cleanText.slice(0, TRUNC) }) : cleanText,
        truncated,
        keyKind,
        capturedAt: today,
      },
      // sanitization replaces ids with placeholders — chained captures need the raw body
      raw: text,
    };
  }

  const out = [];
  const push = async (spec) => {
    const { entry: r, raw } = await call(spec);
    if (!/^2/.test(r.status)) throw new Error(`http capture ${r.id} got ${r.status}: ${r.response.slice(0, 200)}`);
    out.push(r);
    console.log(`http ${r.id}: ${r.status}${r.truncated ? ' (truncated)' : ''}`);
    return { ...r, raw };
  };

  await push({ id: 'health', method: 'GET', path: '/api/health', keyKind: 'public' });
  await push({ id: 'guard-check', method: 'POST', path: '/api/guard', keyKind: 'agent', body: { agent_id: AGENT, action_type: 'deploy', declared_goal: 'Deploy the docs site to production', risk_score: 55, tool_name: 'Bash', act: { kind: 'shell', command: 'vercel deploy --prod' } } });
  await push({ id: 'action-record', method: 'POST', path: '/api/actions', keyKind: 'agent', body: { agent_id: AGENT, action_type: 'docs', declared_goal: 'Record a real example action for the platform guide', result: 'success', risk_score: 10 } });
  const forAssumption = await push({ id: 'action-for-assumption', method: 'POST', path: '/api/actions', keyKind: 'agent', body: { agent_id: AGENT, action_type: 'research', declared_goal: 'Verify assumption flow for the platform guide', status: 'completed', risk_score: 10 } });
  const actionId = JSON.parse(forAssumption.raw).action_id;
  await push({ id: 'assumption-record', method: 'POST', path: '/api/assumptions', keyKind: 'agent', body: { agent_id: AGENT, action_id: actionId, assumption: 'Local instance is on the latest schema', confidence: 90, impact_if_wrong: 'guide examples fail' } });
  // list captures run after the writes so the guide-capture rows are what readers see
  await push({ id: 'actions-list', method: 'GET', path: '/api/actions?limit=2', keyKind: 'agent' });
  await push({ id: 'policies-list', method: 'GET', path: '/api/policies', keyKind: 'agent' });
  await push({ id: 'signals', method: 'GET', path: '/api/signals', keyKind: 'agent' });
  await push({ id: 'setup-status', method: 'GET', path: '/api/setup/status', keyKind: 'public' });
  await push({ id: 'agents-list', method: 'GET', path: '/api/agents?limit=2', keyKind: 'agent' });
  await push({ id: 'guard-decisions', method: 'GET', path: '/api/guard/decisions?limit=2', keyKind: 'agent' });

  const order = ['health', 'guard-check', 'action-record', 'actions-list', 'policies-list', 'signals', 'setup-status', 'agents-list', 'guard-decisions', 'action-for-assumption', 'assumption-record'];
  out.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return out;
}

// ─── MCP examples (repo mcp-server driven over stdio) ───────────────────────
async function captureMcp() {
  const child = spawn('node', [resolve(ROOT, 'mcp-server/bin/dashclaw-mcp.js')], {
    env: { ...process.env, DASHCLAW_URL: BASE, DASHCLAW_API_KEY: env.DASHCLAW_API_KEY, DASHCLAW_AGENT_ID: 'claude-code' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  const pending = new Map();
  child.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      } catch { /* non-JSON stdout line */ }
    }
  });
  let seq = 0;
  const rpc = (method, params) => new Promise((resolvePromise, reject) => {
    const id = ++seq;
    pending.set(id, resolvePromise);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`mcp rpc timeout: ${method}`));
      }
    }, 20000);
  });

  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'guide-capture', version: '1.0.0' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const sanitize = (s) => sanitizeText(s)
    .replace(new RegExp(BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'https://<YOUR_INSTANCE>');

  const version = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
  const verified = `live (local v${version} instance, ${today})`;
  const specs = [
    { id: 'mcp-status', tool: 'dashclaw_status', request: {} },
    { id: 'mcp-guard', tool: 'dashclaw_guard', request: { action_type: 'docs', declared_goal: 'Capture a real guard decision example for the DashClaw platform guide', risk_score: 20, tool_name: 'Write', reversible: true, target: 'app/guides/platform/page.tsx', act: { kind: 'file', file: { path: 'app/guides/platform/page.tsx', content_excerpt: 'Interactive platform guide page' } } } },
    { id: 'mcp-record', tool: 'dashclaw_record', request: { action_type: 'docs', declared_goal: 'Recorded example: building the DashClaw interactive platform guide', status: 'completed', output_summary: 'Captured live guard/record examples for the /guides/platform reference', risk_score: 10, reversible: true } },
    { id: 'mcp-decisions-recent', tool: 'dashclaw_decisions_recent', request: { limit: 2 } },
    { id: 'mcp-policies-list', tool: 'dashclaw_policies_list', request: {} },
    { id: 'mcp-capabilities-list', tool: 'dashclaw_capabilities_list', request: {} },
  ];

  const out = [];
  for (const s of specs) {
    const res = await rpc('tools/call', { name: s.tool, arguments: s.request });
    if (res.error) throw new Error(`mcp capture ${s.id} failed: ${JSON.stringify(res.error).slice(0, 200)}`);
    const text = res.result?.content?.map((c) => c.text).join('\n') ?? '';
    let response = sanitize(text);
    // list responses: drop transient [Grant] rows (they carry operator-local paths),
    // then keep the first 2 items so the example stays readable
    try {
      const obj = JSON.parse(response);
      if (Array.isArray(obj.policies)) obj.policies = obj.policies.filter((p) => !String(p.name).startsWith('[Grant]'));
      for (const k of ['policies', 'capabilities', 'decisions']) {
        if (Array.isArray(obj[k]) && obj[k].length > 2) obj[k] = obj[k].slice(0, 2);
      }
      response = JSON.stringify(obj, null, 2);
    } catch { /* non-JSON response stays as captured */ }
    out.push({ id: s.id, tool: s.tool, request: s.request, response, verified });
    console.log(`mcp ${s.id}: ok`);
  }
  child.kill();
  return out;
}

// ─── SDK examples ───────────────────────────────────────────────────────────
// list responses keep only 2 items — full get_signals captures once shipped at 68KB each
const trimLists = (obj) => {
  for (const k of ['signals', 'actions', 'decisions']) {
    if (Array.isArray(obj?.[k]) && obj[k].length > 2) obj[k] = obj[k].slice(0, 2);
  }
  return obj;
};

async function captureSdkNode() {
  const { DashClaw } = await import(pathToFileURL(resolve(ROOT, 'sdk/dashclaw.js')).href);
  const client = new DashClaw({ baseUrl: BASE, apiKey: env.DASHCLAW_API_KEY, agentId: AGENT });
  const show = (obj) => JSON.stringify(trimLists(obj), null, 2);
  const verified = `live (localhost:3001, ${today})`;
  const out = [];

  const decision = await client.guard({
    action_type: 'deploy',
    declared_goal: 'Deploy the docs site to production',
    risk_score: 55,
    act: { kind: 'shell', command: 'vercel deploy --prod' },
  });
  out.push({ id: 'sdk-guard', code: `const decision = await client.guard({\n  action_type: 'deploy',\n  declared_goal: 'Deploy the docs site to production',\n  risk_score: 55,\n  act: { kind: 'shell', command: 'vercel deploy --prod' },\n});\n// decision.decision => 'allow' | 'warn' | 'block' | 'require_approval'`, response: show(decision), verified });

  const action = await client.createAction({
    action_type: 'docs',
    declared_goal: 'Record a governed docs update',
    status: 'completed',
    output_summary: 'Updated the platform guide',
    risk_score: 10,
    reversible: true,
  });
  out.push({ id: 'sdk-create-action', code: `const action = await client.createAction({\n  action_type: 'docs',\n  declared_goal: 'Record a governed docs update',\n  status: 'completed',\n  output_summary: 'Updated the platform guide',\n  risk_score: 10,\n  reversible: true,\n});`, response: show(action), verified });

  const signals = await client.getSignals();
  out.push({ id: 'sdk-get-signals', code: `const signals = await client.getSignals();`, response: show(signals), verified });

  const pending = await client.getPendingApprovals(5);
  out.push({ id: 'sdk-pending-approvals', code: `const pending = await client.getPendingApprovals(5);`, response: show(pending), verified });

  for (const e of out) console.log(`sdkNode ${e.id}: ok`);
  return out;
}

function captureSdkPython() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('python', [resolve(ROOT, 'scripts/regen-platform-guide-examples.py'), '--base-url', BASE], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`python capture exited ${code}`));
      try {
        const out = JSON.parse(stdout);
        for (const e of out) console.log(`sdkPython ${e.id}: ok`);
        resolvePromise(out);
      } catch (err) {
        reject(new Error(`python capture returned non-JSON: ${err.message}`));
      }
    });
  });
}

// ─── Assemble ───────────────────────────────────────────────────────────────
const health = await fetch(BASE + '/api/health').then((r) => r.json()).catch(() => null);
if (!health) {
  console.error(`No instance responding at ${BASE}. Start one: npx next build && npx next start -p 3001`);
  process.exit(1);
}
console.log(`capturing against ${BASE} (v${health.version})`);

const [http, mcp, sdkNode, sdkPython] = [
  await captureHttp(),
  await captureMcp(),
  await captureSdkNode(),
  SKIP_PY ? [] : await captureSdkPython(),
];
if (SKIP_PY) console.log('sdkPython: SKIPPED (--skip-python) — existing entries kept');

const datasetPath = resolve(ROOT, 'public/guides/platform-guide-data.json');
const dataset = JSON.parse(readFileSync(datasetPath, 'utf8'));
const le = { http, mcp, sdkNode, sdkPython: SKIP_PY ? dataset.liveExamples.sdkPython : sdkPython };
// the concrete local org id has no business in a published example
dataset.liveExamples = JSON.parse(sanitizeText(JSON.stringify(le)));
dataset.meta.generatedAt = today;

const tally = { total: 0, stable: 0, beta: 0, experimental: 0, archived: 0, deprecated: 0 };
for (const area of dataset.areas) {
  for (const item of area.items) {
    if (item.status in tally) tally[item.status] += 1;
    tally.total += 1;
  }
}
dataset.meta.counts = tally;

const out = JSON.stringify(dataset, null, 2) + '\n';
// leak scan: 'ucsandman' (public GitHub/GHCR refs) is fine; a bare 'sandm' or a key/org id is not
const leaks = [];
if (out.includes(env.DASHCLAW_API_KEY)) leaks.push('API KEY VALUE');
for (const p of [/(?<!uc)sandm/gi, /wes@/gi, /org_[a-f0-9]{8}-/g, /key_[a-f0-9-]{8,}/g, /C:\\\\(?:Users|Projects)\\\\/g]) {
  const m = out.match(p);
  if (m) leaks.push(`${p}: ${[...new Set(m)].slice(0, 5).join(',')}`);
}
if (leaks.length) {
  console.error('LEAK SCAN FAILED — dataset NOT written:\n' + leaks.join('\n'));
  process.exit(1);
}

writeFileSync(datasetPath, out);
console.log(`leak scan clean; wrote ${datasetPath} (${out.length} bytes), counts ${JSON.stringify(tally)}`);
console.log('Now run: node scripts/check-platform-guide-drift.mjs');
