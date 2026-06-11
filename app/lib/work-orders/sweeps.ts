import type { getSql } from '../db';
import { buildReceiptBody, computeReceiptHash } from './receipt';
import {
  sweepExpiredLeases, sweepApprovalReleases, createWorkOrderReceipt,
} from '../repositories/work-orders.repository';

// Shared lazy sweep: expire leases (building their timed_out receipts) and
// release approved/denied pending_approval orders. Called from list/get/claim.
// Lives in lib (not a route file) so it can be imported by multiple routes —
// Next 16 route files may only export HTTP verbs + config.
export async function runWorkOrderSweeps(sql: ReturnType<typeof getSql>, orgId: string) {
  const swept = await sweepExpiredLeases(sql, orgId);
  for (const order of swept) {
    const body = buildReceiptBody({
      order: order as never,
      cost: null,
      outputHash: null,
      governance: {
        mode: 'governed',
        guard_decision_id: ((order.guard_decision as Record<string, unknown> | null)?.decision_id as string) ?? null,
        audit_record_id: null,
      },
    });
    await createWorkOrderReceipt(sql, orgId, String(order.id), body, computeReceiptHash(body));
  }
  await sweepApprovalReleases(sql, orgId);
}
