import { expect, it, vi } from 'vitest';
import { getActionWithRelations } from '@/lib/repositories/actions.repository.create';
import { listActions } from '@/lib/repositories/actions.repository';

it('detail carries bound act evidence and distinct identity/signature assertions', async () => {
  const act = { kind: 'shell', command: 'echo reviewed' };
  const sql = vi.fn(async (parts: TemplateStringsArray) => {
    const query = parts.join('?');
    if (query.includes('FROM action_records')) return [{ action_id: 'act_1', guard_decision_id: 'gd_1',
      verified: true, identity_verified: true, payload_signature_status: 'invalid' }];
    if (query.includes('FROM guard_decisions')) return [{ id: 'gd_1', context: JSON.stringify({ act }), decision: 'allow' }];
    return [];
  }) as unknown as Parameters<typeof getActionWithRelations>[0];
  sql.query = vi.fn(async () => [{ id: 'gd_1', context: JSON.stringify({ act }), decision: 'allow' }]);
  const result = await getActionWithRelations(sql, 'org_1', 'act_1');
  expect(result?.action.context).toMatchObject({ act });
  expect(result?.action.provenance).toEqual({ identity_verified: true, payload_signature: 'invalid' });
});

it('both list query paths select evidence identity and expiry fields', async () => {
  const tagged = vi.fn(async () => []);
  const queried = { query: vi.fn(async () => []), queryCalls: [] };
  for (const sql of [tagged, queried]) {
    await listActions(sql as unknown as Parameters<typeof listActions>[0], 'org_1', {});
    const calls = 'query' in sql ? sql.query.mock.calls : tagged.mock.calls;
    const statements = (calls as unknown[][]).map(([q]) => typeof q === 'string' ? q : Array.from(q as string[]).join('?'));
    const statement = statements.find((query) => query.includes('FROM action_records') && query.includes('action_id'));
    for (const column of ['identity_verified', 'payload_signature_status', 'act_content_hash', 'approval_expires_at', 'created_by']) {
      expect(statement).toContain(column);
    }
  }
});
