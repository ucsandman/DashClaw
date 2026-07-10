import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doctorExitCode } from '../../scripts/lib/doctor-cli.mjs';
import { runDoctorFlow } from '../../cli/lib/doctor.js';

describe('doctor CLI status', () => {
  it('fails when doctor found real failures', () => {
    expect(doctorExitCode({ status: 'unhealthy' })).toBe(1);
  });

  it('allows advisory-only warnings in the default local doctor command', () => {
    expect(doctorExitCode({ status: 'needs_attention' })).toBe(0);
  });

  it('can be made strict for CI callers that want warnings to fail', () => {
    expect(doctorExitCode({ status: 'needs_attention' }, { strict: true })).toBe(1);
  });
});

// --- W4: report-only default, --fix opt-in, merged local+remote report ------

function remoteDoctorBody({ failWithFix = false } = {}) {
  return {
    status: failWithFix ? 'unhealthy' : 'healthy',
    summary: failWithFix ? { pass: 1, warn: 0, fail: 1 } : { pass: 1, warn: 0, fail: 0 },
    checks: [
      { id: 'db_connection', category: 'database', status: 'pass', title: 'DB', message: 'OK', fix: null },
      ...(failWithFix
        ? [{
            id: 'dh_timestamp_format', category: 'data-hygiene', status: 'fail',
            title: 'Timestamp Format Hygiene', message: 'Non-ISO values found',
            fix: { type: 'auto', description: 'Normalize parseable non-ISO timestamp values to ISO-8601', action: 'normalize_timestamps' },
          }]
        : []),
    ],
    timestamp: '2026-06-12T00:00:00Z',
  };
}

function makeDeps({ remoteBody, localChecks = [], fetchImpl } = {}) {
  const applyLocalFixes = vi.fn(async () => []);
  const runLocalChecks = vi.fn(async () => localChecks);
  const defaultFetch = vi.fn(async (url, init = {}) => {
    if (String(url).includes('/api/doctor/fix')) {
      return {
        ok: true, status: 200,
        json: async () => ({ applied: true, action: JSON.parse(init.body).action, description: 'fixed' }),
      };
    }
    return { ok: true, status: 200, json: async () => remoteBody ?? remoteDoctorBody() };
  });
  return {
    fetchImpl: fetchImpl || defaultFetch,
    fetchSpy: fetchImpl || defaultFetch,
    applyLocalFixes,
    runLocalChecks,
    local: {
      buildContext: (o) => ({ cwd: '/w', env: {}, platform: 'linux', homedir: '/h', fs: {}, exec: vi.fn(), ...o }),
      detectRepoRoot: () => null,
      runLocalChecks,
      applyLocalFixes,
    },
  };
}

const BASE_OPTS = { baseUrl: 'https://x.test', apiKey: 'k', cliVersion: '0.4.0' };

describe('runDoctorFlow (W4 semantics)', () => {
  let logSpy;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  function printed() {
    return logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
  }

  it('applies ZERO fixes by default and prints would-fix entries', async () => {
    const deps = makeDeps({ remoteBody: remoteDoctorBody({ failWithFix: true }) });

    const code = await runDoctorFlow(BASE_OPTS, deps);

    expect(deps.applyLocalFixes).not.toHaveBeenCalled();
    const fixPosts = deps.fetchSpy.mock.calls.filter(([url]) => String(url).includes('/fix'));
    expect(fixPosts).toHaveLength(0);
    expect(printed()).toMatch(/would fix/i);
    expect(printed()).toMatch(/doctor --fix/);
    expect(code).toBe(1);
  });

  it('--fix applies local + remote fixes, re-checks, and prints a what-changed report', async () => {
    const localCheck = {
      id: 'local_gitattributes_drift', category: 'local-repo', status: 'fail', local: true,
      title: '.gitattributes drift', message: 'modified',
      fix: { type: 'auto', description: 'Restore .gitattributes', action: 'restore_gitattributes' },
    };
    const deps = makeDeps({
      remoteBody: remoteDoctorBody({ failWithFix: true }),
      localChecks: [localCheck],
    });
    deps.local.applyLocalFixes = vi.fn(async () => [
      { id: localCheck.id, action: 'restore_gitattributes', applied: true, description: 'Restored .gitattributes' },
    ]);

    const code = await runDoctorFlow({ ...BASE_OPTS, fix: true }, deps);

    expect(deps.local.applyLocalFixes).toHaveBeenCalledTimes(1);
    const fixPosts = deps.fetchSpy.mock.calls.filter(([url]) => String(url).includes('/api/doctor/fix'));
    expect(fixPosts).toHaveLength(1);
    expect(JSON.parse(fixPosts[0][1].body).action).toBe('normalize_timestamps');
    expect(printed()).toMatch(/What changed/);
    expect(printed()).toMatch(/restore_gitattributes/);
    expect(printed()).toMatch(/normalize_timestamps/);
    // Re-check: doctor GET fetched twice (initial + post-fix)
    const gets = deps.fetchSpy.mock.calls.filter(([url]) => String(url).includes('include_fixes'));
    expect(gets).toHaveLength(2);
    expect(typeof code).toBe('number');
  });

  it('--no-fix is accepted and wins over --fix (no applies)', async () => {
    const deps = makeDeps({ remoteBody: remoteDoctorBody({ failWithFix: true }) });

    await runDoctorFlow({ ...BASE_OPTS, fix: true, noFix: true }, deps);

    expect(deps.applyLocalFixes).not.toHaveBeenCalled();
    const fixPosts = deps.fetchSpy.mock.calls.filter(([url]) => String(url).includes('/fix'));
    expect(fixPosts).toHaveLength(0);
  });

  it('--json output is parseable and includes local checks marked local: true', async () => {
    const localCheck = {
      id: 'local_env_leak', category: 'local-machine', status: 'warn', local: true,
      title: 'Leaked DASHCLAW_* env', message: 'DASHCLAW_URL (~/.bashrc)', fix: null,
    };
    const deps = makeDeps({ localChecks: [localCheck] });

    const code = await runDoctorFlow({ ...BASE_OPTS, json: true }, deps);

    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    const local = parsed.checks.find((c) => c.id === 'local_env_leak');
    expect(local).toMatchObject({ local: true, category: 'local-machine' });
    expect(parsed.summary).toEqual({ pass: 1, warn: 1, fail: 0 });
    expect(code).toBe(1); // needs_attention is not healthy — exit logic unchanged
  });

  it('degrades to a remote_unreachable check when the instance is down — local checks still report', async () => {
    const localCheck = {
      id: 'local_cli_shim_stale', category: 'local-machine', status: 'pass', local: true,
      title: 'Global CLI shim', message: 'ok', fix: null,
    };
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    });
    const deps = makeDeps({ localChecks: [localCheck], fetchImpl });

    const code = await runDoctorFlow({ ...BASE_OPTS, json: true }, deps);

    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.checks.some((c) => c.id === 'remote_unreachable')).toBe(true);
    expect(parsed.checks.some((c) => c.id === 'local_cli_shim_stale')).toBe(true);
    expect(code).toBe(1);
  });

  it('returns 0 when the merged report is healthy', async () => {
    const deps = makeDeps({ remoteBody: remoteDoctorBody() });
    const code = await runDoctorFlow({ ...BASE_OPTS, json: true }, deps);
    expect(code).toBe(0);
  });

  it('does not promise --fix for remote warn-status fixes (server-side only)', async () => {
    // Warn-status checks can carry a local-scope fix; POST /api/doctor/fix
    // only applies on fail — the hint and tip must not over-promise.
    const deps = makeDeps({
      remoteBody: {
        status: 'needs_attention',
        summary: { pass: 0, warn: 1, fail: 0 },
        checks: [{
          id: 'deploy_cors', category: 'deployment', status: 'warn', title: 'CORS',
          message: 'ALLOWED_ORIGIN not set',
          fix: { type: 'auto', description: 'Set ALLOWED_ORIGIN in .env', action: 'fix_cors' },
        }],
        timestamp: '',
      },
    });

    await runDoctorFlow(BASE_OPTS, deps);

    expect(printed()).not.toMatch(/can be auto-fixed/);
    expect(printed()).not.toMatch(/would fix/);
    expect(printed()).toMatch(/npm run doctor -- --fix/);

    // And --fix attempts nothing for it.
    logSpy.mockClear();
    await runDoctorFlow({ ...BASE_OPTS, fix: true }, deps);
    const fixPosts = deps.fetchSpy.mock.calls.filter(([url]) => String(url).includes('/api/doctor/fix'));
    expect(fixPosts).toHaveLength(0);
  });
});
