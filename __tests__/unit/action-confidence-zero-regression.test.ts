import { expect, it, vi } from 'vitest';
import { createActionRecord } from '../../app/lib/repositories/actions.repository.create';

vi.mock('../../app/lib/repositories/usage.repository', () => ({ incrementUsageRollup: vi.fn() }));

it('persists the explicitly stated lower confidence bound without converting it to unstated', async () => {
  let recorded: Record<string, unknown> = {};
  const sql = Object.assign(vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const statement = parts.join('?');
    if (statement.includes('INSERT INTO action_records')) {
      const columns = statement.match(/INSERT INTO action_records\s*\(([^)]+)\)/s)![1]!.split(',').map((v) => v.trim());
      recorded = Object.fromEntries(columns.map((column, i) => [column, values[i]]));
    }
    return [{ action_id: 'act_confidence' }];
  }), { query: vi.fn() });
  await createActionRecord(sql as never, { orgId: 'org_test', action_id: 'act_confidence',
    data: { agent_id: 'a', action_type: 'read', declared_goal: 'read', confidence: 0 },
    actionStatus: 'running', signature: null, verified: false, timestamp_start: '2026-09-05T00:00:00Z' });
  expect(recorded.confidence).toBe(0);
});
