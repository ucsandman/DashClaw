/**
 * Cross-language idempotency key derivation (Organ 3, Phase 3).
 *
 * The golden vectors in __tests__/fixtures/idempotency-golden-vectors.json
 * pin the derivation algorithm — sorted "k=v" pairs joined with "|",
 * SHA-256 hex — across every surface. sdk/dashclaw.js deriveIdempotencyKey
 * is the reference implementation; hooks/dashclaw_pretool.py and
 * mcp-server/src/tools.ts mirror it (the Python side of these vectors is
 * asserted in hooks/tests/test_idempotency_golden.py).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DashClaw } from '../../sdk/dashclaw.js';

const vectors = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../fixtures/idempotency-golden-vectors.json'), 'utf-8'),
);

function makeClient() {
  return new DashClaw({ baseUrl: 'http://dashclaw.test', apiKey: 'oc_live_test', agentId: 'agt_sdk' });
}

describe('idempotency golden vectors (JS reference implementation)', () => {
  it('has the expected vector count', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(4);
  });

  for (const vector of vectors) {
    it(`derives "${vector.name}"`, () => {
      expect(makeClient().deriveIdempotencyKey(vector.parts)).toBe(vector.expected);
    });
  }
});

describe('createAction auto-derives an idempotency key', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ action: { action_id: 'act_1' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sentBody() {
    return JSON.parse(fetchMock.mock.calls.at(-1)[1].body);
  }

  it('injects a derived key when the caller did not supply one', async () => {
    const client = makeClient();
    await client.createAction({ action_type: 'deploy', declared_goal: 'ship it', session_id: 'cs_1' });
    const body = sentBody();
    const expected = client.deriveIdempotencyKey({
      agent_id: 'agt_sdk',
      action_type: 'deploy',
      declared_goal: 'ship it',
      session_id: 'cs_1',
      ts_bucket: Math.floor(Date.now() / 3600000),
    });
    expect(body.idempotency_key).toBe(expected);
  });

  it('an explicit caller key wins over auto-derivation', async () => {
    await makeClient().createAction({ action_type: 'deploy', declared_goal: 'ship it', idempotency_key: 'caller-key-1' });
    expect(sentBody().idempotency_key).toBe('caller-key-1');
  });

  it('identical retries derive identical keys; distinct actions derive distinct keys', async () => {
    const client = makeClient();
    await client.createAction({ action_type: 'deploy', declared_goal: 'ship it' });
    const first = sentBody().idempotency_key;
    await client.createAction({ action_type: 'deploy', declared_goal: 'ship it' });
    expect(sentBody().idempotency_key).toBe(first);
    await client.createAction({ action_type: 'deploy', declared_goal: 'ship something else' });
    expect(sentBody().idempotency_key).not.toBe(first);
  });
});
