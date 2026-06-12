// __tests__/unit/cli-local-doctor.test.js
// W4 CLI local doctor: repo-aware + machine checks, exec/FS fully mocked.
// Detect-only classes (env-leak, OpenClaw plugin) must NEVER exec a mutation.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runLocalChecks,
  applyLocalFixes,
  detectRepoRoot,
} from '../../cli/lib/local-doctor.js';

const CLI_VERSION = '0.4.0';

function makeFs({ files = {}, dirs = {}, trees = {} } = {}) {
  // files: path -> content; dirs: path -> true; trees: dirPath -> [{path, mtimeMs}]
  const norm = (p) => String(p).replace(/\\/g, '/');
  const fileMap = Object.fromEntries(Object.entries(files).map(([k, v]) => [norm(k), v]));
  const dirSet = new Set(Object.keys(dirs).map(norm));
  const treeMap = Object.fromEntries(Object.entries(trees).map(([k, v]) => [norm(k), v]));
  return {
    existsSync: (p) =>
      norm(p) in fileMap || dirSet.has(norm(p)) || norm(p) in treeMap,
    readFileSync: (p) => {
      const key = norm(p);
      if (key in fileMap) return fileMap[key];
      throw new Error(`ENOENT: ${p}`);
    },
    newestMtime: (dir) => {
      const entries = treeMap[norm(dir)];
      if (!entries || entries.length === 0) return null;
      return Math.max(...entries.map((e) => e.mtimeMs));
    },
  };
}

function ctxDefaults(overrides = {}) {
  return {
    repoRoot: null,
    cwd: '/work',
    env: {},
    platform: 'linux',
    homedir: '/home/u',
    cliVersion: CLI_VERSION,
    exec: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
    fs: makeFs(),
    ...overrides,
  };
}

function byId(checks, id) {
  return checks.find((c) => c.id === id);
}

beforeEach(() => vi.clearAllMocks());

describe('detectRepoRoot', () => {
  it('detects the real checkout by its package.json name (dashclaw-platform)', () => {
    const fs = makeFs({ files: { '/repo/package.json': JSON.stringify({ name: 'dashclaw-platform' }) } });
    expect(detectRepoRoot({ cwd: '/repo', fs })).toBe('/repo');
  });

  it('detects a renamed fork by structural markers (drizzle/ + mcp-server/)', () => {
    const fs = makeFs({
      files: { '/fork/package.json': JSON.stringify({ name: 'my-fork' }) },
      dirs: { '/fork/drizzle': true, '/fork/mcp-server': true },
    });
    expect(detectRepoRoot({ cwd: '/fork', fs })).toBe('/fork');
  });

  it('returns null outside a DashClaw checkout', () => {
    const fs = makeFs({ files: { '/elsewhere/package.json': JSON.stringify({ name: 'other' }) } });
    expect(detectRepoRoot({ cwd: '/elsewhere', fs })).toBeNull();
  });
});

describe('local_mcp_lib_stale (repo)', () => {
  it('flags when newest src mtime is newer than newest lib mtime', async () => {
    const ctx = ctxDefaults({
      repoRoot: '/repo',
      fs: makeFs({
        trees: {
          '/repo/mcp-server/src': [{ path: 'a.ts', mtimeMs: 2000 }],
          '/repo/mcp-server/lib': [{ path: 'a.js', mtimeMs: 1000 }],
        },
      }),
    });
    const checks = await runLocalChecks(ctx);
    const check = byId(checks, 'local_mcp_lib_stale');
    expect(check.status).toBe('fail');
    expect(check.category).toBe('local-repo');
    expect(check.fix).toMatchObject({ type: 'auto', action: 'rebuild_mcp_lib' });
  });

  it('flags when lib is missing entirely', async () => {
    const ctx = ctxDefaults({
      repoRoot: '/repo',
      fs: makeFs({ trees: { '/repo/mcp-server/src': [{ path: 'a.ts', mtimeMs: 2000 }] } }),
    });
    const checks = await runLocalChecks(ctx);
    expect(byId(checks, 'local_mcp_lib_stale').status).toBe('fail');
  });

  it('passes on a fresh build', async () => {
    const ctx = ctxDefaults({
      repoRoot: '/repo',
      fs: makeFs({
        trees: {
          '/repo/mcp-server/src': [{ path: 'a.ts', mtimeMs: 1000 }],
          '/repo/mcp-server/lib': [{ path: 'a.js', mtimeMs: 2000 }],
        },
      }),
    });
    const checks = await runLocalChecks(ctx);
    expect(byId(checks, 'local_mcp_lib_stale').status).toBe('pass');
  });
});

describe('local_gitattributes_drift (repo)', () => {
  function gitExec({ modified, contentDiff }) {
    return vi.fn(async (cmd, args = []) => {
      const line = [cmd, ...args].join(' ');
      if (line.includes('status --porcelain')) {
        return { code: 0, stdout: modified ? ' M .gitattributes\n' : '', stderr: '' };
      }
      if (line.includes('--ignore-cr-at-eol')) {
        return { code: 0, stdout: contentDiff ? 'diff --git ...\n+real change' : '', stderr: '' };
      }
      if (line.includes('checkout --')) return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    });
  }

  it('offers the fix when the diff is provably line-ending-only', async () => {
    const ctx = ctxDefaults({ repoRoot: '/repo', exec: gitExec({ modified: true, contentDiff: false }) });
    const checks = await runLocalChecks(ctx);
    const check = byId(checks, 'local_gitattributes_drift');
    expect(check.status).toBe('fail');
    expect(check.fix).toMatchObject({ type: 'auto', action: 'restore_gitattributes' });
  });

  it('refuses the fix on a real content diff (detect-only warn)', async () => {
    const ctx = ctxDefaults({ repoRoot: '/repo', exec: gitExec({ modified: true, contentDiff: true }) });
    const checks = await runLocalChecks(ctx);
    const check = byId(checks, 'local_gitattributes_drift');
    expect(check.status).toBe('warn');
    expect(check.fix).toBeNull();
    expect(check.message).toMatch(/content/i);
  });

  it('passes when .gitattributes is unmodified', async () => {
    const ctx = ctxDefaults({ repoRoot: '/repo', exec: gitExec({ modified: false }) });
    const checks = await runLocalChecks(ctx);
    expect(byId(checks, 'local_gitattributes_drift').status).toBe('pass');
  });
});

describe('local_schema_behind (repo)', () => {
  it('skips when DATABASE_URL is not configured', async () => {
    const ctx = ctxDefaults({ repoRoot: '/repo' });
    const checks = await runLocalChecks(ctx);
    const check = byId(checks, 'local_schema_behind');
    expect(check.status).toBe('pass');
    expect(check.message).toMatch(/DATABASE_URL/);
  });

  it('flags with run_db_migrate fix when the engine probe reports schema failures', async () => {
    const exec = vi.fn(async (cmd, args = []) => {
      const line = [cmd, ...args].join(' ');
      if (line.includes('run doctor')) {
        return {
          code: 1,
          // npm prepends a script banner before the JSON output
          stdout: '\n> dashclaw-platform@0.0.0 doctor\n\n' + JSON.stringify({
            status: 'unhealthy',
            checks: [{ id: 'db_schema', status: 'fail', message: 'Missing 2 core table(s)' }],
          }),
          stderr: '',
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    });
    const ctx = ctxDefaults({ repoRoot: '/repo', env: { DATABASE_URL: 'postgres://x' }, exec });
    const checks = await runLocalChecks(ctx);
    const check = byId(checks, 'local_schema_behind');
    expect(check.status).toBe('fail');
    expect(check.fix).toMatchObject({ type: 'auto', action: 'run_db_migrate' });
  });

  it('degrades to warn when the probe is unreadable', async () => {
    const exec = vi.fn(async (cmd, args = []) => {
      const line = [cmd, ...args].join(' ');
      if (line.includes('run doctor')) return { code: 1, stdout: 'not json', stderr: 'boom' };
      return { code: 0, stdout: '', stderr: '' };
    });
    const ctx = ctxDefaults({ repoRoot: '/repo', env: { DATABASE_URL: 'postgres://x' }, exec });
    const checks = await runLocalChecks(ctx);
    const check = byId(checks, 'local_schema_behind');
    expect(check.status).toBe('warn');
    expect(check.fix).toBeNull();
  });
});

describe('local_openclaw_plugin (repo, DETECT-ONLY)', () => {
  it('warns with remediation when the plugin entry is disabled — and never execs', async () => {
    const exec = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    const ctx = ctxDefaults({
      repoRoot: '/repo',
      exec,
      env: { DASHCLAW_OPENCLAW_CONFIG: '/home/u/.openclaw/openclaw.json' },
      fs: makeFs({
        files: {
          '/home/u/.openclaw/openclaw.json': JSON.stringify({
            plugins: { entries: { 'dashclaw-governance': { enabled: false } } },
          }),
        },
      }),
    });
    const checks = await runLocalChecks(ctx);
    const check = byId(checks, 'local_openclaw_plugin');
    expect(check.status).toBe('warn');
    expect(check.fix).toBeNull();
    expect(check.message).toMatch(/disabled/i);
    // detect-only: no exec call mentions openclaw
    for (const call of exec.mock.calls) {
      expect([call[0], ...(call[1] || [])].join(' ')).not.toMatch(/openclaw/i);
    }
  });

  it('warns when the plugin entry references a missing path', async () => {
    const ctx = ctxDefaults({
      repoRoot: '/repo',
      env: { DASHCLAW_OPENCLAW_CONFIG: '/home/u/.openclaw/openclaw.json' },
      fs: makeFs({
        files: {
          '/home/u/.openclaw/openclaw.json': JSON.stringify({
            plugins: { entries: { 'dashclaw-governance': { enabled: true, path: '/gone/plugin' } } },
          }),
        },
      }),
    });
    const checks = await runLocalChecks(ctx);
    const check = byId(checks, 'local_openclaw_plugin');
    expect(check.status).toBe('warn');
    expect(check.fix).toBeNull();
  });

  it('is silent when no gateway config exists', async () => {
    const ctx = ctxDefaults({ repoRoot: '/repo' });
    const checks = await runLocalChecks(ctx);
    expect(byId(checks, 'local_openclaw_plugin')).toBeUndefined();
  });
});

describe('local_cli_shim_stale (machine)', () => {
  it('flags a version mismatch with the reinstall fix', async () => {
    const exec = vi.fn(async (cmd) =>
      cmd === 'dashclaw' ? { code: 0, stdout: '0.1.8\n', stderr: '' } : { code: 0, stdout: '', stderr: '' },
    );
    const ctx = ctxDefaults({ exec });
    const checks = await runLocalChecks(ctx);
    const check = byId(checks, 'local_cli_shim_stale');
    expect(check.status).toBe('fail');
    expect(check.category).toBe('local-machine');
    expect(check.message).toContain('0.1.8');
    expect(check.message).toContain(CLI_VERSION);
    expect(check.fix).toMatchObject({ type: 'auto', action: 'reinstall_cli' });
  });

  it('passes when the PATH shim matches the current version', async () => {
    const exec = vi.fn(async (cmd) =>
      cmd === 'dashclaw' ? { code: 0, stdout: `${CLI_VERSION}\n`, stderr: '' } : { code: 0, stdout: '', stderr: '' },
    );
    const checks = await runLocalChecks(ctxDefaults({ exec }));
    expect(byId(checks, 'local_cli_shim_stale').status).toBe('pass');
  });

  it('passes when no shim is on PATH', async () => {
    const exec = vi.fn(async (cmd) => {
      if (cmd === 'dashclaw') throw new Error('ENOENT');
      return { code: 0, stdout: '', stderr: '' };
    });
    const checks = await runLocalChecks(ctxDefaults({ exec }));
    expect(byId(checks, 'local_cli_shim_stale').status).toBe('pass');
  });
});

describe('local_hooks_trust (machine)', () => {
  const settingsPath = '/home/u/.claude/settings.json';

  it('flags when a referenced DashClaw hook script is missing', async () => {
    const ctx = ctxDefaults({
      fs: makeFs({
        files: {
          [settingsPath]: JSON.stringify({
            hooks: {
              Stop: [{ hooks: [{ type: 'command', command: 'node /home/u/.claude/hooks/dashclaw_stop.cjs' }] }],
            },
          }),
        },
      }),
    });
    const checks = await runLocalChecks(ctx);
    const check = byId(checks, 'local_hooks_trust');
    expect(check.status).toBe('fail');
    expect(check.fix).toMatchObject({ type: 'auto', action: 'reinstall_hooks' });
  });

  it('passes when every referenced script exists', async () => {
    const ctx = ctxDefaults({
      fs: makeFs({
        files: {
          [settingsPath]: JSON.stringify({
            hooks: {
              Stop: [{ hooks: [{ type: 'command', command: 'node /home/u/.claude/hooks/dashclaw_stop.cjs' }] }],
            },
          }),
          '/home/u/.claude/hooks/dashclaw_stop.cjs': '// hook',
        },
      }),
    });
    const checks = await runLocalChecks(ctx);
    expect(byId(checks, 'local_hooks_trust').status).toBe('pass');
  });

  it('skips quietly when no DashClaw hooks are installed', async () => {
    const ctx = ctxDefaults({
      fs: makeFs({ files: { [settingsPath]: JSON.stringify({ hooks: {} }) } }),
    });
    const checks = await runLocalChecks(ctx);
    expect(byId(checks, 'local_hooks_trust').status).toBe('pass');
  });
});

describe('local_env_leak (machine, DETECT-ONLY)', () => {
  it('warns with variable NAMES (never values) and removal instructions on win32', async () => {
    const exec = vi.fn(async (cmd, args = []) => {
      const line = [cmd, ...(args || [])].join(' ');
      if (line.startsWith('reg query')) {
        return {
          code: 0,
          stdout: '    DASHCLAW_API_KEY    REG_SZ    oc_live_supersecret123\r\n',
          stderr: '',
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    });
    const ctx = ctxDefaults({ platform: 'win32', exec });
    const checks = await runLocalChecks(ctx);
    const check = byId(checks, 'local_env_leak');
    expect(check.status).toBe('warn');
    expect(check.fix).toBeNull();
    expect(check.message).toContain('DASHCLAW_API_KEY');
    expect(check.message).not.toContain('oc_live_supersecret123');
    expect(check.message).toMatch(/SetEnvironmentVariable|remove/i);
    // detect-only: no reg add / delete / setx ever
    for (const call of exec.mock.calls) {
      const line = [call[0], ...(call[1] || [])].join(' ');
      expect(line).not.toMatch(/reg\s+(add|delete)|setx|SetEnvironmentVariable/);
    }
  });

  it('warns on POSIX when shell profiles export DASHCLAW_ vars', async () => {
    const ctx = ctxDefaults({
      platform: 'linux',
      fs: makeFs({ files: { '/home/u/.bashrc': 'export DASHCLAW_URL=https://x\n' } }),
    });
    const checks = await runLocalChecks(ctx);
    const check = byId(checks, 'local_env_leak');
    expect(check.status).toBe('warn');
    expect(check.message).toContain('DASHCLAW_URL');
    expect(check.message).toContain('.bashrc');
  });

  it('passes when no machine-scope DASHCLAW_ vars exist', async () => {
    const checks = await runLocalChecks(ctxDefaults({ platform: 'linux' }));
    expect(byId(checks, 'local_env_leak').status).toBe('pass');
  });
});

describe('machine-only mode (no repo)', () => {
  it('emits no local-repo checks outside a checkout', async () => {
    const checks = await runLocalChecks(ctxDefaults({ repoRoot: null }));
    expect(checks.every((c) => c.category !== 'local-repo')).toBe(true);
    expect(checks.some((c) => c.category === 'local-machine')).toBe(true);
    expect(checks.every((c) => c.local === true)).toBe(true);
  });
});

describe('applyLocalFixes', () => {
  it('applies only auto-fixable failing checks and reports results', async () => {
    const exec = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    const ctx = ctxDefaults({ repoRoot: '/repo', exec });
    const checks = [
      {
        id: 'local_gitattributes_drift', category: 'local-repo', status: 'fail', local: true,
        title: 'x', message: 'm', fix: { type: 'auto', description: 'Restore .gitattributes', action: 'restore_gitattributes' },
      },
      { id: 'local_env_leak', category: 'local-machine', status: 'warn', local: true, title: 'y', message: 'm', fix: null },
    ];
    const results = await applyLocalFixes(checks, ctx);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ action: 'restore_gitattributes', applied: true });
    const gitCalls = exec.mock.calls.filter((c) => [c[0], ...(c[1] || [])].join(' ').includes('checkout --'));
    expect(gitCalls).toHaveLength(1);
  });

  it('applies nothing when no checks carry fixes', async () => {
    const exec = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    const results = await applyLocalFixes(
      [{ id: 'a', status: 'warn', fix: null, local: true }],
      ctxDefaults({ exec }),
    );
    expect(results).toEqual([]);
    expect(exec).not.toHaveBeenCalled();
  });
});
