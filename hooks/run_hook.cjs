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
const path = require('node:path');

function resolvePython() {
  for (const cmd of ['python3', 'python']) {
    // The Windows Store `python3` alias exits non-zero without running
    // anything, so a successful --version is required, not just spawnability.
    const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) return cmd;
  }
  return null;
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

const result = spawnSync(python, [path.join(__dirname, script), ...process.argv.slice(3)], {
  stdio: 'inherit',
});
process.exit(result.status === null ? 0 : result.status);
