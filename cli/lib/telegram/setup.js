// cli/lib/telegram/setup.js
//
// The Telegram approval-bridge setup wizard, shared by two front doors:
//   - `dashclaw install telegram` (published CLI — no repo clone required)
//   - `npm run telegram:setup` (repo shim, scripts/telegram-setup-wizard.mjs)
//
// Walks the operator through wiring a bot to their DashClaw deploy:
//   1. Prompts for the @BotFather token
//   2. Auto-discovers the admin chat ID via getUpdates
//   3. Generates the webhook secret
//   4. Prompts for the deploy URL
//   5. Prompts for the DashClaw API key and auto-discovers the org ID
//   6. Prints the four env vars to paste into the deploy's environment
//   7. Registers the webhook with Telegram's Bot API
//   8. Optionally runs the round-trip smoke test
//
// The wizard is interactive by nature (BotFather + "message your bot" chat-id
// discovery cannot be scripted), so callers inject prompt/promptSecret; the
// CLI passes its EOF-loud ask/askSecret so a piped stdin fails instead of
// hanging. This module performs no repo-relative I/O — the optional local
// .env write only happens when the caller passes `localEnvPath`.

import { randomBytes } from 'node:crypto';
import { writeFile, readFile, access, constants } from 'node:fs/promises';

const TELEGRAM_API = 'https://api.telegram.org';

export function redactSecret(s, keep = 4) {
  if (!s || s.length < keep * 2) return '[hidden]';
  return `${s.slice(0, keep)}...${s.slice(-keep)}`;
}

export function buildTelegramEnvBlock({ token, chatId, webhookSecret, orgId }) {
  return [
    `TELEGRAM_BOT_TOKEN=${token}`,
    `TELEGRAM_ADMIN_CHAT_ID=${chatId}`,
    `TELEGRAM_WEBHOOK_SECRET=${webhookSecret}`,
    `TELEGRAM_APPROVER_ORG_ID=${orgId}`,
  ].join('\n');
}

/** Upsert the four TELEGRAM_* lines into an existing env-file body. */
export function upsertEnvLines(existing, values) {
  const updates = {
    TELEGRAM_BOT_TOKEN: values.token,
    TELEGRAM_ADMIN_CHAT_ID: values.chatId,
    TELEGRAM_WEBHOOK_SECRET: values.webhookSecret,
    TELEGRAM_APPROVER_ORG_ID: values.orgId,
  };
  let updated = existing;
  for (const [k, v] of Object.entries(updates)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, 'm');
    if (re.test(updated)) updated = updated.replace(re, line);
    else updated = (updated && !updated.endsWith('\n') ? updated + '\n' : updated) + line + '\n';
  }
  return updated;
}

async function tgCall(token, method, body) {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description || res.status}`);
  }
  return data.result;
}

async function validateToken(token) {
  try {
    return await tgCall(token, 'getMe');
  } catch {
    return null;
  }
}

/**
 * Run the full 8-step wizard.
 *
 * @param {object} opts
 * @param {string|null} [opts.baseUrl]   Prefilled deploy URL (flag/env/saved config)
 * @param {string|null} [opts.apiKey]    Prefilled admin API key
 * @param {(q: string) => Promise<string>} opts.prompt
 * @param {(q: string) => Promise<string>} opts.promptSecret
 * @param {{ log: Function, error: Function }} [opts.logger]
 * @param {string|null} [opts.localEnvPath]  When set, offer to upsert the env
 *   vars into this file (the repo shim passes its .env; the CLI passes null).
 */
export async function runTelegramSetup({
  baseUrl = null,
  apiKey = null,
  prompt,
  promptSecret,
  logger = console,
  localEnvPath = null,
}) {
  const log = (s = '') => logger.log(s);
  const err = (s) => logger.error(s);

  async function ask(q, def) {
    const raw = await prompt(def !== undefined ? `${q} [${def}] ` : `${q} `);
    return raw.trim() || def || '';
  }

  async function askYesNo(q, defYes = true) {
    const raw = (await prompt(q + (defYes ? ' [Y/n] ' : ' [y/N] '))).trim().toLowerCase();
    if (!raw) return defYes;
    return raw.startsWith('y');
  }

  async function askSecret(q, def) {
    const raw = (await promptSecret(def ? `${q} [${redactSecret(def, 6)}] ` : `${q} `)).trim();
    return raw || def || '';
  }

  async function pause(q) {
    await prompt(q);
  }

  // -- Step 1: bot token ------------------------------------------------------
  async function step1Token() {
    log('\n=== Step 1 of 8: Create the bot ===\n');
    log('  1. Open Telegram (phone or desktop).');
    log('  2. Message @BotFather:  https://t.me/BotFather');
    log('  3. Send  /newbot');
    log('  4. Pick a display name, then a username ending in "bot".');
    log('  5. BotFather will reply with an HTTP API token.');
    log('');
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = await askSecret('Paste the token from BotFather:');
      if (!token) {
        err('  A bot token is required.');
        continue;
      }
      log('  Validating with Telegram...');
      const me = await validateToken(token);
      if (!me) {
        err('  Telegram rejected that value. Try again.');
        continue;
      }
      log(`  OK (bot: @${me.username})`);
      return { token, bot: me };
    }
    throw new Error('Failed to validate the bot token after 3 attempts.');
  }

  // -- Step 2: chat id --------------------------------------------------------
  async function ensureGetUpdatesWorks(token) {
    const info = await tgCall(token, 'getWebhookInfo');
    if (info?.url) {
      log(`\n  Note: a webhook is currently registered at ${info.url}`);
      log('  I need to remove it temporarily so I can read your chat ID from');
      log('  Telegram. I will re-register a new webhook at the end.');
      const proceed = await askYesNo('  OK to temporarily remove the existing webhook?', true);
      if (!proceed) throw new Error('Cannot discover chat ID while webhook is active.');
      await tgCall(token, 'deleteWebhook', { drop_pending_updates: false });
      log('  Existing webhook cleared.');
    }
  }

  async function step2ChatId(token, bot) {
    log('\n=== Step 2 of 8: Discover your admin chat ID ===\n');
    await ensureGetUpdatesWorks(token);
    log('');
    log(`  Open a chat with @${bot.username} (the bot you just created —`);
    log('  NOT BotFather) and send it any message. "hi" works.');
    log('');
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt === 0) {
        await pause("  Press Enter once you've messaged the bot... ");
      }
      log('  Checking for your message...');
      const updates = await tgCall(token, 'getUpdates');
      const chats = new Map();
      for (const u of updates || []) {
        const m = u.message || u.edited_message;
        if (!m || !m.chat) continue;
        chats.set(m.chat.id, { chat: m.chat, from: m.from });
      }
      log(`  Found ${chats.size} chat(s).`);

      if (chats.size === 0) {
        err('  No messages from you yet. Send one to the bot and try again.');
        if (attempt < 4) await pause('  Press Enter to retry... ');
        continue;
      }

      if (chats.size === 1) {
        const [[id, { chat, from }]] = [...chats];
        log(`  Found: ${chat.type} chat, id=${id}${from?.username ? ` (@${from.username})` : ''}`);
        if (chat.type !== 'private') {
          err('  WARNING: this is a group/channel. Telegram approval only works in');
          err('  a 1:1 DM with the bot — group chat.id != user.id and the allowlist');
          err('  check will reject every callback. Start a DM with the bot and retry.');
          if (await askYesNo('  Use this chat ID anyway?', false)) return String(id);
          continue;
        }
        return String(id);
      }

      log('  Multiple chats found:');
      const list = [...chats.entries()];
      list.forEach(([id, { chat, from }], i) => {
        log(`    ${i + 1}. id=${id} (${chat.type}${from?.username ? `, @${from.username}` : ''})`);
      });
      const pick = await ask('  Pick one (number):', '1');
      const idx = Math.max(1, Math.min(list.length, parseInt(pick, 10) || 1)) - 1;
      return String(list[idx][0]);
    }
    throw new Error('Could not discover a chat ID.');
  }

  // -- Step 3: webhook secret -------------------------------------------------
  function step3Secret() {
    log('\n=== Step 3 of 8: Generate webhook secret ===\n');
    const webhookSecret = randomBytes(32).toString('hex');
    log(`  Generated 64-char value: ${redactSecret(webhookSecret, 6)}`);
    return webhookSecret;
  }

  // -- Step 4: deploy URL -----------------------------------------------------
  async function step4DeployConfig() {
    log('\n=== Step 4 of 8: DashClaw deploy URL ===\n');
    log('  Telegram delivers button taps over a webhook, so this URL must be');
    log('  reachable from the internet (a laptop-only http://localhost instance');
    log("  won't receive them).");
    log('');
    for (;;) {
      const answer = await ask(
        '  Your DashClaw deploy URL (e.g. https://my-dashclaw.vercel.app):',
        baseUrl && /^https:\/\//.test(baseUrl) ? baseUrl.replace(/\/$/, '') : undefined
      );
      if (!answer) { err('  Required.'); continue; }
      if (!/^https:\/\//.test(answer)) {
        err("  Must start with https:// (Telegram won't call http URLs).");
        continue;
      }
      return { deployUrl: answer.replace(/\/$/, '') };
    }
  }

  // -- Step 5: API key + org --------------------------------------------------
  async function step5ApiKeyAndOrg(deployUrl) {
    log('\n=== Step 5 of 8: DashClaw API key + org discovery ===\n');
    log('  I need your DashClaw admin API key to auto-discover the org ID that');
    log('  your actions will be created under. Get one from');
    log(`  ${deployUrl}/settings (API Keys section) if you don't have one.`);
    log('');
    log('  Why: TELEGRAM_APPROVER_ORG_ID must match the org your API key resolves');
    log("  to — otherwise webhook callbacks can't find your pending actions.");
    log('');

    const envDefault = apiKey || process.env.DASHCLAW_API_KEY || undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      const key = await askSecret('  Paste your DASHCLAW_API_KEY (oc_live_...):', envDefault);
      if (!key) {
        err('  An API key is required.');
        continue;
      }

      log('  Validating key and discovering org...');
      let res;
      try {
        res = await fetch(`${deployUrl}/api/orgs`, {
          headers: { 'x-api-key': key },
          signal: AbortSignal.timeout(10000),
        });
      } catch (e) {
        err(`  Request failed: ${e.message}`);
        err(`  Check that ${deployUrl} is reachable and is the correct deploy URL.`);
        continue;
      }

      if (res.status === 401) {
        err('  Your API key was rejected. Check the oc_live_... value is correct');
        err('  and that the deploy URL is right.');
        continue;
      }
      if (res.status === 403) {
        err('  API key lacks admin role — only admin-role keys can discover org');
        err('  info. Create or use an admin key from /settings -> API Keys.');
        continue;
      }
      if (!res.ok) {
        err(`  Unexpected ${res.status} from ${deployUrl}/api/orgs: ${await res.text().catch(() => '')}`);
        continue;
      }

      let body;
      try {
        body = await res.json();
      } catch {
        err('  Response was not JSON. Is this a DashClaw deploy?');
        continue;
      }

      const orgs = Array.isArray(body?.organizations) ? body.organizations : [];
      if (orgs.length === 0) {
        throw new Error(
          'Your API key resolved but no orgs were returned — this is unusual. ' +
          'Please create an org first via /setup or the dashboard.'
        );
      }

      let chosen;
      if (orgs.length === 1) {
        chosen = orgs[0];
      } else {
        log('  Multiple orgs found — pick one:');
        orgs.forEach((o, i) => {
          log(`    ${i + 1}. ${o.name || '(unnamed)'} (id=${o.id})`);
        });
        const pick = await ask('  Pick one (number):', '1');
        const idx = Math.max(1, Math.min(orgs.length, parseInt(pick, 10) || 1)) - 1;
        chosen = orgs[idx];
      }

      log(`  Discovered org: ${chosen.name || '(unnamed)'} (id=${chosen.id})`);
      return { apiKey: key, orgId: chosen.id };
    }
    throw new Error('Failed to validate the API key after 3 attempts.');
  }

  // -- Step 6: env vars -------------------------------------------------------
  async function maybeWriteLocalEnv(values) {
    if (!localEnvPath) return;
    if (!(await askYesNo('  Also write these to a local .env for dev?', false))) return;
    let existing = '';
    let fileExists = false;
    try {
      await access(localEnvPath, constants.F_OK);
      fileExists = true;
      existing = await readFile(localEnvPath, 'utf8');
    } catch { /* no existing .env */ }
    let updated = upsertEnvLines(existing, values);
    if (!existing) {
      updated = '# DashClaw local dev env — DO NOT COMMIT\n' + updated;
    }
    const writeOpts = fileExists ? { encoding: 'utf8' } : { encoding: 'utf8', mode: 0o600 };
    await writeFile(localEnvPath, updated, writeOpts);
    log(`  Updated ${localEnvPath}`);
  }

  async function step6EnvVars(values) {
    log('\n=== Step 6 of 8: Environment variables ===\n');
    log("  Copy these into your deploy's environment variables (on Vercel:");
    log('  Settings -> Environment Variables, Production scope):\n');
    log('  ----------------------------------------------------------------');
    for (const line of buildTelegramEnvBlock(values).split('\n')) log(`  ${line}`);
    log('  ----------------------------------------------------------------\n');
    log("  Tip: scope them to Production only — don't mirror to Preview,");
    log('  or a preview deploy can steal the webhook from prod.');
    log('');
    log('  After adding, redeploy so the new env vars take effect.');
    await pause("  Press Enter once you've set these on your deploy (or skip for dev-only)... ");
    await maybeWriteLocalEnv(values);
  }

  // -- Step 7: webhook --------------------------------------------------------
  async function step7RegisterWebhook({ token, webhookSecret, deployUrl }) {
    log('\n=== Step 7 of 8: Register the webhook with Telegram ===\n');
    const webhookUrl = `${deployUrl}/api/telegram/webhook`;
    log(`  Target: ${webhookUrl}`);

    const info = await tgCall(token, 'getWebhookInfo');
    if (info?.url && info.url !== webhookUrl) {
      log(`  Existing webhook: ${info.url}`);
      if (!(await askYesNo('  Replace it with the new one?', true))) {
        err('  Skipped. Re-run this wizard later to register the webhook.');
        return;
      }
    }

    await tgCall(token, 'setWebhook', { url: webhookUrl, secret_token: webhookSecret });
    log('  Webhook registered.');
  }

  // -- Step 8: smoke test -----------------------------------------------------
  async function step8SmokeTest({ deployUrl, apiKey: key }) {
    log('\n=== Step 8 of 8: Round-trip smoke test (optional) ===\n');
    log("  I can create a test approval right now. It'll hit your phone as a");
    log('  Telegram message with Approve / Reject buttons.');
    log('');
    if (!(await askYesNo('  Run the smoke test now?', true))) return;

    if (!key) {
      key = process.env.DASHCLAW_API_KEY;
      if (!key) {
        err('  No API key available — skipped.');
        return;
      }
    }

    const actionId = `act_setup${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    log(`\n  Creating synthetic action ${actionId}...`);
    let create;
    try {
      create = await fetch(`${deployUrl}/api/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({
          action_id: actionId,
          agent_id: 'telegram-setup-wizard',
          action_type: 'deploy',
          declared_goal: 'telegram:setup wizard round-trip test',
          risk_score: 80,
          reversible: false,
          status: 'pending_approval',
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      err(`  Failed to create action: ${e.message}`);
      err('  Most likely causes: env vars not set on the deploy yet, or the');
      err('  redeploy has not finished. Wait 30s and re-run this wizard.');
      return;
    }
    if (!create.ok) {
      err(`  Failed to create action: ${create.status} ${await create.text()}`);
      err('  Most likely causes: env vars not set on the deploy yet, or the');
      err('  redeploy has not finished. Wait 30s and re-run this wizard.');
      return;
    }
    log('  Action created. Check your phone for the Telegram message.');
    log("  Tap Approve or Reject — I'll wait up to 5 minutes.");

    const start = Date.now();
    const timeoutMs = 5 * 60 * 1000;
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 1500));
      let r;
      try {
        r = await fetch(`${deployUrl}/api/actions/${actionId}`, {
          headers: { 'x-api-key': key },
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        continue;
      }
      if (!r.ok) continue;
      const { action } = await r.json();
      if (action?.status && action.status !== 'pending_approval') {
        const s = ((Date.now() - start) / 1000).toFixed(1);
        log(`\n  Round-trip succeeded in ${s}s — final status: ${action.status}`);
        try {
          await fetch(`${deployUrl}/api/actions?action_id=${actionId}`, {
            method: 'DELETE',
            headers: { 'x-api-key': key },
          });
        } catch { /* best-effort cleanup */ }
        return;
      }
    }
    err('\n  Timed out. The webhook may not be live yet — if you just saved env');
    err('  vars on the deploy, wait for the redeploy to finish and re-run this wizard.');
  }

  // -- Main flow --------------------------------------------------------------
  log('\n=== DashClaw Telegram Approval Setup ===\n');
  log("This wizard takes ~3 minutes. You'll need Telegram (phone or desktop),");
  log('your DashClaw deploy URL, and a DashClaw admin API key (oc_live_...).');
  log('You can Ctrl-C at any time.\n');
  if (!(await askYesNo('Ready to start?', true))) return { completed: false };

  const { token, bot } = await step1Token();
  const chatId = await step2ChatId(token, bot);
  const webhookSecret = step3Secret();
  const { deployUrl } = await step4DeployConfig();
  const { apiKey: resolvedKey, orgId } = await step5ApiKeyAndOrg(deployUrl);
  await step6EnvVars({ token, chatId, webhookSecret, orgId });
  await step7RegisterWebhook({ token, webhookSecret, deployUrl });
  await step8SmokeTest({ deployUrl, apiKey: resolvedKey });

  log('\n=== All set. Every pending_approval will now ping your phone. ===\n');
  log('Kill switch: set DASHCLAW_ALERTS_TELEGRAM=false on your deploy to disable');
  log('without removing the bot. Guide: https://github.com/ucsandman/DashClaw/blob/main/docs/telegram-setup.md\n');
  return { completed: true, deployUrl, orgId };
}
