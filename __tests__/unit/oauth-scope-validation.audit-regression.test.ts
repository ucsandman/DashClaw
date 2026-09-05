// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetToken,
  mockGetClient,
  mockInsertCode,
  mockRegisterClient,
  mockConsumeCode,
  mockInsertToken,
  mockRotateRefresh,
} = vi.hoisted(() => ({
  mockGetToken: vi.fn(),
  mockGetClient: vi.fn(),
  mockInsertCode: vi.fn(),
  mockRegisterClient: vi.fn(),
  mockConsumeCode: vi.fn(),
  mockInsertToken: vi.fn(),
  mockRotateRefresh: vi.fn(),
}));

vi.mock('next-auth/jwt', () => ({ getToken: mockGetToken }));
vi.mock('../../app/lib/db.js', () => ({ getSql: () => vi.fn() }));
vi.mock('../../app/lib/repositories/oauth.repository.js', () => ({
  getClient: mockGetClient,
  insertAuthCode: mockInsertCode,
  registerClient: mockRegisterClient,
  consumeAuthCode: mockConsumeCode,
  insertAccessToken: mockInsertToken,
  rotateRefreshToken: mockRotateRefresh,
}));

const { GET: authorizeGET, POST: authorizePOST } = await import('../../app/api/oauth/authorize/route.js');
const { POST: registerPOST } = await import('../../app/api/oauth/register/route.js');
const { POST: tokenPOST } = await import('../../app/api/oauth/token/route.js');

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

function authorizeRequest(scope: string, method = 'GET') {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: 'ocl_1',
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'state-fixture',
    scope,
  });
  return new Request(`https://dashclaw.example/api/oauth/authorize?${params}`, {
    method,
    headers: {
      host: 'dashclaw.example',
      origin: 'https://dashclaw.example',
    },
  });
}

function tokenForm(params: Record<string, string>) {
  return new Request('https://dashclaw.example/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetToken.mockResolvedValue({ orgId: 'org_1', userId: 'usr_1' });
  mockGetClient.mockResolvedValue({
    clientId: 'ocl_1',
    clientName: 'Connector',
    redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
    scope: 'governance:read governance:write',
  });
});

describe('F03: OAuth authorization scope validation', () => {
  it('rejects unsupported and malformed authorization scopes', async () => {
    for (const scope of ['governance:admin', 'governance:read unknown:scope', '   ']) {
      const response = await authorizeGET(authorizeRequest(scope));
      expect(response.status, scope).toBe(400);
      expect((await response.json()).error).toBe('invalid_scope');
    }
  });

  it('rejects a requested scope outside the dynamically registered client scope', async () => {
    mockGetClient.mockResolvedValue({
      clientId: 'ocl_1',
      clientName: 'Read connector',
      redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
      scope: 'governance:read',
    });
    const response = await authorizePOST(authorizeRequest('governance:write', 'POST'));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_scope');
    expect(mockInsertCode).not.toHaveBeenCalled();
  });

  it('normalizes the validated scope before persisting the authorization code', async () => {
    const response = await authorizePOST(authorizeRequest(
      'governance:write governance:read governance:write',
      'POST',
    ));
    expect(response.status).toBe(303);
    expect(mockInsertCode).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      scope: 'governance:read governance:write',
    }));
  });

  it('rejects unsupported dynamic client registration scope metadata', async () => {
    const response = await registerPOST(new Request('https://dashclaw.example/api/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        scope: 'governance:read account:delete',
      }),
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_client_metadata');
    expect(mockRegisterClient).not.toHaveBeenCalled();
  });

  it('normalizes supported dynamic client registration scopes', async () => {
    const response = await registerPOST(new Request('https://dashclaw.example/api/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        scope: 'governance:write governance:read governance:write',
      }),
    }));
    expect(response.status).toBe(201);
    expect(mockRegisterClient).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      scope: 'governance:read governance:write',
    }));
  });

  it('refuses to mint an access token from an invalid persisted scope', async () => {
    mockConsumeCode.mockResolvedValue({
      client_id: 'ocl_1',
      org_id: 'org_1',
      user_id: 'usr_1',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      scope: 'governance:read unknown:scope',
      agent_id: 'claude-desktop',
    });
    const response = await tokenPOST(tokenForm({
      grant_type: 'authorization_code',
      code: 'oac_fixture',
      client_id: 'ocl_1',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_verifier: VERIFIER,
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_scope');
    expect(mockInsertToken).not.toHaveBeenCalled();
  });
});
