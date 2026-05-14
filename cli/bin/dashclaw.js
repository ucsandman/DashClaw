#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DashClaw } from 'dashclaw';
import {
  bold, dim, inverse, colorByRisk, clearScreen,
  moveCursor, hideCursor, showCursor,
  green, red,
} from '../lib/render.js';
import { runDoctor as runDoctorCommand } from '../lib/doctor.js';
import { resolveConfig, clearConfigFile, configPath } from '../lib/config.js';
import { runIngest, defaultClaudeProjectsDir } from '../lib/code/ingest.js';
import { runMemo } from '../lib/code/memo.js';
import { runApply } from '../lib/code/apply.js';
import { installCodex, codexConfigPath, codexHooksDir } from '../lib/codex/install.js';
import { runCodexNotify } from '../lib/codex/notify.js';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// -- Config -------------------------------------------------------------------

// Populated by main() before any command runs.
let baseUrl;
let apiKey;
let agentId;

function createClient() {
  return new DashClaw({ baseUrl, apiKey, agentId });
}

// -- Argv Parsing -------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0] || 'help';

function getFlag(name) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

// -- Commands -----------------------------------------------------------------

async function cmdHelp() {
  console.log(`
${bold('DashClaw CLI')} — terminal approval client

${bold('Usage:')}
  dashclaw approvals                     Interactive approval inbox
  dashclaw approve <actionId> [--reason]  Approve an action
  dashclaw deny <actionId> [--reason]     Deny an action
  dashclaw doctor                        Diagnose and auto-fix your DashClaw instance
    --json                               Output as JSON (for CI/scripts)
    --no-fix                             Diagnose only, skip auto-fixes
    --category <list>                    Filter checks (e.g., database,config)
  dashclaw code ingest [--dry-run]       Backfill Claude Code transcripts from ~/.claude/projects
    --projects-dir <path>                Override the default scan directory
  dashclaw code memo --project=<slug>    Print the latest weekly memo for a project
    --save                               Also write to ./memos/<weekTag>-<slug>.md
  dashclaw code apply <manifestId>       Apply an Optimal Files manifest (Phase 6+ feature)
    --dest=<dir>                         Target project directory (required)
    --yes                                Overwrite existing files when manifest says so
    --allow-redactions                   Write files that contain redacted secret patterns
    --overwrite                          Clobber existing .NEW side-by-side files
  dashclaw install codex                 Provision DashClaw governance into Codex CLI
    --project <path>                     Project to receive AGENTS.md (default: cwd)
    --approval-policy <p>                Codex approval_policy (default: on-request)
    --include-notify                     Also wire Codex's notify config to dashclaw codex notify
  dashclaw codex notify '<json>'         Record a Codex turn-complete event
                                         (called by Codex's notify config; always exits 0)
  dashclaw logout                        Remove saved config (~/.dashclaw/config.json)
  dashclaw help                          Show this help

${bold('Config:')}
  On first run, prompts for DASHCLAW_BASE_URL and DASHCLAW_API_KEY and offers
  to save them to ~/.dashclaw/config.json (mode 600). Env vars always override
  the saved values.
`);
}

async function cmdLogout() {
  const removed = clearConfigFile();
  if (removed) {
    console.log(`${green('Removed')} ${configPath()}`);
  } else {
    console.log(`${dim('No saved config at')} ${configPath()}`);
  }
}

async function cmdDoctor() {
  const jsonFlag = args.includes('--json');
  const noFixFlag = args.includes('--no-fix');
  const catIdx = args.indexOf('--category');
  const catValue = catIdx !== -1 ? args[catIdx + 1] : undefined;
  await runDoctorCommand({
    baseUrl,
    apiKey,
    json: jsonFlag,
    noFix: noFixFlag,
    category: catValue,
  });
}

async function cmdApprove() {
  const actionId = args[1];
  if (!actionId) {
    console.error('Error: Missing action ID. Usage: dashclaw approve <actionId>');
    process.exit(1);
  }
  const reason = getFlag('--reason');
  const claw = createClient();

  try {
    await claw.approveAction(actionId, 'allow', reason);
    console.log(`\n  ${green('Approved:')} ${actionId}`);
    console.log(`  Replay:   ${baseUrl}/replay/${actionId}\n`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function cmdDeny() {
  const actionId = args[1];
  if (!actionId) {
    console.error('Error: Missing action ID. Usage: dashclaw deny <actionId>');
    process.exit(1);
  }
  const reason = getFlag('--reason');
  const claw = createClient();

  try {
    await claw.approveAction(actionId, 'deny', reason);
    console.log(`\n  ${red('Denied:')}  ${actionId}`);
    console.log(`  Replay:  ${baseUrl}/replay/${actionId}\n`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function cmdApprovals() {
  const claw = createClient();

  let items = [];
  let selected = 0;

  async function fetchPending() {
    try {
      const result = await claw.getPendingApprovals(50);
      items = result.actions || [];
    } catch (err) {
      console.error(`Error fetching approvals: ${err.message}`);
      process.exit(1);
    }
  }

  function render() {
    clearScreen();
    moveCursor(1, 1);
    process.stdout.write(bold('DashClaw Approval Inbox') + '\n\n');

    if (items.length === 0) {
      process.stdout.write(dim('  No pending approvals.\n'));
      process.stdout.write(dim('  Press R to refresh, Q to quit.\n'));
    } else {
      for (let i = 0; i < items.length; i++) {
        const a = items[i];
        const id = a.action_id || a.id || '?';
        const type = a.action_type || '-';
        const agent = a.agent_id || '-';
        const goal = (a.declared_goal || '-').slice(0, 60);
        const risk = a.risk_score != null ? colorByRisk(a.risk_score) : dim('-');

        const line = `  [${i + 1}] ${type} | ${agent} | ${goal} | risk: ${risk}`;
        process.stdout.write((i === selected ? inverse(line) : line) + '\n');
      }
    }

    process.stdout.write('\n' + dim('  [A] Approve  [D] Deny  [R] Refresh  [O] Open Replay  [Q] Quit') + '\n');
  }

  function openReplay(actionId) {
    const url = `${baseUrl}/replay/${actionId}`;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      process.stdout.write(`\n  Invalid URL, cannot open browser.\n`);
      return;
    }
    const protocol = parsed.protocol;
    if (protocol !== 'http:' && protocol !== 'https:') {
      process.stdout.write(`\n  Invalid URL, cannot open browser.\n`);
      return;
    }
    if (!parsed.hostname) {
      process.stdout.write(`\n  Invalid URL, cannot open browser.\n`);
      return;
    }
    if (/\s/.test(url)) {
      process.stdout.write(`\n  Invalid URL, cannot open browser.\n`);
      return;
    }
    // Disallow characters that are dangerous when passed through a shell
    if (/[&|><^"'`]/.test(url)) {
      process.stdout.write(`\n  Invalid URL, cannot open browser.\n`);
      return;
    }
    try {
      const platform = process.platform;
      if (platform === 'darwin') {
        execFileSync('open', [url]);
      } else if (platform === 'win32') {
        // Use PowerShell Start-Process instead of relying on cmd.exe parsing
        execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Process', url]);
      } else {
        execFileSync('xdg-open', [url]);
      }
    } catch (_) {
      process.stdout.write(`\n  Could not open browser. URL: ${url}\n`);
    }
  }

  await fetchPending();

  // Open SSE stream for live push of new approval requests
  let stream = null;
  try {
    stream = claw.events()
      .on('guard.decision.created', (data) => {
        if (data.decision !== 'require_approval') return;
        const exists = items.some((it) => (it.action_id || it.id) === data.action_id);
        if (exists) return;
        items.push(data);
        render();
      })
      .on('error', () => {
        moveCursor(items.length + 6, 1);
        process.stdout.write(dim('  SSE stream error — live push unavailable, use R to refresh') + '\n');
      });
  } catch (_) {
    // SSE unavailable — inbox still works via manual refresh
  }

  // Set up raw mode for interactive input
  if (!process.stdin.isTTY) {
    console.error('Error: Interactive mode requires a TTY. Use dashclaw approve/deny for non-interactive use.');
    process.exit(1);
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  hideCursor();

  // Ensure cleanup on exit
  function cleanup() {
    if (stream) stream.close();
    showCursor();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write('\n');
  }
  process.on('exit', cleanup);
  process.on('SIGINT', () => process.exit(0));

  render();

  let busy = false;

  process.stdin.on('data', async (key) => {
    if (busy) return;

    // Ctrl+C
    if (key === '\x03') {
      process.exit(0);
    }

    // Arrow keys: escape sequences
    if (key === '\x1b[A') {
      // Up
      if (selected > 0) selected--;
      render();
      return;
    }
    if (key === '\x1b[B') {
      // Down
      if (selected < items.length - 1) selected++;
      render();
      return;
    }

    const ch = key.toLowerCase();

    if (ch === 'q') {
      process.exit(0);
    }

    if (ch === 'r') {
      busy = true;
      await fetchPending();
      selected = Math.min(selected, Math.max(0, items.length - 1));
      render();
      busy = false;
      return;
    }

    if (items.length === 0) return;
    const current = items[selected];
    const actionId = current.action_id || current.id;

    if (ch === 'a') {
      busy = true;
      try {
        await claw.approveAction(actionId, 'allow');
        items.splice(selected, 1);
        selected = Math.min(selected, Math.max(0, items.length - 1));
      } catch (err) {
        moveCursor(items.length + 5, 1);
        process.stdout.write(red(`  Error: ${err.message}`) + '\n');
      }
      render();
      busy = false;
      return;
    }

    if (ch === 'd') {
      busy = true;
      try {
        await claw.approveAction(actionId, 'deny');
        items.splice(selected, 1);
        selected = Math.min(selected, Math.max(0, items.length - 1));
      } catch (err) {
        moveCursor(items.length + 5, 1);
        process.stdout.write(red(`  Error: ${err.message}`) + '\n');
      }
      render();
      busy = false;
      return;
    }

    if (ch === 'o') {
      openReplay(actionId);
      return;
    }
  });
}

// -- install subcommand group ------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
// cli/bin/ -> cli/ -> repo root
const REPO_ROOT = resolve(__dirname, '..', '..');

async function cmdInstallCodex() {
  const projectDir = getFlag('--project') || process.cwd();
  const approvalPolicy = getFlag('--approval-policy') || 'on-request';
  const includeNotify = args.includes('--include-notify');

  try {
    const result = await installCodex({
      repoRoot: REPO_ROOT,
      projectDir,
      baseUrl,
      approvalPolicy,
      includeNotify,
      logger: console,
    });

    console.log();
    console.log(`  ${green('Done.')} DashClaw governance is wired into Codex.`);
    console.log(`  ${dim('Hooks:')}  ${result.hooks.hooksDst}`);
    console.log(`  ${dim('Config:')} ${result.config.path}${result.config.backup ? dim(' (backup: ' + result.config.backup + ')') : ''}`);
    console.log(`  ${dim('AGENTS:')} ${result.agentsMd.path}${result.agentsMd.backup ? dim(' (backup: ' + result.agentsMd.backup + ')') : ''}`);
    console.log();
    console.log(`  Next: open a new Codex session in ${projectDir} and run a governed tool call.`);
    console.log(`  Codex requires you to trust new hooks; it will prompt on first use.`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function cmdInstall() {
  const target = args[1];
  switch (target) {
    case 'codex':
      return cmdInstallCodex();
    default:
      console.error(`Unknown install target: dashclaw install ${target || '(missing)'}\n` +
                    'Try: dashclaw install codex [--project <path>] [--approval-policy <p>]');
      process.exit(1);
  }
}

// -- codex subcommand group --------------------------------------------------
//
// `dashclaw codex notify '<json>'` is invoked by Codex's legacy notify config.
// It records a turn-complete action_record in DashClaw. ALWAYS exits 0 so
// Codex never sees an error from the spawn.

async function cmdCodexNotify() {
  // Skip the leading 'codex' and 'notify' tokens — runCodexNotify reads the
  // JSON payload from the LAST argv slot (per Codex's notify contract).
  const notifyArgv = args.slice(1); // includes 'notify' and the payload
  await runCodexNotify({
    argv: notifyArgv,
    baseUrl,
    apiKey,
    agentId: agentId || 'codex',
    logger: console,
  });
  process.exit(0);
}

async function cmdCodex() {
  const sub = args[1];
  switch (sub) {
    case 'notify':
      return cmdCodexNotify();
    default:
      console.error(`Unknown subcommand: dashclaw codex ${sub || '(missing)'}\n` +
                    'Try: dashclaw codex notify \'<json>\'   (called by Codex notify config)');
      process.exit(1);
  }
}

// -- code subcommand group ---------------------------------------------------

async function cmdCodeIngest() {
  const dryRun = args.includes('--dry-run');
  const projectsDir = getFlag('--projects-dir') || defaultClaudeProjectsDir();
  console.log(`Scanning ${projectsDir} ...`);
  const results = await runIngest({
    baseUrl,
    apiKey,
    projectsDir,
    dryRun,
  });
  if (!results.length) return;
  let ingested = 0;
  let skipped = 0;
  let errors = 0;
  for (const r of results) {
    if (r.status === 'ingested') ingested++;
    else if (r.status === 'skipped_unchanged' || r.status === 'skipped' || r.status === 'dry_run') skipped++;
    else if (r.status === 'error') errors++;
  }
  console.log();
  console.log(`Done. Ingested: ${ingested}  Skipped: ${skipped}  Errors: ${errors}`);
  if (errors > 0) process.exit(2);
}

async function cmdCodeMemo() {
  const project = getFlag('--project');
  const save = args.includes('--save');
  if (!project) {
    console.error('Error: --project=<slug-or-id> is required.');
    process.exit(1);
  }
  await runMemo({ baseUrl, apiKey, project, save });
}

async function cmdCodeApply() {
  const manifestId = args[2];
  const dest = getFlag('--dest');
  const yes = args.includes('--yes');
  const allowRedactions = args.includes('--allow-redactions');
  const overwrite = args.includes('--overwrite');
  if (!manifestId) {
    console.error('Error: usage — dashclaw code apply <manifestId> --dest=<dir> [--yes] [--allow-redactions] [--overwrite]');
    process.exit(1);
  }
  if (!dest) {
    console.error('Error: --dest=<dir> is required.');
    process.exit(1);
  }
  try {
    const results = await runApply({
      baseUrl,
      apiKey,
      manifestId,
      dest,
      yes,
      allowRedactions,
      allowOverwriteSideBySide: overwrite,
    });
    const summary = results.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});
    console.log();
    console.log('Apply summary:', JSON.stringify(summary));
  } catch (err) {
    console.error('Error: ' + err.message);
    process.exit(1);
  }
}

async function cmdCode() {
  const sub = args[1];
  switch (sub) {
    case 'ingest':
      return cmdCodeIngest();
    case 'memo':
      return cmdCodeMemo();
    case 'apply':
      return cmdCodeApply();
    default:
      console.error(`Unknown subcommand: dashclaw code ${sub || '(missing)'}\n` +
                    'Try: dashclaw code ingest [--dry-run]\n' +
                    '     dashclaw code memo --project=<slug> [--save]\n' +
                    '     dashclaw code apply <manifestId> --dest=<dir> [--yes]');
      process.exit(1);
  }
}

// -- Router -------------------------------------------------------------------

const COMMANDS_NEEDING_CONFIG = new Set(['approvals', 'approve', 'deny', 'doctor', 'code']);
// `install` deliberately omitted: provisioning hooks and AGENTS.md shouldn't
// require the user to have already configured API keys. If config happens to
// be present, install will pick up baseUrl for the AGENTS.md instance link.
// `codex notify` also opt-in: if no config, the notify fail-softs to skipped
// rather than erroring (Codex never sees the error anyway — it spawns with
// stdio nulled).
const COMMANDS_OPTIONAL_CONFIG = new Set(['install', 'codex']);

async function main() {
  if (COMMANDS_NEEDING_CONFIG.has(command)) {
    const config = await resolveConfig();
    if (!config) {
      console.error('Error: Missing required config (DASHCLAW_BASE_URL, DASHCLAW_API_KEY).');
      console.error('Set them as env vars, save with an interactive first run, or use a .env file.');
      process.exit(1);
    }
    baseUrl = config.baseUrl;
    apiKey = config.apiKey;
    agentId = config.agentId;
  } else if (COMMANDS_OPTIONAL_CONFIG.has(command)) {
    const config = await resolveConfig({ interactive: false }).catch(() => null);
    if (config) {
      baseUrl = config.baseUrl;
      apiKey = config.apiKey;
      agentId = config.agentId;
    }
  }

  switch (command) {
    case 'approvals':
      await cmdApprovals();
      break;
    case 'approve':
      await cmdApprove();
      break;
    case 'deny':
      await cmdDeny();
      break;
    case 'doctor':
      await cmdDoctor();
      break;
    case 'logout':
      await cmdLogout();
      break;
    case 'code':
      await cmdCode();
      break;
    case 'install':
      await cmdInstall();
      break;
    case 'codex':
      await cmdCodex();
      break;
    case 'help':
    case '--help':
    case '-h':
      await cmdHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      await cmdHelp();
      process.exit(1);
  }
}

main();
