// cli/lib/local-doctor.js
// W4: local doctor checks that run on the operator machine — the server can't
// see these. Repo-aware checks need the cwd (or --repo) to be a DashClaw
// checkout; machine checks always run. Every fix is idempotent; detect-only
// classes (env leak, OpenClaw plugin) NEVER mutate anything.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir as osHomedir } from 'node:os';
import { execFile } from 'node:child_process';

// ---------------------------------------------------------------------------
// Context + adapters (injected in tests)
// ---------------------------------------------------------------------------

function realExec(cmd, args = [], opts = {}) {
  // With shell:true, node concatenates args unescaped (DEP0190) — pass a
  // single command string instead. Shell mode is only used for trusted,
  // hardcoded commands (npm/dashclaw), never user input.
  const useShell = opts.shell ?? false;
  const command = useShell ? [cmd, ...args].join(' ') : cmd;
  const commandArgs = useShell ? [] : args;
  return new Promise((resolvePromise) => {
    execFile(
      command,
      commandArgs,
      {
        timeout: opts.timeout ?? 30_000,
        shell: useShell,
        cwd: opts.cwd,
        windowsHide: true,
        ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
      },
      (err, stdout, stderr) => {
        if (err && err.code === 'ENOENT') {
          resolvePromise({ code: -1, stdout: '', stderr: 'ENOENT', notFound: true });
          return;
        }
        resolvePromise({
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      },
    );
  });
}

function newestMtimeReal(dir) {
  if (!existsSync(dir)) return null;
  let newest = null;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(full);
      } else {
        try {
          const m = statSync(full).mtimeMs;
          if (newest === null || m > newest) newest = m;
        } catch {
          // file vanished mid-walk — skip
        }
      }
    }
  };
  walk(dir);
  return newest;
}

const realFs = { existsSync, readFileSync, newestMtime: newestMtimeReal };

export function buildContext(overrides = {}) {
  return {
    cwd: process.cwd(),
    env: process.env,
    platform: process.platform,
    homedir: osHomedir(),
    exec: realExec,
    fs: realFs,
    repoRoot: null,
    cliVersion: '0.0.0',
    ...overrides,
  };
}

/**
 * A directory is a DashClaw checkout if its package.json carries the platform
 * name, or (renamed forks) it has the structural markers drizzle/ + mcp-server/.
 */
export function detectRepoRoot({ cwd, fs = realFs }) {
  try {
    const pkg = JSON.parse(fs.readFileSync(join(cwd, 'package.json'), 'utf8'));
    if (pkg?.name === 'dashclaw-platform' || pkg?.name === 'dashclaw') return cwd;
    if (fs.existsSync(join(cwd, 'drizzle')) && fs.existsSync(join(cwd, 'mcp-server'))) return cwd;
    return null;
  } catch {
    return null;
  }
}

function check(id, category, status, title, message, fix = null) {
  return { id, category, status, title, message, fix, local: true };
}

// ---------------------------------------------------------------------------
// Repo-aware checks
// ---------------------------------------------------------------------------

async function checkMcpLibStale(ctx) {
  const srcDir = join(ctx.repoRoot, 'mcp-server', 'src');
  const libDir = join(ctx.repoRoot, 'mcp-server', 'lib');
  const srcNewest = ctx.fs.newestMtime(srcDir);
  if (srcNewest === null) return null; // no mcp-server src — nothing to verify
  const libNewest = ctx.fs.newestMtime(libDir);

  if (libNewest === null || srcNewest > libNewest) {
    return check(
      'local_mcp_lib_stale',
      'local-repo',
      'fail',
      'Compiled mcp-server lib',
      libNewest === null
        ? 'mcp-server/lib is missing — the MCP server cannot serve current tools'
        : 'mcp-server/lib is older than mcp-server/src — served tools are stale',
      { type: 'auto', description: 'Rebuild mcp-server (npm run build in mcp-server/)', action: 'rebuild_mcp_lib' },
    );
  }
  return check('local_mcp_lib_stale', 'local-repo', 'pass', 'Compiled mcp-server lib', 'lib is newer than src');
}

async function checkGitattributesDrift(ctx) {
  const status = await ctx.exec('git', ['status', '--porcelain', '--', '.gitattributes'], { cwd: ctx.repoRoot });
  if (status.code !== 0) return null; // not a git checkout — skip
  if (!/^\s?M/m.test(status.stdout)) {
    return check('local_gitattributes_drift', 'local-repo', 'pass', '.gitattributes drift', '.gitattributes is clean');
  }

  // Provable line-ending/whitespace-only proof: the whitespace-insensitive diff
  // is empty while the file is modified.
  const wsDiff = await ctx.exec(
    'git',
    ['diff', '--ignore-cr-at-eol', '--ignore-all-space', '--', '.gitattributes'],
    { cwd: ctx.repoRoot },
  );
  if (wsDiff.stdout.trim() === '') {
    return check(
      'local_gitattributes_drift',
      'local-repo',
      'fail',
      '.gitattributes drift',
      '.gitattributes is modified but the diff is line-ending/whitespace-only — this silently blocks pull/push/worktree ops',
      { type: 'auto', description: 'Restore .gitattributes from the index (git checkout -- .gitattributes)', action: 'restore_gitattributes' },
    );
  }
  return check(
    'local_gitattributes_drift',
    'local-repo',
    'warn',
    '.gitattributes drift',
    '.gitattributes has real content changes — review and commit or discard it manually (auto-restore refused)',
  );
}

async function checkSchemaBehind(ctx) {
  const dbUrl = ctx.env.DATABASE_URL || readRepoEnvVar(ctx, 'DATABASE_URL');
  if (!dbUrl) {
    return check(
      'local_schema_behind',
      'local-repo',
      'pass',
      'Local DB schema',
      'Skipped — no DATABASE_URL configured for this checkout',
    );
  }

  // Reuse the repo's own engine probe via the npm script (report-only) — the
  // script carries the tsx loader the engine's extensionless .ts imports need.
  const probe = await ctx.exec(
    'npm',
    ['run', 'doctor', '--', '--json', '--no-fix', '--category', 'database'],
    { cwd: ctx.repoRoot, shell: ctx.platform === 'win32', timeout: 60_000, env: { ...ctx.env, DATABASE_URL: dbUrl } },
  );
  let result = null;
  try {
    // npm prepends a script banner before the JSON — parse from the first brace.
    const stdout = probe.stdout || '';
    result = JSON.parse(stdout.slice(stdout.indexOf('{')));
  } catch {
    return check(
      'local_schema_behind',
      'local-repo',
      'warn',
      'Local DB schema',
      `Could not verify schema state (probe unreadable: ${(probe.stderr || probe.stdout || 'no output').slice(0, 120)}) — if you recently pulled schema changes, run npm run db:migrate`,
    );
  }

  const schemaCheck = (result.checks || []).find((c) => c.id === 'db_schema');
  if (schemaCheck && schemaCheck.status === 'fail') {
    return check(
      'local_schema_behind',
      'local-repo',
      'fail',
      'Local DB schema',
      `Local database schema is behind code: ${schemaCheck.message}. Until migrated, authenticated requests can 401`,
      { type: 'auto', description: 'Apply pending schema (npm run db:migrate — idempotent)', action: 'run_db_migrate' },
    );
  }
  return check('local_schema_behind', 'local-repo', 'pass', 'Local DB schema', 'Database schema matches code');
}

function readRepoEnvVar(ctx, name) {
  for (const file of ['.env.local', '.env']) {
    try {
      const content = ctx.fs.readFileSync(join(ctx.repoRoot, file), 'utf8');
      const match = content.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm'));
      if (match) return match[1].trim().replace(/^["']|["']$/g, '');
    } catch {
      // file absent — keep looking
    }
  }
  return null;
}

/** DETECT-ONLY: never mutates a gateway config. */
async function checkOpenclawPlugin(ctx) {
  const candidates = [
    ctx.env.DASHCLAW_OPENCLAW_CONFIG,
    join(ctx.homedir, '.openclaw', 'openclaw.json'),
    join(ctx.cwd, 'openclaw.plugin.json'),
  ].filter(Boolean);

  let path = null;
  for (const candidate of candidates) {
    if (ctx.fs.existsSync(candidate)) {
      path = candidate;
      break;
    }
  }
  if (!path) return null; // no gateway here — silent skip (matches server check)

  let doc;
  try {
    doc = JSON.parse(ctx.fs.readFileSync(path, 'utf8'));
  } catch (err) {
    return check('local_openclaw_plugin', 'local-repo', 'warn', 'OpenClaw runtime plugin', `${path}: unparseable (${err.message}) — fix the JSON by hand; auto-repair of gateway configs is deliberately not supported`);
  }

  const entry = doc?.plugins?.entries?.['dashclaw-governance'] ?? (doc?.id === 'dashclaw-governance' ? doc : null);
  if (!entry) return null; // plugin not installed here — silent skip

  if (entry.enabled === false) {
    return check(
      'local_openclaw_plugin',
      'local-repo',
      'warn',
      'OpenClaw runtime plugin',
      `${path}: dashclaw-governance is disabled — gateway actions are NOT being governed. Re-enable it in the gateway config (set "enabled": true), then restart the gateway. Auto-mutation of gateway configs is deliberately not supported`,
    );
  }

  const pluginPath = entry.path || entry.source || null;
  if (pluginPath && !ctx.fs.existsSync(pluginPath)) {
    return check(
      'local_openclaw_plugin',
      'local-repo',
      'warn',
      'OpenClaw runtime plugin',
      `${path}: plugin path ${pluginPath} does not exist — the gateway will fail to load dashclaw-governance. Point it at a valid plugin checkout and restart the gateway`,
    );
  }

  return check('local_openclaw_plugin', 'local-repo', 'pass', 'OpenClaw runtime plugin', 'dashclaw-governance entry looks healthy');
}

// ---------------------------------------------------------------------------
// Machine checks
// ---------------------------------------------------------------------------

async function checkCliShimStale(ctx) {
  let result;
  try {
    result = await ctx.exec('dashclaw', ['--version'], { shell: ctx.platform === 'win32', timeout: 15_000 });
  } catch {
    result = { notFound: true, code: -1, stdout: '' };
  }
  if (result.notFound || result.code !== 0) {
    return check('local_cli_shim_stale', 'local-machine', 'pass', 'Global CLI shim', 'No global dashclaw shim on PATH');
  }
  const found = (result.stdout.match(/\d+\.\d+\.\d+/) || [])[0];
  if (!found) {
    return check('local_cli_shim_stale', 'local-machine', 'pass', 'Global CLI shim', 'Global shim did not report a version — skipped');
  }
  if (found !== ctx.cliVersion) {
    return check(
      'local_cli_shim_stale',
      'local-machine',
      'fail',
      'Global CLI shim',
      `PATH dashclaw is ${found}, current CLI is ${ctx.cliVersion} — stale shims shadow new commands`,
      { type: 'auto', description: 'Reinstall the global CLI (npm i -g @dashclaw/cli)', action: 'reinstall_cli' },
    );
  }
  return check('local_cli_shim_stale', 'local-machine', 'pass', 'Global CLI shim', `PATH dashclaw matches ${ctx.cliVersion}`);
}

function extractHookScriptPaths(command) {
  // Tokenize respecting double quotes; keep tokens that look like file paths.
  const tokens = command.match(/"[^"]+"|\S+/g) || [];
  return tokens
    .map((t) => t.replace(/^"|"$/g, ''))
    .filter((t) => /[\\/]/.test(t) && /dashclaw/i.test(t) && /\.(py|cjs|mjs|js)$/i.test(t));
}

async function checkHooksTrust(ctx) {
  const settingsPath = join(ctx.homedir, '.claude', 'settings.json');
  let settings;
  try {
    settings = JSON.parse(ctx.fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return check('local_hooks_trust', 'local-machine', 'pass', 'DashClaw Claude hooks', 'No global Claude settings — hooks not installed (skipped)');
  }

  const commands = [];
  for (const eventEntries of Object.values(settings?.hooks || {})) {
    if (!Array.isArray(eventEntries)) continue;
    for (const entry of eventEntries) {
      for (const hook of entry?.hooks || []) {
        if (typeof hook?.command === 'string' && /dashclaw/i.test(hook.command)) {
          commands.push(hook.command);
        }
      }
    }
  }
  if (commands.length === 0) {
    return check('local_hooks_trust', 'local-machine', 'pass', 'DashClaw Claude hooks', 'No DashClaw hooks installed (skipped)');
  }

  const missing = [];
  for (const command of commands) {
    for (const scriptPath of extractHookScriptPaths(command)) {
      if (!ctx.fs.existsSync(scriptPath)) missing.push(scriptPath);
    }
  }
  if (missing.length > 0) {
    const installer = ctx.repoRoot
      ? 'node scripts/install-hooks.mjs --global --governance'
      : 'dashclaw install claude';
    return check(
      'local_hooks_trust',
      'local-machine',
      'fail',
      'DashClaw Claude hooks',
      `Hook script(s) missing: ${missing.join(', ')} — hooks silently no-op`,
      { type: 'auto', description: `Re-run the hook installer (${installer})`, action: 'reinstall_hooks' },
    );
  }
  return check('local_hooks_trust', 'local-machine', 'pass', 'DashClaw Claude hooks', `${commands.length} DashClaw hook(s) installed, scripts present`);
}

/**
 * Standing enforcement-mode surface: fresh `dashclaw install claude` runs
 * default to DASHCLAW_HOOK_MODE=enforce (since 0.9.0; `--observe` opts out,
 * re-installs preserve the chosen mode), but observe-mode deployments still
 * exist — older installs and explicit opt-outs. A deployment can sit in
 * audit-only mode indefinitely while the operator sees "Blocked by
 * policy"-shaped log lines and believes blocks are real (observe prints
 * "[observe] Would block" and lets the tool call proceed), so this check
 * keeps the mode visible.
 */
async function checkHookMode(ctx) {
  const envPath = join(ctx.homedir, '.dashclaw', 'claude-hooks', '.env');
  let content;
  try {
    content = ctx.fs.readFileSync(envPath, 'utf8');
  } catch {
    return null; // installer-managed hooks not present — nothing to report
  }
  // Env vars override the file, same precedence the hooks apply.
  const fileMode = (content.match(/^\s*DASHCLAW_HOOK_MODE\s*=\s*(\S+)/m) || [])[1];
  const mode = (process.env.DASHCLAW_HOOK_MODE || fileMode || 'enforce').toLowerCase();
  if (mode === 'enforce') {
    return check('local_hook_mode', 'local-machine', 'pass', 'Hook enforcement mode', 'DASHCLAW_HOOK_MODE=enforce — policy blocks and approval gates physically stop tool calls');
  }
  return check(
    'local_hook_mode',
    'local-machine',
    'warn',
    'Hook enforcement mode',
    `DASHCLAW_HOOK_MODE=${mode} — hooks LOG decisions but do not stop anything: a "block" lets the tool call proceed. Set DASHCLAW_HOOK_MODE=enforce in ${envPath} when you are ready to enforce.`,
  );
}

/** DETECT-ONLY: deleting user env vars is not trivially safe. */
async function checkEnvLeak(ctx) {
  const names = new Set();
  const sources = [];

  if (ctx.platform === 'win32') {
    const scopes = [
      { args: ['query', 'HKCU\\Environment'], label: 'User' },
      { args: ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'], label: 'Machine' },
    ];
    for (const scope of scopes) {
      let result;
      try {
        result = await ctx.exec('reg', scope.args, { timeout: 15_000 });
      } catch {
        continue;
      }
      if (result.code !== 0) continue;
      for (const match of result.stdout.matchAll(/^\s+(DASHCLAW_\w+)\s+REG_/gim)) {
        names.add(match[1]);
        sources.push(`${match[1]} (${scope.label} scope)`);
      }
    }
    if (names.size > 0) {
      const removal = [...names]
        .map((n) => `[Environment]::SetEnvironmentVariable('${n}', $null, 'User')`)
        .join('; ');
      return check(
        'local_env_leak',
        'local-machine',
        'warn',
        'Leaked DASHCLAW_* env',
        `Machine/user-scope env vars can shadow per-project config: ${sources.join(', ')}. To remove (PowerShell): ${removal}. Removal is manual by design`,
      );
    }
  } else {
    const profiles = ['.bashrc', '.zshrc', '.profile', '.bash_profile'];
    for (const profile of profiles) {
      let content;
      try {
        content = ctx.fs.readFileSync(join(ctx.homedir, profile), 'utf8');
      } catch {
        continue;
      }
      for (const match of content.matchAll(/^\s*(?:export\s+)?(DASHCLAW_\w+)\s*=/gm)) {
        names.add(match[1]);
        sources.push(`${match[1]} (~/${profile})`);
      }
    }
    if (names.size > 0) {
      return check(
        'local_env_leak',
        'local-machine',
        'warn',
        'Leaked DASHCLAW_* env',
        `Shell-profile env vars can shadow per-project config: ${sources.join(', ')}. Remove the export lines from the listed profile(s) and restart your shell. Removal is manual by design`,
      );
    }
  }

  return check('local_env_leak', 'local-machine', 'pass', 'Leaked DASHCLAW_* env', 'No machine-scope DASHCLAW_* env vars found');
}

// ---------------------------------------------------------------------------
// Runner + fixes
// ---------------------------------------------------------------------------

/**
 * Run every applicable local check. Repo-aware checks run only when
 * ctx.repoRoot is a DashClaw checkout; machine checks always run.
 */
export async function runLocalChecks(ctx) {
  const checks = [];

  if (ctx.repoRoot) {
    for (const runner of [checkMcpLibStale, checkGitattributesDrift, checkSchemaBehind, checkOpenclawPlugin]) {
      try {
        const result = await runner(ctx);
        if (result) checks.push(result);
      } catch (err) {
        checks.push(check(runner.name, 'local-repo', 'warn', runner.name, `Check errored: ${err.message}`));
      }
    }
  }

  for (const runner of [checkCliShimStale, checkHooksTrust, checkHookMode, checkEnvLeak]) {
    try {
      const result = await runner(ctx);
      if (result) checks.push(result);
    } catch (err) {
      checks.push(check(runner.name, 'local-machine', 'warn', runner.name, `Check errored: ${err.message}`));
    }
  }

  return checks;
}

const LOCAL_FIX_HANDLERS = {
  rebuild_mcp_lib: async (ctx) => {
    const result = await ctx.exec('npm', ['run', 'build'], {
      cwd: join(ctx.repoRoot, 'mcp-server'),
      shell: ctx.platform === 'win32',
      timeout: 300_000,
    });
    return result.code === 0
      ? { applied: true, description: 'Rebuilt mcp-server/lib from src' }
      : { applied: false, description: `mcp-server build failed: ${(result.stderr || result.stdout).slice(0, 200)}` };
  },
  restore_gitattributes: async (ctx) => {
    const result = await ctx.exec('git', ['checkout', '--', '.gitattributes'], { cwd: ctx.repoRoot });
    return result.code === 0
      ? { applied: true, description: 'Restored .gitattributes from the index' }
      : { applied: false, description: `git checkout failed: ${(result.stderr || '').slice(0, 200)}` };
  },
  run_db_migrate: async (ctx) => {
    const result = await ctx.exec('npm', ['run', 'db:migrate'], {
      cwd: ctx.repoRoot,
      shell: ctx.platform === 'win32',
      timeout: 300_000,
    });
    return result.code === 0
      ? { applied: true, description: 'Applied pending schema via npm run db:migrate' }
      : { applied: false, description: `db:migrate failed: ${(result.stderr || result.stdout).slice(0, 200)}` };
  },
  reinstall_cli: async (ctx) => {
    const result = await ctx.exec('npm', ['i', '-g', '@dashclaw/cli'], {
      shell: ctx.platform === 'win32',
      timeout: 300_000,
    });
    return result.code === 0
      ? { applied: true, description: 'Reinstalled the global @dashclaw/cli' }
      : { applied: false, description: `npm i -g failed: ${(result.stderr || result.stdout).slice(0, 200)}` };
  },
  reinstall_hooks: async (ctx) => {
    const result = ctx.repoRoot
      ? await ctx.exec(process.execPath ?? 'node', ['scripts/install-hooks.mjs', '--global', '--governance'], {
          cwd: ctx.repoRoot,
          timeout: 120_000,
        })
      : await ctx.exec('dashclaw', ['install', 'claude'], { shell: ctx.platform === 'win32', timeout: 120_000 });
    return result.code === 0
      ? { applied: true, description: 'Re-ran the DashClaw hook installer' }
      : { applied: false, description: `Hook installer failed: ${(result.stderr || result.stdout).slice(0, 200)}` };
  },
};

/**
 * Apply local auto-fixes for failing checks. Returns one result per attempted
 * fix: { id, action, applied, description }.
 */
export async function applyLocalFixes(checks, ctx) {
  const results = [];
  for (const item of checks) {
    if (!item?.fix || item.fix.type !== 'auto') continue;
    const handler = LOCAL_FIX_HANDLERS[item.fix.action];
    if (!handler) continue;
    try {
      const result = await handler(ctx);
      results.push({ id: item.id, action: item.fix.action, ...result });
    } catch (err) {
      results.push({ id: item.id, action: item.fix.action, applied: false, description: `Fix errored: ${err.message}` });
    }
  }
  return results;
}
