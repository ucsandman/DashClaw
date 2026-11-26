import { expect, test } from 'vitest';
import { runRefundDemo } from '../../examples/duplicate-refund/demo';

test('the platform guard blocks a fresh attempt for the same refund', async () => {
  const proof = await runRefundDemo();
  expect(proof.refundKey).toBe('full-refund:DEMO-1042');
  expect(proof.receipts).toMatchObject([
    { attempt: 'demo-attempt-1', verdict: 'allow', target: '/demo-store/open/DEMO-1042', policyIds: [] },
    { attempt: 'demo-attempt-2', verdict: 'block', target: '/demo-store/refunded/DEMO-1042',
      policyIds: ['demo_no_second_refund'], reason: expect.stringContaining('Order already refunded') },
  ]);
  expect(proof.receipts[0].decisionId).not.toBe(proof.receipts[1].decisionId);
  expect(proof.ledger).toEqual([
    { orderId: 'DEMO-1042', cents: 4_200, decisionId: proof.receipts[0].decisionId },
  ]);
});
