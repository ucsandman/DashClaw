import { describe, expect, it } from 'vitest';
import { evaluateRecoverySnapshot } from '../../scripts/lib/recovery-drill.mjs';

describe('recovery reconciliation counts', () => {
  it('reports the full outstanding count separately from a bounded row sample', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ action_id: `act_${i}`, status: 'running' }));
    const result = evaluateRecoverySnapshot({
      counts: { actions: 105, pendingApprovals: 0, signingKeys: 1, webhooks: 0 },
      outstandingClaims: rows,
      outstandingClaimCount: 105,
      historicalVerification: [{ verified: true }],
      measuredRpoSeconds: 1,
      measuredRtoSeconds: 1,
      objectives: { rpoSeconds: 10, rtoSeconds: 10 },
    });

    expect(result.checks.outstandingClaims).toEqual({
      status: 'review',
      count: 105,
      sample_count: 100,
      truncated: true,
      rows,
    });
  });
});
