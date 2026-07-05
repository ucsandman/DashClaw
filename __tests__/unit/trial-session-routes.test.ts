/**
 * v5.1 "a way back in" — route-level contract:
 *  - POST /api/hosted/workspaces mints the dashclaw-trial-session cookie in
 *    hosted mode with NEXTAUTH_SECRET present; mints none when the secret is
 *    absent; stays 404 when hosted mode is off.
 *  - GET /api/keys/reveal refuses hosted trial orgs — the bootstrap key
 *    belongs to the instance operator, never a trial principal.
 */
// @vitest-environment node
// (jose signing needs same-realm Uint8Array; jsdom's TextEncoder fails its
// instanceof check. No DOM is used here.)
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockIsHostedMode, mockProvision, mockCountActive, mockGetWorkspace } = vi.hoisted(() => ({
  mockIsHostedMode: vi.fn(),
  mockProvision: vi.fn(),
  mockCountActive: vi.fn(),
  mockGetWorkspace: vi.fn(),
}));
vi.mock('@/lib/hosted/flag', () => ({
  isHostedMode: mockIsHostedMode,
  hostedConfig: () => ({
    trialDays: 30,
    trialActionCap: 10000,
    maxProvisionsPerIpPerDay: 5,
    maxActiveTrials: 500,
  }),
}));
vi.mock('@/lib/hosted/turnstile', () => ({
  verifyTurnstile: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/repositories/hosted-workspace.repository', () => ({
  provisionHostedWorkspace: mockProvision,
  countActiveTrials: mockCountActive,
  getHostedWorkspace: mockGetWorkspace,
}));
vi.mock('@/lib/db', () => ({ getSql: () => ({}) }));

import { POST as mintPOST, _resetLimiterForTests } from '../../app/api/hosted/workspaces/route';
import { GET as revealGET } from '../../app/api/keys/reveal/route';

// Test-only fixture, not a credential.
const JWT_SIGNING_FIXTURE = 'vitest-trial-session-signing-value';

function mintRequest() {
  return new Request('http://localhost:3000/api/hosted/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ turnstile_token: 'tok' }),
  });
}

const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  _resetLimiterForTests();
  vi.stubEnv('NEXTAUTH_SECRET', JWT_SIGNING_FIXTURE);
  mockCountActive.mockResolvedValue(0);
  mockProvision.mockResolvedValue({
    orgId: 'org_trial_route_cov',
    apiKey: 'raw-key-shown-once',
    keyPrefix: 'oc_live_12345678',
    expiresAt: FUTURE,
  });
});

describe('POST /api/hosted/workspaces — trial session cookie', () => {
  it('sets the trial session cookie alongside the key in hosted mode', async () => {
    mockIsHostedMode.mockReturnValue(true);
    const res = await mintPOST(mintRequest());
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('dashclaw-trial-session=');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
    expect(setCookie.toLowerCase()).toContain('expires=');
    // The key is still returned once in the body — the cookie is additive —
    // and session:true tells the client a dashboard is reachable.
    const body = await res.json();
    expect(body.api_key).toBe('raw-key-shown-once');
    expect(body.session).toBe(true);
  });

  it('degrades to a key-only response when NEXTAUTH_SECRET is unset (no unsigned sessions)', async () => {
    mockIsHostedMode.mockReturnValue(true);
    vi.stubEnv('NEXTAUTH_SECRET', '');
    const res = await mintPOST(mintRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie') || '').not.toContain('dashclaw-trial-session=');
    const body = await res.json();
    expect(body.api_key).toBe('raw-key-shown-once');
    // session:false so the post-mint UI never promises a dashboard that
    // would bounce the user to /login (review finding #2).
    expect(body.session).toBe(false);
  });

  it('remains 404 when hosted mode is off', async () => {
    mockIsHostedMode.mockReturnValue(false);
    const res = await mintPOST(mintRequest());
    expect(res.status).toBe(404);
    expect(mockProvision).not.toHaveBeenCalled();
  });
});

describe('GET /api/keys/reveal — hosted-trial refusal', () => {
  function revealRequest(orgId = 'org_reveal_cov') {
    return new Request('http://localhost:3000/api/keys/reveal', {
      headers: { 'x-user-id': 'usr_1', 'x-org-role': 'admin', 'x-org-id': orgId },
    });
  }

  beforeEach(() => {
    // The guard only runs on hosted instances; these cases exercise it.
    mockIsHostedMode.mockReturnValue(true);
    vi.stubEnv('DASHCLAW_API_KEY', 'operator-bootstrap-value');
  });

  it('403s when the requesting org is a hosted trial org', async () => {
    mockGetWorkspace.mockResolvedValue({ orgId: 'org_reveal_cov', hostedMode: true });
    const res = await revealGET(revealRequest());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('operator-bootstrap-value');
  });

  it('403s when the org cannot be found (fail closed)', async () => {
    mockGetWorkspace.mockResolvedValue(null);
    const res = await revealGET(revealRequest());
    expect(res.status).toBe(403);
  });

  it('403s when the org lookup throws (fail closed)', async () => {
    mockGetWorkspace.mockRejectedValue(new Error('db down'));
    const res = await revealGET(revealRequest());
    expect(res.status).toBe(403);
  });

  it('still reveals for a non-trial admin org on a hosted instance', async () => {
    mockGetWorkspace.mockResolvedValue({ orgId: 'org_default', hostedMode: false });
    const res = await revealGET(revealRequest('org_default'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toBe('operator-bootstrap-value');
  });

  it('self-host (hosted off): reveal works without ever querying hosted columns', async () => {
    // MEDIUM regression fix: an un-migrated self-host has no trial columns,
    // so the guard must not run the lookup at all when hosted mode is off.
    mockIsHostedMode.mockReturnValue(false);
    const res = await revealGET(revealRequest('org_default'));
    expect(res.status).toBe(200);
    expect(mockGetWorkspace).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.key).toBe('operator-bootstrap-value');
  });
});
