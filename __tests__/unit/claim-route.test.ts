/**
 * /api/hosted/claim — claim-your-workspace route contract:
 *  - GET: claimability preview for the /claim page (trial cookie + principal).
 *  - POST: an authenticated human (usr_ principal from middleware) with a
 *    valid trial cookie in the same browser claims the trial org, their
 *    auto-minted personal org is discarded, and the trial cookie is cleared.
 *  - 404 off-hosted; 401 for non-human principals; 400 without a trial
 *    cookie; 409 when the org is not claimable or the current workspace
 *    cannot be left behind; same-user already_claimed re-runs are recovery.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockIsHostedMode, mockResolveTrialSession,
  mockGetClaimable, mockClaim, mockDiscard, mockCanLeave, mockBind,
} = vi.hoisted(() => ({
  mockIsHostedMode: vi.fn(() => true),
  mockResolveTrialSession: vi.fn(async (): Promise<{ provider: string; orgId: string } | null> => ({ provider: 'trial', orgId: 'org_trial' })),
  mockGetClaimable: vi.fn(),
  mockClaim: vi.fn(),
  mockDiscard: vi.fn(async (): Promise<{ discarded: boolean; reason?: string }> => ({ discarded: true })),
  mockCanLeave: vi.fn(async () => true),
  mockBind: vi.fn(async () => true),
}));

vi.mock('@/lib/hosted/flag', () => ({ isHostedMode: mockIsHostedMode }));
vi.mock('@/lib/sessionViewer.mjs', () => ({
  resolveTrialSession: mockResolveTrialSession,
  TRIAL_SESSION_COOKIE: 'dashclaw-trial-session',
}));
const { mockGetUserDisplay } = vi.hoisted(() => ({
  mockGetUserDisplay: vi.fn(async (): Promise<{ name: string | null; email: string | null } | null> => ({ name: 'Wes', email: 'wes@example.com' })),
}));
vi.mock('@/lib/repositories/claim.repository', () => ({
  getClaimableWorkspace: mockGetClaimable,
  claimTrialWorkspace: mockClaim,
  discardAbandonedPersonalOrg: mockDiscard,
  canLeaveBehindOrg: mockCanLeave,
  bindUserAsAdmin: mockBind,
  getUserDisplay: mockGetUserDisplay,
}));

vi.mock('@/lib/db', () => ({ getSql: () => ({}) }));

const { GET, POST } = await import('../../app/api/hosted/claim/route');

function req(method: string, { userId = 'usr_1', orgId = 'org_personal', cookie = 'dashclaw-trial-session=tok' } = {}) {
  const headers: Record<string, string> = { cookie };
  if (userId) headers['x-user-id'] = userId;
  if (orgId) headers['x-org-id'] = orgId;
  return new Request('http://localhost:3000/api/hosted/claim', { method, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsHostedMode.mockReturnValue(true);
  mockResolveTrialSession.mockResolvedValue({ provider: 'trial', orgId: 'org_trial' });
  mockGetClaimable.mockResolvedValue({ claimable: true, orgId: 'org_trial', name: 'Trial workspace', actionsUsed: 3 });
  mockClaim.mockResolvedValue({ claimed: true, previousOrgId: 'org_personal' });
  mockDiscard.mockResolvedValue({ discarded: true });
  mockCanLeave.mockResolvedValue(true);
  mockGetUserDisplay.mockResolvedValue({ name: 'Wes', email: 'wes@example.com' });
});

describe('shared gates', () => {
  it('off-hosted: GET is a calm 200 non-claimable preview, POST stays 404', async () => {
    mockIsHostedMode.mockReturnValue(false);
    const get = await GET(req('GET'));
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ claimable: false, reason: 'not_hosted' });
    expect((await POST(req('POST'))).status).toBe(404);
  });

  it('POST without a trial cookie is a 400; GET is a calm 200 preview (the banner probes it on every page)', async () => {
    mockResolveTrialSession.mockResolvedValue(null);
    const post = await POST(req('POST'));
    expect(post.status).toBe(400);
    expect((await post.json()).error).toBe('no_trial_session');

    const get = await GET(req('GET'));
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({ claimable: false, reason: 'no_trial_session' });
  });
});

describe('GET (preview)', () => {
  it('reports claimability + signed-in state for a human principal', async () => {
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      claimable: true,
      signed_in: true,
      current_workspace_movable: true,
      workspace: { org_id: 'org_trial', actions_used: 3 },
    });
  });

  it('a trial-cookie-only browser is not signed in (no movability check)', async () => {
    const res = await GET(req('GET', { userId: 'trial:org_trial', orgId: 'org_trial' }));
    const body = await res.json();
    expect(body.signed_in).toBe(false);
    expect(mockCanLeave).not.toHaveBeenCalled();
  });
});

describe('POST (claim)', () => {
  it('claims, renames after the user, discards the abandoned org, clears the cookie', async () => {
    const res = await POST(req('POST'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ claimed: true, org_id: 'org_trial' });
    expect(mockClaim).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_trial', userId: 'usr_1', orgName: "Wes's workspace",
    });
    expect(mockDiscard).toHaveBeenCalledWith(expect.anything(), 'org_personal');
    expect(res.headers.get('set-cookie') || '').toContain('dashclaw-trial-session=;');
  });

  it('401 for non-human principals (trial cookie only, api key, missing)', async () => {
    for (const userId of ['trial:org_trial', 'key_abc', '']) {
      const res = await POST(req('POST', { userId }));
      expect(res.status).toBe(401);
    }
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it('409 when the current workspace cannot be left behind', async () => {
    mockCanLeave.mockResolvedValue(false);
    const res = await POST(req('POST'));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('current_workspace_not_empty');
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it('409 with the truthful reason when the org is not claimable', async () => {
    mockGetClaimable.mockResolvedValue({ claimable: false, reason: 'expired' });
    const res = await POST(req('POST'));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('expired');
  });

  it('already_claimed by SOMEONE ELSE → 409; claim never re-runs', async () => {
    mockGetClaimable.mockResolvedValue({ claimable: false, reason: 'already_claimed', claimedByUserId: 'usr_other' });
    const res = await POST(req('POST'));
    expect(res.status).toBe(409);
    expect(mockBind).not.toHaveBeenCalled();
  });

  it('already_claimed by THIS user → recovery: rebind finishes and the cookie clears', async () => {
    mockGetClaimable.mockResolvedValue({ claimable: false, reason: 'already_claimed', claimedByUserId: 'usr_1' });
    const res = await POST(req('POST'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ claimed: true, recovered: true });
    expect(mockBind).toHaveBeenCalledWith(expect.anything(), { userId: 'usr_1', orgId: 'org_trial' });
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it('a lost claim race is a 409, and nothing is discarded', async () => {
    mockClaim.mockResolvedValue({ claimed: false, reason: 'not_claimable' });
    const res = await POST(req('POST'));
    expect(res.status).toBe(409);
    expect(mockDiscard).not.toHaveBeenCalled();
  });

  it('discard failure never fails the claim', async () => {
    mockDiscard.mockResolvedValue({ discarded: false, reason: 'delete_failed' });
    const res = await POST(req('POST'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ claimed: true });
  });
});
