#!/usr/bin/env node
// Post-deploy smoke test for hosted provisioning.
// Usage: node scripts/smoke-hosted.mjs --base-url https://hosted.example.com
//
// What it does:
//   1. POST /api/hosted/workspaces → expect 200 + api_key
//   2. GET  /api/health with the api_key → expect 200
//   3. Clean up by nothing — trial workspaces auto-expire (sweeper handles them)
//      OR (if admin DASHCLAW_API_KEY provided) DELETE /api/hosted/workspaces/:id
//
// Exits 0 on success, 1 on failure.
//
// PROD CAVEAT: this script sends no turnstile_token, so against a production
// instance with TURNSTILE_SECRET_KEY set, step 1 is *expected* to fail closed
// with 400 "turnstile verification failed: missing_token". That is the bot
// gate working, not a deploy problem — smoke production via the browser mint
// on /connect instead (HOSTED_TRIAL_RUNBOOK.md §3). The full scripted sweep
// only passes against instances without TURNSTILE_SECRET_KEY (local/preview,
// where verification is bypassed) or with Cloudflare's always-pass test keys.

function parseArgs(argv) {
  const args = { baseUrl: null, adminKey: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base-url') args.baseUrl = argv[++i];
    else if (a === '--admin-key') args.adminKey = argv[++i];
    else if (a.startsWith('--base-url=')) args.baseUrl = a.slice('--base-url='.length);
    else if (a.startsWith('--admin-key=')) args.adminKey = a.slice('--admin-key='.length);
  }
  args.baseUrl = args.baseUrl || process.env.HOSTED_SMOKE_BASE_URL || '';
  args.adminKey = args.adminKey || process.env.DASHCLAW_API_KEY || '';
  return args;
}

async function main() {
  const { baseUrl, adminKey } = parseArgs(process.argv);
  if (!baseUrl) {
    console.error('FAIL: --base-url or HOSTED_SMOKE_BASE_URL required');
    process.exitCode = 1; return;
  }
  const base = baseUrl.replace(/\/$/, '');

  // Step 1: provision
  console.log(`[smoke] POST ${base}/api/hosted/workspaces`);
  const provisionRes = await fetch(`${base}/api/hosted/workspaces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (provisionRes.status !== 200) {
    const body = await provisionRes.text();
    console.error(`FAIL: provision returned ${provisionRes.status}\n${body}`);
    if (provisionRes.status === 400 && /turnstile/i.test(body)) {
      console.error(
        '[smoke] NOTE: this is expected against production — the script sends no ' +
        'turnstile_token and the instance enforces Turnstile (fail-closed). ' +
        'Smoke production via the browser mint on /connect instead (runbook §3).',
      );
    }
    process.exitCode = 1; return;
  }
  const provisioned = await provisionRes.json();
  console.log(`[smoke] provisioned workspace=${provisioned.workspace_id}, api_key prefix=${provisioned.key_prefix}`);

  // Step 2: use the key
  console.log(`[smoke] GET ${base}/api/health with provisioned key`);
  const healthRes = await fetch(`${base}/api/health`, {
    headers: { 'x-api-key': provisioned.api_key },
  });
  if (healthRes.status !== 200) {
    console.error(`FAIL: /api/health returned ${healthRes.status}`);
    process.exitCode = 1; return;
  }
  console.log('[smoke] /api/health OK');

  // Step 3: cleanup (best-effort, admin only)
  if (adminKey) {
    console.log(`[smoke] DELETE ${base}/api/hosted/workspaces/${provisioned.workspace_id}`);
    const delRes = await fetch(`${base}/api/hosted/workspaces/${provisioned.workspace_id}`, {
      method: 'DELETE',
      headers: { 'x-api-key': adminKey },
    });
    if (delRes.status !== 200) {
      console.warn(`WARN: cleanup returned ${delRes.status} — trial will auto-expire`);
    } else {
      console.log('[smoke] cleanup OK');
    }
  } else {
    console.log('[smoke] no admin key provided; trial will auto-expire');
  }

  console.log('[smoke] PASS');
  process.exitCode = 0; return;
}

main().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exitCode = 1; return;
});
