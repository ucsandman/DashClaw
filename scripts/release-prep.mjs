#!/usr/bin/env node
/**
 * release-prep.mjs <x.y.z> — the whole version-bump recipe in one command,
 * so a release can no longer ship with half of it missing.
 *
 * Both v5.15.0 and v5.16.0 shipped with a green working tree and then failed
 * CI twice each, on the two artifacts a bare `version:set` does not touch:
 * the release-plan contract and the platform guide's version-stamped
 * liveExamples. This script runs the full sequence:
 *
 *   1. version:set <x.y.z>        (manifests + release-plan, one stroke)
 *   2. npm install                (package-lock sync)
 *   3. next build                 (guide regen needs the new version built)
 *   4. next start -p 3001         (waits until /api/health reports <x.y.z>)
 *   5. regen-platform-guide-examples.mjs
 *   6. teardown of the instance
 *   7. gates: guide:drift:check, contracts:check, version:sync:check,
 *      version:check
 *
 * Prereqs: DASHCLAW_API_KEY in .env.local (guide regen), port 3001 free,
 * Python 3 on PATH (pass --skip-python to skip the sdkPython examples).
 *
 * Usage: npm run release:prep -- 5.17.0 [--skip-python]
 *
 * It does NOT write the CHANGELOG entry, rewrite release-plan reasons for
 * SDK-source releases, run the test suite, or commit — those stay editorial
 * and gated where they already are (pre-commit + CI).
 */
import { spawn, spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--'));
const skipPython = args.includes('--skip-python');
const PORT = 3001;
const BASE = `http://127.0.0.1:${PORT}`;
const HEALTH = `${BASE}/api/health`;

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version || '')) {
  console.error('Usage: npm run release:prep -- <x.y.z> [--skip-python]');
  process.exit(1);
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(label, cmd, cmdArgs, opts = {}) {
  console.log(`\n[release-prep] ${label}`);
  const res = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (res.status !== 0) {
    console.error(`[release-prep] FAILED at: ${label} (exit ${res.status})`);
    process.exit(res.status ?? 1);
  }
}

async function healthVersion() {
  try {
    const res = await fetch(HEALTH, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return (await res.json())?.version ?? null;
  } catch {
    return null;
  }
}

function killTree(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fail loudly if something else already owns the port — never kill an
// unknown process.
if (await healthVersion()) {
  console.error(
    `[release-prep] something is already serving ${HEALTH} — free port ${PORT} first.`
  );
  process.exit(1);
}

run(`version:set ${version}`, 'node', ['scripts/set-version.mjs', version]);
run('npm install (package-lock sync)', npmCmd, ['install', '--no-audit', '--no-fund']);
run('next build', npxCmd, ['next', 'build']);

console.log(`\n[release-prep] starting next start -p ${PORT} ...`);
const server = spawn(npxCmd, ['next', 'start', '-p', String(PORT)], {
  cwd: ROOT,
  stdio: 'ignore',
  shell: process.platform === 'win32',
  detached: process.platform !== 'win32',
});

let exitCode = 1;
try {
  let live = null;
  for (let i = 0; i < 24 && live !== version; i += 1) {
    await sleep(5000);
    live = await healthVersion();
  }
  if (live !== version) {
    throw new Error(
      `instance never reported version ${version} on ${HEALTH} (last saw: ${live})`
    );
  }
  console.log(`[release-prep] instance healthy at ${version}`);

  const regenArgs = ['scripts/regen-platform-guide-examples.mjs', '--base-url', BASE];
  if (skipPython) regenArgs.push('--skip-python');
  const regen = spawnSync('node', regenArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (regen.status !== 0) throw new Error(`guide regen failed (exit ${regen.status})`);
  exitCode = 0;
} catch (err) {
  console.error(`[release-prep] FAILED: ${err.message}`);
} finally {
  killTree(server.pid);
}
if (exitCode !== 0) process.exit(exitCode);

run('guide:drift:check', npmCmd, ['run', 'guide:drift:check']);
run('contracts:check', npmCmd, ['run', 'contracts:check']);
run('version:sync:check', npmCmd, ['run', 'version:sync:check']);
run('version:check', npmCmd, ['run', 'version:check']);

console.log(`
[release-prep] ${version} ready. Still yours before committing:
  - CHANGELOG.md entry for ${version}
  - release-plan reasons, IF SDK source changed this release
  - full test suite + lint (pre-commit and CI gate these)
`);
