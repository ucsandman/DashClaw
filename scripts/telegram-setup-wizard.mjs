#!/usr/bin/env node
/**
 * Interactive setup wizard for the Telegram approval bridge — repo shim.
 *
 * The wizard implementation lives in cli/lib/telegram/setup.js so the
 * published CLI can offer the same flow as `dashclaw install telegram`
 * without a repo clone. This shim only adds the repo-specific extra: the
 * option to write the resulting env vars into the repo's local .env.
 *
 * Usage: npm run telegram:setup
 */

import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { runTelegramSetup } from '../cli/lib/telegram/setup.js';
import { ask, askSecret } from '../cli/lib/config.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

runTelegramSetup({
  baseUrl: process.env.DASHCLAW_BASE_URL || process.env.DASHCLAW_URL || null,
  apiKey: process.env.DASHCLAW_API_KEY || null,
  prompt: ask,
  promptSecret: askSecret,
  logger: console,
  localEnvPath: resolve(repoRoot, '.env'),
}).catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
