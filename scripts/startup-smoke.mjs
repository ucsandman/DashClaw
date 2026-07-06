#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
  assertPortAvailable,
  createStartServerSpawnConfig,
  shutdownChildProcess,
  waitForConfiguredSetup,
} from './lib/startup-smoke.mjs';

// Operator key for the in-process doctor gate: env wins (CI); .env.local is the
// local-dev fallback (same precedence the child smoke scripts use themselves).
function resolveOperatorKey() {
  if (process.env.DASHCLAW_API_KEY) return process.env.DASHCLAW_API_KEY;
  try {
    const envFile = readFileSync('.env.local', 'utf8');
    const m = envFile.match(/^DASHCLAW_API_KEY=(.*)$/m);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  } catch {
    // no .env.local — caller treats a missing key as "skip"
  }
  return null;
}

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.STARTUP_SMOKE_BASE_URL || 'http://127.0.0.1:3100',
    timeoutMs: Number(process.env.STARTUP_SMOKE_TIMEOUT_MS || 45000),
    intervalMs: Number(process.env.STARTUP_SMOKE_INTERVAL_MS || 1000),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base-url') options.baseUrl = argv[i + 1];
    if (arg === '--timeout-ms') options.timeoutMs = Number(argv[i + 1]);
    if (arg === '--interval-ms') options.intervalMs = Number(argv[i + 1]);
  }

  return options;
}

function getPortFromBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

function createLogBuffer(limit = 200) {
  const lines = [];
  return {
    push(chunk) {
      const text = String(chunk || '').trim();
      if (!text) return;
      for (const line of text.split(/\r?\n/)) {
        lines.push(line);
        if (lines.length > limit) lines.shift();
      }
    },
    toString() {
      return lines.join('\n');
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const setupStatusUrl = `${options.baseUrl.replace(/\/$/, '')}/api/setup/status`;
  const port = getPortFromBaseUrl(options.baseUrl);

  try {
    await assertPortAvailable(port);
  } catch (error) {
    console.error(`[startup-smoke] ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const startServer = createStartServerSpawnConfig({ port });
  const child = spawn(startServer.command, startServer.args, startServer.options);

  const stdoutBuffer = createLogBuffer();
  const stderrBuffer = createLogBuffer();
  let childExited = false;
  let exitCode = null;
  let resolveExit;
  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve;
  });

  child.stdout?.on('data', (chunk) => {
    stdoutBuffer.push(chunk);
  });

  child.stderr?.on('data', (chunk) => {
    stderrBuffer.push(chunk);
  });

  child.on('close', (code) => {
    childExited = true;
    exitCode = code;
    resolveExit(code);
  });

  try {
    const result = await waitForConfiguredSetup({
      url: setupStatusUrl,
      timeoutMs: options.timeoutMs,
      intervalMs: options.intervalMs,
      shouldAbort: () => childExited,
    });

    console.log(`[startup-smoke] configured: ${result.message || 'setup status is ready'}`);

    // With the server already up, prove policy ENFORCEMENT, not just boot:
    // scripts/policy-smoke.mjs runs 25 live governance-loop checks with real
    // policies (see docs/plans/2026-07-01-explain-claims-audit.md). Needs an
    // operator key; skipped when absent or explicitly opted out.
    if (process.env.STARTUP_SMOKE_SKIP_POLICY === '1') {
      console.log('[startup-smoke] policy smoke skipped (STARTUP_SMOKE_SKIP_POLICY=1)');
    } else if (!process.env.DASHCLAW_API_KEY && !existsSync('.env.local')) {
      console.log('[startup-smoke] policy smoke skipped (no DASHCLAW_API_KEY in env and no .env.local)');
    } else {
      console.log('[startup-smoke] running policy smoke...');
      const policyExit = await new Promise((resolvePolicy) => {
        const policyChild = spawn(
          process.execPath,
          ['scripts/policy-smoke.mjs', options.baseUrl],
          { stdio: 'inherit', env: process.env },
        );
        policyChild.on('close', (code) => resolvePolicy(code));
        policyChild.on('error', () => resolvePolicy(1));
      });
      if (policyExit !== 0) {
        throw new Error(`policy smoke failed with exit code ${policyExit}`);
      }
      console.log('[startup-smoke] policy smoke passed');
    }

    // Cross-org isolation: scripts/cross-org-smoke.mjs seeds two run-unique
    // orgs with DB-minted keys and proves neither can touch the other's
    // governance resources. Needs DATABASE_URL (direct seeding); skipped when
    // absent or explicitly opted out.
    if (process.env.STARTUP_SMOKE_SKIP_CROSS_ORG === '1') {
      console.log('[startup-smoke] cross-org smoke skipped (STARTUP_SMOKE_SKIP_CROSS_ORG=1)');
    } else if (!process.env.DATABASE_URL && !existsSync('.env.local')) {
      console.log('[startup-smoke] cross-org smoke skipped (no DATABASE_URL in env and no .env.local)');
    } else {
      console.log('[startup-smoke] running cross-org isolation smoke...');
      const crossOrgExit = await new Promise((resolveCrossOrg) => {
        const crossOrgChild = spawn(
          process.execPath,
          ['scripts/cross-org-smoke.mjs', options.baseUrl],
          { stdio: 'inherit', env: process.env },
        );
        crossOrgChild.on('close', (code) => resolveCrossOrg(code));
        crossOrgChild.on('error', () => resolveCrossOrg(1));
      });
      if (crossOrgExit !== 0) {
        throw new Error(`cross-org isolation smoke failed with exit code ${crossOrgExit}`);
      }
      console.log('[startup-smoke] cross-org isolation smoke passed');
    }

    // Write-path canary: the doctor performs REAL writes through the real
    // repository writers (heartbeat, action ledger, guard audit) against the
    // isolated canary org. On a fresh schema a dead write path — the
    // silent-death bug class — is a FAIL here, which 503s and fails the job.
    const operatorKey = resolveOperatorKey();
    if (process.env.STARTUP_SMOKE_SKIP_CANARY === '1') {
      console.log('[startup-smoke] write-canary gate skipped (STARTUP_SMOKE_SKIP_CANARY=1)');
    } else if (!operatorKey) {
      console.log('[startup-smoke] write-canary gate skipped (no DASHCLAW_API_KEY in env and no .env.local)');
    } else {
      console.log('[startup-smoke] running doctor write-path canary...');
      const res = await fetch(`${options.baseUrl.replace(/\/$/, '')}/api/doctor?category=write-canary`, {
        headers: { 'x-api-key': operatorKey },
      });
      const doctor = await res.json().catch(() => null);
      const checks = doctor?.checks || [];
      const failed = checks.filter((c) => c.status === 'fail');
      if (!res.ok || failed.length > 0) {
        throw new Error(
          `write-path canary failed (http ${res.status}): ` +
          (failed.map((c) => `${c.id}: ${c.message || c.title || c.status}`).join('; ') || JSON.stringify(doctor)),
        );
      }
      if (checks.length === 0) {
        throw new Error('write-path canary returned zero checks — category missing from the doctor engine?');
      }
      console.log(`[startup-smoke] write-path canary passed (${checks.length} checks)`);
    }
  } catch (error) {
    console.error(`[startup-smoke] ${error.message}`);
    if (stdoutBuffer.toString()) {
      console.error('[startup-smoke] server stdout:');
      console.error(stdoutBuffer.toString());
    }
    if (stderrBuffer.toString()) {
      console.error('[startup-smoke] server stderr:');
      console.error(stderrBuffer.toString());
    }
    if (childExited) {
      console.error(`[startup-smoke] server exited early with code ${exitCode}`);
    }
    process.exitCode = 1;
  } finally {
    await shutdownChildProcess({
      child,
      hasExited: () => childExited,
      exitPromise,
      isDetached: startServer.options.detached === true,
    });
  }
}

await main();
