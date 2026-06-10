import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, it, vi } from 'vitest';

const mockRuntime = vi.hoisted(() => ({
  definePluginEntry: vi.fn((entry) => entry),
}));

vi.mock('openclaw/plugin-sdk/plugin-entry', () => ({
  definePluginEntry: mockRuntime.definePluginEntry,
}));

function createPluginApi(pluginConfig = {}) {
  const handlers = new Map();
  return {
    pluginConfig,
    handlers,
    on: vi.fn((eventName, handler) => {
      handlers.set(eventName, handler);
    }),
    async emit(eventName, event = {}, ctx = {}) {
      const handler = handlers.get(eventName);
      assert.ok(handler, `missing handler for ${eventName}`);
      return handler(event, ctx);
    },
  };
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
  };
}

function parseBody(init) {
  return init?.body ? JSON.parse(String(init.body)) : undefined;
}

function installFetchMock(handler = defaultFetchHandler) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const request = {
        url: String(url),
        path: new URL(String(url)).pathname,
        method: init.method ?? 'GET',
        body: parseBody(init),
      };
      calls.push(request);
      const response = await handler(request, calls);
      if (response && 'ok' in response && 'json' in response) return response;
      return jsonResponse(response ?? { ok: true });
    })
  );
  return calls;
}

function defaultFetchHandler(request) {
  if (request.path === '/api/guard') {
    return { decision: 'allow', action_id: 'gd_1' };
  }
  if (request.path === '/api/sessions' && request.method === 'POST') {
    return { session: { id: 'sess_1' } };
  }
  if (request.path === '/api/actions' && request.method === 'POST') {
    return {
      action_id: 'act_1',
      action: { action_id: 'act_1', status: 'running' },
    };
  }
  if (request.path === '/api/stream') {
    return jsonResponse({}, 404);
  }
  if (request.path === '/api/actions/act_approval') {
    return {
      action: {
        action_id: 'act_approval',
        status: 'completed',
        approved_by: 'usr_1',
      },
    };
  }
  if (request.path.startsWith('/api/actions/') && request.method === 'PATCH') {
    return { action: { action_id: request.path.split('/').pop() } };
  }
  if (request.path.startsWith('/api/sessions/') && request.method === 'PATCH') {
    return { ok: true };
  }
  if (request.path === '/api/x402/providers') {
    return { providers: [{ name: 'stableenrich.dev', provider_id: 'prov_1' }] };
  }
  if (request.path === '/api/x402/purchases') {
    return { action: { action_id: 'x402_act_1' } };
  }
  if (request.path === '/api/artifacts') {
    return { ok: true };
  }
  return { ok: true };
}

function findCall(calls, path, method) {
  return calls.find((call) => {
    if (call.path !== path) return false;
    return method ? call.method === method : true;
  });
}

function actionPatch(calls, actionId) {
  return findCall(calls, `/api/actions/${actionId}`, 'PATCH');
}

async function patchNestedDashClawX402Methods() {
  const pluginDashClawModule =
    '../../../../../packages/openclaw-plugin/node_modules/dashclaw/dashclaw.js';
  const pluginDashClawFile = fileURLToPath(
    new URL(pluginDashClawModule, import.meta.url)
  );
  const dashClawModule = existsSync(pluginDashClawFile)
    ? pluginDashClawModule
    : 'dashclaw';
  const { DashClaw } = await import(dashClawModule);
  DashClaw.prototype.listProviders ??= function listProviders(filters = {}) {
    return this._request('/api/x402/providers', 'GET', null, filters);
  };
  DashClaw.prototype.createProvider ??= function createProvider(data = {}) {
    return this._request('/api/x402/providers', 'POST', data);
  };
  DashClaw.prototype.recordPurchase ??= function recordPurchase(data = {}) {
    return this._request('/api/x402/purchases', 'POST', data);
  };
  DashClaw.prototype.recordPurchaseResult ??= function recordPurchaseResult(
    actionId,
    result = {}
  ) {
    return this._request('/api/artifacts', 'POST', {
      artifact_type: 'x402_purchase_result',
      name: `x402 result ${actionId}`,
      description: result.summary || null,
      content_json: result.data ?? {},
      content_url: result.url || null,
      source_action_id: actionId,
    });
  };
}

async function registerPlugin({ pluginConfig = {} } = {}) {
  vi.resetModules();
  mockRuntime.definePluginEntry.mockClear();
  await patchNestedDashClawX402Methods();

  const mod = await import('../../../../../packages/openclaw-plugin/src/index.ts');
  const plugin = mod.default;
  const api = createPluginApi({
    dashclawUrl: 'https://dashclaw.test',
    dashclawApiKey: 'dc_test',
    agentId: 'openclaw-test',
    ...pluginConfig,
  });
  plugin.register(api);
  return { api, plugin };
}

describe('@dashclaw/openclaw-plugin', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    installFetchMock();
  });

  it('exports the DashClaw governance plugin contract and registers all hooks', async () => {
    const { api, plugin } = await registerPlugin();

    assert.equal(plugin.id, 'dashclaw-governance');
    assert.equal(plugin.name, 'DashClaw Governance');
    assert.deepEqual([...api.handlers.keys()], [
      'before_tool_call',
      'llm_output',
      'agent_end',
      'after_tool_call',
    ]);
  });

  it('guards allowed tool calls, opens an action record, and records completion', async () => {
    const calls = installFetchMock();
    const { api } = await registerPlugin();

    const beforeResult = await api.emit('before_tool_call', {
      toolName: 'bash',
      params: { command: 'git status --short' },
      toolCallId: 'call_1',
      runId: 'run_1',
      workspace: 'C:/Projects/DashClaw',
      branch: 'main',
    });
    await api.emit('after_tool_call', {
      toolName: 'bash',
      toolCallId: 'call_1',
      runId: 'run_1',
    });

    assert.equal(beforeResult, undefined);
    assert.deepEqual(findCall(calls, '/api/sessions', 'POST').body, {
      agent_id: 'openclaw-test',
      workspace: 'C:/Projects/DashClaw',
      branch: 'main',
    });
    assert.deepEqual(findCall(calls, '/api/guard', 'POST').body, {
      action_type: 'review',
      risk_score: 10,
      declared_goal: 'Bash: git status --short',
      reversible: true,
      systems_touched: [],
      agent_id: 'openclaw-test',
    });
    assert.deepEqual(findCall(calls, '/api/actions', 'POST').body, {
      action_type: 'review',
      declared_goal: 'Bash: git status --short',
      risk_score: 10,
      reversible: true,
      systems_touched: [],
      metadata: { openclaw_tool_name: 'bash' },
      agent_id: 'openclaw-test',
    });
    assert.equal(actionPatch(calls, 'act_1').body.status, 'completed');
    assert.match(actionPatch(calls, 'act_1').body.timestamp_end, /^\d{4}-/);
  });

  it('blocks policy-denied tool calls without opening an action record', async () => {
    const calls = installFetchMock((request) => {
      if (request.path === '/api/guard') {
        return { decision: 'block', action_id: 'gd_blocked', reason: 'no deploys' };
      }
      return defaultFetchHandler(request);
    });
    const { api } = await registerPlugin();

    const result = await api.emit('before_tool_call', {
      toolName: 'bash',
      params: { command: 'git push origin main' },
      toolCallId: 'call_blocked',
      runId: 'run_blocked',
    });

    assert.deepEqual(result, {
      block: true,
      blockReason: 'no deploys',
    });
    assert.equal(findCall(calls, '/api/actions', 'POST'), undefined);
  });

  it('waits for approval when guard or the created action requires it', async () => {
    const calls = installFetchMock((request) => {
      if (request.path === '/api/guard') {
        return { decision: 'require_approval', action_id: 'gd_approval' };
      }
      if (request.path === '/api/actions' && request.method === 'POST') {
        return {
          action_id: 'act_approval',
          action: { action_id: 'act_approval', status: 'pending_approval' },
        };
      }
      return defaultFetchHandler(request);
    });
    const { api } = await registerPlugin();

    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let result;
    try {
      result = await api.emit('before_tool_call', {
        toolName: 'write',
        params: { file_path: 'README.md' },
        toolCallId: 'call_approval',
        runId: 'run_approval',
      });
    } finally {
      stdoutWrite.mockRestore();
    }

    assert.equal(result, undefined);
    assert.ok(findCall(calls, '/api/stream'));
    assert.equal(findCall(calls, '/api/actions/act_approval', 'GET').body, undefined);
  });

  it('gates x402 payments separately and records the settled receipt', async () => {
    const calls = installFetchMock();
    const { api } = await registerPlugin({
      pluginConfig: { x402EstimatedCostUsd: 0.03 },
    });

    const beforeResult = await api.emit('before_tool_call', {
      toolName: 'bash',
      params: {
        command:
          'npx agentcash fetch https://stableenrich.dev/v1/search --max-amount 0.25',
      },
      toolCallId: 'call_x402',
      runId: 'run_x402',
    });
    await api.emit('after_tool_call', {
      toolName: 'bash',
      toolCallId: 'call_x402',
      runId: 'run_x402',
      result: JSON.stringify({
        data: {
          requestId: 'req_1',
          costDollars: { total: 0.12 },
        },
        metadata: {
          payment: { transactionHash: 'tx_1' },
        },
      }),
    });

    assert.equal(beforeResult, undefined);
    assert.equal(findCall(calls, '/api/actions', 'POST'), undefined);
    assert.deepEqual(findCall(calls, '/api/guard', 'POST').body, {
      action_type: 'x402_purchase',
      provider: 'stableenrich.dev',
      cost_estimate: 0.25,
      risk_score: 40,
      declared_goal: 'x402 purchase: stableenrich.dev',
      reversible: false,
      systems_touched: ['x402', 'stableenrich.dev'],
      agent_id: 'openclaw-test',
    });
    assert.deepEqual(findCall(calls, '/api/x402/purchases', 'POST').body, {
      agent_id: 'openclaw-test',
      provider: 'stableenrich.dev',
      declared_goal: 'x402 purchase: stableenrich.dev',
      purchase_reason: 'Paid x402 capability call to stableenrich.dev',
      context_gap: 'Capability gated behind payment at stableenrich.dev',
      expected_value: 'Paid result from stableenrich.dev',
      spend_amount: 0.12,
      cost_estimate: 0.12,
      currency: 'USDC',
      payment_method: 'x402',
      provider_id: 'prov_1',
    });
    assert.deepEqual(findCall(calls, '/api/artifacts', 'POST').body, {
      artifact_type: 'x402_purchase_result',
      name: 'x402 result x402_act_1',
      description: 'x402 settled: $0.12 USDC at stableenrich.dev',
      content_json: {
        origin: 'stableenrich.dev',
        transactionHash: 'tx_1',
        requestId: 'req_1',
      },
      content_url: null,
      source_action_id: 'x402_act_1',
    });
  });

  it('flushes pending token usage and closes the DashClaw session at run end', async () => {
    const calls = installFetchMock();
    const { api } = await registerPlugin({
      pluginConfig: { defaultModel: 'gpt-test' },
    });

    await api.emit('llm_output', {
      runId: 'run_tokens',
      usage: { input: 100, output: 20, cacheRead: 30, cacheWrite: 7 },
    });
    await api.emit('before_tool_call', {
      toolName: 'read',
      params: { file_path: 'app/page.tsx' },
      toolCallId: 'call_tokens',
      runId: 'run_tokens',
    });
    await api.emit('agent_end', {}, { runId: 'run_tokens' });

    const tokenPatch = actionPatch(calls, 'act_1');
    assert.equal(tokenPatch.body.tokens_in, 110);
    assert.equal(tokenPatch.body.tokens_out, 20);
    assert.equal(tokenPatch.body.model, 'gpt-test');
    assert.deepEqual(findCall(calls, '/api/sessions/sess_1', 'PATCH').body, {
      status: 'completed',
    });
  });
});
