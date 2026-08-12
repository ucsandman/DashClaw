/**
 * Regression tests for three adversarial-review findings:
 *
 *  1. validate.js's `number` field type accepted Infinity/NaN because it only
 *     checked `typeof value === 'number'` (integer already used
 *     Number.isInteger, which rejects both).
 *  2. POST /api/orgs/[orgId]/keys validated role against a hardcoded
 *     ['admin','member','readonly'] list that didn't match the DB's
 *     api_keys_role_check constraint (admin|member only), so 'readonly' 500s
 *     on insert instead of 400ing.
 *  3. safeFetch in url-safety.ts validated a URL's DNS resolution but then
 *     called plain fetch(), which re-resolves DNS at connect time — no
 *     protection against DNS rebinding despite the module's own claims.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';
import { validateActionRecord } from '@/lib/validate.js';

describe('validate.js number field rejects non-finite values', () => {
  const baseRecord = { agent_id: 'agent_1', action_type: 'build', declared_goal: 'test' };

  it('rejects Infinity for cost_estimate (the 1e400 JSON-parse case)', () => {
    // {"cost_estimate": 1e400} is legal JSON number syntax; JSON.parse
    // resolves it to the JS value Infinity, not the (JSON-illegal) literal.
    const { valid, errors } = validateActionRecord({ ...baseRecord, cost_estimate: JSON.parse('1e400') });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('cost_estimate'))).toBe(true);
  });

  it('rejects -Infinity for cost_estimate', () => {
    const { valid, errors } = validateActionRecord({ ...baseRecord, cost_estimate: -Infinity });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('cost_estimate'))).toBe(true);
  });

  it('rejects NaN for cost_estimate', () => {
    const { valid, errors } = validateActionRecord({ ...baseRecord, cost_estimate: NaN });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('cost_estimate'))).toBe(true);
  });

  it('still accepts an ordinary finite cost_estimate', () => {
    const { valid, errors } = validateActionRecord({ ...baseRecord, cost_estimate: 1.5 });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });
});

describe('/api/orgs/[orgId]/keys POST role validation', () => {
  const { mockSql } = vi.hoisted(() => ({
    mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  }));

  vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));

  let POST;
  beforeEach(async () => {
    vi.clearAllMocks();
    // findOrgId's SELECT is the first sql call in the handler; a non-empty
    // row means "org exists" so the handler proceeds to role validation.
    mockSql.mockResolvedValueOnce([{ id: 'org_1' }]);
    ({ POST } = await import('@/api/orgs/[orgId]/keys/route.js'));
  });

  it('returns 400 (not 500) for role "readonly", which the DB constraint does not allow', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/orgs/org_1/keys', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { label: 'Key', role: 'readonly' },
      }),
      { params: Promise.resolve({ orgId: 'org_1' }) }
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/role must be one of/i);
    expect(data.error).not.toMatch(/readonly/i);
    // The insert must never have been attempted with the invalid role.
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('still accepts the valid "member" role', async () => {
    mockSql.mockResolvedValueOnce([]); // INSERT

    const res = await POST(
      makeRequest('http://localhost/api/orgs/org_1/keys', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { label: 'Key', role: 'member' },
      }),
      { params: Promise.resolve({ orgId: 'org_1' }) }
    );

    expect(res.status).toBe(201);
  });
});

describe('safeFetch pins the connection to the DNS-validated addresses', () => {
  // Each test re-mocks 'undici' and dynamically re-imports url-safety.js —
  // without resetModules, the second test's fresh vi.doMock would be
  // invisible to the already-cached module from the first test's import.
  beforeEach(() => {
    vi.resetModules();
  });

  it('builds an undici dispatcher from the resolved IPs instead of letting fetch re-resolve', async () => {
    const PUBLIC_IP = '93.184.216.34'; // example.com per IANA reservation
    const dnsLookup = vi.fn(async () => [{ address: PUBLIC_IP, family: 4 }]);

    let capturedOptions;
    vi.doMock('undici', async () => {
      const actual = await vi.importActual('undici');
      return {
        ...actual,
        fetch: vi.fn(async (_url, options) => {
          capturedOptions = options;
          return new Response('ok', { status: 200 });
        }),
      };
    });

    const { safeFetch } = await import('@/lib/url-safety.js');
    const res = await safeFetch('https://rebinding.example.com/path', { dnsLookup });

    expect(res.status).toBe(200);
    expect(dnsLookup).toHaveBeenCalledWith('rebinding.example.com', { all: true });
    // The DNS-rebinding fix: safeFetch must pass a dispatcher pinned to the
    // addresses it already validated, not rely on fetch's own connect-time
    // resolution (which a short-TTL malicious DNS record could flip to a
    // private IP between the validation lookup and the real connection).
    expect(capturedOptions.dispatcher).toBeDefined();
    expect(capturedOptions.redirect).toBe('manual');

    vi.doUnmock('undici');
  });

  it('a caller cannot override redirect or dispatcher via fetchOptions', async () => {
    const PUBLIC_IP = '93.184.216.34';
    const dnsLookup = vi.fn(async () => [{ address: PUBLIC_IP, family: 4 }]);

    let capturedOptions;
    vi.doMock('undici', async () => {
      const actual = await vi.importActual('undici');
      return {
        ...actual,
        fetch: vi.fn(async (_url, options) => {
          capturedOptions = options;
          return new Response('ok', { status: 200 });
        }),
      };
    });

    const { safeFetch } = await import('@/lib/url-safety.js');
    await safeFetch('https://rebinding.example.com/path', {
      dnsLookup,
      redirect: 'follow',
      dispatcher: 'attacker-supplied',
    });

    expect(capturedOptions.redirect).toBe('manual');
    expect(capturedOptions.dispatcher).not.toBe('attacker-supplied');

    vi.doUnmock('undici');
  });

  it('rejects a public-looking hostname that DNS-resolves to a private IP before ever calling fetch', async () => {
    const dnsLookup = vi.fn(async () => [{ address: '127.0.0.1', family: 4 }]);

    let fetchCalled = false;
    vi.doMock('undici', async () => {
      const actual = await vi.importActual('undici');
      return {
        ...actual,
        fetch: vi.fn(async () => {
          fetchCalled = true;
          return new Response('ok', { status: 200 });
        }),
      };
    });

    const { safeFetch } = await import('@/lib/url-safety.js');
    await expect(
      safeFetch('https://malicious-rebinding.example.com/', { dnsLookup })
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    expect(fetchCalled).toBe(false);

    vi.doUnmock('undici');
  });
});
