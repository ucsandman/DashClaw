#!/usr/bin/env node
// Fresh-machine entry-path drill (roadmap v8.3) — Windows host launcher.
//
// Proves the DISTRIBUTION path (`npx dashclaw up` resolving the published npm
// CLI + GitHub release tarball), not --source-dir, on a factory-fresh Windows
// image via Windows Sandbox. This is a MAINTAINER instrument — no product UI.
//
// Usage:
//   node scripts/drills/fresh-windows.mjs [--cli <spec>] [--timeout-min <n>] [--keep]
//
//   --cli          npm package spec for the CLI, e.g. @dashclaw/cli@latest (default)
//                   or @dashclaw/cli@0.7.2 to seed a known-broken version.
//   --timeout-min  minutes to wait for drill-result.json before giving up (default 40 —
//                   a factory-fresh Windows image installs Node, then `dashclaw up`
//                   downloads the CLI, deps, a platform tarball, Postgres binaries, and
//                   possibly the VC++ runtime; the first cold run is genuinely slow).
//   --keep         don't note "close the sandbox window" reminder as a TODO for the
//                   human — the launcher can't close Windows Sandbox programmatically
//                   either way; the verdict comes from the result file, not the window.
//
// Exits 0 on verdict "pass", 1 on verdict "fail" or timeout, 2 if Windows Sandbox
// isn't available on this machine.

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { cli: '@dashclaw/cli@latest', timeoutMin: 40, keep: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--cli') args.cli = argv[++i];
    else if (a.startsWith('--cli=')) args.cli = a.slice('--cli='.length);
    else if (a === '--timeout-min') args.timeoutMin = Number(argv[++i]);
    else if (a.startsWith('--timeout-min=')) args.timeoutMin = Number(a.slice('--timeout-min='.length));
    else if (a === '--keep') args.keep = true;
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv);
  const sandboxExe = 'C:\\Windows\\System32\\WindowsSandbox.exe';

  if (!existsSync(sandboxExe)) {
    console.error('FAIL: Windows Sandbox is not installed/enabled on this machine.');
    console.error('Enable it with (elevated PowerShell):');
    console.error('  Enable-WindowsOptionalFeature -Online -FeatureName "Containers-DisposableClientVM" -All');
    console.error('Then reboot and re-run this drill.');
    process.exitCode = 2;
    return;
  }

  const repoRoot = path.resolve(__dirname, '..', '..');
  const stageDir = path.join(os.homedir(), 'SandboxShared-drill');
  mkdirSync(stageDir, { recursive: true });

  const drillPs1Src = path.join(repoRoot, 'scripts', 'drills', 'windows-sandbox', 'drill.ps1');
  const wsbTemplateSrc = path.join(repoRoot, 'scripts', 'drills', 'windows-sandbox', 'drill.wsb.template');

  const resultPath = path.join(stageDir, 'drill-result.json');
  if (existsSync(resultPath)) rmSync(resultPath, { force: true });

  // Stage the script + config + generated .wsb
  copyFileSync(drillPs1Src, path.join(stageDir, 'drill.ps1'));

  // A local tarball path only exists on the host; the sandbox sees just the
  // mapped share (C:\Shared). Stage the file and point the spec there.
  let cliSpec = args.cli;
  if (existsSync(cliSpec) && cliSpec.endsWith('.tgz')) {
    const staged = path.basename(cliSpec);
    copyFileSync(cliSpec, path.join(stageDir, staged));
    cliSpec = `C:\\Shared\\${staged}`;
    console.log(`[drill] local tarball staged into the share as ${cliSpec}`);
  }
  writeFileSync(path.join(stageDir, 'drill-config.json'), JSON.stringify({ cliSpec }, null, 2));

  const template = readFileSync(wsbTemplateSrc, 'utf8');
  const wsbContent = template.replace('{{HOST_DIR}}', stageDir);
  const wsbPath = path.join(stageDir, 'drill.wsb');
  writeFileSync(wsbPath, wsbContent);

  console.log(`[drill] staged at ${stageDir}`);
  console.log(`[drill] cli spec: ${args.cli}`);
  console.log(`[drill] launching Windows Sandbox (timeout ${args.timeoutMin}m)...`);

  const child = spawn(sandboxExe, [wsbPath], { detached: true, stdio: 'ignore' });
  child.unref();

  const deadline = Date.now() + args.timeoutMin * 60 * 1000;
  let result = null;
  while (Date.now() < deadline) {
    if (existsSync(resultPath)) {
      try {
        // PowerShell writes the file with a UTF-8 BOM; JSON.parse rejects it,
        // which used to masquerade as "mid-write" and poll to the timeout.
        result = JSON.parse(readFileSync(resultPath, 'utf8').replace(/^\uFEFF/, ''));
        break;
      } catch {
        // file may be mid-write; retry on next poll
      }
    }
    await sleep(15000);
  }

  if (!result) {
    console.error('FAIL: timed out waiting for drill-result.json.');
    console.error(`Check the sandbox logs at ${path.join(stageDir, 'drill.log')} and ${path.join(stageDir, 'up.log')}`);
    console.error('The sandbox window (if still open) must be closed by hand — this launcher cannot close it.');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('=== Fresh-Windows Drill Result ===');
  for (const step of result.steps || []) {
    console.log(`  [${step.status.toUpperCase()}] ${step.id} — ${step.detail}`);
  }
  console.log(`node_version: ${result.node_version}`);
  console.log(`cli_spec: ${result.cli_spec}`);
  console.log(`finished_at: ${result.finished_at}`);
  console.log(`verdict: ${result.verdict}`);
  if (result.failed_step) console.log(`failed_step: ${result.failed_step}`);
  console.log('');
  console.log(`Full logs: ${path.join(stageDir, 'drill.log')} and ${path.join(stageDir, 'up.log')}`);
  if (!args.keep) {
    console.log('Note: close the Windows Sandbox window by hand — it is not closed automatically.');
  }

  process.exitCode = result.verdict === 'pass' ? 0 : 1;
}

main().catch((err) => {
  console.error(`FAIL: ${err.stack || err.message}`);
  process.exitCode = 1;
});
