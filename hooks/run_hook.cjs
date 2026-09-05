#!/usr/bin/env node
// DashClaw hook launcher.
//
// Resolves a working Python interpreter (python3 first, then python) and runs
// the named hook script from this directory with stdin/stdout/stderr passed
// through and the exit code mirrored.
//
// Why this exists: the plugin's hooks.json is static, so it cannot know
// whether the host has `python` (Windows) or only `python3` (macOS, most
// Linux). A `python3 X || python X` one-liner is NOT safe — a guard block
// exits 2, which `||` treats as failure and re-runs the hook (double guard
// call, double action record). Node is always present (Claude Code runs on
// it), so this shim probes once per invocation and runs the script exactly
// once.
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The `--version` probe is a whole extra process per tool call (two when
// `python3` is the Windows Store alias), on top of the hook itself. Remember
// the answer for a day; a stale entry (interpreter uninstalled) is detected
// by the real spawn's ENOENT below and re-probed on the spot.
const PYTHON_CACHE_FILE = path.join(os.tmpdir(), 'dashclaw-run-hook-python.txt');
const PYTHON_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function readCachedPython() {
  try {
    const st = fs.statSync(PYTHON_CACHE_FILE);
    if (Date.now() - st.mtimeMs > PYTHON_CACHE_TTL_MS) return null;
    const cmd = fs.readFileSync(PYTHON_CACHE_FILE, 'utf8').trim();
    return cmd === 'python3' || cmd === 'python' ? cmd : null;
  } catch {
    return null;
  }
}

function probePython() {
  for (const cmd of ['python3', 'python']) {
    // The Windows Store `python3` alias exits non-zero without running
    // anything, so a successful --version is required, not just spawnability.
    const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) {
      try { fs.writeFileSync(PYTHON_CACHE_FILE, cmd); } catch { /* cache is best-effort */ }
      return cmd;
    }
  }
  return null;
}

function resolvePython() {
  return readCachedPython() || probePython();
}

const script = process.argv[2];
if (!script || script.includes('/') || script.includes('\\') || script.includes('..')) {
  console.error('[DashClaw] run_hook.cjs: expected a hook script filename argument');
  process.exit(0); // never break the user's tool call over launcher misuse
}

const python = resolvePython();
if (!python) {
  console.error('[DashClaw] No python3 or python found on PATH — governance hook skipped for this call.');
  process.exit(0); // proceed-with-notice: do not hard-block tool calls on a missing interpreter
}

const hookArgs = [path.join(__dirname, script), ...process.argv.slice(3)];
let result = spawnSync(python, hookArgs, { stdio: 'inherit' });
if (result.error && result.error.code === 'ENOENT') {
  // Cached interpreter vanished — re-probe once, run exactly once.
  try { fs.unlinkSync(PYTHON_CACHE_FILE); } catch { /* already gone */ }
  const fresh = probePython();
  if (!fresh) {
    console.error('[DashClaw] No python3 or python found on PATH — governance hook skipped for this call.');
    process.exit(0);
  }
  result = spawnSync(fresh, hookArgs, { stdio: 'inherit' });
}
process.exit(result.status === null ? 0 : result.status);
