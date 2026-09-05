// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  sql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  prepare: vi.fn(),
  execute: vi.fn(),
  evaluateGuard: vi.fn(),
  evaluateAccess: vi.fn(),
  checkCircuitBreaker: vi.fn(),
  resolveAgentIdentity: vi.fn(),
  authorizeActionExecution: vi.fn(),
  createActionRecord: vi.fn(),
  createBlockedActionRecord: vi.fn(),
  updateActionOutcome: vi.fn(),
  updateCapability: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (callback: () => void) => callback() };
});
vi.mock('@/lib/db.js', () => ({ getSql: () => m.sql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_1', getUserId: () => 'usr_actor' }));
vi.mock('@/lib/capability-runtime.js', () => ({
  prepareCapabilityInvocation: m.prepare,
  executeCapabilityInvocation: m.execute,
}));
vi.mock('@/lib/guard.js', () => ({ evaluateGuard: m.evaluateGuard }));
vi.mock('@/lib/guard/execution.js', () => ({ authorizeActionExecution: m.authorizeActionExecution }));
vi.mock('@/lib/approvalSurfaces.js', () => ({ fireApprovalSurfaces: vi.fn() }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  createActionRecord: m.createActionRecord,
  createBlockedActionRecord: m.createBlockedActionRecord,
  updateActionOutcome: m.updateActionOutcome,
}));
vi.mock('@/lib/capability-health.js', () => ({ checkCircuitBreaker: m.checkCircuitBreaker }));
vi.mock('@/lib/repositories/capabilities.repository.js', () => ({ updateCapability: m.updateCapability }));
vi.mock('@/lib/repositories/capability-access.repository.js', () => ({ evaluateAccess: m.evaluateAccess }));
vi.mock('@/lib/identity-resolution.js', () => ({ resolveAgentIdentity: m.resolveAgentIdentity }));

const { POST } = await import('@/api/capabilities/[capabilityId]/invoke/route.js');

function post(body: Record<string, unknown> = {}) {
  return POST(new Request('http://localhost/api/capabilities/cap_1/invoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': 'usr_actor' },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ capabilityId: 'cap_1' }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.prepare.mockResolvedValue({
    capability: { capability_id: 'cap_1', name: 'Buy Domain', slug: 'buy-domain', risk_level: 'high' },
    schema: {
      method: 'POST',
      request_mapping: { domain: '$.domain', account: '$settings.ACCOUNT' },
    },
    endpoint: 'https://api.example.com/domains/${input.domain}/buy',
    authHeaders: { authorization: 'Bearer server-secret' },
    settings: { ACCOUNT: 'acct_1' },
  });
  m.evaluateGuard.mockImplementation(async (_orgId, context) => {
    context.action_type = 'spend';
    return { decision: 'allow', decision_id: 'dec_1', risk_score: 80, matched_policies: [] };
  });
  m.checkCircuitBreaker.mockResolvedValue({ open: false });
  m.resolveAgentIdentity.mockResolvedValue({
    agent_id: 'agt_1', agent_name: 'Buyer', verification_status: 'verified', verified: true,
  });
  m.evaluateAccess.mockResolvedValue({ access: 'allow', rule: null });
  m.createActionRecord.mockResolvedValue({ action_id: 'act_1' });
  m.authorizeActionExecution.mockResolvedValue({ action_id: 'act_1', execution_claimed_at: 'now' });
  m.execute.mockResolvedValue({ success: true, data: { order: 'ord_1' }, elapsed_ms: 5 });
  m.updateActionOutcome.mockResolvedValue({ action_id: 'act_1', status: 'completed' });
  m.updateCapability.mockResolvedValue({});
});

describe('capability invoke execution authority', () => {
  it('persists and claims the same resolved HTTP act before the external call', async () => {
    const response = await post({ agent_id: 'agt_1', domain: 'x.com', declared_goal: 'buy x.com' });
    expect(response.status).toBe(200);

    const act = {
      kind: 'http',
      request: {
        method: 'POST',
        url: 'https://api.example.com/domains/x.com/buy',
        url_digest: expect.stringMatching(/^sha256:[A-Za-z0-9_-]+$/),
        body_excerpt: JSON.stringify({ domain: 'x.com', account: '[server-setting]' }),
        body_digest: expect.stringMatching(/^sha256:[A-Za-z0-9_-]+$/),
      },
    };
    expect(m.evaluateGuard).toHaveBeenCalledWith('org_1', expect.objectContaining({ act }), m.sql);
    expect(m.createActionRecord).toHaveBeenCalledWith(m.sql, expect.objectContaining({
      data: expect.objectContaining({
        action_type: 'spend',
        systems_touched: ['capability:buy-domain', 'capability-id:cap_1'],
        act,
        guard_decision_id: 'dec_1',
        client_capabilities: ['execution_claims'],
      }),
      identityVerified: true,
      payloadSignatureStatus: 'missing',
    }));
    const createdActionId = m.createActionRecord.mock.calls[0]![1].action_id;
    expect(m.authorizeActionExecution).toHaveBeenCalledWith(m.sql, expect.objectContaining({
      orgId: 'org_1',
      actionId: createdActionId,
      principalId: 'usr_actor',
      act,
      identity: expect.objectContaining({ agent_id: 'agt_1', verified: true }),
    }));
    expect(m.authorizeActionExecution.mock.calls[0]![1].attemptId)
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(m.authorizeActionExecution.mock.invocationCallOrder[0])
      .toBeLessThan(m.execute.mock.invocationCallOrder[0]!);
    expect(m.updateActionOutcome).toHaveBeenCalledWith(
      m.sql,
      'org_1',
      createdActionId,
      expect.objectContaining({ status: 'completed' }),
      { gateStatus: 'running', closeSource: 'outcome' },
    );
    expect(m.sql).not.toHaveBeenCalled();
  });

  it('binds server settings by digest without exposing their values to governance', async () => {
    const firstSecret = 'not-a-known-secret-pattern::alpha::7319';
    const secondSecret = 'not-a-known-secret-pattern::bravo::8420';
    const firstUrlSecret = 'endpoint-custody::alpha::9531';
    const secondUrlSecret = 'endpoint-custody::bravo::0642';
    const firstQuerySecret = 'query-custody::alpha::1753';
    const secondQuerySecret = 'query-custody::bravo::2864';
    const mappedSchema = {
      method: 'POST',
      endpoint: '${API_BASE}/domains/${input.domain}/buy?opaque=${URL_TOKEN}&mode=live',
      auth: { type: 'bearer', token_setting: 'URL_TOKEN' },
      request_mapping: {
        domain: '$.domain',
        account: '$settings.ACCOUNT',
        nested: { custody: '$settings.CUSTODY_VALUE' },
        fallbacks: ['$settings.CUSTODY_VALUE', 'literal-fallback'],
      },
    };
    m.prepare.mockResolvedValue({
      capability: { capability_id: 'cap_1', name: 'Buy Domain', slug: 'buy-domain', risk_level: 'high' },
      schema: mappedSchema,
      endpoint: `https://public-user:${firstUrlSecret}@api.example.com/base/domains/\${input.domain}/buy?opaque=${firstQuerySecret}&mode=live`,
      authHeaders: {},
      settings: {
        API_BASE: `https://public-user:${firstUrlSecret}@api.example.com/base`,
        URL_TOKEN: firstQuerySecret,
        ACCOUNT: 'acct_1',
        CUSTODY_VALUE: firstSecret,
      },
    });

    expect((await post({ agent_id: 'agt_1', domain: 'x.com' })).status).toBe(200);
    const firstGuardAct = m.evaluateGuard.mock.calls[0]![1].act;
    const firstRecordAct = m.createActionRecord.mock.calls[0]![1].data.act;
    const firstClaimAct = m.authorizeActionExecution.mock.calls[0]![1].act;
    for (const act of [firstGuardAct, firstRecordAct, firstClaimAct]) {
      const serialized = JSON.stringify(act);
      expect(serialized).not.toContain(firstSecret);
      expect(serialized).not.toContain(firstUrlSecret);
      expect(serialized).not.toContain(firstQuerySecret);
      expect(act).toEqual(firstGuardAct);
    }
    expect(firstGuardAct.request).toMatchObject({
      method: 'POST',
      url: expect.stringMatching(/^https:\/\/[^/]*api\.example\.com\/\[server-setting\]\/domains\/x\.com\/buy\?/),
      url_digest: expect.stringMatching(/^sha256:[A-Za-z0-9_-]+$/),
      body_excerpt: JSON.stringify({
        domain: 'x.com',
        account: '[server-setting]',
        nested: { custody: '[server-setting]' },
        fallbacks: ['[server-setting]', 'literal-fallback'],
      }),
      body_digest: expect.stringMatching(/^sha256:[A-Za-z0-9_-]+$/),
    });
    expect(m.execute).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: `https://public-user:${firstUrlSecret}@api.example.com/base/domains/\${input.domain}/buy?opaque=${firstQuerySecret}&mode=live`,
      schema: mappedSchema,
      settings: expect.objectContaining({ URL_TOKEN: firstQuerySecret, CUSTODY_VALUE: firstSecret }),
    }));

    vi.clearAllMocks();
    m.prepare.mockResolvedValue({
      capability: { capability_id: 'cap_1', name: 'Buy Domain', slug: 'buy-domain', risk_level: 'high' },
      schema: mappedSchema,
      endpoint: `https://public-user:${secondUrlSecret}@api.example.com/base/domains/\${input.domain}/buy?opaque=${secondQuerySecret}&mode=live`,
      authHeaders: {},
      settings: {
        API_BASE: `https://public-user:${secondUrlSecret}@api.example.com/base`,
        URL_TOKEN: secondQuerySecret,
        ACCOUNT: 'acct_1',
        CUSTODY_VALUE: secondSecret,
      },
    });
    m.evaluateGuard.mockImplementation(async (_orgId, context) => {
      context.action_type = 'spend';
      return { decision: 'allow', decision_id: 'dec_2', risk_score: 80, matched_policies: [] };
    });
    m.checkCircuitBreaker.mockResolvedValue({ open: false });
    m.resolveAgentIdentity.mockResolvedValue({
      agent_id: 'agt_1', agent_name: 'Buyer', verification_status: 'verified', verified: true,
    });
    m.evaluateAccess.mockResolvedValue({ access: 'allow', rule: null });
    m.createActionRecord.mockResolvedValue({ action_id: 'act_2' });
    m.authorizeActionExecution.mockResolvedValue({ action_id: 'act_2', execution_claimed_at: 'now' });
    m.execute.mockResolvedValue({ success: true, data: { order: 'ord_2' }, elapsed_ms: 5 });
    m.updateActionOutcome.mockResolvedValue({ action_id: 'act_2', status: 'completed' });
    m.updateCapability.mockResolvedValue({});

    expect((await post({ agent_id: 'agt_1', domain: 'x.com' })).status).toBe(200);
    const secondGuardAct = m.evaluateGuard.mock.calls[0]![1].act;
    const secondSerialized = JSON.stringify(secondGuardAct);
    expect(secondSerialized).not.toContain(secondSecret);
    expect(secondSerialized).not.toContain(secondUrlSecret);
    expect(secondSerialized).not.toContain(secondQuerySecret);
    expect(secondGuardAct.request.url).toBe(firstGuardAct.request.url);
    expect(secondGuardAct.request.body_excerpt).toBe(firstGuardAct.request.body_excerpt);
    expect(secondGuardAct.request.url_digest).not.toBe(firstGuardAct.request.url_digest);
    expect(secondGuardAct.request.body_digest).not.toBe(firstGuardAct.request.body_digest);
  });

  it('uses an opaque safe URL when a custody setting occupies the hostname', async () => {
    const hostSecret = 'host-custody-nonregex-3971';
    const literalQueryCredential = 'literal-query-custody-5082';
    const rawEndpoint = `https://${hostSecret}.example.com/transfer?api_key=${literalQueryCredential}`;
    m.prepare.mockResolvedValue({
      capability: { capability_id: 'cap_1', name: 'Transfer', slug: 'transfer', risk_level: 'high' },
      schema: {
        method: 'POST',
        endpoint: `https://\${HOST_CUSTODY}.example.com/transfer?api_key=${literalQueryCredential}`,
        auth: { type: 'bearer', token_setting: 'AUTH_TOKEN' },
        request_mapping: { custody: '$settings.HOST_CUSTODY', amount: '$.amount' },
      },
      endpoint: rawEndpoint,
      authHeaders: { authorization: `Bearer ${hostSecret}` },
      settings: { HOST_CUSTODY: hostSecret, AUTH_TOKEN: 'separate-auth-value' },
    });

    expect((await post({ agent_id: 'agt_1', amount: 25 })).status).toBe(200);
    const act = m.evaluateGuard.mock.calls[0]![1].act;
    expect(act.request.url).toBe('https://redacted.invalid/[server-setting]');
    expect(act.request.url_digest).toMatch(/^sha256:[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(act)).not.toContain(hostSecret);
    expect(JSON.stringify(act)).not.toContain(literalQueryCredential);
    expect(m.createActionRecord.mock.calls[0]![1].data.act).toEqual(act);
    expect(m.authorizeActionExecution.mock.calls[0]![1].act).toEqual(act);
    expect(m.execute).toHaveBeenCalledWith(expect.objectContaining({ endpoint: rawEndpoint }));
  });

  it('never returns an unparsed endpoint template after credential redaction', async () => {
    const hostCredential = 'auth-host-custody-6193';
    const literalQueryCredential = 'literal-query-custody-7204';
    const rawEndpoint = `https://${hostCredential}.example.com/run?credential=${literalQueryCredential}`;
    m.prepare.mockResolvedValue({
      capability: { capability_id: 'cap_1', name: 'Run', slug: 'run', risk_level: 'high' },
      schema: {
        method: 'POST',
        endpoint: `https://\${HOST_TOKEN}.example.com/run?credential=${literalQueryCredential}`,
        auth: { type: 'bearer', token_setting: 'HOST_TOKEN' },
      },
      endpoint: rawEndpoint,
      authHeaders: { authorization: `Bearer ${hostCredential}` },
      settings: { HOST_TOKEN: hostCredential },
    });

    expect((await post({ agent_id: 'agt_1' })).status).toBe(200);
    const act = m.evaluateGuard.mock.calls[0]![1].act;
    expect(act.request.url).toBe('https://redacted.invalid/[server-setting]');
    expect(JSON.stringify(act)).not.toContain(hostCredential);
    expect(JSON.stringify(act)).not.toContain(literalQueryCredential);
    expect(m.execute).toHaveBeenCalledWith(expect.objectContaining({ endpoint: rawEndpoint }));
  });

  it('binds a pending approval record to the same exact act', async () => {
    m.evaluateGuard.mockImplementation(async (_orgId, context) => {
      context.action_type = 'spend';
      return { decision: 'require_approval', decision_id: 'dec_hold', risk_score: 90, matched_policies: [] };
    });

    const response = await post({ agent_id: 'agt_1', domain: 'x.com' });
    expect(response.status).toBe(202);
    expect(m.createActionRecord).toHaveBeenCalledWith(m.sql, expect.objectContaining({
      actionStatus: 'pending_approval',
      data: expect.objectContaining({
        action_type: 'spend',
        guard_decision_id: 'dec_hold',
        client_capabilities: ['execution_claims'],
        act: expect.objectContaining({ request: expect.objectContaining({ body_excerpt: expect.any(String) }) }),
      }),
      identityVerified: true,
      payloadSignatureStatus: 'missing',
    }));
    expect(m.authorizeActionExecution).not.toHaveBeenCalled();
    expect(m.execute).not.toHaveBeenCalled();
  });

  it('binds access-required approval and blocked records to the same exact act', async () => {
    m.evaluateAccess.mockResolvedValueOnce({ access: 'require_approval', rule: { reason: 'operator review' } });
    const held = await post({ agent_id: 'agt_1', domain: 'x.com' });
    expect(held.status).toBe(202);
    expect(m.createActionRecord).toHaveBeenCalledWith(m.sql, expect.objectContaining({
      actionStatus: 'pending_approval',
      data: expect.objectContaining({
        act: expect.objectContaining({ request: expect.objectContaining({ body_excerpt: expect.any(String) }) }),
        guard_decision_id: 'dec_1',
      }),
      identityVerified: true,
      payloadSignatureStatus: 'missing',
    }));

    vi.clearAllMocks();
    m.prepare.mockResolvedValue({
      capability: { capability_id: 'cap_1', name: 'Buy Domain', slug: 'buy-domain', risk_level: 'high' },
      schema: { method: 'POST' },
      endpoint: 'https://api.example.com/buy',
      authHeaders: {},
      settings: {},
    });
    m.resolveAgentIdentity.mockResolvedValue({
      agent_id: 'agt_1', agent_name: 'Buyer', verification_status: 'verified', verified: true,
    });
    m.evaluateGuard.mockImplementation(async (_orgId, context) => {
      context.action_type = 'spend';
      return { decision: 'block', decision_id: 'dec_block', risk_score: 95, matched_policies: ['block-spend'] };
    });
    const blocked = await post({ agent_id: 'agt_1', amount: 50 });
    expect(blocked.status).toBe(403);
    expect(m.createBlockedActionRecord).toHaveBeenCalledWith(m.sql, expect.objectContaining({
      data: expect.objectContaining({
        action_type: 'spend',
        act: expect.objectContaining({ request: expect.objectContaining({ body_excerpt: expect.any(String) }) }),
        guard_decision_id: 'dec_block',
        client_capabilities: ['execution_claims'],
      }),
      identityVerified: true,
      payloadSignatureStatus: 'missing',
    }));
    expect(m.execute).not.toHaveBeenCalled();
  });

  it('returns 409 and makes no external call when the execution claim loses', async () => {
    m.authorizeActionExecution.mockResolvedValue(null);
    const response = await post({ agent_id: 'agt_1', domain: 'x.com' });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('execution_claim_conflict');
    expect(m.execute).not.toHaveBeenCalled();
  });

  it('returns 503 and makes no external call when claiming is unavailable', async () => {
    m.authorizeActionExecution.mockRejectedValue(new Error('claim database unavailable'));
    const response = await post({ agent_id: 'agt_1', domain: 'x.com' });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('execution_claim_unavailable');
    expect(m.execute).not.toHaveBeenCalled();
  });

  it('reports outcome persistence loss as unknown completion without calling the capability failed', async () => {
    m.updateActionOutcome.mockRejectedValue(new Error('outcome database unavailable'));
    const response = await post({ agent_id: 'agt_1', domain: 'x.com' });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'execution_outcome_unknown',
      execution_state: 'unknown',
      retry_safe: false,
    });
    expect(m.execute).toHaveBeenCalledTimes(1);
  });

  it('treats a no-row outcome update as the same unknown completion state', async () => {
    m.updateActionOutcome.mockResolvedValue(null);
    const response = await post({ agent_id: 'agt_1', domain: 'x.com' });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: 'execution_outcome_unknown',
      execution_state: 'unknown',
      retry_safe: false,
    });
    expect(m.execute).toHaveBeenCalledTimes(1);
  });
});
