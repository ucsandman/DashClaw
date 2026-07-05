/**
 * Act-content grant binding (drizzle/0056, security review 2026-07-05
 * follow-up): createActionRecord stamps a SERVER-computed digest of the act
 * payload the row was created with, so the operator-approval grant can bind
 * a retry to the exact approved act.
 *
 * Position pin: act_content_hash binds directly BEFORE created_by in the
 * insert's VALUES tail, so every existing pin is unchanged
 * (.at(-5) = created_by, fleet-attribution -4/-3, close_source -2,
 * approval-lifecycle -1) and the new value is .at(-6).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createActionRecord } from '../../app/lib/repositories/actions.repository.js';
import { computeActContentHash } from '../../app/lib/act-content-hash.js';
import { digestJson } from '../../app/lib/integrity/canonicalize.js';
import { validateActionRecord } from '../../app/lib/validate.js';

function makeCapturingSqlMock(responses) {
  const queue = [...responses];
  const calls = [];
  const sql = vi.fn((strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(queue.shift() ?? []);
  });
  sql.query = vi.fn(async () => []);
  sql.calls = calls;
  return sql;
}

const ACT = { kind: 'shell', command: 'npm run lint' };

const payload = (extra = {}) => ({
  orgId: 'org_actbind',
  action_id: 'act_new_1',
  actionStatus: 'pending_approval',
  data: { agent_id: 'a1', action_type: 'build', declared_goal: 'Run lint' },
  signature: null,
  verified: false,
  timestamp_start: '2026-07-05T00:00:00Z',
  riskScore: 10,
  ...extra,
});

beforeEach(() => vi.clearAllMocks());

describe('computeActContentHash', () => {
  it('digests an act object via the canonical JSON path', () => {
    expect(computeActContentHash(ACT)).toBe(digestJson(ACT));
    expect(computeActContentHash(ACT)).toMatch(/^sha256:/);
  });

  it('is key-order independent (canonicalized, not serialized as-sent)', () => {
    expect(computeActContentHash({ command: 'npm run lint', kind: 'shell' })).toBe(computeActContentHash(ACT));
  });

  it('returns null for missing or non-object acts (binding never fabricated)', () => {
    expect(computeActContentHash(undefined)).toBeNull();
    expect(computeActContentHash(null)).toBeNull();
    expect(computeActContentHash('rm -rf /')).toBeNull();
    expect(computeActContentHash(['shell'])).toBeNull();
  });
});

// The live A7 smoke caught this: ACTION_RECORD_SCHEMA is a whitelist, so an
// undeclared act was silently dropped before it ever reached the repository —
// the unit stamp tests passed while the live stamp was NULL. Pin the
// validation layer, not just the repository.
describe('validateActionRecord — act passes validation intact', () => {
  const BASE = { agent_id: 'a1', action_type: 'build', declared_goal: 'Run lint', status: 'running' };

  it('keeps a valid act on the validated data (same wire contract as guard)', () => {
    const { valid, data } = validateActionRecord({ ...BASE, act: ACT });
    expect(valid).toBe(true);
    expect(data.act).toEqual(ACT);
  });

  it('rejects an act that violates the guard wire contract', () => {
    const { valid, errors } = validateActionRecord({ ...BASE, act: { kind: 'teleport' } });
    expect(valid).toBe(false);
    expect(errors.join(' ')).toContain('act.kind');
  });

  it('omits act entirely when not supplied', () => {
    const { valid, data } = validateActionRecord(BASE);
    expect(valid).toBe(true);
    expect('act' in data).toBe(false);
  });
});

describe('createActionRecord — act_content_hash stamp', () => {
  it('stamps the server-computed hash when the creation payload carries an act', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_new_1' }]]);
    await createActionRecord(sql, payload({
      data: { agent_id: 'a1', action_type: 'build', declared_goal: 'Run lint', act: ACT },
    }));
    const { text, values } = sql.calls[0];
    expect(text).toContain('act_content_hash');
    expect(values.at(-6)).toBe(computeActContentHash(ACT));
  });

  it('binds NULL when no act was supplied (grant keeps the tuple match)', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_new_1' }]]);
    await createActionRecord(sql, payload());
    expect(sql.calls[0].values.at(-6)).toBeNull();
  });

  it('never trusts a client-supplied hash — the stamp is computed from the act', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_new_1' }]]);
    await createActionRecord(sql, payload({
      data: {
        agent_id: 'a1', action_type: 'build', declared_goal: 'Run lint',
        act: ACT, act_content_hash: 'sha256:forged',
      },
    }));
    const { values } = sql.calls[0];
    expect(values.at(-6)).toBe(computeActContentHash(ACT));
    expect(values).not.toContain('sha256:forged');
  });

  it('keeps the existing position pins intact (created_by still .at(-5))', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_new_1' }]]);
    await createActionRecord(sql, payload({
      createdBy: 'key_abc123',
      data: { agent_id: 'a1', action_type: 'build', declared_goal: 'Run lint', act: ACT },
    }));
    expect(sql.calls[0].values.at(-5)).toBe('key_abc123');
  });
});
