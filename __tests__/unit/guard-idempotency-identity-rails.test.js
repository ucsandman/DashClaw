/**
 * Cross-layer regression: identity verification detects token reuse BEFORE
 * idempotency lookup. A cached verdict must not skip a current identity block.
 * Runs the real route, validator, JWT crypto, identity resolver, replay store
 * repository, cache binding, evaluator and audit INSERT. Only I/O is replaced:
 * DNS/JWKS transport, event delivery, and a stateful in-memory SQL boundary.
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { database } = vi.hoisted(() => ({ database: { sql: null } }));
vi.mock('@/lib/db', () => ({ getSql: () => database.sql }));
vi.mock('node:dns/promises', () => ({
  default: { lookup: async () => [{ address: '93.184.216.34', family: 4 }] },
}));
vi.mock('@/lib/events', () => ({
  EVENTS: { GUARD_DECISION_CREATED: 'guard.decision.created' },
  publishOrgEvent: async () => undefined,
}));

import { POST } from '@/api/guard/route';
import { __resetGuardCaches } from '@/lib/guard';
import { _resetStateForTesting } from '@/lib/jwks-verifier';
import { _resetCacheForTesting } from '@/lib/repositories/jti-replay.repository';

const ISSUER = 'https://identity.example.com';
const ORG = 'org_identity_replay_regression';
const BODY = {
  action_type: 'read',
  agent_id: 'agent_regression',
  declared_goal: 'Inspect the repository status',
  idempotency_key: 'identity-replay-regression',
};
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'regression-key', alg: 'EdDSA' };

function token(jti) {
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: jwk.kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: ISSUER, sub: BODY.agent_id, aud: 'dashclaw-regression',
    exp: Math.floor(Date.now() / 1000) + 300, ...(jti === undefined ? {} : { jti }),
  })).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
}

function createDatabase() {
  const decisions = [];
  const seenTokens = new Set();
  const state = { decisions, seenTokens, storeUnavailable: false, failAudit: false };
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    if (text.includes('INSERT INTO jwt_replay_log')) {
      if (state.storeUnavailable) throw new Error('Replay store unavailable in regression fixture');
      const key = JSON.stringify(values.slice(0, 2));
      if (seenTokens.has(key)) return [];
      seenTokens.add(key);
      return [{ jti: values[1] }];
    }
    if (text.includes('INSERT INTO guard_decisions')) {
      if (state.failAudit) throw new Error('Audit store unavailable in regression fixture');
      const columns = text.match(/INSERT INTO guard_decisions\s*\(([^)]+)\)/)[1]
        .split(',').map((column) => column.trim());
      if (columns.length !== values.length) throw new Error('Audit INSERT fixture column/value mismatch');
      decisions.push(Object.fromEntries(columns.map((column, index) => [column, values[index]])));
      return [];
    }
    // Empty organization: no policies, templates, settings, plans or alerts.
    if (/^\s*(SELECT|CREATE|DELETE)\b/.test(text)) return [];
    throw new Error(`Unexpected SQL in identity regression: ${text.slice(0, 120)}`);
  };
  sql.query = async (text, values) => {
    if (text.includes('FROM guard_decisions') && text.includes('idempotency_key = $2')) {
      return decisions.filter((row) => row.org_id === values[0] && row.idempotency_key === values[1]).slice(-1);
    }
    if (/^\s*SELECT\b/.test(text)) return [];
    throw new Error(`Unexpected SQL query in identity regression: ${text.slice(0, 120)}`);
  };
  database.sql = sql;
  return state;
}

async function post(jwt, body = BODY) {
  const response = await POST(makeRequest('http://localhost/api/guard', {
    headers: { 'x-org-id': ORG, ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
    body: { ...body },
  }));
  return { status: response.status, body: await response.json() };
}

let state;
beforeEach(() => {
  __resetGuardCaches();
  _resetStateForTesting();
  _resetCacheForTesting();
  vi.stubEnv('DASHCLAW_MODE', 'cloud');
  vi.stubEnv('DASHCLAW_JTI_REPLAY_PROTECTION', 'required');
  vi.stubEnv('DASHCLAW_ACT_BINDING', 'best_effort');
  vi.stubEnv('DASHCLAW_ALLOWED_ISSUER', ISSUER);
  vi.stubEnv('DASHCLAW_JWT_AUDIENCE', 'dashclaw-regression');
  vi.stubEnv('REDIS_URL', '');
  vi.stubGlobal('fetch', async (url) => {
    if (url !== `${ISSUER}/.well-known/jwks.json`) throw new Error(`Unexpected network request: ${url}`);
    return Response.json({ keys: [jwk] });
  });
  state = createDatabase();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function expectAuditedBlock(result, expectedStatus, reason) {
  expect(result.status).toBe(200);
  expect(result.body.decision).toBe('block');
  expect(result.body.idempotent_replay).toBeUndefined();
  expect(result.body.reason).toContain(reason);
  expect(state.decisions).toHaveLength(2);
  expect(state.decisions[1]).toMatchObject({ decision: 'block', replay_status: expectedStatus });
  expect(state.decisions[1].id).not.toBe(state.decisions[0].id);
}

describe('idempotency cannot override current JWT enforcement', () => {
  it.each(['required', 'best_effort'])('blocks reuse of a verified JWT under the same key in %s mode', async (mode) => {
    vi.stubEnv('DASHCLAW_JTI_REPLAY_PROTECTION', mode);
    const jwt = token('single-use-token');
    const first = await post(jwt);
    expect(first.status).toBe(200);
    expect(first.body.decision).toBe('allow');
    expect(first.body.verification_status).toBe('verified');
    expect(state.decisions[0].replay_status).toBe('unique');
    expectAuditedBlock(await post(jwt), 'replayed', 'Replay detected');
  });

  it('does not inherit a verified allow when the retry omits jti in required mode', async () => {
    expect((await post(token('first-token'))).body.decision).toBe('allow');
    expectAuditedBlock(await post(token()), 'not_present', 'Verified token has no jti');
  });

  it('does not inherit an allow when the replay store becomes unavailable in required mode', async () => {
    expect((await post(token('first-token'))).body.decision).toBe('allow');
    state.storeUnavailable = true;
    expectAuditedBlock(await post(token('fresh-token')), 'unavailable', 'Replay store unreachable');
  });

  it('blocks after best_effort is tightened to required even when both contexts have no jti', async () => {
    vi.stubEnv('DASHCLAW_JTI_REPLAY_PROTECTION', 'best_effort');
    const jwt = token();
    expect((await post(jwt)).body.decision).toBe('allow');
    vi.stubEnv('DASHCLAW_JTI_REPLAY_PROTECTION', 'required');
    expectAuditedBlock(await post(jwt), 'not_present', 'Verified token has no jti');
  });

  it('blocks after action binding becomes required even when the token status has not changed', async () => {
    expect((await post(token('first-token'))).body.decision).toBe('allow');
    vi.stubEnv('DASHCLAW_ACT_BINDING', 'required');
    expectAuditedBlock(await post(token('fresh-token')), 'unique', 'Action-binding not_present');
  });

  it('preserves idempotency for the same action retried with a fresh valid token', async () => {
    const first = await post(token('first-token'));
    const retry = await post(token('fresh-token'));
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ decision: 'allow', idempotent_replay: true, decision_id: first.body.decision_id });
    expect(state.seenTokens.size).toBe(2);
    expect(state.decisions).toHaveLength(1);
  });

  it('allows recovery with a fresh token after a rejected token replay', async () => {
    const jwt = token('first-token');
    expect((await post(jwt)).body.decision).toBe('allow');
    expectAuditedBlock(await post(jwt), 'replayed', 'Replay detected');
    const recovery = await post(token('fresh-token'));
    expect(recovery.status).toBe(200);
    expect(recovery.body.decision).toBe('allow');
    expect(recovery.body.idempotent_replay).toBeUndefined();
    expect(state.decisions).toHaveLength(3);
    expect(state.decisions[2]).toMatchObject({ decision: 'allow', replay_status: 'unique' });
  });

  it('blocks reused tokens even without an idempotency key (control)', async () => {
    const jwt = token('first-token');
    expect((await post(jwt)).body.decision).toBe('allow');
    const { idempotency_key: _key, ...withoutKey } = BODY;
    expectAuditedBlock(await post(jwt, withoutKey), 'replayed', 'Replay detected');
  });

  it('preserves non-JWT route idempotency', async () => {
    const first = await post();
    const retry = await post();
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ decision: 'allow', idempotent_replay: true, decision_id: first.body.decision_id });
    expect(state.decisions).toHaveLength(1);
    expect(state.seenTokens.size).toBe(0);
  });

  it('preserves the explicit replay-protection-off mode', async () => {
    vi.stubEnv('DASHCLAW_JTI_REPLAY_PROTECTION', 'off');
    const jwt = token('reusable-only-when-off');
    const first = await post(jwt);
    const retry = await post(jwt);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ decision: 'allow', idempotent_replay: true, decision_id: first.body.decision_id });
    expect(state.decisions).toHaveLength(1);
    expect(state.decisions[0].replay_status).toBe('disabled');
    expect(state.seenTokens.size).toBe(0);
  });

  it('never returns the cached allow when the new identity block cannot be audited', async () => {
    const jwt = token('single-use-token');
    expect((await post(jwt)).body.decision).toBe('allow');
    state.failAudit = true;
    const retry = await post(jwt);
    expect(retry.status).toBe(503);
    expect(retry.body).toMatchObject({ code: 'GUARD_AUDIT_PERSIST_FAILED' });
    expect(retry.body.decision).toBeUndefined();
    expect(state.decisions).toHaveLength(1);
  });
});
