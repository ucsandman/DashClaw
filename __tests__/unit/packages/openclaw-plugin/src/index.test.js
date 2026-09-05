import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, it, vi } from 'vitest';

const mockRuntime = vi.hoisted(() => ({
  definePluginEntry: vi.fn((entry) => entry),
}));

vi.mock('openclaw/plugin-sdk/plugin-entry', () => ({
  definePluginEntry: mockRuntime.definePluginEntry,
}));

// Mock the auto-pairing module: the real one touches fs + homedir and adds
// its own fetches, which would leak into every before_tool_call assertion.
const autoPairMock = vi.hoisted(() => ({ maybeAutoPair: vi.fn(async () => {}) }));

vi.mock('../../../../../packages/openclaw-plugin/src/auto-pairing.ts', () => ({
  maybeAutoPair: autoPairMock.maybeAutoPair,
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
        signal: init.signal,
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
    return {
      decision: 'allow',
      action_id: 'gd_1',
      execution_claim_required: true,
      claim_protocol: 1,
    };
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
    if (request.method === 'PATCH' && request.body?.claim_execution) {
      return {
        claimed: true,
        action_id: 'act_approval',
        attempt_id: request.body.attempt_id,
      };
    }
    return {
      action: {
        action_id: 'act_approval',
        status: 'completed',
        approved_by: 'usr_1',
      },
    };
  }
  if (request.path.startsWith('/api/actions/') && request.method === 'PATCH') {
    if (request.body?.claim_execution) {
      return {
        claimed: true,
        action_id: request.path.split('/').pop(),
        attempt_id: request.body.attempt_id,
      };
    }
    return { action: { action_id: request.path.split('/').pop() } };
  }
  if (request.path.startsWith('/api/sessions/') && request.method === 'PATCH') {
    return { ok: true };
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
  return calls.find((call) =>
    call.path === `/api/actions/${actionId}` &&
    call.method === 'PATCH' &&
    !call.body?.claim_execution
  );
}

async function registerPlugin({ pluginConfig = {} } = {}) {
  vi.resetModules();
  mockRuntime.definePluginEntry.mockClear();
  autoPairMock.maybeAutoPair.mockClear();

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
      // Enforcement-liveness probe (v8.2). Registered last and read-only from
      // the gateway's point of view: it drives before_tool_call above with a
      // synthetic action to prove the veto still holds, under a `smoke-`
      // agent id that every aggregate excludes.
      'session_start',
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
      client_capabilities: ['execution_claims'],
      act: { kind: 'shell', command: 'git status --short' },
      agent_id: 'openclaw-test',
      // dashclaw >=4.6x declares its approval polling window on the guard call
      approval_wait_seconds: 300,
    });
    const actionsPostBody = findCall(calls, '/api/actions', 'POST').body;
    // dashclaw >=4.21 auto-derives an idempotency_key (hourly ts_bucket → non-deterministic value)
    assert.match(actionsPostBody.idempotency_key, /^[0-9a-f]{64}$/);
    const { idempotency_key: _ik, ...actionsPostBodyRest } = actionsPostBody;
    assert.deepEqual(actionsPostBodyRest, {
      action_type: 'review',
      declared_goal: 'Bash: git status --short',
      risk_score: 10,
      reversible: true,
      systems_touched: [],
      client_capabilities: ['execution_claims'],
      act: { kind: 'shell', command: 'git status --short' },
      metadata: { openclaw_tool_name: 'bash' },
      agent_id: 'openclaw-test',
      approval_wait_seconds: 300,
    });
    assert.equal(actionPatch(calls, 'act_1').body.status, 'completed');
    assert.match(actionPatch(calls, 'act_1').body.timestamp_end, /^\d{4}-/);
  });

  it('makes the execution claim abortable before waiting for its acknowledgement', async () => {
    const calls = installFetchMock();
    const { api } = await registerPlugin();

    const result = await api.emit('before_tool_call', {
      toolName: 'bash',
      params: { command: 'git status --short' },
      toolCallId: 'call_claim_signal',
      runId: 'run_claim_signal',
    });

    const claim = calls.find((call) => call.body?.claim_execution === true);
    assert.equal(result, undefined);
    assert.ok(claim.signal instanceof AbortSignal);
    assert.equal(claim.signal.aborted, false);
  });

  it('aborts a claim whose response body never acknowledges and blocks without retrying', async () => {
    vi.useFakeTimers();
    try {
      const calls = installFetchMock((request) => {
        if (request.body?.claim_execution === true) {
          return {
            ok: true,
            status: 200,
            json: () => new Promise(() => {}),
          };
        }
        return defaultFetchHandler(request);
      });
      const { api } = await registerPlugin();

      const pending = api.emit('before_tool_call', {
        toolName: 'bash',
        params: { command: 'git status --short' },
        toolCallId: 'call_claim_timeout',
        runId: 'run_claim_timeout',
      });
      await vi.advanceTimersByTimeAsync(30_001);
      const result = await pending;

      const claims = calls.filter((call) => call.body?.claim_execution === true);
      assert.equal(claims.length, 1);
      assert.equal(claims[0].signal.aborted, true);
      assert.equal(result?.block, true);
      assert.match(result.blockReason, /timed out after 30000ms/);
      assert.match(result.blockReason, /reconcile action act_1 before retrying/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries file-path evidence through both calls without copying file content', async () => {
    const calls = installFetchMock();
    const { api } = await registerPlugin();

    await api.emit('before_tool_call', {
      toolName: 'write',
      params: { file_path: '.github/workflows/release.yml', content: 'token=do-not-copy' },
      toolCallId: 'call_file_evidence',
      runId: 'run_file_evidence',
    });

    const expectedAct = { kind: 'file', file: { path: '.github/workflows/release.yml' } };
    assert.deepEqual(findCall(calls, '/api/guard', 'POST').body.act, expectedAct);
    assert.deepEqual(findCall(calls, '/api/actions', 'POST').body.act, expectedAct);
    assert.doesNotMatch(JSON.stringify(findCall(calls, '/api/guard', 'POST').body.act), /do-not-copy/);
  });

  it('attaches a local script excerpt when bash invokes an existing script', async () => {
    const calls = installFetchMock();
    const { api } = await registerPlugin();

    const workspace = mkdtempSync(join(tmpdir(), 'openclaw-plugin-'));
    try {
      writeFileSync(
        join(workspace, 'domain-buy.mjs'),
        "console.log('buy domain')",
        'utf8'
      );

      await api.emit('before_tool_call', {
        toolName: 'bash',
        params: { command: 'node domain-buy.mjs example.com' },
        toolCallId: 'call_script_evidence',
        runId: 'run_script_evidence',
        workspace,
      });

      const guardAct = findCall(calls, '/api/guard', 'POST').body.act;
      assert.equal(guardAct.kind, 'shell');
      assert.equal(guardAct.command, 'node domain-buy.mjs example.com');
      assert.deepEqual(guardAct.script, {
        path: 'domain-buy.mjs',
        content_excerpt: "console.log('buy domain')",
      });
      assert.deepEqual(
        findCall(calls, '/api/actions', 'POST').body.act,
        guardAct
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('omits script evidence without throwing when the script path does not exist', async () => {
    const calls = installFetchMock();
    const { api } = await registerPlugin();

    const workspace = mkdtempSync(join(tmpdir(), 'openclaw-plugin-'));
    try {
      const result = await api.emit('before_tool_call', {
        toolName: 'bash',
        params: { command: 'node tmp/does-not-exist.mjs example.com' },
        toolCallId: 'call_script_missing',
        runId: 'run_script_missing',
        workspace,
      });

      assert.equal(result, undefined);
      const guardAct = findCall(calls, '/api/guard', 'POST').body.act;
      assert.deepEqual(guardAct, {
        kind: 'shell',
        command: 'node tmp/does-not-exist.mjs example.com',
      });
      assert.equal(guardAct.script, undefined);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('blocks policy-denied tool calls without opening an action record', async () => {
    const calls = installFetchMock((request) => {
      if (request.path === '/api/guard') {
        return {
          decision: 'block',
          action_id: 'gd_blocked',
          reason: 'no deploys',
          execution_claim_required: true,
          claim_protocol: 1,
        };
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
        return {
          decision: 'require_approval',
          action_id: 'gd_approval',
          execution_claim_required: true,
          claim_protocol: 1,
        };
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

  it('bounds the approval wait and blocks with a parked-action reason on timeout', async () => {
    // The wait must resolve inside the runtime's per-tool-call watchdog
    // (Codex embedded dynamic-tool RPC kills the call at ~90s). An operator
    // who never answers must produce a clean block, not a killed RPC.
    installFetchMock((request) => {
      if (request.path === '/api/guard') {
        return {
          decision: 'require_approval',
          action_id: 'gd_parked',
          execution_claim_required: true,
          claim_protocol: 1,
        };
      }
      if (request.path === '/api/actions' && request.method === 'POST') {
        return {
          action_id: 'act_parked',
          action: { action_id: 'act_parked', status: 'pending_approval' },
        };
      }
      if (request.path === '/api/actions/act_parked') {
        // Operator never responds — stays pending forever.
        return { action: { action_id: 'act_parked', status: 'pending_approval' } };
      }
      return defaultFetchHandler(request);
    });
    const { api } = await registerPlugin({
      pluginConfig: { approvalWaitMs: 120 },
    });

    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let result;
    try {
      result = await api.emit('before_tool_call', {
        toolName: 'sessions_send',
        params: { action: 'send', message: 'hello' },
        toolCallId: 'call_parked',
        runId: 'run_parked',
      });
    } finally {
      stdoutWrite.mockRestore();
    }

    assert.equal(result?.block, true);
    assert.match(result.blockReason, /act_parked/);
    assert.match(result.blockReason, /still awaiting the operator/);
    assert.match(result.blockReason, /https:\/\/dashclaw\.test\/approvals/);
    assert.doesNotMatch(result.blockReason, /denied/i);
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

// ---------------------------------------------------------------------------
// Codex late/absent-usage recovery (v1.4.0)
//
// 51.6% of codex LLM-turn actions fire `llm_output` with absent/all-zero
// usage (the Codex app-server never emitted `thread/tokenUsage/updated` for
// that turn). The plugin must hold those turns' action_ids and fold them into
// the next usage-bearing `llm_output` on the same run — never drop them
// silently, and never PATCH any action twice.
// ---------------------------------------------------------------------------

// Distinct per-tool-call action_ids so we can assert which actions got usage.
function installSequentialActionFetchMock() {
  let n = 0;
  const calls = installFetchMock((request) => {
    if (request.path === '/api/actions' && request.method === 'POST') {
      n += 1;
      const id = `act_${n}`;
      return { action_id: id, action: { action_id: id, status: 'running' } };
    }
    return defaultFetchHandler(request);
  });
  return calls;
}

async function openToolCall(api, runId, callId) {
  await api.emit('before_tool_call', {
    toolName: 'read',
    params: { file_path: `app/${callId}.tsx` },
    toolCallId: callId,
    runId,
  });
}

describe('@dashclaw/openclaw-plugin — codex absent-usage recovery', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    installFetchMock();
  });

  it('folds a usage-absent turn’s actions into the next usage-bearing turn', async () => {
    const calls = installSequentialActionFetchMock();
    const { api } = await registerPlugin({
      pluginConfig: { defaultModel: 'gpt-test' },
    });

    // Turn A: usage-bearing → opens act_1.
    await api.emit('llm_output', {
      runId: 'run_fold',
      model: 'codex-a',
      usage: { input: 50, output: 10 },
    });
    await openToolCall(api, 'run_fold', 'a1'); // act_1

    // Turn B: usage ABSENT (codex omission) → opens act_2.
    // Turn A's usage flushes onto act_1 here; act_2 is held.
    await api.emit('llm_output', { runId: 'run_fold' });
    await openToolCall(api, 'run_fold', 'b1'); // act_2

    // Turn C: usage-bearing again → opens act_3, then agent_end flushes.
    await api.emit('llm_output', {
      runId: 'run_fold',
      model: 'codex-c',
      usage: { input: 60, output: 30 },
    });
    await openToolCall(api, 'run_fold', 'c1'); // act_3
    await api.emit('agent_end', {}, { runId: 'run_fold' });

    // act_1 got turn A's usage alone.
    assert.equal(actionPatch(calls, 'act_1').body.tokens_in, 50);
    assert.equal(actionPatch(calls, 'act_1').body.tokens_out, 10);

    // The held act_2 (usage-absent turn) is NOT dropped — it shares turn C's
    // usage with act_3, split evenly: 60 in / 30 out across 2 actions = 30/15.
    assert.equal(actionPatch(calls, 'act_2').body.tokens_in, 30);
    assert.equal(actionPatch(calls, 'act_2').body.tokens_out, 15);
    assert.equal(actionPatch(calls, 'act_3').body.tokens_in, 30);
    assert.equal(actionPatch(calls, 'act_3').body.tokens_out, 15);
  });

  it('never PATCHes the same action twice when usage flushes are replayed', async () => {
    const calls = installSequentialActionFetchMock();
    const { api } = await registerPlugin({
      pluginConfig: { defaultModel: 'gpt-test' },
    });

    await api.emit('llm_output', {
      runId: 'run_dbl',
      model: 'codex-a',
      usage: { input: 40, output: 8 },
    });
    await openToolCall(api, 'run_dbl', 'a1'); // act_1

    // First flush: the next usage-bearing turn distributes onto act_1.
    await api.emit('llm_output', {
      runId: 'run_dbl',
      model: 'codex-b',
      usage: { input: 20, output: 4 },
    });
    // agent_end must not re-distribute act_1 (already attributed once).
    await api.emit('agent_end', {}, { runId: 'run_dbl' });

    const act1Patches = calls.filter(
      (c) => c.path === '/api/actions/act_1' && c.method === 'PATCH' && !c.body?.claim_execution
    );
    assert.equal(act1Patches.length, 1);
    assert.equal(act1Patches[0].body.tokens_in, 40);
    assert.equal(act1Patches[0].body.tokens_out, 8);
  });

  it('warns (does not silently drop) when a run ends with unattributed actions', async () => {
    const calls = installSequentialActionFetchMock();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { api } = await registerPlugin({
      pluginConfig: { defaultModel: 'gpt-test' },
    });

    try {
      // Single usage-absent turn opens act_1, then the run ends with no usage.
      await api.emit('llm_output', { runId: 'run_drop' });
      await openToolCall(api, 'run_drop', 'a1'); // act_1
      await api.emit('agent_end', {}, { runId: 'run_drop' });

      // No usage ever arrived → no token PATCH on act_1.
      assert.equal(actionPatch(calls, 'act_1'), undefined);

      // But the drop is logged with runId + count (never silent).
      const breadcrumb = warnSpy.mock.calls
        .map((args) => String(args[0]))
        .find((msg) => msg.includes('run_drop') && /unattributed/i.test(msg));
      assert.ok(breadcrumb, 'expected an unattributed-actions warn breadcrumb');
      assert.match(breadcrumb, /1/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  describe('auto-pairing wiring', () => {
    it('fires maybeAutoPair on before_tool_call with autoPairing defaulted true', async () => {
      installFetchMock();
      const { api } = await registerPlugin();

      await api.emit('before_tool_call', {
        toolName: 'read',
        params: {},
        toolCallId: 'tc_ap',
        runId: 'run_ap',
      });

      assert.equal(autoPairMock.maybeAutoPair.mock.calls.length, 1);
      const [, cfg] = autoPairMock.maybeAutoPair.mock.calls[0];
      assert.equal(cfg.autoPairing, true);
      assert.equal(cfg.agentId, 'openclaw-test');
    });

    it('passes autoPairing false through from plugin config', async () => {
      installFetchMock();
      const { api } = await registerPlugin({ pluginConfig: { autoPairing: false } });

      await api.emit('before_tool_call', {
        toolName: 'read',
        params: {},
        toolCallId: 'tc_ap2',
        runId: 'run_ap2',
      });

      const [, cfg] = autoPairMock.maybeAutoPair.mock.calls.at(-1);
      assert.equal(cfg.autoPairing, false);
    });
  });
});
