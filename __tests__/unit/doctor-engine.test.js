// __tests__/unit/doctor-engine.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDatabaseChecks,
  mockConfigChecks,
  mockAuthChecks,
  mockDeploymentChecks,
  mockSdkChecks,
  mockGovernanceChecks,
  mockOpenclawPluginChecks,
  mockHostedChecks,
  mockDataHygieneChecks,
  mockWriteCanaryChecks,
} = vi.hoisted(() => ({
  mockDatabaseChecks: vi.fn(async () => []),
  mockConfigChecks: vi.fn(async () => []),
  mockAuthChecks: vi.fn(async () => []),
  mockDeploymentChecks: vi.fn(async () => []),
  mockSdkChecks: vi.fn(async () => []),
  mockGovernanceChecks: vi.fn(async () => []),
  mockOpenclawPluginChecks: vi.fn(async () => []),
  mockHostedChecks: vi.fn(async () => []),
  mockDataHygieneChecks: vi.fn(async () => []),
  mockWriteCanaryChecks: vi.fn(async () => []),
}));

vi.mock('@/lib/doctor/checks/database.mjs', () => ({ runChecks: mockDatabaseChecks }));
vi.mock('@/lib/doctor/checks/config.mjs', () => ({ runChecks: mockConfigChecks }));
vi.mock('@/lib/doctor/checks/auth.mjs', () => ({ runChecks: mockAuthChecks }));
vi.mock('@/lib/doctor/checks/deployment.mjs', () => ({ runChecks: mockDeploymentChecks }));
vi.mock('@/lib/doctor/checks/sdk.mjs', () => ({ runChecks: mockSdkChecks }));
vi.mock('@/lib/doctor/checks/governance.mjs', () => ({ runChecks: mockGovernanceChecks }));
vi.mock('@/lib/doctor/checks/openclawPlugin.mjs', () => ({ runChecks: mockOpenclawPluginChecks }));
vi.mock('@/lib/doctor/checks/hosted.mjs', () => ({ runChecks: mockHostedChecks }));
vi.mock('@/lib/doctor/checks/data-hygiene.mjs', () => ({ runChecks: mockDataHygieneChecks }));
vi.mock('@/lib/doctor/checks/write-canary.mjs', () => ({ runChecks: mockWriteCanaryChecks }));

import { runDoctor, computeSummary } from '@/lib/doctor/engine.mjs';

beforeEach(() => {
  vi.clearAllMocks();
  mockDatabaseChecks.mockResolvedValue([]);
  mockConfigChecks.mockResolvedValue([]);
  mockAuthChecks.mockResolvedValue([]);
  mockDeploymentChecks.mockResolvedValue([]);
  mockSdkChecks.mockResolvedValue([]);
  mockGovernanceChecks.mockResolvedValue([]);
  mockOpenclawPluginChecks.mockResolvedValue([]);
  mockHostedChecks.mockResolvedValue([]);
  mockDataHygieneChecks.mockResolvedValue([]);
  mockWriteCanaryChecks.mockResolvedValue([]);
});

describe('runDoctor', () => {
  it('returns healthy when all checks pass', async () => {
    mockDatabaseChecks.mockResolvedValue([
      { id: 'db_connection', category: 'database', status: 'pass', title: 'DB', message: 'OK', fix: null },
    ]);
    mockConfigChecks.mockResolvedValue([
      { id: 'env_DATABASE_URL', category: 'config', status: 'pass', title: 'DATABASE_URL', message: 'Present', fix: null },
    ]);

    const result = await runDoctor();

    expect(result.status).toBe('healthy');
    expect(result.checks).toHaveLength(2);
    expect(result.summary).toEqual({ pass: 2, warn: 0, fail: 0 });
    expect(result.timestamp).toBeDefined();
  });

  it('returns unhealthy when any check fails', async () => {
    mockDatabaseChecks.mockResolvedValue([
      { id: 'db_connection', category: 'database', status: 'fail', title: 'DB', message: 'Refused', fix: null },
    ]);

    const result = await runDoctor();

    expect(result.status).toBe('unhealthy');
    expect(result.summary.fail).toBe(1);
  });

  it('returns needs_attention when checks warn but none fail', async () => {
    mockConfigChecks.mockResolvedValue([
      { id: 'env_NEXTAUTH_URL', category: 'config', status: 'warn', title: 'URL', message: 'Not set', fix: null },
    ]);

    const result = await runDoctor();

    expect(result.status).toBe('needs_attention');
    expect(result.summary.warn).toBe(1);
  });

  it('filters by category when specified', async () => {
    mockDatabaseChecks.mockResolvedValue([
      { id: 'db_connection', category: 'database', status: 'pass', title: 'DB', message: 'OK', fix: null },
    ]);
    mockConfigChecks.mockResolvedValue([
      { id: 'env_x', category: 'config', status: 'pass', title: 'ENV', message: 'OK', fix: null },
    ]);

    const result = await runDoctor({ categories: ['database'] });

    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].category).toBe('database');
  });

  it('runs the data-hygiene category and supports filtering to it', async () => {
    mockDataHygieneChecks.mockResolvedValue([
      { id: 'dh_timestamp_format', category: 'data-hygiene', status: 'pass', title: 'Timestamps', message: 'OK', fix: null },
    ]);
    mockDatabaseChecks.mockResolvedValue([
      { id: 'db_connection', category: 'database', status: 'pass', title: 'DB', message: 'OK', fix: null },
    ]);

    const all = await runDoctor();
    expect(all.checks.some((c) => c.category === 'data-hygiene')).toBe(true);

    const filtered = await runDoctor({ categories: ['data-hygiene'] });
    expect(filtered.checks).toHaveLength(1);
    expect(filtered.checks[0].id).toBe('dh_timestamp_format');
  });

  it('runs the write-canary category and a dead write path makes the instance unhealthy', async () => {
    mockWriteCanaryChecks.mockResolvedValue([
      { id: 'canary_agent_presence', category: 'write-canary', status: 'fail', title: 'Heartbeats', message: 'dead', fix: { type: 'auto', description: 'Run migrations', action: 'migrate' } },
    ]);

    const all = await runDoctor();
    expect(all.status).toBe('unhealthy');

    const filtered = await runDoctor({ categories: ['write-canary'] });
    expect(filtered.checks).toHaveLength(1);
    expect(filtered.checks[0].id).toBe('canary_agent_presence');
  });

  it('strips fix metadata when includeFixes is false', async () => {
    mockDatabaseChecks.mockResolvedValue([
      { id: 'db_tables', category: 'database', status: 'fail', title: 'Tables', message: 'Missing',
        fix: { type: 'auto', description: 'Run migrations', action: 'migrate' } },
    ]);

    const result = await runDoctor({ includeFixes: false });

    expect(result.checks[0].fix).toBeNull();
  });
});

describe('computeSummary', () => {
  it('counts pass/warn/fail correctly', () => {
    const checks = [
      { status: 'pass' }, { status: 'pass' }, { status: 'warn' }, { status: 'fail' },
    ];
    expect(computeSummary(checks)).toEqual({ pass: 2, warn: 1, fail: 1 });
  });

  it('returns zeros for empty array', () => {
    expect(computeSummary([])).toEqual({ pass: 0, warn: 0, fail: 0 });
  });
});
