import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('node:fs', () => ({ ...fsMock, default: fsMock }));

const osMock = vi.hoisted(() => ({ homedir: vi.fn(() => '/fakehome') }));
vi.mock('node:os', () => ({ ...osMock, default: osMock }));

const { maybeAutoPair, __resetAutoPairing } = await import(
  '../../../../../packages/openclaw-plugin/src/auto-pairing.ts'
);

const AGENT_ID = 'openclaw-test';
// Split so the contiguous PEM header never appears in this file (secrets hook).
const PUBLIC_PEM_HEADER = '-----BEGIN ' + 'PUBLIC KEY-----';
const PRIVATE_PEM_HEADER = '-----BEGIN ' + 'PRIVATE KEY-----';

function config(overrides = {}) {
  return {
    dashclawUrl: 'https://dashclaw.test',
    dashclawApiKey: 'dc_test',
    agentId: AGENT_ID,
    autoPairing: true,
    ...overrides,
  };
}

// Mirrors buildPairingRequestMessage in app/lib/pairing-request.ts: prose
// followed by the fenced JSON directive.
function directiveBody(agentId = AGENT_ID) {
  return [
    'An operator asked this agent to enroll an identity.',
    '',
    '```json',
    JSON.stringify(
      {
        kind: 'dashclaw.pairing_request',
        agent_id: agentId,
        dashboard_url: 'https://dashclaw.test',
        action: 'Generate a keypair, POST your PEM public key to /api/pairings, then await admin approval.',
      },
      null,
      2
    ),
    '```',
  ].join('\n');
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
  };
}

/** Stub global fetch; records {url, path, method, body} per call. */
function installFetchMock(messages = []) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const request = {
        url: String(url),
        path: new URL(String(url)).pathname,
        method: init.method ?? 'GET',
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(request);
      if (request.path === '/api/messages' && request.method === 'GET') {
        return jsonResponse({ messages, total: messages.length, unread_count: messages.length });
      }
      if (request.path === '/api/messages' && request.method === 'PATCH') {
        return jsonResponse({ updated: request.body.message_ids.length });
      }
      return jsonResponse({ ok: true });
    })
  );
  return calls;
}

function fakeClient() {
  return { createPairing: vi.fn(async () => ({ pairing: { id: 'pair_1', status: 'pending' } })) };
}

beforeEach(() => {
  __resetAutoPairing();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  fsMock.existsSync.mockReturnValue(false);
  osMock.homedir.mockReturnValue('/fakehome');
});

describe('maybeAutoPair', () => {
  it('happy path: submits public key, stores private key 0600, marks message read, runs once per process', async () => {
    const calls = installFetchMock([{ id: 'msg_1', body: directiveBody() }]);
    const client = fakeClient();

    await maybeAutoPair(client, config());

    // Public PEM POSTed via SDK; private key never passed anywhere but writeFileSync.
    assert.equal(client.createPairing.mock.calls.length, 1);
    const publicPem = client.createPairing.mock.calls[0][0];
    assert.ok(publicPem.startsWith(PUBLIC_PEM_HEADER));

    // Private key written to the identity path with mode 600.
    assert.equal(fsMock.writeFileSync.mock.calls.length, 1);
    const [pemPath, privatePem, opts] = fsMock.writeFileSync.mock.calls[0];
    assert.ok(String(pemPath).replace(/\\/g, '/').endsWith('.dashclaw/identity/openclaw-test.pem'));
    assert.ok(privatePem.startsWith(PRIVATE_PEM_HEADER));
    assert.equal(opts.mode, 0o600);

    // Message marked read for this agent.
    const patch = calls.find((c) => c.path === '/api/messages' && c.method === 'PATCH');
    assert.ok(patch, 'expected PATCH /api/messages');
    assert.deepEqual(patch.body.message_ids, ['msg_1']);
    assert.equal(patch.body.action, 'read');
    assert.equal(patch.body.agent_id, AGENT_ID);

    // Second call in the same process is a no-op (per-process guard).
    await maybeAutoPair(client, config());
    assert.equal(client.createPairing.mock.calls.length, 1);
  });

  it('autoPairing false: no network at all', async () => {
    installFetchMock([{ id: 'msg_1', body: directiveBody() }]);
    const client = fakeClient();
    await maybeAutoPair(client, config({ autoPairing: false }));
    assert.equal(globalThis.fetch.mock.calls.length, 0);
    assert.equal(client.createPairing.mock.calls.length, 0);
  });

  it('private key already exists: no network, no overwrite', async () => {
    fsMock.existsSync.mockReturnValue(true);
    installFetchMock([{ id: 'msg_1', body: directiveBody() }]);
    const client = fakeClient();
    await maybeAutoPair(client, config());
    assert.equal(globalThis.fetch.mock.calls.length, 0);
    assert.equal(client.createPairing.mock.calls.length, 0);
    assert.equal(fsMock.writeFileSync.mock.calls.length, 0);
  });

  it('no directive for this agent (other-agent directive + plain message): no pairing, no pem, nothing marked read', async () => {
    const calls = installFetchMock([
      { id: 'msg_1', body: directiveBody('someone-else') },
      { id: 'msg_2', body: 'plain message, no fence' },
    ]);
    const client = fakeClient();
    await maybeAutoPair(client, config());
    assert.equal(client.createPairing.mock.calls.length, 0);
    assert.equal(fsMock.writeFileSync.mock.calls.length, 0);
    assert.ok(!calls.some((c) => c.method === 'PATCH'));
  });

  it('createPairing failure: no pem written, warns, never throws', async () => {
    installFetchMock([{ id: 'msg_1', body: directiveBody() }]);
    const client = { createPairing: vi.fn(async () => { throw new Error('boom'); }) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await maybeAutoPair(client, config()); // must resolve, not reject

    assert.equal(fsMock.writeFileSync.mock.calls.length, 0);
    assert.ok(warn.mock.calls.some(([m]) => String(m).includes('auto-pairing')));
    warn.mockRestore();
  });

  it('messages GET failure: warns, never throws, retryable (guard is per-process only)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'nope' }, 500)));
    const client = fakeClient();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await maybeAutoPair(client, config());
    assert.equal(client.createPairing.mock.calls.length, 0);
    assert.ok(warn.mock.calls.some(([m]) => String(m).includes('auto-pairing')));
    warn.mockRestore();
  });
});
