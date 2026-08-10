import { describe, expect, it, vi } from 'vitest';

const { mockGetSetupStatus } = vi.hoisted(() => ({
  mockGetSetupStatus: vi.fn(),
}));

vi.mock('@/lib/setupStatus.mjs', () => ({
  getSetupStatus: mockGetSetupStatus,
}));

import { getReadinessReport, getSdkCommands, projectConnectNextStep, projectReadinessReport } from '@/lib/readiness.mjs';
import { buildDeploySection } from '@/lib/readiness/deployCheck.mjs';
import { ADVISORY_ENV_VARS } from '@/lib/readiness/constants.mjs';
import { checkConfiguration } from '@/lib/readiness/configurationCheck.mjs';

describe('readiness projections', () => {
  it('uses a self-contained SDK validator command and never suggests dashclaw.io as the agent base URL', () => {
    const commands = getSdkCommands('dashclaw.io');

    expect(commands.baseUrl).toBe('https://your-dashclaw-instance.example.com');
    expect(commands.node).toContain('npm install dashclaw');
    expect(commands.node).toContain('createAction');
    expect(commands.node).toContain('updateOutcome');
    expect(commands.node).toContain('agentId');
    expect(commands.node).not.toContain('.ping(');
    expect(commands.node).not.toContain('.claude/skills');
    expect(commands.node).not.toContain('dashclaw.io');
  });

  it('projects a sign-in handoff when operator context is unavailable', () => {
    const step = projectConnectNextStep({
      isAuthenticated: false,
      verification: {
        overall: 'ready_unverified',
        ready: true,
      },
      onboarding: null,
      host: 'dashclaw.example.com',
    });

    expect(step.state).toBe('sign_in');
    expect(step.primaryCta.label).toBe('Sign in to continue');
    expect(step.primaryCta.href).toBe('/login');
  });

  it('projects a workspace handoff for authenticated users without a workspace', () => {
    const step = projectConnectNextStep({
      isAuthenticated: true,
      verification: {
        overall: 'ready_unverified',
        ready: true,
      },
      onboarding: {
        steps: {
          workspace_created: false,
          api_key_exists: false,
          first_action_sent: false,
        },
      },
      host: 'dashclaw.example.com',
    });

    expect(step.state).toBe('create_workspace');
    expect(step.primaryCta.label).toBe('Create workspace');
    expect(step.primaryCta.href).toBe('/approvals');
  });

  it('projects an API key handoff when a workspace exists but no key is available', () => {
    const step = projectConnectNextStep({
      isAuthenticated: true,
      verification: {
        overall: 'ready_unverified',
        ready: true,
      },
      onboarding: {
        steps: {
          workspace_created: true,
          api_key_exists: false,
          first_action_sent: false,
        },
      },
      host: 'dashclaw.example.com',
    });

    expect(step.state).toBe('create_api_key');
    expect(step.primaryCta.label).toBe('Generate API key');
    expect(step.primaryCta.href).toBe('/api-keys');
  });

  it('projects a connect-agent handoff when an API key exists but no first action has been observed', () => {
    const step = projectConnectNextStep({
      isAuthenticated: true,
      verification: {
        overall: 'ready_unverified',
        ready: true,
      },
      onboarding: {
        steps: {
          workspace_created: true,
          api_key_exists: true,
          first_action_sent: false,
        },
      },
      host: 'dashclaw.example.com',
    });

    expect(step.state).toBe('connect_agent');
    expect(step.primaryCta.label).toBe('Open connect guide');
    expect(step.primaryCta.href).toBe('/connect');
    expect(step.secondaryCtas.map((cta) => cta.label)).toEqual(
      expect.arrayContaining(['Node starter', 'Python starter', 'Run validator'])
    );
    expect(step.statusItems.map((item) => item.label)).toEqual(
      expect.arrayContaining(['Workspace ready', 'API key ready', 'Waiting for first live action'])
    );
  });

  it('projects a connected handoff when the first action has already been observed', () => {
    const step = projectConnectNextStep({
      isAuthenticated: true,
      verification: {
        overall: 'verified',
        ready: true,
      },
      onboarding: {
        steps: {
          workspace_created: true,
          api_key_exists: true,
          first_action_sent: true,
        },
      },
      host: 'dashclaw.example.com',
    });

    expect(step.state).toBe('connected');
    expect(step.primaryCta.label).toBe('Open dashboard');
    expect(step.primaryCta.href).toBe('/approvals');
    expect(step.secondaryCtas.map((cta) => cta.href)).toEqual(
      expect.arrayContaining(['/identities', '/policies'])
    );
  });

  it('redacts missing table names in the public view', async () => {
    mockGetSetupStatus.mockResolvedValue({
      configured: false,
      reason: 'no_tables',
      missing: ['users', 'guard_policies'],
      message: 'Missing tables.',
    });

    const report = await getReadinessReport({
      DATABASE_URL: 'postgres://db',
      NEXTAUTH_SECRET: 'secret',
      DASHCLAW_LOCAL_ADMIN_PASSWORD: 'password',
      NEXTAUTH_URL: 'https://dashclaw.example.com',
    });

    const publicView = projectReadinessReport(report, { isAuthenticated: false });
    const dbSchema = publicView.sections
      .find((section) => section.id === 'database')
      .checks.find((check) => check.id === 'db_schema');

    expect(dbSchema.detail).toContain('required table check');
    expect(dbSchema.subDetail).toContain('Sign in');
    expect(dbSchema.subDetail).not.toContain('users');
    expect(dbSchema.subDetail).not.toContain('guard_policies');
  });

  it('keeps exact missing table names in the authenticated operator view', async () => {
    mockGetSetupStatus.mockResolvedValue({
      configured: false,
      reason: 'no_tables',
      missing: ['users', 'guard_policies'],
      message: 'Missing tables.',
    });

    const report = await getReadinessReport({
      DATABASE_URL: 'postgres://db',
      NEXTAUTH_SECRET: 'secret',
      DASHCLAW_LOCAL_ADMIN_PASSWORD: 'password',
      NEXTAUTH_URL: 'https://dashclaw.example.com',
    });

    const operatorView = projectReadinessReport(report, { isAuthenticated: true });
    const dbSchema = operatorView.sections
      .find((section) => section.id === 'database')
      .checks.find((check) => check.id === 'db_schema');

    expect(dbSchema.subDetail).toContain('users');
    expect(dbSchema.subDetail).toContain('guard_policies');
  });

  it('redacts migration command details from the public recommendations', async () => {
    mockGetSetupStatus.mockResolvedValue({
      configured: false,
      reason: 'no_tables',
      missing: ['users'],
      message: 'Missing tables.',
    });

    const report = await getReadinessReport({
      DATABASE_URL: 'postgres://db',
      NEXTAUTH_SECRET: 'secret',
      DASHCLAW_LOCAL_ADMIN_PASSWORD: 'password',
      NEXTAUTH_URL: 'https://dashclaw.example.com',
    });

    const publicView = projectReadinessReport(report, { isAuthenticated: false });
    const step = publicView.recommendations.find((item) => item.id === 'run_migrations');

    expect(step.code).toBe('Sign in for the exact migration commands.');
    expect(step.note).toContain('required schema check');
  });

  it('marks strong operator-ready instances as ready but unverified until live proof is captured', async () => {
    mockGetSetupStatus.mockResolvedValue({
      configured: true,
      reason: 'ready',
      missing: [],
      message: 'Ready.',
    });

    const report = await getReadinessReport({
      DATABASE_URL: 'postgres://db',
      NEXTAUTH_SECRET: 'secret',
      NEXTAUTH_URL: 'https://dashclaw.example.com',
      DASHCLAW_LOCAL_ADMIN_PASSWORD: 'password',
      DASHCLAW_API_KEY: 'dc_test_key',
      CRON_SECRET: 'cron_test_secret',
    });

    expect(report.verification.overall).toBe('ready_unverified');
    expect(report.verification.fullyVerified).toBe(false);
  });

  it('marks strong operator-ready instances as verified when live proof is attached', async () => {
    mockGetSetupStatus.mockResolvedValue({
      configured: true,
      reason: 'ready',
      missing: [],
      message: 'Ready.',
    });

    const report = await getReadinessReport(
      {
        DATABASE_URL: 'postgres://db',
        NEXTAUTH_SECRET: 'secret',
        NEXTAUTH_URL: 'https://dashclaw.example.com',
        DASHCLAW_LOCAL_ADMIN_PASSWORD: 'password',
        DASHCLAW_API_KEY: 'dc_test_key',
        CRON_SECRET: 'cron_test_secret',
      },
      {
        host: 'dashclaw.example.com',
        liveProof: {
          tool: 'node',
          mode: 'full',
          capturedAt: '2026-03-13T12:00:00.000Z',
          summary: { passed: 13, failed: 0, skipped: 0, score: 100 },
          checks: [{ name: 'Health endpoint', status: 'pass' }],
          proofStatement: 'Node validator full validation passed with 13 successful check(s) and 0 skipped check(s).',
          verified: true,
        },
      }
    );

    expect(report.verification.overall).toBe('verified');
    expect(report.verification.fullyVerified).toBe(true);
    expect(report.sdk.hasLiveProof).toBe(true);
  });

  it('exposes a sanitized public proof artifact', async () => {
    mockGetSetupStatus.mockResolvedValue({
      configured: false,
      reason: 'no_tables',
      missing: ['users', 'guard_policies'],
      message: 'Missing tables.',
    });

    const report = await getReadinessReport(
      {
        DATABASE_URL: 'postgres://db',
        NEXTAUTH_SECRET: 'secret',
        NEXTAUTH_URL: 'https://dashclaw.example.com',
        DASHCLAW_LOCAL_ADMIN_PASSWORD: 'password',
        GITHUB_ID: 'github-client-id',
      },
      { host: 'dashclaw.example.com' }
    );

    const publicView = projectReadinessReport(report, {
      isAuthenticated: false,
      host: 'dashclaw.example.com',
    });
    const databaseCategory = publicView.proofArtifact.categories.find((category) => category.id === 'database');
    const authCategory = publicView.proofArtifact.categories.find((category) => category.id === 'auth');

    expect(publicView.proofArtifact.viewer_mode).toBe('public');
    expect(databaseCategory.checks.find((check) => check.id === 'db_schema').sub_detail).not.toContain('users');
    expect(authCategory.checks.find((check) => check.id === 'auth_github')?.sub_detail || '').not.toContain('GITHUB');
  });
});

describe('deploy section — NEXTAUTH_URL checks', () => {
  it('returns pass when NEXTAUTH_URL matches the host', () => {
    const section = buildDeploySection(
      { NEXTAUTH_URL: 'https://app.example.com' },
      'app.example.com'
    );
    const check = section.checks.find((c) => c.id === 'nextauth_url');
    expect(check.status).toBe('pass');
    expect(check.label).toBe('NEXTAUTH_URL matches deployment host');
  });

  it('returns warn when NEXTAUTH_URL does not match the host', () => {
    const section = buildDeploySection(
      { NEXTAUTH_URL: 'https://old.example.com' },
      'new.example.com'
    );
    const check = section.checks.find((c) => c.id === 'nextauth_url');
    expect(check.status).toBe('warn');
    expect(check.label).toContain('does not match');
    expect(check.nextAction).toContain('set NEXTAUTH_URL to https://new.example.com');
  });

  it('returns fail when NEXTAUTH_URL is not set', () => {
    const section = buildDeploySection({}, 'app.example.com');
    const check = section.checks.find((c) => c.id === 'nextauth_url');
    expect(check.status).toBe('fail');
    expect(check.label).toContain('not configured');
  });
});

describe('deploy section — realtime backend checks', () => {
  it('returns warn on Vercel with no Redis configured', () => {
    const section = buildDeploySection({ VERCEL: '1' }, 'app.example.com');
    const check = section.checks.find((c) => c.id === 'realtime_backend');
    expect(check.status).toBe('warn');
    expect(check.label).toContain('requires Redis');
  });

  it('returns pass on Vercel with Upstash Redis configured', () => {
    const section = buildDeploySection(
      {
        VERCEL: '1',
        UPSTASH_REDIS_REST_URL: 'https://redis.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'token123',
      },
      'app.example.com'
    );
    const check = section.checks.find((c) => c.id === 'realtime_backend');
    expect(check.status).toBe('pass');
    expect(check.label).toBe('Realtime backend: Redis');
  });

  it('returns info when not on Vercel and no Redis', () => {
    const section = buildDeploySection({}, 'localhost:3000');
    const check = section.checks.find((c) => c.id === 'realtime_backend');
    expect(check.status).toBe('info');
    expect(check.label).toBe('Realtime backend: in-memory');
  });
});

describe('deploy section — section shape', () => {
  it('has id deploy and title Deploy Readiness', () => {
    const section = buildDeploySection(
      { NEXTAUTH_URL: 'https://app.example.com' },
      'app.example.com'
    );
    expect(section.id).toBe('deploy');
    expect(section.title).toBe('Deploy Readiness');
  });
});

describe('CRON_SECRET in advisory env vars', () => {
  it('includes CRON_SECRET entry in ADVISORY_ENV_VARS', () => {
    const entry = ADVISORY_ENV_VARS.find((v) => v.key === 'CRON_SECRET');
    expect(entry).toBeDefined();
    expect(entry.key).toBe('CRON_SECRET');
  });

  it('checkConfiguration returns pass for CRON_SECRET when present', () => {
    const config = checkConfiguration({
      CRON_SECRET: 'abc123',
      DATABASE_URL: 'postgres://x',
      NEXTAUTH_SECRET: 'y',
      NEXTAUTH_URL: 'https://z.example.com',
      DASHCLAW_API_KEY: 'k',
    });
    const check = config.checks.find((c) => c.id === 'cron_secret');
    expect(check).toBeDefined();
    expect(check.status).toBe('pass');
  });

  it('checkConfiguration returns warn for CRON_SECRET when absent', () => {
    const config = checkConfiguration({
      DATABASE_URL: 'postgres://x',
      NEXTAUTH_SECRET: 'y',
    });
    const check = config.checks.find((c) => c.id === 'cron_secret');
    expect(check).toBeDefined();
    expect(check.status).toBe('warn');
  });
});

describe('deploy section integration', () => {
  it('includes deploy section in report sections', async () => {
    mockGetSetupStatus.mockResolvedValue({ configured: true, reason: 'ready', missing: [] });
    const report = await getReadinessReport(
      { DATABASE_URL: 'postgres://test', NEXTAUTH_SECRET: 'secret', NEXTAUTH_URL: 'https://test.vercel.app' },
      { host: 'test.vercel.app' }
    );
    expect(report.deploy).toBeDefined();
    expect(report.deploy.id).toBe('deploy');
    expect(report.sections.some((s) => s.id === 'deploy')).toBe(true);
  });
});

