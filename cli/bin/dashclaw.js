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
import {
  runCodexIngest,
  defaultCodexSessionsDir,
  defaultCodexOutDir,
} from '../lib/code/ingest-codex.js';
import { installCodex, codexConfigPath, codexHooksDir } from '../lib/codex/install.js';
import { runCodexNotify } from '../lib/codex/notify.js';
import { apiRequest } from '../lib/api.js';
import { fetchPosture, fetchFindings, fetchNext, resolveFinding } from '../lib/posture.js';

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
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === name) return i + 1 < args.length ? args[i + 1] : undefined; // --name value
    if (a.startsWith(name + '=')) return a.slice(name.length + 1);          // --name=value
  }
  return undefined;
}

function incrementCount(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
}

function runSubcommand(table, sub, errorMessage) {
  const handler = table[sub];
  if (handler) return handler();
  console.error(errorMessage(sub));
  process.exit(1);
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
  dashclaw code ingest-codex [--dry-run] Backfill Codex transcripts from ~/.codex/sessions
    --sessions-dir <path>                Override the default scan directory
    --out <dir>                          Local output dir (default ~/.dashclaw/codex-sessions)
    --endpoint <url>                     POST to <url> instead of writing local (advanced)
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
  dashclaw prompts list [--category C]   List prompt templates
  dashclaw prompts get <id>              Show a template
  dashclaw prompts versions <id>         List a template's versions
  dashclaw prompts render <templateId>   Render a prompt
    --version-id <vid>                   Render a specific version instead of the active one
    --var <key=value>                    Set a variable (repeatable)
    --record                             Record the render as a prompt run
  dashclaw prompts create --name N       Create a template (admin)
    --description <D> --category <C>
  dashclaw prompts add-version <id> --content C   Add a version (admin)
    --changelog <L> --model-hint <M>
  dashclaw prompts activate <id> <vid>   Activate a version (admin)
  dashclaw prompts stats [--template-id X]        Prompt run analytics
  dashclaw inbox list [--unread] [--limit N]      List inbox messages
  dashclaw inbox read <id> [<id> ...]    Mark messages read
  dashclaw inbox archive <id> [<id> ...] Archive messages
  dashclaw behavior status               Behavior Learning sample status (local recorder)
  dashclaw behavior suggestions          Evidence-backed policy suggestions per agent
    --agent-id <id>                      Filter to one agent
  dashclaw posture                       Governance posture score + remediation queue
  dashclaw posture resolve <key>         Draft a fix (inactive) | --snooze | --accept-risk
    --note "..."                         Attach a note to the resolution
  dashclaw next                          The single top open governance gap + its fix
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

async function fetchPendingApprovals(state) {
  try {
    const result = await state.claw.getPendingApprovals(50);
    state.items = result.actions || [];
  } catch (err) {
    console.error(`Error fetching approvals: ${err.message}`);
    process.exit(1);
  }
}

function approvalId(action) {
  return action.action_id || action.id;
}

function renderApprovalRow(action, index, selected) {
  const type = action.action_type || '-';
  const agent = action.agent_id || '-';
  const goal = (action.declared_goal || '-').slice(0, 60);
  const risk = action.risk_score != null ? colorByRisk(action.risk_score) : dim('-');
  const line = `  [${index + 1}] ${type} | ${agent} | ${goal} | risk: ${risk}`;
  process.stdout.write((index === selected ? inverse(line) : line) + '\n');
}

function renderApprovals(state) {
  clearScreen();
  moveCursor(1, 1);
  process.stdout.write(bold('DashClaw Approval Inbox') + '\n\n');

  if (state.items.length === 0) {
    process.stdout.write(dim('  No pending approvals.\n'));
    process.stdout.write(dim('  Press R to refresh, Q to quit.\n'));
  } else {
    state.items.forEach((action, index) => renderApprovalRow(action, index, state.selected));
  }

  process.stdout.write('\n' + dim('  [A] Approve  [D] Deny  [R] Refresh  [O] Open Replay  [Q] Quit') + '\n');
}

function replayUrlIsSafe(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const protocolOk = parsed.protocol === 'http:' || parsed.protocol === 'https:';
  return protocolOk && parsed.hostname && !/\s/.test(url) && !/[&|><^"'`]/.test(url);
}

function openReplay(actionId) {
  const url = `${baseUrl}/replay/${actionId}`;
  if (!replayUrlIsSafe(url)) {
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

function startApprovalStream(state) {
  try {
    state.stream = state.claw.events()
      .on('guard.decision.created', (data) => handleApprovalPush(state, data))
      .on('error', () => {
        moveCursor(state.items.length + 6, 1);
        process.stdout.write(dim('  SSE stream error — live push unavailable, use R to refresh') + '\n');
      });
  } catch (_) {
    // SSE unavailable — inbox still works via manual refresh
  }
}

function handleApprovalPush(state, data) {
  if (data.decision !== 'require_approval') return;
  const exists = state.items.some((it) => approvalId(it) === data.action_id);
  if (exists) return;
  state.items.push(data);
  renderApprovals(state);
}

function ensureApprovalTty() {
  if (!process.stdin.isTTY) {
    console.error('Error: Interactive mode requires a TTY. Use dashclaw approve/deny for non-interactive use.');
    process.exit(1);
  }
}

function selectedWithinItems(state) {
  state.selected = Math.min(state.selected, Math.max(0, state.items.length - 1));
}

function setupApprovalTerminal(state) {
  ensureApprovalTty();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  hideCursor();
  process.on('exit', () => cleanupApprovalInbox(state));
  process.on('SIGINT', () => process.exit(0));
}

function cleanupApprovalInbox(state) {
  if (state.stream) state.stream.close();
  showCursor();
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdout.write('\n');
}

async function withApprovalBusy(state, fn) {
  state.busy = true;
  try {
    await fn();
  } finally {
    state.busy = false;
  }
}

async function refreshApprovals(state) {
  await fetchPendingApprovals(state);
  selectedWithinItems(state);
  renderApprovals(state);
}

async function decideApproval(state, decision) {
  const actionId = approvalId(state.items[state.selected]);
  try {
    await state.claw.approveAction(actionId, decision);
    state.items.splice(state.selected, 1);
    selectedWithinItems(state);
  } catch (err) {
    moveCursor(state.items.length + 5, 1);
    process.stdout.write(red(`  Error: ${err.message}`) + '\n');
  }
  renderApprovals(state);
}

function moveApprovalSelection(state, delta) {
  const next = state.selected + delta;
  state.selected = Math.max(0, Math.min(next, state.items.length - 1));
  renderApprovals(state);
}

const EMPTY_APPROVAL_KEY_ACTIONS = {
  q: () => process.exit(0),
  r: (state) => withApprovalBusy(state, () => refreshApprovals(state)),
};

const APPROVAL_KEY_ACTIONS = {
  ...EMPTY_APPROVAL_KEY_ACTIONS,
  a: (state) => withApprovalBusy(state, () => decideApproval(state, 'allow')),
  d: (state) => withApprovalBusy(state, () => decideApproval(state, 'deny')),
  o: (state) => openReplay(approvalId(state.items[state.selected])),
};

function approvalActionFor(state, key) {
  if (key === '\x03') return () => process.exit(0);
  if (key === '\x1b[A') return () => moveApprovalSelection(state, -1);
  if (key === '\x1b[B') return () => moveApprovalSelection(state, 1);
  const actions = state.items.length === 0 ? EMPTY_APPROVAL_KEY_ACTIONS : APPROVAL_KEY_ACTIONS;
  return actions[key.toLowerCase()];
}

async function handleApprovalKey(state, key) {
  if (state.busy) return;
  const action = approvalActionFor(state, key);
  if (action) return action(state);
}

async function cmdApprovals() {
  const state = { claw: createClient(), items: [], selected: 0, busy: false, stream: null };
  await fetchPendingApprovals(state);
  startApprovalStream(state);
  setupApprovalTerminal(state);
  renderApprovals(state);
  process.stdin.on('data', (key) => handleApprovalKey(state, key));
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
  return runSubcommand({
    notify: cmdCodexNotify,
  }, args[1], (sub) => `Unknown subcommand: dashclaw codex ${sub || '(missing)'}\n` +
    'Try: dashclaw codex notify \'<json>\'   (called by Codex notify config)');
}

// -- code subcommand group ---------------------------------------------------

async function cmdCodeIngestCodex() {
  const dryRun = args.includes('--dry-run');
  const sessionsDir = getFlag('--sessions-dir') || defaultCodexSessionsDir();
  const outDir = getFlag('--out') || defaultCodexOutDir();
  const endpoint = getFlag('--endpoint') || null;
  console.log(`Scanning ${sessionsDir} ...`);
  const results = await runCodexIngest({
    sessionsDir,
    outDir,
    endpoint,
    apiKey,
    dryRun,
    logger: console,
  });
  if (!results.length) {
    console.log('No sessions to ingest.');
    return;
  }
  const counts = tallyCodexIngestResults(results);
  console.log();
  console.log(`Done. Written: ${counts.written_local}  Ingested: ${counts.ingested}  Dry-run: ${counts.dry_run}  Skipped: ${counts.skipped}  Errors: ${counts.error}`);
  if (!endpoint && counts.written_local > 0) {
    console.log(dim(`  Local sessions saved under ${outDir}.`));
    console.log(dim(`  Server-side codex ingest will be wired in a follow-up phase.`));
  }
  if (counts.error > 0) process.exit(2);
}

function tallyCodexIngestResults(results) {
  const counts = { written_local: 0, ingested: 0, dry_run: 0, skipped: 0, error: 0 };
  for (const r of results) {
    incrementCount(counts, r.status);
    if (r.status === 'error') console.error(formatCodexIngestError(r));
  }
  return counts;
}

function formatCodexIngestError(result) {
  return `  ${red('error')} ${result.file}: ${result.reason}${result.detail ? ' — ' + result.detail : ''}`;
}

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
  const counts = { ingested: 0, skipped: 0, error: 0 };
  for (const r of results) {
    if (r.status === 'skipped_unchanged' || r.status === 'dry_run') {
      incrementCount(counts, 'skipped');
    } else {
      incrementCount(counts, r.status);
    }
  }
  console.log();
  console.log(`Done. Ingested: ${counts.ingested}  Skipped: ${counts.skipped}  Errors: ${counts.error}`);
  if (counts.error > 0) process.exit(2);
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
  return runSubcommand({
    ingest: cmdCodeIngest,
    'ingest-codex': cmdCodeIngestCodex,
    memo: cmdCodeMemo,
    apply: cmdCodeApply,
  }, args[1], (sub) => `Unknown subcommand: dashclaw code ${sub || '(missing)'}\n` +
    'Try: dashclaw code ingest [--dry-run]\n' +
    '     dashclaw code ingest-codex [--dry-run] [--out <dir>] [--endpoint <url>]\n' +
    '     dashclaw code memo --project=<slug> [--save]\n' +
    '     dashclaw code apply <manifestId> --dest=<dir> [--yes]');
}

// -- prompts subcommand group ------------------------------------------------
//
// Direct-API calls (apiRequest) rather than SDK methods: the CLI imports the
// PUBLISHED `dashclaw` package, which may lag this repo and lack newly-added
// prompt methods. fetch + x-api-key against the resolved baseUrl/apiKey is the
// durable path.

function promptsClient() {
  return { baseUrl, apiKey };
}

// Collect repeated `--var key=value` flags into a { key: value } object.
function parseVars() {
  const vars = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--var' && i + 1 < args.length) {
      const pair = args[i + 1];
      const eq = pair.indexOf('=');
      if (eq === -1) {
        console.error(`Error: --var expects key=value, got "${pair}"`);
        process.exit(1);
      }
      vars[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
  }
  return vars;
}

async function cmdPromptsList() {
  const category = getFlag('--category');
  try {
    const data = await apiRequest(promptsClient(), 'GET', '/api/prompts/templates', {
      query: { category },
    });
    const templates = data.templates || [];
    if (templates.length === 0) {
      console.log(dim('  No templates.'));
      return;
    }
    for (const t of templates) {
      console.log(
        `  ${bold(t.id)}  ${t.name || '-'}  ${dim('[' + (t.category || 'uncategorized') + ']')}` +
        `  active v${t.active_version ?? '-'}  ${dim('(' + (t.version_count ?? 0) + ' versions)')}`,
      );
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function cmdPromptsGet() {
  const id = args[2];
  if (!id) {
    console.error('Error: Missing template ID. Usage: dashclaw prompts get <id>');
    process.exit(1);
  }
  try {
    const data = await apiRequest(promptsClient(), 'GET', `/api/prompts/templates/${encodeURIComponent(id)}`);
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function cmdPromptsVersions() {
  const id = args[2];
  if (!id) {
    console.error('Error: Missing template ID. Usage: dashclaw prompts versions <id>');
    process.exit(1);
  }
  try {
    const data = await apiRequest(
      promptsClient(), 'GET', `/api/prompts/templates/${encodeURIComponent(id)}/versions`,
    );
    const versions = data.versions || [];
    if (versions.length === 0) {
      console.log(dim('  No versions.'));
      return;
    }
    for (const v of versions) {
      const active = v.is_active ? green(' (active)') : '';
      console.log(`  v${v.version}  ${bold(v.id)}${active}  ${dim(v.changelog || '')}`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function cmdPromptsRender() {
  const versionId = getFlag('--version-id');
  const templateId = args[2] && !args[2].startsWith('--') ? args[2] : undefined;
  if (!templateId && !versionId) {
    console.error('Error: usage — dashclaw prompts render <templateId> [--var k=v ...] [--record]');
    console.error('       or:    dashclaw prompts render --version-id <vid> [--var k=v ...]');
    process.exit(1);
  }
  const variables = parseVars();
  const record = args.includes('--record');
  try {
    const data = await apiRequest(promptsClient(), 'POST', '/api/prompts/render', {
      body: {
        template_id: templateId,
        version_id: versionId,
        variables,
        agent_id: agentId,
        record,
      },
    });
    console.log(data.rendered ?? '');
    if (Array.isArray(data.parameters) && data.parameters.length > 0) {
      console.log();
      console.log(dim(`  parameters: ${data.parameters.join(', ')}`));
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function cmdPromptsCreate() {
  const name = getFlag('--name');
  if (!name) {
    console.error('Error: --name is required. Usage: dashclaw prompts create --name N [--description D] [--category C]');
    process.exit(1);
  }
  const description = getFlag('--description');
  const category = getFlag('--category');
  try {
    const data = await apiRequest(promptsClient(), 'POST', '/api/prompts/templates', {
      body: { name, description, category },
    });
    console.log(`  ${green('Created')} ${bold(data.id)}  ${data.name}`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function cmdPromptsAddVersion() {
  const templateId = args[2];
  if (!templateId || templateId.startsWith('--')) {
    console.error('Error: usage — dashclaw prompts add-version <templateId> --content C [--changelog L] [--model-hint M]');
    process.exit(1);
  }
  const content = getFlag('--content');
  if (!content) {
    console.error('Error: --content is required.');
    process.exit(1);
  }
  const changelog = getFlag('--changelog');
  const modelHint = getFlag('--model-hint');
  try {
    const data = await apiRequest(
      promptsClient(), 'POST', `/api/prompts/templates/${encodeURIComponent(templateId)}/versions`,
      { body: { content, changelog, model_hint: modelHint } },
    );
    console.log(`  ${green('Added')} v${data.version}  ${bold(data.id)}`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function cmdPromptsActivate() {
  const templateId = args[2];
  const versionId = args[3];
  if (!templateId || !versionId) {
    console.error('Error: usage — dashclaw prompts activate <templateId> <versionId>');
    process.exit(1);
  }
  try {
    await apiRequest(
      promptsClient(), 'POST',
      `/api/prompts/templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}`,
    );
    console.log(`  ${green('Activated')} version ${bold(versionId)}`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function cmdPromptsStats() {
  const templateId = getFlag('--template-id');
  try {
    const data = await apiRequest(promptsClient(), 'GET', '/api/prompts/stats', {
      query: { template_id: templateId },
    });
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function cmdPrompts() {
  const sub = args[1];
  switch (sub) {
    case 'list':
      return cmdPromptsList();
    case 'get':
      return cmdPromptsGet();
    case 'versions':
      return cmdPromptsVersions();
    case 'render':
      return cmdPromptsRender();
    case 'create':
      return cmdPromptsCreate();
    case 'add-version':
      return cmdPromptsAddVersion();
    case 'activate':
      return cmdPromptsActivate();
    case 'stats':
      return cmdPromptsStats();
    default:
      console.error(`Unknown subcommand: dashclaw prompts ${sub || '(missing)'}\n` +
                    'Try: dashclaw prompts list [--category C]\n' +
                    '     dashclaw prompts get <id>\n' +
                    '     dashclaw prompts versions <id>\n' +
                    '     dashclaw prompts render <templateId> [--var k=v ...] [--record]\n' +
                    '     dashclaw prompts create --name N [--description D] [--category C]\n' +
                    '     dashclaw prompts add-version <templateId> --content C [--changelog L] [--model-hint M]\n' +
                    '     dashclaw prompts activate <templateId> <versionId>\n' +
                    '     dashclaw prompts stats [--template-id X]');
      process.exit(1);
  }
}

// -- inbox subcommand group --------------------------------------------------
//
// Direct-API calls against /api/messages (durable path, see prompts group).
// Uses the resolved `agentId` for direction=inbox filtering and PATCH attribution.

function inboxClient() {
  return { baseUrl, apiKey };
}

async function cmdInboxList() {
  try {
    const data = await apiRequest(inboxClient(), 'GET', '/api/messages', { query: inboxListQuery() });
    renderInboxList(data);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

function inboxListQuery() {
  return {
    agent_id: agentId,
    direction: 'inbox',
    unread: args.includes('--unread') ? 'true' : undefined,
    limit: getFlag('--limit'),
  };
}

function renderInboxList(data) {
  const messages = data.messages || [];
  if (messages.length === 0) {
    console.log(dim('  No messages.'));
  } else {
    messages.forEach(renderInboxMessage);
  }
  console.log();
  console.log(dim(`  unread: ${data.unread_count ?? 0}`));
}

function renderInboxMessage(message) {
  const readMark = message.is_read ? dim('read') : green('unread');
  console.log(
    `  ${bold(message.id)}  ${dim('from')} ${message.from_agent_id || '-'}  ${message.subject || dim('(no subject)')}  [${readMark}]`,
  );
}

async function cmdInboxUpdate(action) {
  const ids = args.slice(2).filter((a) => !a.startsWith('--'));
  if (ids.length === 0) {
    console.error(`Error: usage — dashclaw inbox ${action} <id> [<id> ...]`);
    process.exit(1);
  }
  try {
    const data = await apiRequest(inboxClient(), 'PATCH', '/api/messages', {
      body: { message_ids: ids, action, agent_id: agentId },
    });
    console.log(`  ${green('Updated')} ${data.updated ?? 0} message(s)`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function cmdInbox() {
  return runSubcommand({
    list: cmdInboxList,
    read: () => cmdInboxUpdate('read'),
    archive: () => cmdInboxUpdate('archive'),
  }, args[1], (sub) => `Unknown subcommand: dashclaw inbox ${sub || '(missing)'}\n` +
    'Try: dashclaw inbox list [--unread] [--limit N]\n' +
    '     dashclaw inbox read <id> [<id> ...]\n' +
    '     dashclaw inbox archive <id> [<id> ...]');
}

// -- behavior subcommand group -----------------------------------------------
//
// Behavior Learning / Policy Coach. Read-only inspection of the locally-recorded
// behavior samples and the evidence-backed policy suggestions derived from them.
// Direct-API calls (durable path, see prompts/inbox groups). Adopt/dismiss are
// intentionally UI-only in V1 — they require simulation review.

function behaviorClient() {
  return { baseUrl, apiKey };
}

async function cmdBehaviorStatus() {
  try {
    const data = await apiRequest(behaviorClient(), 'GET', '/api/behavior/samples');
    renderBehaviorStatus(data);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

function behaviorReadyLabel(data) {
  return data.ready ? green('yes') : dim('no — need ' + (data.min_samples ?? 8) + '+ samples for an agent');
}

function renderBehaviorStatus(data) {
  console.log(`  Recorder:   ${data.recorder_enabled ? green('on') : dim('off')}`);
  console.log(`  Directory:  ${dim(data.dir || '-')}`);
  console.log(`  Samples:    ${bold(String(data.sample_count ?? 0))}  ${dim('across')} ${data.agent_count ?? 0} ${dim('agent(s)')}`);
  console.log(`  Window:     ${dim((data.oldest_ts || '-') + ' → ' + (data.newest_ts || '-'))}`);
  console.log(`  Ready:      ${behaviorReadyLabel(data)}`);
  for (const a of data.agents || []) {
    console.log(`    ${a.agent_id}  ${dim(a.count + ' samples')}`);
  }
}

async function cmdBehaviorSuggestions() {
  const agent = getFlag('--agent-id') || agentId;
  try {
    const data = await apiRequest(behaviorClient(), 'GET', '/api/behavior/suggestions', {
      query: { agent_id: agent },
    });
    const suggestions = data.suggestions || [];
    if (suggestions.length === 0) {
      console.log(dim(`  No suggestions (${data.sample_count ?? 0} samples analyzed).`));
      return;
    }
    for (const s of suggestions) {
      const kind = s.enforceable ? green('draft') : dim('advisory');
      console.log(`  ${bold(s.type)}  ${dim(s.agent_id)}  ${s.confidence}%  [${kind}]  ${dim(s.severity)}`);
      console.log(`    ${s.expected_effect}`);
      console.log(dim(`    evidence: ${s.matching_sample_size}/${s.sample_size} · id ${s.id}`));
    }
    console.log();
    console.log(dim('  Review + simulate + adopt from the Policy Coach UI (/policy-coach).'));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function cmdBehavior() {
  return runSubcommand({
    status: cmdBehaviorStatus,
    suggestions: cmdBehaviorSuggestions,
  }, args[1], (sub) => `Unknown subcommand: dashclaw behavior ${sub || '(missing)'}\n` +
    'Try: dashclaw behavior status\n' +
    '     dashclaw behavior suggestions [--agent-id X]');
}

// -- posture subcommand group ------------------------------------------------
//
// Direct-API (apiRequest via cli/lib/posture.js) — the governance posture score
// + the prioritized remediation queue. `posture resolve` is DRAFT-ONLY: it can
// create an inactive policy draft / snooze / accept risk, never activate
// enforcement (a human does that at /policies).

function postureClient() {
  return { baseUrl, apiKey };
}

const POSTURE_DIM_LABEL = {
  identity: 'Identity', enforcement: 'Enforcement', spend: 'Spend',
  auditability: 'Audit', approval: 'Approval', data_protection: 'Data',
};

function printFinding(f, indent = '   ') {
  console.log(`${indent}${bold('+' + (f.scoreDelta ?? 0))}  ${dim('[' + f.severity + ']')}  ${f.title}`);
  console.log(dim(`${indent}    ${f.key}`));
}

function postureStatusLabel(status) {
  if (status === 'healthy') return green(status);
  if (status === 'at_risk') return red(status);
  return status;
}

function renderPostureHeader(data) {
  console.log();
  console.log(`  ${bold('Governance posture')}  ${bold(String(data.score))}${dim('/100')}  ${postureStatusLabel(data.status)}` +
    `${data.cappedBy ? '  ' + red('[capped: incident]') : ''}`);
  console.log(dim(`  ${data.summary?.openFindings ?? 0} open · +${Math.round(data.summary?.pointsRecoverable ?? 0)} points recoverable`));
  console.log();
}

function renderPostureDimensions(dimensions) {
  for (const d of dimensions || []) {
    const label = POSTURE_DIM_LABEL[d.dimension] || d.dimension;
    const mark = d.score < 70 ? red('!') : ' ';
    console.log(`   ${mark} ${label.padEnd(12)} ${String(d.score).padStart(3)}`);
  }
  console.log();
}

function renderPostureQueue(findings) {
  console.log(dim(`  Next — ${findings.length} open`));
  if (findings.length === 0) {
    console.log(green('   Queue is clear — no open coverage gaps.'));
    return;
  }
  for (const f of findings.slice(0, 5)) printFinding(f);
  if (findings.length > 5) console.log(dim(`   … ${findings.length - 5} more`));
}

async function cmdPostureShow() {
  try {
    const client = postureClient();
    const [data, queue] = await Promise.all([fetchPosture(client), fetchFindings(client)]);
    const findings = queue.findings || [];
    renderPostureHeader(data);
    renderPostureDimensions(data.dimensions);
    renderPostureQueue(findings);
    console.log();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function cmdPostureResolve() {
  const key = args[2];
  if (!key || key.startsWith('-')) {
    console.error('Error: usage — dashclaw posture resolve <key> [--snooze | --accept-risk] [--note "..."]');
    process.exit(1);
  }
  const action = args.includes('--snooze') ? 'snooze'
    : args.includes('--accept-risk') ? 'accept_risk' : 'create_draft';
  try {
    await resolveFinding(postureClient(), key, action, getFlag('--note'));
    if (action === 'create_draft') {
      console.log(green('  Draft created (inactive).') +
        dim(' Activate it at /policies and rescan — drafting does not change the score.'));
    } else {
      console.log(green(`  Finding ${action === 'snooze' ? 'snoozed' : 'risk-accepted'}.`));
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function cmdPosture() {
  const sub = args[1];
  if (sub === undefined) return cmdPostureShow();
  if (sub === 'resolve') return cmdPostureResolve();
  console.error(`Unknown subcommand: dashclaw posture ${sub}\n` +
    'Try: dashclaw posture\n     dashclaw posture resolve <key>');
  process.exit(1);
}

async function cmdNext() {
  try {
    const f = await fetchNext(postureClient());
    if (!f) {
      console.log(green('  Queue is clear — no open coverage gaps.'));
      return;
    }
    console.log();
    printFinding(f, '  ');
    if (f.fix?.type === 'create_policy_draft') {
      console.log(dim(`  Fix: draft a ${f.fix.policyType} policy →  dashclaw posture resolve ${f.key}`));
    } else if (f.fix?.deepLink) {
      console.log(dim(`  Fix: ${f.fix.type} →  ${f.fix.deepLink}`));
    }
    console.log();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

// -- Router -------------------------------------------------------------------

const COMMANDS_NEEDING_CONFIG = new Set(['approvals', 'approve', 'deny', 'doctor', 'code', 'prompts', 'inbox', 'behavior', 'posture', 'next']);
// `install` deliberately omitted: provisioning hooks and AGENTS.md shouldn't
// require the user to have already configured API keys. If config happens to
// be present, install will pick up baseUrl for the AGENTS.md instance link.
// `codex notify` also opt-in: if no config, the notify fail-softs to skipped
// rather than erroring (Codex never sees the error anyway — it spawns with
// stdio nulled).
const COMMANDS_OPTIONAL_CONFIG = new Set(['install', 'codex']);

function applyConfig(config) {
  baseUrl = config.baseUrl;
  apiKey = config.apiKey;
  agentId = config.agentId;
}

async function loadCommandConfig() {
  if (COMMANDS_NEEDING_CONFIG.has(command)) {
    const config = await resolveConfig();
    if (!config) {
      console.error('Error: Missing required config (DASHCLAW_BASE_URL, DASHCLAW_API_KEY).');
      console.error('Set them as env vars, save with an interactive first run, or use a .env file.');
      process.exit(1);
    }
    applyConfig(config);
    return;
  }
  if (COMMANDS_OPTIONAL_CONFIG.has(command)) {
    const config = await resolveConfig({ interactive: false }).catch(() => null);
    if (config) {
      applyConfig(config);
    }
  }
}

const COMMAND_HANDLERS = {
  approvals: cmdApprovals,
  approve: cmdApprove,
  deny: cmdDeny,
  doctor: cmdDoctor,
  logout: cmdLogout,
  code: cmdCode,
  install: cmdInstall,
  codex: cmdCodex,
  prompts: cmdPrompts,
  inbox: cmdInbox,
  behavior: cmdBehavior,
  posture: cmdPosture,
  next: cmdNext,
  help: cmdHelp,
  '--help': cmdHelp,
  '-h': cmdHelp,
};

async function main() {
  await loadCommandConfig();
  const handler = COMMAND_HANDLERS[command];
  if (handler) {
    await handler();
    return;
  }
  console.error(`Unknown command: ${command}`);
  await cmdHelp();
  process.exit(1);
}

main();
