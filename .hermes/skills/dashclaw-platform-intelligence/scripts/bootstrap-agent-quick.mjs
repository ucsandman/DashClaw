#!/usr/bin/env node

/**
 * DashClaw Quick Agent Bootstrap
 *
 * Wraps the full bootstrap scanner with sensible defaults for the most
 * common case: bootstrapping a local agent into a local DashClaw instance.
 *
 * Usage:
 *   node .claude/skills/dashclaw-platform-intelligence/scripts/bootstrap-agent-quick.mjs \
 *     --dir "/path/to/agent/workspace" \
 *     --agent-id "my-agent"
 *
 * Flags:
 *   --dir          Agent workspace directory (required)
 *   --agent-id     Agent identifier (required)
 *   --agent-name   Human-readable name (default: agent-id)
 *   --base-url     DashClaw server URL (default: http://localhost:3000)
 *   --api-key      API key (default: DASHCLAW_API_KEY env var)
 *   --dry-run      Preview payload without pushing
 *   --validate     After bootstrap, run the integration validator
 */

import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..');

const args = process.argv.slice(2);
function getFlag(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return args[idx + 1] || fallback;
}
const hasFlag = (name) => args.includes(`--${name}`);

const AGENT_DIR = getFlag('dir', '');
const AGENT_ID = getFlag('agent-id', '');
const AGENT_NAME = getFlag('agent-name', AGENT_ID);
const BASE_URL = getFlag('base-url', process.env.DASHCLAW_BASE_URL || 'http://localhost:3000');
const API_KEY = getFlag('api-key', process.env.DASHCLAW_API_KEY || '');
const DRY_RUN = hasFlag('dry-run');
const VALIDATE = hasFlag('validate');

function log(msg) { console.log(msg); }
function fail(msg) { console.error(`[ERROR] ${msg}`); process.exit(1); }

async function main() {
  log('');
  log('DashClaw Quick Agent Bootstrap');
  log('='.repeat(50));

  if (!AGENT_DIR) fail('--dir is required (path to agent workspace)');
  if (!AGENT_ID) fail('--agent-id is required');

  const resolvedDir = resolve(AGENT_DIR);
  if (!existsSync(resolvedDir)) fail(`Agent directory not found: ${resolvedDir}`);

  log(`Agent:     ${AGENT_NAME} (${AGENT_ID})`);
  log(`Directory: ${resolvedDir}`);
  log(`Server:    ${BASE_URL}`);
  log(`Mode:      ${DRY_RUN ? 'Dry run (preview only)' : 'Live (will push data)'}`);
  log('');

  if (!DRY_RUN) {
    log('Checking server connectivity...');
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (!res.ok) {
        log(`[WARN] Server returned ${res.status}. Proceeding anyway.`);
      } else {
        log('[OK] Server is reachable.');
      }
    } catch (err) {
      fail(`Cannot reach ${BASE_URL}: ${err.message}\nIs the server running? (npm run dev)`);
    }
    log('');
  }

  const bootstrapScript = resolve(PROJECT_ROOT, 'scripts', 'bootstrap-agent.mjs');
  if (!existsSync(bootstrapScript)) {
    fail(`Bootstrap script not found at ${bootstrapScript}`);
  }

  const bootstrapArgs = [
    bootstrapScript,
    '--dir', resolvedDir,
    '--agent-id', AGENT_ID,
    '--agent-name', AGENT_NAME,
    '--base-url', BASE_URL,
  ];
  if (API_KEY) bootstrapArgs.push('--api-key', API_KEY);
  if (DRY_RUN) bootstrapArgs.push('--dry-run');

  log('Running bootstrap scanner...');
  log(`> node ${bootstrapScript} --dir "${resolvedDir}" --agent-id "${AGENT_ID}"`);
  log('');

  try {
    execFileSync('node', bootstrapArgs, { stdio: 'inherit', cwd: PROJECT_ROOT });
  } catch (err) {
    fail(`Bootstrap scanner failed with exit code ${err.status}`);
  }

  if (VALIDATE && !DRY_RUN) {
    log('');
    log('Running integration validation...');
    const validateScript = resolve(__dirname, 'validate-integration.mjs');
    const validateArgs = [
      validateScript,
      '--base-url', BASE_URL,
      '--agent-id', AGENT_ID,
      '--full',
    ];
    if (API_KEY) validateArgs.push('--api-key', API_KEY);

    try {
      execFileSync('node', validateArgs, { stdio: 'inherit' });
    } catch {
      log('[WARN] Validation reported issues. Review the output above.');
    }
  }

  log('');
  log('Bootstrap complete.');
  if (DRY_RUN) {
    log('This was a dry run. Remove --dry-run to push data to DashClaw.');
  } else {
    log(`Visit ${BASE_URL}/workspace to see your agent's imported data.`);
  }
}

main();
