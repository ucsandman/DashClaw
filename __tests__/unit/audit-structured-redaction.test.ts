import { describe, expect, it } from 'vitest';
import { logActivityStrict } from '@/lib/audit';
import { createSqlMock } from '../helpers.js';

describe('structured activity redaction', () => {
  it('redacts secret-shaped values at every nesting level before serialization', async () => {
    const sql = createSqlMock();
    const fakeCredential = `sk-${'A'.repeat(24)}`;

    await logActivityStrict({
      orgId: 'org_test',
      actorId: 'operator',
      action: 'action.allowed',
      details: {
        reasoning: `approved with ${fakeCredential}`,
        nested: [{ authorization: `Bearer ${'B'.repeat(24)}` }],
      },
    }, sql);

    const stored = String(sql.taggedCalls[0]?.values[7]);
    expect(stored).not.toContain(fakeCredential);
    expect(stored).not.toContain('Bearer');
    expect(stored).toContain('[REDACTED:openai_key]');
    expect(stored).toContain('[REDACTED:bearer_token]');
  });
});
