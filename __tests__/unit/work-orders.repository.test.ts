import { describe, it, expect, vi } from 'vitest';
import {
  assertTransition, createWorkOrder, claimNextWorkOrder, sweepExpiredLeases,
  transitionWorkOrder,
  LEGAL_TRANSITIONS,
} from '@/lib/repositories/work-orders.repository';

type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

function makeSqlMock(responses: Record<string, unknown>[][]) {
  const queue = [...responses];
  const calls: { strings: TemplateStringsArray; values: unknown[] }[] = [];
  const fn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ strings, values });
    return Promise.resolve(queue.shift() ?? []);
  }) as unknown as SqlTag & { calls: typeof calls };
  (fn as unknown as { calls: typeof calls }).calls = calls;
  return fn;
}

describe('lifecycle legality', () => {
  it('allows documented transitions and rejects everything else', () => {
    expect(() => assertTransition('queued', 'claimed')).not.toThrow();
    expect(() => assertTransition('pending_approval', 'queued')).not.toThrow();
    expect(() => assertTransition('claimed', 'completed')).not.toThrow();
    expect(() => assertTransition('completed', 'queued')).toThrow();
    expect(() => assertTransition('queued', 'completed')).toThrow(); // no skipping claim
    expect(() => assertTransition('blocked', 'queued')).toThrow();
  });
  it('terminal states have no outgoing transitions', () => {
    for (const terminal of ['completed', 'failed', 'timed_out', 'cancelled', 'blocked']) {
      expect(LEGAL_TRANSITIONS[terminal]).toEqual([]);
    }
  });
});

describe('createWorkOrder', () => {
  it('inserts with wo_ id, org scoping, and input hash', async () => {
    const sql = makeSqlMock([[{ id: 'wo_x', status: 'queued' }]]);
    const row = await createWorkOrder(sql, 'org_1', {
      type: 'research_brief', typeVersion: '1.0', input: { topic: 'x' },
      inputHash: 'sha256:i', maxCostUsd: 0.25, timeoutSeconds: 600,
      status: 'queued', requestedBy: 'caller', guardDecision: { decision: 'allow' },
    });
    expect(row!.id).toBe('wo_x');
    const mock = sql as unknown as { calls: { values: unknown[] }[] };
    expect(mock.calls[0]!.values).toContain('org_1');
    expect(mock.calls[0]!.values.some((v) => typeof v === 'string' && (v as string).startsWith('wo_'))).toBe(true);
  });
});

describe('claimNextWorkOrder', () => {
  it('passes org, agent and types into the atomic claim query', async () => {
    const sql = makeSqlMock([[]]);
    await claimNextWorkOrder(sql, 'org_1', 'worker-1', ['research_brief']);
    const mock = sql as unknown as { calls: { values: unknown[] }[] };
    expect(mock.calls[0]!.values).toContain('org_1');
    expect(mock.calls[0]!.values).toContain('worker-1');
  });
});

describe('sweepExpiredLeases', () => {
  it('returns swept rows so callers can build timed_out receipts', async () => {
    const sql = makeSqlMock([[{ id: 'wo_expired', status: 'timed_out' }]]);
    const swept = await sweepExpiredLeases(sql, 'org_1');
    expect(swept).toHaveLength(1);
    expect(swept[0]!.id).toBe('wo_expired');
  });
});

describe('transitionWorkOrder', () => {
  it('includes the expected-state guard value in the UPDATE call', async () => {
    // First call: getWorkOrder returns current row (status=claimed).
    // Second call: the UPDATE with the state guard.
    const sql = makeSqlMock([
      [{ id: 'wo_1', status: 'claimed', error_code: null, error_details: null, completed_at: null }],
      [{ id: 'wo_1', status: 'completed' }],
    ]);
    const row = await transitionWorkOrder(sql, 'org_1', 'wo_1', 'completed');
    expect(row).not.toBeNull();
    const mock = sql as unknown as { calls: { values: unknown[] }[] };
    // The second call is the UPDATE — it must carry 'claimed' as the expected-state guard.
    expect(mock.calls[1]!.values).toContain('claimed');
  });

  it('throws on illegal transition and issues no UPDATE', async () => {
    // First call: getWorkOrder returns a terminal (completed) row.
    const sql = makeSqlMock([
      [{ id: 'wo_1', status: 'completed', error_code: null, error_details: null, completed_at: null }],
    ]);
    await expect(transitionWorkOrder(sql, 'org_1', 'wo_1', 'queued')).rejects.toThrow(
      'illegal work order transition: completed -> queued',
    );
    const mock = sql as unknown as { calls: { values: unknown[] }[] };
    // Only the SELECT (getWorkOrder) should have been called — no UPDATE.
    expect(mock.calls).toHaveLength(1);
  });
});
