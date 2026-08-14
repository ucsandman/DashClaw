// cli/lib/trial.js
//
// Shared hosted-trial signup flow. Turnstile cannot be driven headlessly, so
// every installer that mints a key against the hosted trial does it the same
// way: print/open the signup page, let the human sign in, accept the pasted
// key. Used by `dashclaw install claude --trial` and the `install openclaw`
// onboarding wizard.

import { spawnSync } from 'node:child_process';

// The public hosted trial instance. Falls back here when no endpoint is given —
// a cold outsider following QUICK-START has no way to answer a "which URL?"
// prompt (v5.4 outsider run).
export const DEFAULT_HOSTED_TRIAL_URL = 'https://hosted.dashclaw.io';

/** Prompt via `promptFn`, requiring a non-empty answer. */
export async function mustPrompt(promptFn, question) {
  if (!promptFn) {
    throw new Error(`Missing required value (${question.trim()}) and no interactive prompt available.`);
  }
  const answer = (await promptFn(question)).trim();
  if (!answer) throw new Error('Aborted — a value is required.');
  return answer;
}

/** Best-effort browser open; the URL is printed either way. */
export function defaultOpenUrl(url) {
  try {
    if (process.platform === 'win32') spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
    else if (process.platform === 'darwin') spawnSync('open', [url], { stdio: 'ignore' });
    else spawnSync('xdg-open', [url], { stdio: 'ignore' });
  } catch {
    // best-effort — the URL is printed either way
  }
}

/**
 * Open the hosted signup page and accept the pasted trial key.
 * Returns `{ baseUrl, apiKey }` with the trailing slash stripped.
 */
export async function promptTrialKey({ hostedBase, prompt, promptSecret, openUrl = defaultOpenUrl, logger = console }) {
  const base = String(hostedBase).replace(/\/+$/, '');
  const signupUrl = `${base}/connect`;
  logger.log('');
  logger.log(`  Opening the trial signup page: ${signupUrl}`);
  logger.log('  Sign in there, copy your trial API key, and paste it below.');
  openUrl(signupUrl);
  const apiKey = await mustPrompt(promptSecret || prompt, 'Paste your trial API key (oc_live_...): ');
  return { baseUrl: base, apiKey };
}
