/**
 * POST /api/settings/test with integration 'external_verdict' — the /policies
 * panel's "Test provider" probe (#219 follow-up). Fires the production wire
 * client (fetchExternalVerdict) at the SAVED provider config with a clearly-
 * marked synthetic act, so an operator sees exactly which contract stage a
 * misconfigured provider fails at BEFORE real guard decisions start taking
 * the unavailability posture. Lives inside the existing connection-test
 * route: the surface budget (THESIS.md) makes a new route a thesis amendment,
 * and this probe does not warrant one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetConfig, mockFetchVerdict, mockInvalidateSettings, mockInvalidateExternal } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockFetchVerdict: vi.fn(),
  mockInvalidateSettings: vi.fn(),
  mockInvalidateExternal: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => ({}) }));
vi.mock('@/lib/guard/caches', async (importOriginal) => ({
  ...(await importOriginal()),
  getExternalVerdictConfig: mockGetConfig,
  invalidateGuardSettingsCache: mockInvalidateSettings,
  invalidateGuardExternalVerdictCache: mockInvalidateExternal,
}));
vi.mock('@/lib/guard/external-verdict', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchExternalVerdict: mockFetchVerdict,
}));

const { POST } = await import('@/api/settings/test/route');
const { computeInputIdentity } = await import('@/lib/guard/external-verdict');

const CFG = {
  enabled: true,
  url: 'https://provider.example.com/verdict',
  authToken: 'tok',
  timeoutMs: 1200,
  posture: 'fail_closed',
  providerId: 'agent-memory-pama',
};

function req(role = 'admin') {
  return new Request('http://localhost/api/settings/test', {
    method: 'POST',
    headers: { 'x-org-role': role, 'x-org-id': 'org_test', 'content-type': 'application/json' },
    body: JSON.stringify({ integration: 'external_verdict' }),
  });
}

function okEvidence(overrides = {}) {
  return {
    provider_id: CFG.providerId,
    status: 'ok',
    regime: 'external+local',
    posture: CFG.posture,
    latency_ms: 42,
    raw_verdict: 'allow',
    mapped_verdict: 'allow',
    reason_code: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfig.mockResolvedValue(CFG);
  mockFetchVerdict.mockResolvedValue(okEvidence());
});

describe('POST /api/settings/test — external_verdict probe', () => {
  it('rejects non-admin callers with 403 and never touches the provider', async () => {
    const res = await POST(req('member'));
    expect(res.status).toBe(403);
    expect(mockFetchVerdict).not.toHaveBeenCalled();
  });

  it('answers success:false when no provider URL is saved', async () => {
    mockGetConfig.mockResolvedValue({ ...CFG, url: null, configState: 'unset' });
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/provider url/i);
    expect(mockFetchVerdict).not.toHaveBeenCalled();
  });

  it('A1: distinguishes a decrypt-broken saved URL from never-configured', async () => {
    mockGetConfig.mockResolvedValue({ ...CFG, url: null, configState: 'unreadable' });
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/cannot be decrypted/i);
    expect(body.message).not.toMatch(/no provider url saved/i);
    expect(mockFetchVerdict).not.toHaveBeenCalled();
  });

  it('invalidates the config caches before reading, so the probe always tests what was just saved', async () => {
    await POST(req());
    expect(mockInvalidateSettings).toHaveBeenCalledWith('org_test');
    expect(mockInvalidateExternal).toHaveBeenCalledWith('org_test');
    // invalidate happened before the config read
    expect(mockInvalidateExternal.mock.invocationCallOrder[0])
      .toBeLessThan(mockGetConfig.mock.invocationCallOrder[0]);
  });

  it('probes with the saved config, full configured timeout, and a synthetic identity-bound act', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mockFetchVerdict).toHaveBeenCalledTimes(1);
    const [cfg, wire, budget] = mockFetchVerdict.mock.calls[0];
    expect(cfg).toBe(CFG);
    expect(budget).toBe(CFG.timeoutMs);
    // The act is unmistakably synthetic and scoped to the calling org.
    expect(wire.org_id).toBe('org_test');
    expect(wire.action_type).toBe('dashclaw.connection_test');
    expect(wire.act).toMatchObject({ synthetic: true });
    expect(wire.request_id).toMatch(/^evr_/);
    // input_identity is the real digest of the wire tuple — providers echo it.
    expect(wire.input_identity).toBe(computeInputIdentity({
      org_id: wire.org_id,
      agent_id: wire.agent_id,
      action_type: wire.action_type,
      declared_goal: wire.declared_goal,
      act: wire.act,
    }));
  });

  it('returns the wire evidence and an ok message on success', async () => {
    const res = await POST(req());
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.evidence.mapped_verdict).toBe('allow');
    expect(body.evidence.latency_ms).toBe(42);
    expect(body.message).toMatch(/allow/);
  });

  it('surfaces a wire failure as success:false with the failure code intact', async () => {
    mockFetchVerdict.mockResolvedValue({
      provider_id: CFG.providerId,
      status: 'unavailable',
      regime: 'external_unavailable',
      posture: 'fail_closed',
      latency_ms: 7,
      failure: 'identity_mismatch',
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.evidence.failure).toBe('identity_mismatch');
    expect(body.message).toMatch(/identity/i);
  });

  it('probes even while the provider toggle is off — operators verify before enabling', async () => {
    mockGetConfig.mockResolvedValue({ ...CFG, enabled: false });
    const res = await POST(req());
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockFetchVerdict).toHaveBeenCalledTimes(1);
  });
});
