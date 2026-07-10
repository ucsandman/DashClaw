import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assessHostedReadiness } from '../../../scripts/check-hosted-ready.mjs';

// Values are built at runtime / kept as obvious placeholder words so the repo
// secret guard does not flag this tracked test file. None are real credentials.
const FAKE_ADMIN_KEY = 'oc_' + 'live_' + '0123456789abcdef'.repeat(2); // /^oc_live_[0-9a-f]{32}$/
const ENC_KEY_32 = 'placeholder-encryption-key-'.padEnd(32, '0'); // exactly 32 ASCII bytes

// A complete, valid hosted env — every hard-required var set to a passing value.
// Individual tests clone this and remove/mangle one var to assert the hard fail.
const COMPLETE = {
  DASHCLAW_HOSTED: 'true',
  DATABASE_URL: 'postgres://user:pw@host/db',
  NEXTAUTH_SECRET: 'placeholder-nextauth-secret',
  NEXTAUTH_URL: 'https://hosted.dashclaw.io',
  ENCRYPTION_KEY: ENC_KEY_32,
  GOOGLE_ID: 'placeholder-google-client-id',
  GOOGLE_SECRET: 'placeholder-google-client-secret',
  TURNSTILE_SECRET_KEY: 'placeholder-turnstile-secret',
  DASHCLAW_API_KEY: FAKE_ADMIN_KEY,
  HOSTED_CLEANUP_SECRET: 'placeholder-cleanup-secret',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'placeholder-site-key',
  REDIS_URL: 'redis://localhost:6379',
};

describe('assessHostedReadiness', () => {
  const original = { ...process.env };
  beforeEach(() => { process.env = { ...original }; });
  afterEach(() => { process.env = { ...original }; });

  it('returns skipped when DASHCLAW_HOSTED is unset', () => {
    const r = assessHostedReadiness({});
    expect(r.status).toBe('skipped');
    expect(r.failures).toEqual([]);
  });

  it('passes when all required vars are set', () => {
    const r = assessHostedReadiness({ ...COMPLETE });
    expect(r.status).toBe('pass');
    expect(r.failures).toEqual([]);
  });

  it('fails loudly when TURNSTILE_SECRET_KEY is missing in hosted mode', () => {
    const env = { ...COMPLETE };
    delete env.TURNSTILE_SECRET_KEY;
    const r = assessHostedReadiness(env);
    expect(r.status).toBe('fail');
    expect(r.failures).toContainEqual(
      expect.objectContaining({ message: 'TURNSTILE_SECRET_KEY missing', nextAction: expect.any(String) }),
    );
  });

  it('warns when HOSTED_CLEANUP_SECRET and CRON_SECRET are both unset', () => {
    const env = { ...COMPLETE };
    delete env.HOSTED_CLEANUP_SECRET;
    delete env.CRON_SECRET;
    const r = assessHostedReadiness(env);
    expect(r.status).toBe('warn');
    expect(r.warnings).toContainEqual(
      expect.objectContaining({
        message: 'no cleanup secret configured (HOSTED_CLEANUP_SECRET or CRON_SECRET) — scheduled trial cleanup cannot authenticate',
        nextAction: expect.any(String),
      }),
    );
  });

  it('fails on DATABASE_URL missing', () => {
    const env = { ...COMPLETE };
    delete env.DATABASE_URL;
    const r = assessHostedReadiness(env);
    expect(r.status).toBe('fail');
    expect(r.failures).toContainEqual(
      expect.objectContaining({ message: 'DATABASE_URL missing', nextAction: expect.any(String) }),
    );
  });

  it('fails when DASHCLAW_API_KEY is missing or malformed', () => {
    const env = { ...COMPLETE };
    delete env.DASHCLAW_API_KEY;
    const r = assessHostedReadiness(env);
    expect(r.status).toBe('fail');
    expect(r.failures).toContainEqual(
      expect.objectContaining({ message: 'DASHCLAW_API_KEY missing', nextAction: expect.any(String) }),
    );
  });

  it('fails when NEXTAUTH_SECRET is missing', () => {
    const env = { ...COMPLETE };
    delete env.NEXTAUTH_SECRET;
    const r = assessHostedReadiness(env);
    expect(r.status).toBe('fail');
    expect(r.failures).toContainEqual(
      expect.objectContaining({ message: 'NEXTAUTH_SECRET missing', nextAction: expect.any(String) }),
    );
  });

  it('fails when NEXTAUTH_URL is missing', () => {
    const env = { ...COMPLETE };
    delete env.NEXTAUTH_URL;
    const r = assessHostedReadiness(env);
    expect(r.status).toBe('fail');
    expect(r.failures).toContainEqual(
      expect.objectContaining({ message: 'NEXTAUTH_URL missing', nextAction: expect.any(String) }),
    );
  });

  it('fails when ENCRYPTION_KEY is missing', () => {
    const env = { ...COMPLETE };
    delete env.ENCRYPTION_KEY;
    const r = assessHostedReadiness(env);
    expect(r.status).toBe('fail');
    expect(r.failures).toContainEqual(
      expect.objectContaining({ message: 'ENCRYPTION_KEY missing', nextAction: expect.any(String) }),
    );
  });

  it('fails when ENCRYPTION_KEY is not exactly 32 bytes', () => {
    const env = { ...COMPLETE, ENCRYPTION_KEY: 'too-short' };
    const r = assessHostedReadiness(env);
    expect(r.status).toBe('fail');
    expect(r.failures).toContainEqual(
      expect.objectContaining({
        message: 'ENCRYPTION_KEY must be exactly 32 bytes (32 ASCII characters)',
        nextAction: expect.any(String),
      }),
    );
  });

  it('fails when no sign-in provider pair is configured', () => {
    const env = { ...COMPLETE };
    delete env.GOOGLE_ID;
    delete env.GOOGLE_SECRET;
    const r = assessHostedReadiness(env);
    expect(r.status).toBe('fail');
    expect(r.failures).toContainEqual(
      expect.objectContaining({
        message: 'no dashboard sign-in method configured — nobody can sign in',
        nextAction: expect.any(String),
      }),
    );
  });

  it('accepts a GitHub provider pair as a valid sign-in method', () => {
    const env = { ...COMPLETE };
    delete env.GOOGLE_ID;
    delete env.GOOGLE_SECRET;
    env.GITHUB_ID = 'placeholder-gh-id';
    env.GITHUB_SECRET = 'placeholder-gh-secret';
    const r = assessHostedReadiness(env);
    expect(r.failures).toEqual([]);
  });

  it('warns (does not fail) when Redis is not configured', () => {
    const env = { ...COMPLETE };
    delete env.REDIS_URL;
    delete env.UPSTASH_REDIS_REST_URL;
    const r = assessHostedReadiness(env);
    expect(r.status).toBe('warn');
    expect(r.warnings).toContainEqual(
      expect.objectContaining({
        message: 'no Redis configured (REDIS_URL or UPSTASH_REDIS_REST_URL) — rate limits and SSE run in-memory',
        nextAction: expect.any(String),
      }),
    );
  });
});
