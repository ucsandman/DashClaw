#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DashClaw } from 'dashclaw';
import {
  bold, dim, inverse, colorByRisk, clearScreen,
  moveCursor, hideCursor, showCursor,
  green, red,
} from '../lib/render.js';
import { runDoctor as runDoctorCommand } from '../lib/doctor.js';
import { resolveConfig, clearConfigFile, configPath, ask, askSecret } from '../lib/config.js';
import { installCodex, codexConfigPath, codexHooksDir } from '../lib/codex/install.js';
import { installClaude } from '../lib/claude/install.js';
import { upCommand, runDown, resolveBaseDir } from '../lib/up/index.js';
import { runCodexNotify } from '../lib/codex/notify.js';
import { apiRequest } from '../lib/api.js';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  // exitCode (not process.exit) — a hard exit during in-flight I/O trips a
  // libuv teardown assert on Windows.
  process.exitCode = 1;
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

function runSubcommand(table, sub, errorMessage) {
  const handler = table[sub];
  if (handler) return handler();
  console.error(errorMessage(sub));
  process.exitCode = 1;
}

// -- Commands -----------------------------------------------------------------

async function cmdHelp() {
  console.log(`
${bold('DashClaw CLI')} — terminal approval client

${bold('Usage:')}
  dashclaw up                            Install + start a local DashClaw (one command, resumable)
    --update                             Re-fetch + rebuild from the latest published version
    --yes                                Non-interactive (auto-pick DB, auto-connect Claude Code)
    --db docker|embedded|url             Database mode (default: prompt; docker if detected)
    --port <n>                           Server port (default: 3000)
    --no-browser                         Do not open the browser when ready
  dashclaw down                          Stop the local DashClaw server (and Docker DB if we started it)
  dashclaw import <bundle.json>          Import a workspace carry-out bundle (from /api/workspace/export)
                                         into this instance — idempotent; keys/secrets never ride a bundle
  dashclaw approvals                     Interactive approval inbox
  dashclaw approve <actionId> [--reason]  Approve an action
  dashclaw deny <actionId> [--reason]     Deny an action
  dashclaw halt on|off|status [--reason]  Org kill switch: halt/resume every governed action (admin)
  dashclaw contained list                List actions awaiting containment promotion
  dashclaw contained diff <actionId>     Print the captured patch diff for a contained action
  dashclaw contained apply <actionId>    Governed merge: run the promoted action's containment_ref
                                         merge, guarded by the operator's promote grant
  dashclaw doctor                        Diagnose your instance + this machine (report-only)
    --fix                                Apply safe auto-fixes, then re-check and report
    --json                               Output as JSON (for CI/scripts)
    --no-fix                             Accepted no-op alias (report-only is the default)
    --category <list>                    Filter remote checks (e.g., database,config)
    --repo <path>                        Treat <path> as the DashClaw checkout for repo checks
  dashclaw install claude [--trial]      Provision DashClaw governance into Claude Code
    --endpoint <url>                     Your DashClaw instance URL (or DASHCLAW_BASE_URL;
                                         --trial defaults to https://hosted.dashclaw.io)
    --key <key>                          API key (or DASHCLAW_API_KEY; --trial prompts via browser signup)
    --agent-id <id>                      Agent id for governed actions (default: claude-code)
    --observe                            Start in observe mode (fresh installs default to enforce)
  dashclaw install codex                 Provision DashClaw governance into Codex CLI
    --project <path>                     Project to receive AGENTS.md (default: cwd)
    --approval-policy <p>                Codex approval_policy (default: on-request)
    --include-notify                     Also wire Codex's notify config to dashclaw codex notify
  dashclaw codex notify '<json>'         Record a Codex turn-complete event
                                         (called by Codex's notify config; always exits 0)
  dashclaw logout                        Remove saved config (~/.dashclaw/config.json)
  dashclaw version                       Print the CLI version
  dashclaw help                          Show this help

${bold('Config:')}
  On first run, prompts for DASHCLAW_BASE_URL and DASHCLAW_API_KEY and offers
  to save them to ~/.dashclaw/config.json (mode 600). Env vars always override
  the saved values.
`);
}

async function cmdVersion() {
  const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  console.log(pkg.version);
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
  const fixFlag = args.includes('--fix');
  const noFixFlag = args.includes('--no-fix');
  const catIdx = args.indexOf('--category');
  const catValue = catIdx !== -1 ? args[catIdx + 1] : undefined;
  const repoIdx = args.indexOf('--repo');
  const repoValue = repoIdx !== -1 ? args[repoIdx + 1] : undefined;
  const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  await runDoctorCommand({
    baseUrl,
    apiKey,
    json: jsonFlag,
    fix: fixFlag,
    noFix: noFixFlag,
    category: catValue,
    repo: repoValue,
    cliVersion: pkg.version,
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

async function cmdHalt() {
  const sub = args[1];
  if (!['on', 'off', 'status'].includes(sub || '')) {
    console.error('Usage: dashclaw halt on|off|status [--reason "<why>"]');
    process.exitCode = 1;
    return;
  }
  try {
    if (sub === 'status') {
      const { halt } = await apiRequest({ baseUrl, apiKey }, 'GET', '/api/halt');
      if (halt?.halted) {
        console.log(`
  ${red('HALTED')} — every governed action for this org is blocked.`);
        console.log(`  By:     ${halt.actor || 'admin'}`);
        console.log(`  Reason: ${halt.reason || '(none given)'}`);
        console.log(`  Since:  ${halt.at || 'unknown'}
`);
      } else {
        console.log(`
  ${green('Running')} — org is not halted.
`);
      }
      return;
    }
    const halted = sub === 'on';
    const reason = getFlag('--reason') || null;
    const { halt } = await apiRequest({ baseUrl, apiKey }, 'POST', '/api/halt', { body: { halted, reason } });
    if (halted) {
      console.log(`
  ${red('HALTED')} — every governed action for this org now blocks immediately.`);
      if (halt?.reason) console.log(`  Reason: ${halt.reason}`);
      console.log(`  Resume with: dashclaw halt off
`);
    } else {
      console.log(`
  ${green('Resumed')} — guard evaluation is back to normal.
`);
    }
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      console.error('Rejected (admin access required). The kill switch needs an admin API key.');
    } else {
      console.error(`Halt request failed: ${err.message}`);
    }
    process.exitCode = 1;
  }
}

async function cmdInstallClaude() {
  try {
    const result = await installClaude({
      endpoint: getFlag('--endpoint') || baseUrl,
      apiKey: getFlag('--key') || apiKey,
      agentId: getFlag('--agent-id') || undefined,
      trial: args.includes('--trial'),
      observe: args.includes('--observe'),
      prompt: ask,
      promptSecret: askSecret,
      logger: console,
    });
    console.log();
    console.log(`  ${green('Done.')} Claude Code governance installed (mode: ${result.hookMode}).`);
  } catch (err) {
    console.error(red(`Error: ${err.message}`));
    process.exit(1);
  }
}

async function cmdInstall() {
  const target = args[1];
  switch (target) {
    case 'codex':
      return cmdInstallCodex();
    case 'claude':
      return cmdInstallClaude();
    default:
      console.error(`Unknown install target: dashclaw install ${target || '(missing)'}\n` +
                    'Try: dashclaw install claude [--trial] | dashclaw install codex [--project <path>]');
      process.exitCode = 1;
  }
}

// -- import (v7.2 graduation path) --------------------------------------------

/*
 * Ingest a workspace carry-out bundle (the file /api/workspace/export
 * downloads) into the configured instance. HTTP like every other post-up
 * command; the route is idempotent so re-running is safe.
 */
async function cmdImport() {
  const file = args[1];
  if (!file || file.startsWith('--')) {
    console.error('Usage: dashclaw import <bundle.json>   (the file downloaded from your trial\'s "Export workspace")');
    process.exitCode = 1;
    return;
  }
  try {
    let bundle;
    try {
      bundle = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(err.code === 'ENOENT' ? `File not found: ${file}` : `${file} is not valid JSON`);
    }
    const data = await apiRequest({ baseUrl, apiKey }, 'POST', '/api/workspace/import', { body: bundle });
    console.log(green(`Imported ${data.imported} rows (${data.skipped} skipped — already present or missing their id).`));
    for (const [table, c] of Object.entries(data.counts || {})) {
      console.log(`  ${table}: +${c.imported}${c.skipped ? ` (${c.skipped} skipped)` : ''}`);
    }
  } catch (err) {
    console.error(red(`Error: ${err.message}`));
    process.exitCode = 1;
  }
}

// -- contained (Containment Verdicts, RFC 2026-07-06) -------------------------
//
// `dashclaw contained list|diff|apply` — the operator/agent-facing CLI for the
// contained -> awaiting_promotion -> promoted -> merged lifecycle. `list` and
// `diff` are read-only; `apply` runs the governed merge once an operator has
// promoted the action from the dashboard.

// Pinned to app/lib/guard/containment.ts buildPromotionGoal/buildPromotionAct
// — the CLI never imports app/** code, so these two tiny string builders are
// duplicated here byte-for-byte. If those change, mirror the change here too;
// a mismatch means the guard call's act/goal no longer matches the operator's
// pre-approved grant and `apply` never resolves to allow.
function buildPromotionGoal(containedActionId) {
  return `containment promote ${containedActionId}`;
}
function buildPromotionAct(containmentRef) {
  return { kind: 'shell', command: `git merge --no-ff ${containmentRef}` };
}

// Mirrors hooks/dashclaw_pretool.py _safe_branch_segment: branch_seg is
// alnum+dash, max 64 chars. Used as a defensive assertion before `git merge`
// / `git worktree remove` in cmdContainedApply below.
const CONTAINMENT_REF_PATTERN = /^dashclaw\/contained-[A-Za-z0-9-]{1,64}$/;

// Mirrors hooks/dashclaw_pretool.py _ensure_containment_worktree: ref is
// "dashclaw/contained-<branch_seg>"; the worktree lives at
// .dashclaw/contained/<branch_seg> relative to the repo root. Returned as a
// path relative to the repo root (git resolves it against cwd).
function containmentWorktreePath(ref) {
  const branchSeg = ref.replace(/^dashclaw\/contained-/, '');
  return `.dashclaw/contained/${branchSeg}`;
}

function gitRepoRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function formatAge(iso) {
  if (!iso) return '-';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '-';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function renderContainedRow(action) {
  const id = String(action.action_id || action.id || '-').padEnd(38);
  const agent = String(action.agent_id || '-').padEnd(14);
  const ref = String(action.containment_ref || '-').padEnd(32);
  const age = formatAge(action.timestamp_start || action.created_at);
  return `  ${id}${agent}${ref}${age}`;
}

async function cmdContainedList() {
  // listContained() is a brand-new SDK method (this feature) the PUBLISHED
  // npm package doesn't have yet (see cli/lib/api.js's doc comment) — go
  // straight through the raw endpoint instead of createClient().listContained().
  //
  // Defensively re-filters client-side: GET /api/actions forwards the
  // containment_status query param to the repository (fixed in ade87aec),
  // but this belt-and-suspenders filter stays in place against a server
  // running an older build or a client-side proxy that drops query params.
  try {
    const { actions } = await apiRequest({ baseUrl, apiKey }, 'GET', '/api/actions', {
      query: { containment_status: 'awaiting_promotion' },
    });
    const rows = (actions || []).filter((a) => a && a.containment_status === 'awaiting_promotion');
    if (rows.length === 0) {
      console.log(dim('\n  No contained actions awaiting promotion.\n'));
      return;
    }
    console.log(`\n  ${bold('Action'.padEnd(38))}${bold('Agent'.padEnd(14))}${bold('Ref'.padEnd(32))}${bold('Age')}`);
    for (const action of rows) console.log(renderContainedRow(action));
    console.log();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

async function cmdContainedDiff() {
  const actionId = args[2];
  if (!actionId) {
    console.error('Usage: dashclaw contained diff <actionId>');
    process.exitCode = 1;
    return;
  }
  try {
    const { action } = await createClient().getAction(actionId);
    if (!action) {
      console.error(`Error: action ${actionId} not found.`);
      process.exitCode = 1;
      return;
    }
    const { artifacts } = await apiRequest({ baseUrl, apiKey }, 'GET', `/api/actions/${actionId}/artifacts`);
    // listArtifacts orders newest-first, so the first 'patch' match is the
    // latest captured diff.
    const patch = (artifacts || []).find((a) => a && a.artifact_type === 'patch');
    if (!patch) {
      const ref = action.containment_ref;
      const hint = ref ? ` at ${containmentWorktreePath(ref)} (ref ${ref})` : '';
      console.error(`No diff artifact captured; the containment worktree may still exist${hint}.`);
      process.exitCode = 1;
      return;
    }
    // The artifacts route shapes rows via shapeArtifact() (artifacts.repository.ts),
    // which already JSON.parses the stored content_json column into `content` —
    // there is no content_json key on the wire, only `content`.
    const content = patch.content;
    if (content && content.truncated) {
      console.error('Note: diff was truncated at capture time (large changeset) — this may not be the full diff.');
    }
    process.stdout.write((content && content.diff) || '');
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

async function cmdContainedApply() {
  const actionId = args[2];
  if (!actionId) {
    console.error('Usage: dashclaw contained apply <actionId>');
    process.exitCode = 1;
    return;
  }

  const claw = createClient();
  let action;
  try {
    ({ action } = await claw.getAction(actionId));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (!action) {
    console.error(`Error: action ${actionId} not found.`);
    process.exitCode = 1;
    return;
  }
  // Server is the source of truth: only a dashboard 'promote' verdict flips
  // containment_status to 'promoted'. Never trust a local/cached copy.
  if (action.containment_status !== 'promoted') {
    console.error(
      `Refusing: ${actionId} is not promoted (containment_status: ${action.containment_status || 'none'}).\n` +
      `Promote it from the dashboard first.`
    );
    process.exitCode = 1;
    return;
  }
  const ref = action.containment_ref;
  if (!ref) {
    console.error(`Error: ${actionId} is promoted but has no containment_ref recorded — cannot merge.`);
    process.exitCode = 1;
    return;
  }
  // LOW (2026-07-27) defensive assertion: the server is the only writer of
  // containment_ref today (regex-validated at creation, hooks/dashclaw_pretool.py
  // _safe_branch_segment), so this is belt-and-suspenders, not the primary
  // guard. It keeps the CLI safe against `git merge --no-ff <ref>` /
  // `git worktree remove` running against an arbitrary string if a future
  // writer ever skips that server-side check.
  if (!CONTAINMENT_REF_PATTERN.test(ref)) {
    console.error(`Error: containment_ref "${ref}" does not match the expected pattern (dashclaw/contained-<id>) — refusing to merge.`);
    process.exitCode = 1;
    return;
  }

  const repoRoot = gitRepoRoot(process.cwd());
  if (!repoRoot) {
    console.error('Error: not inside a git repository. Run this from the governed project checkout.');
    process.exitCode = 1;
    return;
  }

  let decision;
  try {
    decision = await claw.guard({
      agent_id: action.agent_id,
      action_type: 'containment_promote',
      declared_goal: buildPromotionGoal(actionId),
      act: buildPromotionAct(ref),
      risk_score: 20,
    });
  } catch (err) {
    console.error(`Error: guard evaluation failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (decision.decision === 'require_approval') {
    console.error(
      'Promote in the dashboard first (or the 15-minute approval window expired).\n' +
      `Re-issue the merge grant at ${baseUrl}/decisions/${actionId}`
    );
    process.exitCode = 1;
    return;
  }
  if (decision.decision !== 'allow') {
    console.error(`${decision.decision}: ${decision.reason || '(no reason given)'}`);
    process.exitCode = 1;
    return;
  }

  try {
    const mergeOutput = execFileSync('git', ['merge', '--no-ff', ref], { cwd: repoRoot, encoding: 'utf8' });
    process.stdout.write(mergeOutput);
  } catch (err) {
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    console.error(
      '\nMerge failed. Grant consumed. Resolve manually and commit, or re-issue the merge grant at ' +
      `${baseUrl}/decisions/${actionId}`
    );
    process.exitCode = 1;
    return;
  }

  // The synthetic containment_promote action's id is never returned as a
  // structured field — guard()'s response only embeds it in a human-readable
  // `signals` string ("Covered by operator approval <id> ...") when the
  // operator-approval grant matches, and there's no SDK/API method to look it
  // up by tuple otherwise. Skipping the outcome PATCH rather than parsing
  // free text for an id; the merge itself already succeeded.
  console.error('Note: skipping promotion-action outcome update (no structured way to resolve its action id from here).');

  const worktreePath = containmentWorktreePath(ref);
  try {
    execFileSync('git', ['worktree', 'remove', worktreePath], { cwd: repoRoot, stdio: 'pipe' });
    execFileSync('git', ['branch', '-d', ref], { cwd: repoRoot, stdio: 'pipe' });
    console.log(green(`\nMerged and cleaned up: worktree + branch ${ref} removed.\n`));
  } catch (err) {
    // Cleanup failure isn't a command failure — the merge already succeeded.
    console.error(`\nMerge succeeded, but cleanup failed: ${err.message}`);
    console.error(`Run manually:\n  git worktree remove ${worktreePath}\n  git branch -d ${ref}`);
  }
}

async function cmdContained() {
  return runSubcommand({
    list: cmdContainedList,
    diff: cmdContainedDiff,
    apply: cmdContainedApply,
  }, args[1], (sub) => `Unknown subcommand: dashclaw contained ${sub || '(missing)'}\n` +
    'Try: dashclaw contained list | diff <actionId> | apply <actionId>');
}

// -- up / down (one-command local install) -----------------------------------

async function cmdUp() {
  try {
    await upCommand(args.slice(1));
  } catch (err) {
    console.error(red(`Error: ${err.message}`));
    process.exitCode = 1;
  }
}

async function cmdDown() {
  try {
    // Parse --dir so `dashclaw down --dir /path` targets the right state directory.
    const downArgv = args.slice(1);
    const dirIdx = downArgv.indexOf('--dir');
    const dir = dirIdx !== -1 ? downArgv[dirIdx + 1] : null;
    const baseDir = resolveBaseDir({ dir });
    await runDown({ baseDir });
  } catch (err) {
    console.error(red(`Error: ${err.message}`));
    process.exitCode = 1;
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
  try {
    await runCodexNotify({
      argv: notifyArgv,
      baseUrl,
      apiKey,
      agentId: agentId || 'codex',
      logger: console,
    });
  } catch {
    // Best-effort by contract: Codex must never see a failure from its
    // notify hook, so errors are swallowed and we still exit 0.
  }
  process.exit(0);
}

async function cmdCodex() {
  return runSubcommand({
    notify: cmdCodexNotify,
  }, args[1], (sub) => `Unknown subcommand: dashclaw codex ${sub || '(missing)'}\n` +
    'Try: dashclaw codex notify \'<json>\'   (called by Codex notify config)');
}

// -- Router -------------------------------------------------------------------

const COMMANDS_NEEDING_CONFIG = new Set(['approvals', 'approve', 'deny', 'doctor', 'halt', 'import', 'contained']);
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
  up: cmdUp,
  down: cmdDown,
  import: cmdImport,
  install: cmdInstall,
  codex: cmdCodex,
  halt: cmdHalt,
  contained: cmdContained,
  help: cmdHelp,
  '--help': cmdHelp,
  '-h': cmdHelp,
  version: cmdVersion,
  '--version': cmdVersion,
  '-v': cmdVersion,
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
  process.exitCode = 1;
}

main();
