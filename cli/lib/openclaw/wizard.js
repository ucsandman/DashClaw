// cli/lib/openclaw/wizard.js
//
// Interactive onboarding for `dashclaw install openclaw`.
//
// A bare invocation in a TTY used to die with "baseUrl is required" — the one
// command the guides lead with, failing the person with the least context.
// This wizard fills the gaps conversationally instead: no instance? offer the
// hosted trial or an inline `dashclaw up`; no key? mint/paste one; no agent
// id? suggest a per-machine default. Non-interactive callers (CI, scripts,
// piped stdin) are returned untouched so the installer's hard errors still
// fail loudly and nothing ever hangs on a prompt.
//
// This module only RESOLVES inputs. The pure installer (install.js) keeps all
// write-ordering guarantees; the wizard never touches openclaw.json or .env.

import { hostname } from 'node:os';
import { DEFAULT_HOSTED_TRIAL_URL, promptTrialKey, mustPrompt, defaultOpenUrl } from '../trial.js';

/** Per-machine default ledger identity: `<hostname-slug>-openclaw`. */
export function defaultAgentId(host = hostname()) {
  const slug = String(host || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `${slug}-openclaw` : 'openclaw';
}

async function askYesNo(prompt, question, def = true) {
  const answer = (await prompt(question)).trim().toLowerCase();
  if (!answer) return def;
  return answer !== 'n' && answer !== 'no';
}

/**
 * Resolve { baseUrl, apiKey, agentId } for `install openclaw`, prompting only
 * for what is missing. Returns `upHandle` (the running local server's
 * lifecycle handle) when the user chose an inline local install, so the caller
 * can keep the process attached the way `dashclaw up` does.
 *
 * @param {object} opts
 * @param {string|null} [opts.baseUrl]   From flags/env/saved config.
 * @param {string|null} [opts.apiKey]    From flags/env/saved config.
 * @param {string|null} [opts.agentId]   From --agent-id only (never defaulted before here).
 * @param {boolean} [opts.interactive]   stdin TTY; false returns inputs untouched.
 * @param {Function} opts.prompt         (question) => Promise<string>
 * @param {Function} [opts.promptSecret] Masked variant for keys.
 * @param {Function} [opts.openUrl]      Best-effort browser open.
 * @param {string} [opts.host]           Injectable hostname (tests).
 * @param {Function|null} [opts.runUpLocal]  async () => ({ baseUrl, apiKey, upHandle });
 *                                       absent means inline `up` is unavailable here.
 * @param {Function|null} [opts.readConfig]  () => object — ~/.dashclaw/config.json
 * @param {Function|null} [opts.writeConfig] (object) => void
 * @param {object} [opts.logger]
 */
export async function resolveOpenclawOnboarding({
  baseUrl = null,
  apiKey = null,
  agentId = null,
  interactive = process.stdin.isTTY,
  prompt,
  promptSecret,
  openUrl = defaultOpenUrl,
  host = hostname(),
  runUpLocal = null,
  readConfig = null,
  writeConfig = null,
  logger = console,
} = {}) {
  if (!interactive) return { baseUrl, apiKey, agentId, upHandle: null };

  let upHandle = null;
  let obtained = false; // did the wizard acquire a URL or key it should offer to save?

  if (!baseUrl) {
    const have = await askYesNo(prompt, 'Do you have a running DashClaw instance? [Y/n] ');
    if (have) {
      baseUrl = (await mustPrompt(prompt, 'DashClaw instance URL (e.g. https://your-dashclaw.vercel.app): ')).replace(/\/+$/, '');
      obtained = true;
    } else {
      logger.log('');
      logger.log('  Two ways to get one:');
      logger.log('    1. Hosted trial — free, nothing to run, ready in about a minute');
      logger.log('    2. Local install on this machine (`dashclaw up` — Docker or embedded Postgres)');
      const choice = (await mustPrompt(prompt, '  Which one? [1/2] ')).trim().toLowerCase();
      if (choice === '2' || choice.startsWith('local')) {
        if (!runUpLocal) {
          throw new Error('Inline local install is not available here. Run `dashclaw up` first, then re-run: dashclaw install openclaw');
        }
        const local = await runUpLocal();
        baseUrl = local.baseUrl.replace(/\/+$/, '');
        apiKey = apiKey || local.apiKey;
        upHandle = local.upHandle ?? null;
        obtained = true;
      } else {
        const trial = await promptTrialKey({ hostedBase: DEFAULT_HOSTED_TRIAL_URL, prompt, promptSecret, openUrl, logger });
        baseUrl = trial.baseUrl;
        apiKey = apiKey || trial.apiKey;
        obtained = true;
      }
    }
  }

  if (!apiKey) {
    if (baseUrl.replace(/\/+$/, '') === DEFAULT_HOSTED_TRIAL_URL) {
      const trial = await promptTrialKey({ hostedBase: baseUrl, prompt, promptSecret, openUrl, logger });
      apiKey = trial.apiKey;
    } else {
      logger.log(`  Get a key from ${baseUrl}/connect (or Settings → API keys on your instance).`);
      apiKey = await mustPrompt(promptSecret || prompt, 'API key (oc_live_...): ');
    }
    obtained = true;
  }

  if (!agentId) {
    const suggested = defaultAgentId(host);
    logger.log('  Give every machine its own agent id so /decisions can tell your fleet apart.');
    const answer = (await prompt(`Agent id for this machine [${suggested}]: `)).trim();
    agentId = answer || suggested;
  }

  if (obtained && readConfig && writeConfig) {
    const save = await askYesNo(prompt, 'Save the URL + key to ~/.dashclaw/config.json for future dashclaw commands? [Y/n] ');
    if (save) {
      try {
        writeConfig({ ...readConfig(), baseUrl, apiKey });
        logger.log('  Saved. Remove with: dashclaw logout');
      } catch (err) {
        logger.warn(`  Warning: could not save config: ${err.message}`);
      }
    }
  }

  return { baseUrl, apiKey, agentId, upHandle };
}
