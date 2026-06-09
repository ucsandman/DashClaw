// __tests__/unit/doctor-format.test.js
import { describe, expect, it } from 'vitest';
import { formatDoctorResult, formatFixResult, formatManualSummary } from '@/lib/doctor/format.mjs';

const sample = {
  status: 'healthy',
  summary: { pass: 3, warn: 0, fail: 0 },
  checks: [
    { id: 'db_conn', category: 'database', status: 'pass', title: 'Database', message: 'OK', fix: null },
    { id: 'env_url', category: 'config', status: 'pass', title: 'DATABASE_URL', message: 'Set', fix: null },
    { id: 'auth_key', category: 'auth', status: 'pass', title: 'API Key', message: 'Present', fix: null },
  ],
  timestamp: '2026-04-12T00:00:00Z',
};

describe('formatDoctorResult', () => {
  it('returns JSON string in json mode', () => {
    const output = formatDoctorResult(sample, { json: true });
    const parsed = JSON.parse(output);
    expect(parsed.status).toBe('healthy');
    expect(parsed.checks).toHaveLength(3);
  });

  it('includes category headers in rich mode', () => {
    const output = formatDoctorResult(sample, { json: false });
    expect(output).toContain('Database');
    expect(output).toContain('Configuration');
    expect(output).toContain('Auth');
  });

  it('includes summary line', () => {
    const output = formatDoctorResult(sample, { json: false });
    expect(output).toContain('3 passed');
  });

  it('prints next action for warning and failing checks', () => {
    const output = formatDoctorResult({
      status: 'needs_attention',
      summary: { pass: 0, warn: 1, fail: 0 },
      checks: [
        {
          id: 'deploy_cors',
          category: 'deployment',
          status: 'warn',
          title: 'CORS',
          message: 'Origin is not set',
          likelyCause: 'ALLOWED_ORIGIN is missing',
          nextAction: 'Set ALLOWED_ORIGIN',
          fix: null,
        },
      ],
      timestamp: '2026-04-12T00:00:00Z',
    });

    expect(output).toContain('Origin is not set');
    expect(output).toContain('Likely cause: ALLOWED_ORIGIN is missing');
    expect(output).toContain('NEXT: Set ALLOWED_ORIGIN');
  });
});

describe('formatFixResult', () => {
  it('returns JSON in json mode', () => {
    const result = { applied: true, action: 'migrate', description: 'Ran migrations' };
    expect(JSON.parse(formatFixResult(result, { json: true })).applied).toBe(true);
  });

  it('returns human-readable string in rich mode', () => {
    const result = { applied: true, action: 'migrate', description: 'Ran migrations' };
    expect(formatFixResult(result, { json: false })).toContain('Ran migrations');
  });
});

describe('formatManualSummary', () => {
  it('returns empty string when no manual checks', () => {
    expect(formatManualSummary([])).toBe('');
  });

  it('lists manual checks', () => {
    const output = formatManualSummary([
      {
        id: 'x',
        message: 'Configure OAuth provider',
        likelyCause: 'OAuth provider is partially configured',
        nextAction: 'Add OAuth env vars',
        status: 'warn',
      },
    ]);
    expect(output).toContain('Manual action needed');
    expect(output).toContain('Configure OAuth provider');
    expect(output).toContain('Likely cause: OAuth provider is partially configured');
    expect(output).toContain('NEXT: Add OAuth env vars');
  });
});
