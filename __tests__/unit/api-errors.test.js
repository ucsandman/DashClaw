/**
 * apiErrorResponse — production detail/code redaction (v3.7 item 5e).
 *
 * The generic 500 fallback echoes err.message/err.code to any API-key/JWT
 * holder. In production this must be withheld unless the operator opts back
 * in via DASHCLAW_EXPOSE_ERROR_DETAIL=true; the three curated 503 branches
 * (schema-not-initialized, DB connection, DATABASE_URL missing) are safe by
 * construction and must stay untouched in every environment.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiErrorResponse } from '@/lib/apiErrors';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('apiErrorResponse — generic fallback redaction', () => {
  it('withholds detail and code in production by default', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DASHCLAW_EXPOSE_ERROR_DETAIL', '');
    const err = Object.assign(new Error('column "duration_ms" does not exist'), { code: '42703' });

    const res = apiErrorResponse(err, 'TEST');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal server error');
    expect(body.detail).toBe(
      'Error detail withheld. Set DASHCLAW_EXPOSE_ERROR_DETAIL=true to include it in responses.',
    );
    expect(body.code).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('duration_ms');
  });

  it('includes detail and code in production when DASHCLAW_EXPOSE_ERROR_DETAIL=true', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DASHCLAW_EXPOSE_ERROR_DETAIL', 'true');
    const err = Object.assign(new Error('column "duration_ms" does not exist'), { code: '42703' });

    const res = apiErrorResponse(err, 'TEST');
    const body = await res.json();
    expect(body.error).toBe('Internal server error');
    expect(body.detail).toBe('column "duration_ms" does not exist');
    expect(body.code).toBe('42703');
  });

  it('includes full detail and code outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const err = Object.assign(new Error('db exploded'), { code: 'ECONNRESET' });

    const res = apiErrorResponse(err, 'TEST');
    const body = await res.json();
    expect(body.error).toBe('Internal server error');
    expect(body.detail).toBe('db exploded');
    expect(body.code).toBe('ECONNRESET');
  });
});

describe('apiErrorResponse — curated 503 branches are unaffected by the redaction gate', () => {
  it('42P01 schema-not-initialized stays fully descriptive in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const err = Object.assign(new Error('relation "guard_decisions" does not exist'), { code: '42P01' });

    const res = apiErrorResponse(err, 'TEST');
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('SCHEMA_NOT_INITIALIZED');
    expect(body.error).toMatch(/Database schema not initialized/);
    expect(body.setup_url).toBe('/setup');
  });

  it('08xxx connection errors stay fully descriptive in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const err = Object.assign(new Error('connection refused'), { code: '08006' });

    const res = apiErrorResponse(err, 'TEST');
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('DB_CONNECTION_FAILED');
    expect(body.error).toMatch(/Database connection failed/);
  });

  it('missing DATABASE_URL stays fully descriptive in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const err = new Error('DATABASE_URL is not set in this environment');

    const res = apiErrorResponse(err, 'TEST');
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('DB_NOT_CONFIGURED');
    expect(body.error).toMatch(/DATABASE_URL is not configured/);
  });
});
