import { describe, it, expect, vi } from 'vitest';
import { applyOperatorApprovalGrant } from '../../app/lib/guard/evaluate.grants';
import { newAccumulator } from '../../app/lib/guard/evaluate.accumulator';

describe('approval authority is not spent by evaluation', () => {
  it('finds a matching grant without mutating it before a durable execution claim', async () => {
    const statements: string[] = [];
    const sql = Object.assign(vi.fn(async (parts: TemplateStringsArray) => {
      statements.push(parts.join('?'));
      return [{ action_id: 'act_approved', approved_by: 'operator', act_content_hash: null }];
    }), { query: vi.fn() });
    const acc = newAccumulator();
    acc.highestDecision = 'require_approval';
    await applyOperatorApprovalGrant({ sql, orgId: 'org_test', context: {
      agent_id: 'agent', action_type: 'write', declared_goal: 'write a fixture',
      client_capabilities: ['execution_claims'],
    } } as never, acc);
    expect(acc.highestDecision).toBe('allow');
    expect(statements).toHaveLength(1);
    expect(statements[0]).not.toMatch(/\bUPDATE\b/i);
    expect(acc).toHaveProperty('executionAuthorization', { kind: 'operator', id: 'act_approved' });
  });

  it('does not issue deferred grant authority to clients that cannot claim it', async () => {
    const sql = Object.assign(vi.fn(async () => [{ action_id: 'act_approved' }]), { query: vi.fn() });
    const acc = newAccumulator();
    acc.highestDecision = 'require_approval';
    await applyOperatorApprovalGrant({ sql, orgId: 'org_test', context: {
      agent_id: 'agent', action_type: 'write', declared_goal: 'write a fixture',
    } } as never, acc);
    expect(acc.highestDecision).toBe('require_approval');
    expect(sql).not.toHaveBeenCalled();
  });
});
