#!/usr/bin/env node
/**
 * v8.3 hosted stranger drill — the full stranger path against the LIVE
 * hosted instance, scripted: mint → key works → first governed action →
 * export workspace → import into an owned instance → teardown.
 *
 * This is the drill that would have caught the missing hosted import route
 * the day it lagged (v7.2). A drill failure is a broken ship: fix on the
 * spot, log it in the maintainer log.
 *
 * Mint rides the operator-held drill token (HOSTED_DRILL_TOKEN presented as
 * x-hosted-drill-token) because Turnstile correctly blocks scripts; the mint
 * is force-labeled source='drill' server-side, so drill traffic is excluded
 * from the reach cohort read and visible-as-drill in the funnel. Everything
 * downstream of the mint is the untouched stranger path.
 *
 * Usage:
 *   node scripts/drills/hosted-stranger.mjs
 *     [--base-url https://hosted.dashclaw.io]   (or HOSTED_DRILL_BASE_URL)
 *     [--import-url http://localhost:3000]      (or DRILL_IMPORT_BASE_URL)
 *     [--skip-import]                            (explicitly narrower drill)
 *
 * Env:
 *   HOSTED_DRILL_TOKEN        required — must match the hosted instance
 *   DRILL_IMPORT_API_KEY      admin key for the import target
 *                             (falls back to DASHCLAW_API_KEY)
 *   HOSTED_ADMIN_API_KEY      optional — admin key on the hosted instance
 *                             for teardown DELETE (else trial auto-expires)
 *
 * Exit code: 0 all steps green; 1 otherwise. Runs on bare Node 20+.
 */

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.HOSTED_DRILL_BASE_URL || 'https://hosted.dashclaw.io',
    importUrl: process.env.DRILL_IMPORT_BASE_URL || 'http://localhost:3000',
    skipImport: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base-url') args.baseUrl = argv[++i];
    else if (a.startsWith('--base-url=')) args.baseUrl = a.slice('--base-url='.length);
    else if (a === '--import-url') args.importUrl = argv[++i];
    else if (a.startsWith('--import-url=')) args.importUrl = a.slice('--import-url='.length);
    else if (a === '--skip-import') args.skipImport = true;
  }
  args.baseUrl = (args.baseUrl || '').replace(/\/$/, '');
  args.importUrl = (args.importUrl || '').replace(/\/$/, '');
  return args;
}

const steps = [];
function record(id, ok, detail) {
  steps.push({ id, ok, detail });
  console.log(`DRILL_STEP ${id} ${ok ? 'PASS' : 'FAIL'} ${detail}`);
  return ok;
}

async function jsonFetch(url, init = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON is handled by callers via .text */ }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const { baseUrl, importUrl, skipImport } = parseArgs(process.argv);
  const drillToken = process.env.HOSTED_DRILL_TOKEN || '';
  const importKey = process.env.DRILL_IMPORT_API_KEY || process.env.DASHCLAW_API_KEY || '';
  const hostedAdminKey = process.env.HOSTED_ADMIN_API_KEY || '';

  if (!drillToken) {
    console.error('FAIL: HOSTED_DRILL_TOKEN is required (the mint bypass is fail-closed without it).');
    process.exit(1);
  }
  console.log(`[drill] stranger path against ${baseUrl}${skipImport ? ' (import step explicitly skipped)' : ` -> import into ${importUrl}`}`);

  // 1. Mint — the door a stranger walks through (drill-labeled).
  const mint = await jsonFetch(`${baseUrl}/api/hosted/workspaces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hosted-drill-token': drillToken },
    body: JSON.stringify({}),
  });
  const minted = mint.status === 200 && mint.json?.api_key;
  record('mint', Boolean(minted), minted
    ? `workspace ${mint.json.workspace_id} (key prefix ${mint.json.key_prefix})`
    : `HTTP ${mint.status}: ${mint.text.slice(0, 200)}`);
  if (!minted) return finish(null, baseUrl, hostedAdminKey);

  const key = mint.json.api_key;
  const workspaceId = mint.json.workspace_id;

  // 2. The key works.
  const health = await jsonFetch(`${baseUrl}/api/health`, { headers: { 'x-api-key': key } });
  record('key-works', health.status === 200, `GET /api/health -> ${health.status}`);

  // 3. First governed action — the activation event the funnel measures.
  const action = await jsonFetch(`${baseUrl}/api/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({
      agent_id: 'smoke-drill-hosted',
      action_type: 'smoke.drill',
      declared_goal: 'v8.3 hosted stranger drill: first governed action',
    }),
  });
  record('first-action', action.status === 200 || action.status === 201,
    `POST /api/actions -> ${action.status}`);

  // 4. Export — the carry-out bundle (stamps graduation, drill bucket).
  const exp = await jsonFetch(`${baseUrl}/api/workspace/export`, { headers: { 'x-api-key': key } });
  const bundleOk = exp.status === 200 && exp.json && typeof exp.json === 'object';
  record('export', bundleOk, bundleOk
    ? `bundle exported_at ${exp.json.exported_at || '?'} (${exp.text.length} bytes)`
    : `GET /api/workspace/export -> ${exp.status}`);

  // 5. Import into an owned instance — v7.2's door, the one that lagged.
  if (skipImport) {
    record('import', true, 'SKIPPED by --skip-import (explicitly narrower drill)');
  } else if (!bundleOk) {
    record('import', false, 'no bundle to import (export failed)');
  } else if (!importKey) {
    record('import', false, 'DRILL_IMPORT_API_KEY / DASHCLAW_API_KEY not set for the import target');
  } else {
    const imp = await jsonFetch(`${importUrl}/api/workspace/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': importKey },
      body: exp.text,
    }, 120_000).catch((err) => ({ status: 0, json: null, text: String(err?.message || err) }));
    record('import', imp.status === 201,
      imp.status === 201
        ? `imported ${imp.json?.imported ?? '?'} rows (${imp.json?.skipped ?? '?'} skipped) into ${importUrl}`
        : `POST ${importUrl}/api/workspace/import -> ${imp.status}: ${imp.text.slice(0, 200)}`);
  }

  return finish(workspaceId, baseUrl, hostedAdminKey);
}

async function finish(workspaceId, baseUrl, hostedAdminKey) {
  // Teardown — best-effort; a leaked drill trial auto-expires and is
  // drill-labeled either way.
  if (workspaceId && hostedAdminKey) {
    const del = await jsonFetch(`${baseUrl}/api/hosted/workspaces/${workspaceId}`, {
      method: 'DELETE',
      headers: { 'x-api-key': hostedAdminKey },
    }).catch((err) => ({ status: 0, text: String(err?.message || err) }));
    record('teardown', del.status === 200,
      del.status === 200 ? `workspace ${workspaceId} deleted` : `DELETE -> ${del.status} (trial will auto-expire)`);
  } else if (workspaceId) {
    record('teardown', true, 'no HOSTED_ADMIN_API_KEY — drill trial left to auto-expire (drill-labeled)');
  }

  const failed = steps.filter((s) => !s.ok);
  console.log(`DRILL_VERDICT ${failed.length === 0 ? 'PASS' : 'FAIL'} ${steps.length - failed.length}/${steps.length} steps green${failed.length ? ` — first failure: ${failed[0].id}` : ''}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
