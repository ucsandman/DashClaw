import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';

const mockRuntime = vi.hoisted(() => ({
  definePluginEntry: vi.fn((entry) => entry),
}));

vi.mock('openclaw/plugin-sdk/plugin-entry', () => ({
  definePluginEntry: mockRuntime.definePluginEntry,
}));

const autoPairMock = vi.hoisted(() => ({ maybeAutoPair: vi.fn(async () => {}) }));
vi.mock('../../../../../packages/openclaw-plugin/src/auto-pairing.ts', () => ({
  maybeAutoPair: autoPairMock.maybeAutoPair,
}));

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
  };
}

function createApi(pluginConfig = {}) {
  const handlers = new Map();
  return {
    pluginConfig,
    on: vi.fn((name, handler) => handlers.set(name, handler)),
    emit(name, event = {}, ctx = {}) {
      const handler = handlers.get(name);
      assert.ok(handler, `missing ${name} handler`);
      return handler(event, ctx);
    },
  };
}

async function register(fetchHandler, pluginConfig = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const request = {
      path: new URL(String(url)).pathname,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(request);
    const result = await fetchHandler(request, calls);
    return result && 'ok' in result ? result : response(result ?? { ok: true });
  }));
  vi.resetModules();
  const plugin = (await import('../../../../../packages/openclaw-plugin/src/index.ts')).default;
  const api = createApi({
    dashclawUrl: 'https://dashclaw.test',
    dashclawApiKey: 'dc_test',
    agentId: 'openclaw-test',
    autoPairing: false,
    ...pluginConfig,
  });
  plugin.register(api);
  return { api, calls };
}

function validGuard(decision = 'allow') {
  return {
    decision,
    action_id: 'gd_1',
    execution_claim_required: true,
    claim_protocol: 1,
  };
}

function standardHandler(request) {
  if (request.path === '/api/guard') return validGuard();
  if (request.path === '/api/sessions' && request.method === 'POST') {
    return { session: { id: 'sess_1' } };
  }
  if (request.path === '/api/actions' && request.method === 'POST') {
    return { action_id: 'act_1', action: { action_id: 'act_1', status: 'running' } };
  }
  if (request.path === '/api/actions/act_1' && request.method === 'PATCH' && request.body?.claim_execution) {
    return {
      claimed: true,
      action_id: 'act_1',
      attempt_id: request.body.attempt_id,
    };
  }
  return { ok: true };
}

describe('@dashclaw/openclaw-plugin runtime safety', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    [{}, 'malformed'],
    [{ decision: 'future_verdict', execution_claim_required: true, claim_protocol: 1 }, 'malformed'],
  ])('blocks malformed or unsupported successful guard response %#', async (guardBody, reason) => {
    const { api, calls } = await register((request) => {
      if (request.path === '/api/guard') return guardBody;
      return standardHandler(request);
    });

    const result = await api.emit('before_tool_call', {
      toolName: 'read',
      params: { file_path: 'README.md' },
      toolCallId: 'tc_bad_guard',
      runId: 'run_bad_guard',
    });

    assert.equal(result?.block, true);
    assert.match(result.blockReason, new RegExp(reason, 'i'));
    assert.equal(calls.filter((call) => call.path === '/api/actions').length, 0);
  });

  it.each(['allow', 'warn'])('preserves legacy-server %s decisions when strict claims are disabled', async (decision) => {
    const { api, calls } = await register((request) => {
      if (request.path === '/api/guard') return { decision, action_id: 'gd_legacy' };
      return standardHandler(request);
    });

    const result = await api.emit('before_tool_call', {
      toolName: 'read',
      params: { file_path: 'README.md' },
      toolCallId: `tc_legacy_${decision}`,
      runId: `run_legacy_${decision}`,
    });

    assert.equal(result, undefined);
    assert.equal(calls.filter((call) => call.body?.claim_execution).length, 0);
  });

  it('preserves a legacy-server block without opening an action', async () => {
    const { api, calls } = await register((request) => {
      if (request.path === '/api/guard') return { decision: 'block', reason: 'legacy policy block' };
      return standardHandler(request);
    });

    const result = await api.emit('before_tool_call', {
      toolName: 'write',
      params: { file_path: 'README.md' },
      toolCallId: 'tc_legacy_block',
      runId: 'run_legacy_block',
    });

    assert.equal(result?.block, true);
    assert.match(result.blockReason, /legacy policy block/i);
    assert.equal(calls.filter((call) => call.path === '/api/actions').length, 0);
  });

  it('preserves a legacy-server approval before permitting without a claim', async () => {
    const { api, calls } = await register((request) => {
      if (request.path === '/api/guard') return { decision: 'require_approval', action_id: 'gd_legacy' };
      if (request.path === '/api/actions/act_1' && request.method === 'GET') {
        return { action: { action_id: 'act_1', status: 'running', approved_by: 'operator' } };
      }
      return standardHandler(request);
    }, { approvalWaitMs: 100 });

    const result = await api.emit('before_tool_call', {
      toolName: 'write',
      params: { file_path: 'README.md' },
      toolCallId: 'tc_legacy_approval',
      runId: 'run_legacy_approval',
    });

    assert.equal(result, undefined);
    assert.ok(calls.some((call) => call.path === '/api/actions/act_1' && call.method === 'GET'));
    assert.equal(calls.filter((call) => call.body?.claim_execution).length, 0);
  });

  it('blocks a legacy server when strict execution claims are enabled', async () => {
    vi.stubEnv('DASHCLAW_REQUIRE_EXECUTION_CLAIMS', 'true');
    const { api, calls } = await register((request) => {
      if (request.path === '/api/guard') return { decision: 'allow', action_id: 'gd_legacy' };
      return standardHandler(request);
    });

    const result = await api.emit('before_tool_call', {
      toolName: 'read',
      params: { file_path: 'README.md' },
      toolCallId: 'tc_strict_legacy',
      runId: 'run_strict_legacy',
    });

    assert.equal(result?.block, true);
    assert.match(result.blockReason, /upgrade|required|protocol 1/i);
    assert.equal(calls.filter((call) => call.path === '/api/actions').length, 0);
  });

  it.each([
    { decision: 'allow', execution_claim_required: true },
    { decision: 'allow', claim_protocol: 1 },
    { decision: 'allow', execution_claim_required: true, claim_protocol: 2 },
  ])('blocks an advertised malformed or unsupported claim contract %#', async (guardBody) => {
    const { api, calls } = await register((request) => {
      if (request.path === '/api/guard') return guardBody;
      return standardHandler(request);
    });

    const result = await api.emit('before_tool_call', {
      toolName: 'read',
      params: { file_path: 'README.md' },
      toolCallId: 'tc_bad_claim_advertisement',
      runId: 'run_bad_claim_advertisement',
    });

    assert.equal(result?.block, true);
    assert.match(result.blockReason, /upgrade|required|protocol 1/i);
    assert.equal(calls.filter((call) => call.path === '/api/actions').length, 0);
  });

  it('blocks a successful action response without one exact action id', async () => {
    const { api } = await register((request) => {
      if (request.path === '/api/guard') return validGuard('require_approval');
      if (request.path === '/api/actions' && request.method === 'POST') return { ok: true };
      return standardHandler(request);
    });

    const result = await api.emit('before_tool_call', {
      toolName: 'write',
      params: { file_path: 'README.md' },
      toolCallId: 'tc_missing_action',
      runId: 'run_missing_action',
    });
    assert.equal(result?.block, true);
    assert.match(result.blockReason, /action id/i);
  });

  it.each([
    [409, { error: 'already claimed' }],
    [200, {}],
    [200, { claimed: true, action_id: 'act_other', attempt_id: 'wrong' }],
  ])('blocks failed or malformed execution claim %# without retry', async (status, claimBody) => {
    const { api, calls } = await register((request) => {
      if (request.path === '/api/actions/act_1' && request.method === 'PATCH') {
        return response(claimBody, status);
      }
      return standardHandler(request);
    });

    const result = await api.emit('before_tool_call', {
      toolName: 'read',
      params: { file_path: 'README.md' },
      toolCallId: 'tc_claim',
      runId: 'run_claim',
    });
    assert.equal(result?.block, true);
    assert.match(result.blockReason, /execution claim/i);
    assert.equal(
      calls.filter((call) => call.path === '/api/actions/act_1' && call.method === 'PATCH').length,
      1,
    );
  });

  it('advertises claims, binds act and exact attempt, then permits the host call', async () => {
    const { api, calls } = await register(standardHandler);
    const result = await api.emit('before_tool_call', {
      toolName: 'bash',
      params: { command: 'echo ok' },
      toolCallId: 'tc_claim_ok',
      runId: 'run_claim_ok',
    });
    assert.equal(result, undefined);
    const guard = calls.find((call) => call.path === '/api/guard').body;
    assert.ok(guard.client_capabilities.includes('execution_claims'));
    const claim = calls.find(
      (call) => call.path === '/api/actions/act_1' && call.body?.claim_execution,
    ).body;
    assert.equal(claim.agent_id, 'openclaw-test');
    assert.deepEqual(claim.act, guard.act);
    assert.match(claim.attempt_id, /^[0-9a-f-]{36}$/i);
  });

  it('persists execution-claim capability when creating the server action row', async () => {
    let createdProtocol = null;
    const { api, calls } = await register((request) => {
      if (request.path === '/api/guard') return validGuard();
      if (request.path === '/api/actions' && request.method === 'POST') {
        createdProtocol = request.body.client_capabilities?.includes('execution_claims') ? 1 : null;
        return { action_id: 'act_1', action: { action_id: 'act_1', status: 'running' } };
      }
      if (request.path === '/api/actions/act_1' && request.method === 'PATCH' && request.body?.claim_execution) {
        if (createdProtocol !== 1) return response({ error: 'action is not claim-aware' }, 409);
        return {
          claimed: true,
          action_id: 'act_1',
          attempt_id: request.body.attempt_id,
        };
      }
      return standardHandler(request);
    });

    const result = await api.emit('before_tool_call', {
      toolName: 'bash',
      params: { command: 'echo contract' },
      toolCallId: 'tc_row_protocol',
      runId: 'run_row_protocol',
    });

    assert.equal(result, undefined);
    assert.equal(createdProtocol, 1);
    assert.deepEqual(
      calls.find((call) => call.path === '/api/actions' && call.method === 'POST').body.client_capabilities,
      ['execution_claims'],
    );
  });

  it('vetoes an overlapping call without a stable host id instead of assuming FIFO', async () => {
    let nextAction = 0;
    const { api, calls } = await register((request) => {
      if (request.path === '/api/actions' && request.method === 'POST') {
        nextAction += 1;
        const id = `act_${nextAction}`;
        return { action_id: id, action: { action_id: id, status: 'running' } };
      }
      if (request.path.startsWith('/api/actions/act_') && request.method === 'PATCH' && request.body?.claim_execution) {
        return {
          claimed: true,
          action_id: request.path.split('/').pop(),
          attempt_id: request.body.attempt_id,
        };
      }
      return standardHandler(request);
    });
    const event = { toolName: 'bash', params: { command: 'echo ok' }, runId: 'run_fifo' };

    assert.equal(await api.emit('before_tool_call', event), undefined);
    const overlap = await api.emit('before_tool_call', event);
    assert.equal(overlap?.block, true);
    assert.match(overlap.blockReason, /stable tool call id/i);
    assert.equal(calls.filter((call) => call.path === '/api/actions' && call.method === 'POST').length, 1);

    await api.emit('after_tool_call', event);
    assert.equal(await api.emit('before_tool_call', event), undefined);
    assert.equal(calls.filter((call) => call.path === '/api/actions' && call.method === 'POST').length, 2);
  });
});
