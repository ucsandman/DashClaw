import { describe, expect, it, vi } from 'vitest';
import { evaluateAccess, shapeAccessRule } from '../../app/lib/repositories/capability-access.repository.js';

describe('shapeAccessRule', () => {
  it('shapes a raw row into a rule object', () => {
    const row = {
      rule_id: 'car_1',
      org_id: 'org_1',
      capability_id: 'cap_1',
      agent_id: 'bot_1',
      access: 'deny',
      reason: 'Production only',
      created_by: 'admin',
      created_at: '2026-04-09T10:00:00Z',
    };

    const rule = shapeAccessRule(row);
    expect(rule.rule_id).toBe('car_1');
    expect(rule.access).toBe('deny');
    expect(rule.agent_id).toBe('bot_1');
    expect(rule.reason).toBe('Production only');
  });

  it('handles null agent_id for org-wide rules', () => {
    const row = {
      rule_id: 'car_2',
      org_id: 'org_1',
      capability_id: 'cap_1',
      agent_id: null,
      access: 'require_approval',
      reason: null,
    };

    const rule = shapeAccessRule(row);
    expect(rule.agent_id).toBeNull();
    expect(rule.access).toBe('require_approval');
    expect(rule.reason).toBeNull();
  });

  it('returns null for null input', () => {
    expect(shapeAccessRule(null)).toBeNull();
  });
});

/**
 * D1 identity gate (trust & failure model ADR): agent_id is self-asserted
 * unless a JWKS JWT verified it. An unverified assertion must never obtain a
 * MORE permissive outcome than the org default — per-agent allowances require
 * verified identity. Restrictive agent-specific rules still apply to the
 * asserted id (they bind honest-but-drifting agents, the actual threat model).
 */
describe('evaluateAccess identity gate', () => {
  const AGENT_ALLOW = { rule_id: 'car_a', org_id: 'org_1', capability_id: 'cap_1', agent_id: 'bot_1', access: 'allow', reason: null, created_by: null, created_at: 't' };
  const AGENT_DENY = { rule_id: 'car_d', org_id: 'org_1', capability_id: 'cap_1', agent_id: 'bot_1', access: 'deny', reason: 'prod only', created_by: null, created_at: 't' };
  const ORG_DENY = { rule_id: 'car_o', org_id: 'org_1', capability_id: 'cap_1', agent_id: null, access: 'deny', reason: 'default deny', created_by: null, created_at: 't' };

  const sqlReturning = (rows) => vi.fn(async () => rows);

  it('UNVERIFIED caller asserting an allow-listed agent gets the org default, not the allowance', async () => {
    const sql = sqlReturning([AGENT_ALLOW, ORG_DENY]);
    const result = await evaluateAccess(sql, 'org_1', 'cap_1', 'bot_1', { verified: false });
    expect(result.access).toBe('deny');
    expect(result.identity_downgrade).toBeTruthy();
    expect(result.identity_downgrade.asserted_access).toBe('allow');
  });

  it('VERIFIED identity gets the agent-specific allowance', async () => {
    const sql = sqlReturning([AGENT_ALLOW, ORG_DENY]);
    const result = await evaluateAccess(sql, 'org_1', 'cap_1', 'bot_1', { verified: true });
    expect(result.access).toBe('allow');
    expect(result.identity_downgrade).toBeUndefined();
  });

  it('restrictive agent-specific rules still apply to unverified assertions', async () => {
    const sql = sqlReturning([AGENT_DENY]);
    const result = await evaluateAccess(sql, 'org_1', 'cap_1', 'bot_1', { verified: false });
    expect(result.access).toBe('deny');
    expect(result.rule.rule_id).toBe('car_d');
  });

  it('agent allow with no org rule stays allow (nothing more permissive than the default)', async () => {
    const sql = sqlReturning([AGENT_ALLOW]);
    const result = await evaluateAccess(sql, 'org_1', 'cap_1', 'bot_1', { verified: false });
    expect(result.access).toBe('allow');
    expect(result.identity_downgrade).toBeUndefined();
  });

  it('org-wide rule applies when no agent rule matches (regression)', async () => {
    const sql = sqlReturning([ORG_DENY]);
    const result = await evaluateAccess(sql, 'org_1', 'cap_1', 'bot_2', { verified: false });
    expect(result.access).toBe('deny');
    expect(result.rule.rule_id).toBe('car_o');
  });

  it('no rules at all → allow (regression)', async () => {
    const sql = sqlReturning([]);
    const result = await evaluateAccess(sql, 'org_1', 'cap_1', 'bot_1', { verified: false });
    expect(result.access).toBe('allow');
    expect(result.rule).toBeNull();
  });
});
