import { describe, it, expect } from 'vitest';
import {
  demoListWorkOrders,
  demoGetWorkOrder,
  demoListWorkOrderTypes,
} from '@/lib/demo/demoMiddleware';

function makeUrl(qs = '') {
  return new URL(`http://localhost/api/work-orders${qs}`);
}

describe('demoListWorkOrders', () => {
  it('returns all 3 demo orders when no filter is applied', () => {
    const result = demoListWorkOrders(makeUrl());
    expect(result.work_orders.length).toBe(3);
    expect(result.total).toBe(3);
  });

  it('filters by status', () => {
    const result = demoListWorkOrders(makeUrl('?status=completed'));
    expect(result.work_orders.every((o) => o.status === 'completed')).toBe(true);
    expect(result.total).toBe(1);
  });

  it('filters by type', () => {
    const result = demoListWorkOrders(makeUrl('?type=research_brief'));
    expect(result.work_orders.every((o) => o.type === 'research_brief')).toBe(true);
    expect(result.total).toBe(3);
  });

  it('returns empty list for an unknown status', () => {
    const result = demoListWorkOrders(makeUrl('?status=nonexistent'));
    expect(result.work_orders.length).toBe(0);
    expect(result.total).toBe(0);
  });

  it('filters by agent — returns only orders where the agent is requester or claimer', () => {
    // wo_demo_completed has claimed_by: 'research-worker-1'; others do not
    const result = demoListWorkOrders(makeUrl('?agent=research-worker-1'));
    expect(result.work_orders.length).toBe(1);
    expect(result.work_orders[0]?.id).toBe('wo_demo_completed');
    expect(result.total).toBe(1);
  });

  it('returns empty list when agent matches no order', () => {
    const result = demoListWorkOrders(makeUrl('?agent=unknown-agent-x'));
    expect(result.work_orders.length).toBe(0);
    expect(result.total).toBe(0);
  });
});

describe('demoGetWorkOrder', () => {
  it('returns the completed order with its receipt', () => {
    const result = demoGetWorkOrder('wo_demo_completed');
    expect(result.work_order).toBeTruthy();
    expect((result.work_order as Record<string, unknown>).status).toBe('completed');
    expect(result.receipt).toBeTruthy();
    expect((result.receipt as Record<string, unknown>).receipt_hash).toBe('sha256:demo-receipt-hash');
  });

  it('returns a non-completed order with null receipt', () => {
    const result = demoGetWorkOrder('wo_demo_queued');
    expect(result.work_order).toBeTruthy();
    expect(result.receipt).toBeNull();
  });

  it('returns the pending_approval order with null receipt', () => {
    const result = demoGetWorkOrder('wo_demo_pending');
    expect(result.work_order).toBeTruthy();
    expect(result.receipt).toBeNull();
  });

  it('returns error shape for unknown id', () => {
    const result = demoGetWorkOrder('wo_does_not_exist');
    expect((result as Record<string, unknown>).error).toBe('work_order_not_found');
    expect((result as Record<string, unknown>).work_order).toBeUndefined();
  });
});

describe('demoListWorkOrderTypes', () => {
  it('returns the registered types', () => {
    const result = demoListWorkOrderTypes();
    expect(result.types.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.types[0]?.type).toBe('research_brief');
    expect(result.types[0]?.status).toBe('active');
  });
});
