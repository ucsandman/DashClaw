// __tests__/unit/doctor-checks.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSetupStatus, mockCheckConfiguration } = vi.hoisted(() => ({
  mockGetSetupStatus: vi.fn(),
  mockCheckConfiguration: vi.fn(),
}));

vi.mock('@/lib/setupStatus.mjs', () => ({ getSetupStatus: mockGetSetupStatus }));
vi.mock('@/lib/readiness/configurationCheck.mjs', () => ({
  checkConfiguration: mockCheckConfiguration,
  buildConfigurationSection: vi.fn(),
}));

import { runChecks as databaseChecks } from '@/lib/doctor/checks/database.mjs';
import { runChecks as configChecks } from '@/lib/doctor/checks/config.mjs';

beforeEach(() => vi.clearAllMocks());

describe('doctor/checks/database', () => {
  it('returns pass checks when DB is configured', async () => {
    mockGetSetupStatus.mockResolvedValue({ configured: true, message: 'OK' });

    const checks = await databaseChecks({ env: { DATABASE_URL: 'postgres://test' } });

    expect(checks.length).toBeGreaterThanOrEqual(2);
    expect(checks.every((c) => c.category === 'database')).toBe(true);
    const conn = checks.find((c) => c.id === 'db_connection');
    expect(conn.status).toBe('pass');
  });

  it('returns fail with null fix when DATABASE_URL is missing', async () => {
    mockGetSetupStatus.mockResolvedValue({
      configured: false,
      reason: 'missing_database_url',
      message: 'DATABASE_URL is not set.',
    });

    const checks = await databaseChecks({ env: {} });

    const conn = checks.find((c) => c.id === 'db_connection');
    expect(conn.status).toBe('fail');
    expect(conn.fix).toBeNull();
  });

  it('returns fail when database connection fails', async () => {
    mockGetSetupStatus.mockResolvedValue({
      configured: false,
      reason: 'connection_error',
      message: 'Unable to connect to database',
    });

    const checks = await databaseChecks({ env: { DATABASE_URL: 'postgres://test' } });

    const conn = checks.find((c) => c.id === 'db_connection');
    expect(conn.status).toBe('fail');
    expect(conn.message).toContain('Unable to connect');
    expect(conn.fix).toBeNull();
  });

  it('returns fail with migrate fix when tables are missing', async () => {
    mockGetSetupStatus.mockResolvedValue({
      configured: false,
      reason: 'no_tables',
      message: 'Missing 3 tables.',
      missing: ['guard_policies', 'guard_decisions', 'action_records'],
    });

    const checks = await databaseChecks({ env: { DATABASE_URL: 'postgres://test' } });

    const schema = checks.find((c) => c.id === 'db_schema');
    expect(schema.status).toBe('fail');
    expect(schema.fix).toEqual({
      type: 'auto',
      description: 'Run database migrations to create missing tables',
      action: 'migrate',
    });
  });
});

describe('doctor/checks/config', () => {
  it('returns pass for present required vars', async () => {
    mockCheckConfiguration.mockReturnValue({
      ok: true,
      status: 'pass',
      checks: [
        { id: 'database_url', label: 'DATABASE_URL', status: 'pass', detail: 'Present' },
        { id: 'nextauth_secret', label: 'NEXTAUTH_SECRET', status: 'pass', detail: 'Present' },
      ],
      missingRequired: [],
      missingAdvisory: [],
    });

    const checks = await configChecks({ env: { DATABASE_URL: 'x', NEXTAUTH_SECRET: 'y' } });

    expect(checks.every((c) => c.status === 'pass')).toBe(true);
    expect(checks.every((c) => c.category === 'config')).toBe(true);
  });

  it('returns fail with generate_secret fix for missing NEXTAUTH_SECRET', async () => {
    mockCheckConfiguration.mockReturnValue({
      ok: false,
      status: 'fail',
      checks: [
        { id: 'database_url', label: 'DATABASE_URL', status: 'pass', detail: 'Present' },
        { id: 'nextauth_secret', label: 'NEXTAUTH_SECRET', status: 'fail', detail: 'Missing' },
      ],
      missingRequired: [{ key: 'NEXTAUTH_SECRET' }],
      missingAdvisory: [],
    });

    const checks = await configChecks({ env: { DATABASE_URL: 'x' } });

    const secret = checks.find((c) => c.id === 'env_NEXTAUTH_SECRET');
    expect(secret.status).toBe('fail');
    expect(secret.fix.action).toBe('generate_secret');
  });

  it('returns warn for missing advisory vars', async () => {
    mockCheckConfiguration.mockReturnValue({
      ok: true,
      status: 'warn',
      checks: [
        { id: 'nextauth_url', label: 'NEXTAUTH_URL', status: 'warn', detail: 'Not set' },
      ],
      missingRequired: [],
      missingAdvisory: [{ key: 'NEXTAUTH_URL' }],
    });

    const checks = await configChecks({ env: {} });

    const url = checks.find((c) => c.id === 'env_NEXTAUTH_URL');
    expect(url.status).toBe('warn');
    expect(url.likelyCause).toBeDefined();
    expect(url.nextAction).toBeDefined();
  });
});
