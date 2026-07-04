#!/usr/bin/env node
/**
 * v3.4 live-host canary — probe production as the user.
 * (docs/superpowers/plans/2026-07-04-live-host-canary.md)
 *
 * Probes the real hosts as an unauthenticated client and asserts each public
 * surface's expected contract (verified against production 2026-07-04). Two
 * probes assert auth CHALLENGES on purpose:
 *   - trial-mint-fail-closed sends NO turnstile_token and passes on the 400
 *     `missing_token` rejection — a 200 would mean a junk trial was minted.
 *   - mcp-handshake passes on the 401 + WWW-Authenticate OAuth challenge.
 *
 * Reporting: when DASHCLAW_BASE_URL + DASHCLAW_API_KEY are set, the verdict is
 * filed to POST /api/live-canary (rendered on /setup#live-canary and as a
 * posture auditability finding). The report lands in live_canary_runs only —
 * never the action/guard ledgers — so this synthetic traffic is structurally
 * excluded from posture scoring and calibration mining.
 *
 * Env:
 *   LIVE_CANARY_MARKETING_ORIGIN  (default https://www.dashclaw.io)
 *   LIVE_CANARY_HOSTED_ORIGIN     (default https://hosted.dashclaw.io)
 *   DASHCLAW_BASE_URL + DASHCLAW_API_KEY   enable reporting
 *
 * Exit code: 0 all probes passed (and report filed, if configured); 1 otherwise.
 * Runs on bare Node 20+ (global fetch); no repo dependencies.
 */

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

import { appendFileSync } from 'node:fs';

const MARKETING = (process.env.LIVE_CANARY_MARKETING_ORIGIN || 'https://www.dashclaw.io').replace(/\/$/, '');
const HOSTED = (process.env.LIVE_CANARY_HOSTED_ORIGIN || 'https://hosted.dashclaw.io').replace(/\/$/, '');
const TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 5_000;

/**
 * Probe inventory. Each `assert` receives {status, headers, text} and returns
 * null on pass or a human-readable failure detail.
 */
const PROBES = [
  {
    id: 'marketing-home',
    title: 'Marketing homepage renders with the trial CTA',
    target: `${MARKETING}/`,
    request: {},
    assert: ({ status, text }) => {
      if (status !== 200) return `expected 200, got ${status}`;
      if (!text.includes('hosted.dashclaw.io/connect')) return 'trial CTA link (hosted.dashclaw.io/connect) missing from homepage';
      return null;
    },
  },
  {
    id: 'marketing-docs',
    title: 'Docs page renders',
    target: `${MARKETING}/docs`,
    request: {},
    assert: ({ status, text }) => {
      if (status !== 200) return `expected 200, got ${status}`;
      if (!text.includes('DashClaw')) return 'docs page body missing expected content';
      return null;
    },
  },
  {
    id: 'demo-entry',
    title: 'Demo entry redirects to the live demo',
    target: `${MARKETING}/demo`,
    request: { redirect: 'manual' },
    assert: ({ status, headers }) => {
      const loc = headers.get('location') || '';
      if (status !== 307 && status !== 308) return `expected 307 redirect, got ${status}`;
      if (!loc.includes('#live-demo')) return `expected Location containing #live-demo, got "${loc}"`;
      return null;
    },
  },
  {
    id: 'demo-cookie',
    title: 'Demo cookie renders mission control (the v4.36.3 class)',
    target: `${MARKETING}/mission-control`,
    request: { redirect: 'manual', headers: { cookie: 'dashclaw_demo=1' } },
    assert: ({ status }) => (status === 200 ? null : `expected 200 with the demo cookie, got ${status}`),
  },
  {
    id: 'trial-connect',
    title: 'Hosted trial /connect renders',
    target: `${HOSTED}/connect`,
    request: {},
    assert: ({ status }) => (status === 200 ? null : `expected 200, got ${status}`),
  },
  {
    id: 'trial-mint-fail-closed',
    title: 'Trial mint reachable and Turnstile fail-closed (no junk trials)',
    target: `${HOSTED}/api/hosted/workspaces`,
    request: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'canary-probe' }),
    },
    expected5xxIsVerdict: true,
    assert: ({ status, text }) => {
      if (status === 200 || status === 201) return `got ${status} without a turnstile token — a junk trial may have been minted (Turnstile off?)`;
      if (status !== 400) return `expected 400 missing_token, got ${status}`;
      if (!text.toLowerCase().includes('turnstile')) return `400 body does not mention turnstile: ${text.slice(0, 120)}`;
      return null;
    },
  },
  {
    id: 'oauth-as-metadata',
    title: 'OAuth authorization-server discovery',
    target: `${HOSTED}/.well-known/oauth-authorization-server`,
    request: {},
    assert: ({ status, text }) => {
      if (status !== 200) return `expected 200, got ${status}`;
      try {
        const json = JSON.parse(text);
        if (!json.authorization_endpoint) return 'metadata missing authorization_endpoint';
      } catch {
        return 'response is not valid JSON';
      }
      return null;
    },
  },
  {
    id: 'oauth-resource-metadata',
    title: 'OAuth protected-resource discovery',
    target: `${HOSTED}/.well-known/oauth-protected-resource`,
    request: {},
    assert: ({ status, text }) => {
      if (status !== 200) return `expected 200, got ${status}`;
      try {
        const json = JSON.parse(text);
        if (!json.resource) return 'metadata missing resource';
      } catch {
        return 'response is not valid JSON';
      }
      return null;
    },
  },
  {
    id: 'mcp-handshake',
    title: 'Hosted MCP endpoint answers with the OAuth challenge',
    target: `${HOSTED}/api/mcp`,
    request: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'dashclaw-live-canary', version: '1' } },
      }),
    },
    assert: ({ status, headers }) => {
      if (status !== 401) return `expected 401 challenge, got ${status}`;
      const challenge = headers.get('www-authenticate') || '';
      if (!challenge.includes('resource_metadata')) return `WWW-Authenticate missing resource_metadata: "${challenge}"`;
      return null;
    },
  },
];

async function fetchOnce(target, request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target, { ...request, signal: controller.signal });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text };
  } finally {
    clearTimeout(timer);
  }
}

async function runProbe(probe) {
  const started = Date.now();
  let response = null;
  let networkError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    networkError = null;
    try {
      response = await fetchOnce(probe.target, probe.request);
    } catch (err) {
      networkError = err;
      continue; // retry network failures once
    }
    // Retry unexpected 5xx once (GH runner / edge flake guard). Probes whose
    // verdict logic already speaks to 5xx handle it in assert instead.
    if (response.status >= 500 && !probe.expected5xxIsVerdict && attempt === 0) continue;
    break;
  }
  const durationMs = Date.now() - started;
  if (!response) {
    return {
      id: probe.id, title: probe.title, status: 'fail',
      detail: `network error after retry: ${networkError?.message || networkError}`,
      durationMs, target: probe.target,
    };
  }
  const failure = probe.assert(response);
  return {
    id: probe.id, title: probe.title,
    status: failure ? 'fail' : 'pass',
    ...(failure ? { detail: failure } : {}),
    durationMs, target: probe.target,
  };
}

async function report(run) {
  const base = (process.env.DASHCLAW_BASE_URL || '').replace(/\/$/, '');
  const key = process.env.DASHCLAW_API_KEY || '';
  if (!base || !key) {
    console.log('\n[live-canary] DASHCLAW_BASE_URL / DASHCLAW_API_KEY not set — verdict not reported.');
    return true;
  }
  const res = await fetch(`${base}/api/live-canary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify(run),
  });
  if (res.status !== 201) {
    console.error(`\n[live-canary] report FAILED: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return false;
  }
  const { id } = await res.json();
  console.log(`\n[live-canary] verdict reported: ${id}`);
  return true;
}

function summarize(checks) {
  const rows = checks.map((c) =>
    `| ${c.status === 'pass' ? '✅' : '❌'} ${c.id} | ${c.status} | ${c.durationMs}ms | ${c.detail || ''} |`);
  return [
    '| probe | status | duration | detail |',
    '|---|---|---|---|',
    ...rows,
  ].join('\n');
}

const startedAt = new Date().toISOString();
console.log(`[live-canary] probing ${MARKETING} + ${HOSTED} as a real client...`);
const checks = [];
for (const probe of PROBES) {
  const result = await runProbe(probe);
  checks.push(result);
  console.log(`  ${result.status === 'pass' ? 'PASS' : 'FAIL'}  ${result.id} (${result.durationMs}ms)${result.detail ? ` — ${result.detail}` : ''}`);
}
const finishedAt = new Date().toISOString();
const failed = checks.filter((c) => c.status === 'fail');
const status = failed.length > 0 ? 'fail' : 'pass';

console.log(`\n[live-canary] ${status.toUpperCase()} — ${checks.length - failed.length}/${checks.length} probes passed.`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Live host canary — ${status.toUpperCase()}\n\n${summarize(checks)}\n`);
}

const reported = await report({ source: 'github-actions', status, checks, startedAt, finishedAt });
process.exit(failed.length > 0 || !reported ? 1 : 0);
