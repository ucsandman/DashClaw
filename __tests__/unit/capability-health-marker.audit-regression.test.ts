// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { checkCircuitBreaker, getCapabilityHealthSummary } from '../../app/lib/capability-health.js';

type SqlCall = { text: string; values: unknown[] };

function captureSql(results: Array<Record<string, unknown>[]>) {
  const calls: SqlCall[] = [];
  const sql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const index = calls.length;
    calls.push({ text: Array.from(strings).join(' '), values });
    return results[index] || [];
  });
  return { sql, calls };
}

describe('capability health stable invocation marker', () => {
  it('counts derived action types by stable capability id while preserving legacy slug rows', async () => {
    const { sql, calls } = captureSql([[{
      total_invocations: 0,
      successful_invocations: 0,
      failed_invocations: 0,
      pending_approvals: 0,
      total_invocations_1d: 0,
      successful_invocations_1d: 0,
    }], [], []]);
    await getCapabilityHealthSummary(sql as never, 'org_1', {
      capability_id: 'cap_1', slug: 'buy-domain', health_status: 'unknown',
    });

    const stable = JSON.stringify(['capability:buy-domain', 'capability-id:cap_1']);
    const legacy = JSON.stringify(['capability:buy-domain']);
    for (const call of calls.slice(0, 2)) {
      expect(call.values).toContain(stable);
      expect(call.values).toContain(legacy);
      expect(call.text).toContain('AND (systems_touched =');
      expect(call.text).toContain("OR (action_type = 'capability_invoke' AND systems_touched =");
    }
    expect(calls[2]?.values).toContain(legacy);
    expect(calls[2]?.values).not.toContain(stable);
  });

  it('parameterizes the stable id and opens the breaker for derived-type failures', async () => {
    const capabilityId = "cap_1' OR 1=1 --";
    const { sql, calls } = captureSql([[
      { status: 'failed' }, { status: 'failed' }, { status: 'failed' },
    ]]);
    const result = await checkCircuitBreaker(sql as never, 'org_1', {
      capability_id: capabilityId,
      slug: 'buy-domain',
      health_status: 'degraded',
      invocation_schema: { circuit_breaker: { enabled: true, consecutive_failures: 3 } },
    });

    expect(result).toEqual({ open: true, consecutive_failures: 3 });
    expect(calls[0]?.text).not.toContain(capabilityId);
    expect(calls[0]?.values).toContain(JSON.stringify([
      'capability:buy-domain', `capability-id:${capabilityId}`,
    ]));
    expect(calls[0]?.values).toContain(JSON.stringify(['capability:buy-domain']));
    expect(calls[0]?.text).toContain('AND (systems_touched =');
    expect(calls[0]?.text).toContain("OR (action_type = 'capability_invoke' AND systems_touched =");
  });
});
