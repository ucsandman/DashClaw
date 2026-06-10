// cli/lib/config.js
// Config resolution: env vars -> ~/.dashclaw/config.json -> interactive prompt.
import readline from 'node:readline';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { bold, dim, green, red, yellow } from './render.js';

const CONFIG_DIR = resolve(homedir(), '.dashclaw');
const CONFIG_PATH = resolve(CONFIG_DIR, 'config.json');

export function configPath() {
  return CONFIG_PATH;
}

export function readConfigFile() {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

export function writeConfigFile(config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

export function clearConfigFile() {
  if (existsSync(CONFIG_PATH)) {
    unlinkSync(CONFIG_PATH);
    return true;
  }
  return false;
}

export function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(question, (answer) => {
      rl.close();
      res(answer.trim());
    });
  });
}

export function askSecret(question) {
  return new Promise((res) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let input = '';
    const onData = (char) => {
      const str = String(char);
      for (const c of str) {
        if (c === '\n' || c === '\r' || c === '\u0004') {
          if (stdin.setRawMode) stdin.setRawMode(wasRaw);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          res(input.trim());
          return;
        }
        if (c === '\u0003') {
          if (stdin.setRawMode) stdin.setRawMode(wasRaw);
          stdin.pause();
          process.stdout.write('\n');
          process.exit(130);
        }
        if (c === '\u007f' || c === '\b') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (c >= ' ') {
          input += c;
          process.stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}

/**
 * Resolve config from env, then file, then interactive prompt.
 * @returns {Promise<{ baseUrl, apiKey, agentId, source } | null>}
 *   Returns null if missing and stdin is not a TTY (so caller can error out).
 */
export async function resolveConfig({ env = process.env, interactive = true } = {}) {
  let baseUrl = env.DASHCLAW_BASE_URL;
  let apiKey = env.DASHCLAW_API_KEY;
  let agentId = env.DASHCLAW_AGENT_ID;
  let source = 'env';

  if (!baseUrl || !apiKey) {
    const file = readConfigFile();
    if (!baseUrl && file.baseUrl) {
      baseUrl = file.baseUrl;
      source = 'file';
    }
    if (!apiKey && file.apiKey) {
      apiKey = file.apiKey;
      source = 'file';
    }
    if (!agentId && file.agentId) agentId = file.agentId;
  }

  if (baseUrl && apiKey) {
    return { baseUrl, apiKey, agentId: agentId || 'cli-operator', source };
  }

  if (!interactive || !process.stdin.isTTY) {
    return null;
  }

  console.log();
  console.log(bold('DashClaw CLI — first-time setup'));
  console.log(dim(`Saved values go to ${CONFIG_PATH} (mode 600). Env vars always override.`));
  console.log();

  if (!baseUrl) {
    baseUrl = await ask('DashClaw instance URL (e.g. https://your-dashclaw.vercel.app): ');
    if (!baseUrl) {
      console.error(red('Aborted — baseUrl is required.'));
      process.exit(1);
    }
    baseUrl = baseUrl.replace(/\/+$/, '');
  }

  if (!apiKey) {
    apiKey = await askSecret('API key (oc_live_...): ');
    if (!apiKey) {
      console.error(red('Aborted — API key is required.'));
      process.exit(1);
    }
  }

  agentId = agentId || 'cli-operator';

  const saveAnswer = await ask(`Save to ${CONFIG_PATH}? [Y/n] `);
  if (saveAnswer.toLowerCase() !== 'n' && saveAnswer.toLowerCase() !== 'no') {
    try {
      writeConfigFile({ baseUrl, apiKey, agentId });
      console.log(green(`  \u2192 Saved. Remove with: dashclaw logout`));
    } catch (err) {
      console.error(yellow(`  Warning: could not write config file: ${err.message}`));
    }
  } else {
    console.log(dim('  Not saved. Values apply to this invocation only.'));
  }
  console.log();

  return { baseUrl, apiKey, agentId, source: 'prompted' };
}
