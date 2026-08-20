// Short List admission on the policy write paths (spec 2.3):
// POST/PATCH demote interrupting rules to Watch unless the caller opts in with
// rules.short_list, and the opt-in is capped at SHORT_LIST_CAP.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockValidatePolicy, mockPublishOrgEvent, mockGetActivePolicies } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockValidatePolicy: vi.fn(),
  mockPublishOrgEvent: vi.fn(),
  mockGetActivePolicies: vi.fn(async () => []),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/validate', () => ({ validatePolicy: mockValidatePolicy }));
vi.mock('@/lib/events.js', () => ({
  EVENTS: { POLICY_UPDATED: 'policy.updated' },
  publishOrgEvent: mockPublishOrgEvent,
}));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  deletePoliciesByIds: vi.fn(async () => []),
  getActivePolicies: mockGetActivePolicies,
}));

import { POST, PATCH } from '@/api/policies/route.js';

const ADMIN = { 'x-org-id': 'org_1', 'x-org-role': 'admin' };

/** A full Short List: ten active interrupting rules. */
function fullList() {
  return Array.from({ length: 10 }, (_, i) => ({
    id: `gp_${i}`,
    policy_type: 'require_approval',
    rules: JSON.stringify({ action_types: [`t${i}`] }),
    active: 1,
  }));
}

/** The (policy_type, rules) the route handed to the INSERT template. */
function insertedValues() {
  return mockSql.mock.calls.find(
    (c) => Array.isArray(c[0]) && String(c[0][0]).includes('INSERT INTO guard_policies'),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = 'postgres://unit-test';
  mockSql.mockImplementation(async () => []);
  mockSql.query.mockImplementation(async () => []);
  mockGetActivePolicies.mockResolvedValue([]);
  mockValidatePolicy.mockImplementation((body) => ({
    valid: true,
    data: { name: body.name, policy_type: body.policy_type, rules: body.rules, active: 1 },
    errors: [],
  }));
});

describe('POST /api/policies — Short List', () => {
  it('demotes an interrupting rule to Watch when the caller did not opt in', async () => {
    const res = await POST(makeRequest('http://localhost/api/policies', {
      headers: ADMIN,
      body: {
        name: 'Pause on API calls',
        policy_type: 'require_approval',
        rules: JSON.stringify({ action_types: ['api'] }),
      },
    }));
    expect(res.status).toBe(201);
    const values = insertedValues();
    // ...(id, org_id, name, policy_type, rules, ...) — positions 4 and 5.
    expect(values[4]).toBe('warn_action_type');
    expect(JSON.parse(values[5])).toEqual({ action_types: ['api'] });
  });

  it('leaves an already-watched rule untouched', async () => {
    const res = await POST(makeRequest('http://localhost/api/policies', {
      headers: ADMIN,
      body: {
        name: 'Record posts',
        policy_type: 'warn_action_type',
        rules: JSON.stringify({ action_types: ['post'] }),
      },
    }));
    expect(res.status).toBe(201);
    const values = insertedValues();
    expect(values[4]).toBe('warn_action_type');
    expect(JSON.parse(values[5])).toEqual({ action_types: ['post'] });
  });

  it('short_list: true is the opt-in — the rule keeps its interrupting action', async () => {
    const res = await POST(makeRequest('http://localhost/api/policies', {
      headers: ADMIN,
      body: {
        name: 'Hold deploys',
        policy_type: 'require_approval',
        rules: JSON.stringify({ action_types: ['deploy'], short_list: true }),
      },
    }));
    expect(res.status).toBe(201);
    const values = insertedValues();
    expect(values[4]).toBe('require_approval');
    expect(JSON.parse(values[5])).toEqual({ action_types: ['deploy'], short_list: true });
  });

  it('returns 409 SHORT_LIST_FULL when the list is already at ten', async () => {
    mockGetActivePolicies.mockResolvedValue(fullList());
    const res = await POST(makeRequest('http://localhost/api/policies', {
      headers: ADMIN,
      body: {
        name: 'Eleventh',
        policy_type: 'block_action_type',
        rules: JSON.stringify({ action_types: ['drop'], short_list: true }),
      },
    }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'The Short List is full (10 of 10). Remove a line to add this one.',
      code: 'SHORT_LIST_FULL',
    });
    expect(insertedValues()).toBeUndefined();
  });

  it('a full list does not block a watched rule', async () => {
    mockGetActivePolicies.mockResolvedValue(fullList());
    const res = await POST(makeRequest('http://localhost/api/policies', {
      headers: ADMIN,
      body: {
        name: 'Record posts',
        policy_type: 'warn_action_type',
        rules: JSON.stringify({ action_types: ['post'] }),
      },
    }));
    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/policies — Short List', () => {
  beforeEach(() => {
    mockSql.query.mockImplementation(async (q) => {
      if (String(q).startsWith('SELECT policy_type')) return [{ policy_type: 'warn_action_type', rules: '{}' }];
      return [{ id: 'gp_target' }];
    });
  });

  it('promoting a warn row to Hold actually writes policy_type = require_approval', async () => {
    const res = await PATCH(makeRequest('http://localhost/api/policies', {
      method: 'PATCH',
      headers: ADMIN,
      body: {
        id: 'gp_target',
        policy_type: 'require_approval',
        rules: { action_types: ['deploy'], short_list: true },
      },
    }));
    expect(res.status).toBe(200);
    const [query, params] = mockSql.query.mock.calls.at(-1);
    expect(query).toContain('UPDATE guard_policies');
    expect(query).toContain('policy_type =');
    // Without this the row stays warn_action_type: require_approval's evaluator
    // hardcodes its decision, so the promotion would burn a cap slot and never
    // actually hold anything.
    expect(params).toContain('require_approval');
    expect(JSON.stringify(params)).toContain('short_list');
  });

  it('a promote whose type already matches the row does not rewrite policy_type', async () => {
    mockSql.query.mockImplementation(async (q) => {
      if (String(q).startsWith('SELECT policy_type')) return [{ policy_type: 'require_approval', rules: '{}' }];
      return [{ id: 'gp_target' }];
    });
    const res = await PATCH(makeRequest('http://localhost/api/policies', {
      method: 'PATCH',
      headers: ADMIN,
      body: { id: 'gp_target', rules: { action_types: ['deploy'], short_list: true } },
    }));
    expect(res.status).toBe(200);
    expect(mockSql.query.mock.calls.at(-1)[0]).not.toContain('policy_type =');
  });

  it('returns 409 SHORT_LIST_FULL when promoting past the cap', async () => {
    mockGetActivePolicies.mockResolvedValue(fullList());
    const res = await PATCH(makeRequest('http://localhost/api/policies', {
      method: 'PATCH',
      headers: ADMIN,
      body: {
        id: 'gp_target',
        policy_type: 'require_approval',
        rules: { action_types: ['deploy'], short_list: true },
      },
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('SHORT_LIST_FULL');
  });

  it('does not count the policy being updated against its own cap', async () => {
    const list = fullList();
    list[0].id = 'gp_target';
    mockGetActivePolicies.mockResolvedValue(list);
    const res = await PATCH(makeRequest('http://localhost/api/policies', {
      method: 'PATCH',
      headers: ADMIN,
      body: {
        id: 'gp_target',
        policy_type: 'require_approval',
        rules: { action_types: ['deploy'], short_list: true },
      },
    }));
    expect(res.status).toBe(200);
  });

  it('a PATCH that raises a rule without opting in is demoted back to Watch', async () => {
    const res = await PATCH(makeRequest('http://localhost/api/policies', {
      method: 'PATCH',
      headers: ADMIN,
      body: {
        id: 'gp_target',
        policy_type: 'risk_threshold',
        rules: { threshold: 100, action: 'block' },
      },
    }));
    expect(res.status).toBe(200);
    const params = mockSql.query.mock.calls.at(-1)[1];
    expect(params.some((p) => typeof p === 'string' && p.includes('"action":"warn"'))).toBe(true);
    expect(params.some((p) => typeof p === 'string' && p.includes('"action":"block"'))).toBe(false);
  });
});

describe('PATCH /api/policies — reactivation is capped', () => {
  function dormantHold(rules = { action_types: ['deploy'] }) {
    mockSql.query.mockImplementation(async (q) => {
      if (String(q).startsWith('SELECT policy_type')) {
        return [{ policy_type: 'require_approval', rules: JSON.stringify(rules) }];
      }
      return [{ id: 'gp_dormant' }];
    });
  }

  it('returns 409 when switching a dormant Short List line back on with no free slot', async () => {
    dormantHold();
    mockGetActivePolicies.mockResolvedValue(fullList());
    const res = await PATCH(makeRequest('http://localhost/api/policies', {
      method: 'PATCH',
      headers: ADMIN,
      body: { id: 'gp_dormant', active: 1 },
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('SHORT_LIST_FULL');
  });

  it('allows the reactivation when a slot is free', async () => {
    dormantHold();
    mockGetActivePolicies.mockResolvedValue(fullList().slice(0, 9));
    const res = await PATCH(makeRequest('http://localhost/api/policies', {
      method: 'PATCH',
      headers: ADMIN,
      body: { id: 'gp_dormant', active: 1 },
    }));
    expect(res.status).toBe(200);
  });

  it('never caps a reactivation of a watched line, or a deactivation', async () => {
    mockGetActivePolicies.mockResolvedValue(fullList());
    mockSql.query.mockImplementation(async (q) => {
      if (String(q).startsWith('SELECT policy_type')) {
        return [{ policy_type: 'warn_action_type', rules: '{"action_types":["post"]}' }];
      }
      return [{ id: 'gp_watched' }];
    });
    expect((await PATCH(makeRequest('http://localhost/api/policies', {
      method: 'PATCH', headers: ADMIN, body: { id: 'gp_watched', active: 1 },
    }))).status).toBe(200);

    dormantHold();
    expect((await PATCH(makeRequest('http://localhost/api/policies', {
      method: 'PATCH', headers: ADMIN, body: { id: 'gp_dormant', active: 0 },
    }))).status).toBe(200);
  });
});

describe('POST /api/policies — types with no Watch tier', () => {
  it('returns 409 NO_WATCH_TIER instead of storing an inert demotion flag', async () => {
    const res = await POST(makeRequest('http://localhost/api/policies', {
      headers: ADMIN,
      body: {
        name: 'Role limits',
        policy_type: 'role_constraint',
        rules: JSON.stringify({ role: 'junior', blocked_action_types: ['deploy'] }),
      },
    }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe('NO_WATCH_TIER');
    expect(data.error).toContain('role_constraint');
    expect(insertedValues()).toBeUndefined();
  });

  it('the same rule installs when the operator opts it onto the Short List', async () => {
    const res = await POST(makeRequest('http://localhost/api/policies', {
      headers: ADMIN,
      body: {
        name: 'Role limits',
        policy_type: 'role_constraint',
        rules: JSON.stringify({ role: 'junior', blocked_action_types: ['deploy'], short_list: true }),
      },
    }));
    expect(res.status).toBe(201);
    expect(insertedValues()[4]).toBe('role_constraint');
  });
});
