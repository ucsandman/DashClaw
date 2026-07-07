import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';
import { generateSigningKey } from '../../app/lib/integrity/keys.js';
import { verifyBundle } from '../../app/lib/integrity/bundle.js';

// The compliance cockpit was culled in v5 (Wave 11); the tamper-evident audit
// export folds into the surviving /api/artifacts/evidence-bundle route, which
// now SIGNS the bundle via app/lib/integrity/bundle.signBundle. This pins that
// fold: the exported bundle is a signed, independently re-verifiable envelope.

const KEY = generateSigningKey('evidence-test-kid');

const { mockSql, mockBuildBundle, mockCreateArtifact } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockBuildBundle: vi.fn(),
  mockCreateArtifact: vi.fn(async () => ({})),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));
vi.mock('@/lib/repositories/artifacts.repository.js', () => ({
  buildEvidenceBundle: mockBuildBundle,
  createArtifact: mockCreateArtifact,
}));
vi.mock('@/lib/integrity/server-key.js', () => ({
  getServerSigningKey: vi.fn(async () => ({ kid: KEY.kid, privateKeyJwk: KEY.privateKeyJwk, publicKeyJwk: KEY.publicKeyJwk, source: 'db' })),
  getServerPublicJwks: vi.fn(async () => ({ keys: [KEY.publicKeyJwk] })),
}));

import { POST } from '@/api/artifacts/evidence-bundle/route.js';

const UNSIGNED_BUNDLE = {
  artifact_type: 'evidence_bundle',
  action: { action_id: 'act_1', declared_goal: 'deploy to prod', agent_id: 'agent_1' },
  steps: [{ action_id: 'act_1.1' }, { action_id: 'act_1.2' }],
  artifacts: [{ artifact_id: 'art_1' }],
  generated_at: '2026-07-07T00:00:00Z',
};

describe('/api/artifacts/evidence-bundle POST — signed export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    mockBuildBundle.mockResolvedValue(UNSIGNED_BUNDLE);
  });

  it('returns a signed bundle envelope that re-verifies against the instance key', async () => {
    const res = await POST(makeRequest('http://localhost/api/artifacts/evidence-bundle', { body: { action_id: 'act_1' } }));
    expect(res.status).toBe(200);
    const bundle = await res.json();

    // Signed envelope, not the bare unsigned payload.
    expect(bundle.version).toBe('dashclaw-compliance-bundle/v1');
    expect(bundle.signature).toBeTruthy();
    // The evidence content lives inside the signed payload.
    expect(bundle.payload.action.action_id).toBe('act_1');
    expect(bundle.payload.steps).toHaveLength(2);
    // Independently re-verifiable against the published key (fail-closed).
    expect(verifyBundle(bundle, [KEY.publicKeyJwk]).ok).toBe(true);
  });

  it('binds the payload: tampering the bundle breaks verification', async () => {
    const res = await POST(makeRequest('http://localhost/api/artifacts/evidence-bundle', { body: { action_id: 'act_1' } }));
    const bundle = await res.json();
    bundle.payload.steps = [{ action_id: 'INJECTED' }];
    expect(verifyBundle(bundle, [KEY.publicKeyJwk]).ok).toBe(false);
  });

  it('persists the signed envelope as the evidence-bundle artifact', async () => {
    await POST(makeRequest('http://localhost/api/artifacts/evidence-bundle', { body: { action_id: 'act_1' } }));
    expect(mockCreateArtifact).toHaveBeenCalledTimes(1);
    const persisted = mockCreateArtifact.mock.calls[0][2];
    expect(persisted.artifact_type).toBe('evidence_bundle');
    expect(persisted.content_json.version).toBe('dashclaw-compliance-bundle/v1');
    expect(persisted.content_json.signature).toBeTruthy();
    expect(persisted.tags).toContain('signed');
  });

  it('does not persist when persist is false but still signs', async () => {
    const res = await POST(makeRequest('http://localhost/api/artifacts/evidence-bundle', { body: { action_id: 'act_1', persist: false } }));
    const bundle = await res.json();
    expect(mockCreateArtifact).not.toHaveBeenCalled();
    expect(verifyBundle(bundle, [KEY.publicKeyJwk]).ok).toBe(true);
  });

  it('404s when the action is not found', async () => {
    mockBuildBundle.mockResolvedValue(null);
    const res = await POST(makeRequest('http://localhost/api/artifacts/evidence-bundle', { body: { action_id: 'missing' } }));
    expect(res.status).toBe(404);
  });
});
