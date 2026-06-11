import { describe, it, expect } from 'vitest';
import { buildReceiptBody, computeReceiptHash, verifyReceiptHash } from '@/lib/work-orders/receipt';

const ORDER = {
  id: 'wo_1', org_id: 'org_1', type: 'research_brief', type_version: '1.0',
  input_hash: 'sha256:abc', max_cost_usd: '0.25', timeout_seconds: 600,
  status: 'completed', requested_by: 'caller-1', claimed_by: 'worker-1',
  created_at: '2026-06-11T00:00:00.000Z', claimed_at: '2026-06-11T00:00:05.000Z',
  completed_at: '2026-06-11T00:01:00.000Z',
};

describe('work order receipts', () => {
  it('builds a canonical body with cost, lifecycle, governance and over_budget flag', () => {
    const body = buildReceiptBody({
      order: ORDER,
      cost: { input_tokens: 100, output_tokens: 200, total_usd: 0.31 },
      outputHash: 'sha256:out',
      governance: { mode: 'governed', guard_decision_id: 'act_gd_x', audit_record_id: 'act_y' },
    });
    expect(body.work_order_id).toBe('wo_1');
    expect(body.over_budget).toBe(true); // 0.31 > 0.25
    expect(body.lifecycle.created_at).toBe(ORDER.created_at);
    expect(body.governance.audit_record_id).toBe('act_y');
  });

  it('hash round-trips and detects tamper', () => {
    const body = buildReceiptBody({ order: ORDER, cost: { total_usd: 0.1 }, outputHash: 'sha256:o', governance: { mode: 'governed' } });
    const hash = computeReceiptHash(body);
    expect(verifyReceiptHash(body, hash)).toBe(true);
    expect(verifyReceiptHash({ ...body, cost: { ...body.cost, total_usd: 9.99 } }, hash)).toBe(false);
  });

  it('post-build mutation of the governance argument does not change the hash', () => {
    const governance = { mode: 'governed' as const, matched_policies: ['pol_a', 'pol_b'] };
    const body = buildReceiptBody({ order: ORDER, cost: { total_usd: 0.1 }, outputHash: 'sha256:o', governance });
    const hash = computeReceiptHash(body);
    // Mutate the original governance object and the matched_policies array after the fact.
    governance.matched_policies.push('pol_injected');
    (governance as Record<string, unknown>).mode = 'tampered';
    expect(verifyReceiptHash(body, hash)).toBe(true);
  });

  it('Date-object timestamps canonicalize identically to equivalent ISO strings', () => {
    // Neon returns timestamptz columns as JS Date objects. JSON.stringify converts
    // Date to {} (empty object), which corrupts the hash. toIso() normalises them
    // to ISO strings so Date and string inputs produce the same receipt hash.
    const dateOrder = {
      ...ORDER,
      created_at: new Date('2026-06-11T00:00:00.000Z'),
      claimed_at: new Date('2026-06-11T00:00:05.000Z'),
      completed_at: new Date('2026-06-11T00:01:00.000Z'),
    };
    const costArg = { input_tokens: 100, output_tokens: 200, total_usd: 0.1 };
    const govArg = { mode: 'governed' as const };

    const bodyFromDates = buildReceiptBody({ order: dateOrder, cost: costArg, outputHash: 'sha256:o', governance: govArg });
    const bodyFromStrings = buildReceiptBody({ order: ORDER, cost: costArg, outputHash: 'sha256:o', governance: govArg });

    // Lifecycle fields must be ISO strings regardless of input type.
    expect(bodyFromDates.lifecycle.created_at).toBe('2026-06-11T00:00:00.000Z');
    expect(bodyFromDates.lifecycle.claimed_at).toBe('2026-06-11T00:00:05.000Z');
    expect(bodyFromDates.lifecycle.completed_at).toBe('2026-06-11T00:01:00.000Z');

    // Hashes must be identical — Date and string inputs are interchangeable.
    expect(computeReceiptHash(bodyFromDates)).toBe(computeReceiptHash(bodyFromStrings));
  });
});
