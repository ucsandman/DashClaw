// @vitest-environment node
/**
 * v5.1 security follow-up (review BLOCK → fixed): the trial session is
 * x-org-role: admin of its own org, so every role-only "admin" route that is
 * really an INSTANCE OPERATOR surface must reject a trial principal while
 * still admitting the operator. Covers the three routes hardened after the
 * reveal one-off: inspect/delete-any-workspace, tenant creation, and the
 * cleanup sweep. The shared guard is denyTrialPrincipal (hosted-only; caller
 * org hosted_mode=TRUE → 403; lookup failure → 403 fail-closed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockIsHostedMode, mockGetWorkspace, mockDeleteWorkspace, mockFindExpired } = vi.hoisted(() => ({
  mockIsHostedMode: vi.fn(),
  mockGetWorkspace: vi.fn(),
  mockDeleteWorkspace: vi.fn(),
  mockFindExpired: vi.fn(),
}));
vi.mock('@/lib/hosted/flag', () => ({ isHostedMode: mockIsHostedMode }));
vi.mock('@/lib/repositories/hosted-workspace.repository', () => ({
  getHostedWorkspace: mockGetWorkspace,
  deleteHostedWorkspace: mockDeleteWorkspace,
  findExpiredWorkspaces: mockFindExpired,
}));
vi.mock('@/lib/db', () => ({ getSql: () => ({}) }));

import { GET as wsGET, DELETE as wsDELETE } from '../../app/api/hosted/workspaces/[workspaceId]/route';
import { POST as cleanupPOST } from '../../app/api/hosted/cleanup/route';
import { POST as orgsPOST } from '../../app/api/orgs/route';

// A trial admin session: role admin, but the caller's OWN org is hosted_mode.
const TRIAL = { 'x-org-role': 'admin', 'x-org-id': 'org_trial_attacker', 'x-user-id': 'trial:org_trial_attacker' };
// The operator: admin of a non-trial org (org_default).
const OPERATOR = { 'x-org-role': 'admin', 'x-org-id': 'org_default' };

function asTrialOrg() {
  // denyTrialPrincipal looks up the CALLER's org; a trial caller is hosted.
  mockGetWorkspace.mockImplementation((_sql: unknown, orgId: string) =>
    orgId === 'org_trial_attacker'
      ? Promise.resolve({ orgId, hostedMode: true })
      : Promise.resolve({ orgId, hostedMode: true, name: 'victim', trialEndsAt: null, trialActionCap: 10, trialActionsUsed: 1 }),
  );
}
function asOperatorCaller() {
  mockGetWorkspace.mockImplementation((_sql: unknown, orgId: string) =>
    orgId === 'org_default'
      ? Promise.resolve({ orgId, hostedMode: false })
      : Promise.resolve({ orgId, hostedMode: true, name: 'victim', trialEndsAt: null, trialActionCap: 10, trialActionsUsed: 1 }),
  );
}

function req(path: string, method: string, headers: Record<string, string>, body?: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = (workspaceId: string) => ({ params: Promise.resolve({ workspaceId }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockIsHostedMode.mockReturnValue(true);
});

describe('GET/DELETE /api/hosted/workspaces/:id — cross-tenant inspect/delete', () => {
  it('trial principal cannot inspect another workspace (403)', async () => {
    asTrialOrg();
    const res = await wsGET(req('/api/hosted/workspaces/org_victim', 'GET', TRIAL), params('org_victim'));
    expect(res.status).toBe(403);
  });

  it('trial principal cannot DELETE another workspace (403, no delete attempted)', async () => {
    asTrialOrg();
    const res = await wsDELETE(req('/api/hosted/workspaces/org_victim', 'DELETE', TRIAL), params('org_victim'));
    expect(res.status).toBe(403);
    expect(mockDeleteWorkspace).not.toHaveBeenCalled();
  });

  it('operator can still inspect any workspace', async () => {
    asOperatorCaller();
    const res = await wsGET(req('/api/hosted/workspaces/org_victim', 'GET', OPERATOR), params('org_victim'));
    expect(res.status).toBe(200);
  });

  it('operator can still delete a workspace', async () => {
    asOperatorCaller();
    mockDeleteWorkspace.mockResolvedValue({ deleted: true });
    const res = await wsDELETE(req('/api/hosted/workspaces/org_victim', 'DELETE', OPERATOR), params('org_victim'));
    expect(res.status).toBe(200);
    expect(mockDeleteWorkspace).toHaveBeenCalled();
  });
});

describe('POST /api/orgs — tenant creation', () => {
  const validBody = { name: 'New Org', slug: 'new-org' };

  it('trial principal cannot create a new (uncapped) org (403)', async () => {
    asTrialOrg();
    const res = await orgsPOST(req('/api/orgs', 'POST', TRIAL, validBody));
    expect(res.status).toBe(403);
  });

  it('off-hosted self-host: org creation is unaffected by the guard', async () => {
    // No trial principals exist off-hosted; the guard is a no-op and normal
    // admin org creation proceeds (getSql is mocked as an empty object, so we
    // only assert the guard did not 403 — the insert path is exercised
    // elsewhere).
    mockIsHostedMode.mockReturnValue(false);
    const res = await orgsPOST(req('/api/orgs', 'POST', OPERATOR, validBody));
    expect(res.status).not.toBe(403);
    expect(mockGetWorkspace).not.toHaveBeenCalled();
  });
});

describe('POST /api/hosted/cleanup — instance sweep', () => {
  it('trial principal cannot trigger the sweep via admin role (403)', async () => {
    asTrialOrg();
    const res = await cleanupPOST(req('/api/hosted/cleanup', 'POST', TRIAL));
    expect(res.status).toBe(403);
    expect(mockFindExpired).not.toHaveBeenCalled();
  });

  it('cron secret still authorizes the sweep (no role needed)', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret-fixture-value');
    mockFindExpired.mockResolvedValue([]);
    const res = await cleanupPOST(
      req('/api/hosted/cleanup', 'POST', { authorization: 'Bearer cron-secret-fixture-value' }),
    );
    expect(res.status).toBe(200);
    expect(mockFindExpired).toHaveBeenCalled();
  });

  it('operator admin (non-trial org) can still trigger the sweep', async () => {
    asOperatorCaller();
    mockFindExpired.mockResolvedValue([]);
    const res = await cleanupPOST(req('/api/hosted/cleanup', 'POST', OPERATOR));
    expect(res.status).toBe(200);
  });
});
