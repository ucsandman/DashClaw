import { describe, expect, it } from 'vitest';
import {
  assertDisposableRestoreTarget,
  evaluateRecoverySnapshot,
} from '../../scripts/lib/recovery-drill.mjs';

describe('recovery drill safety and evidence', () => {
  it('refuses a drill target that is the configured source database', () => {
    const url = 'postgresql://operator:fake@localhost:5432/dashclaw';
    expect(() => assertDisposableRestoreTarget(url, url)).toThrow(/must differ/i);
  });

  it('reports outstanding approval claims and historical verification failures without claiming recovery', () => {
    const result = evaluateRecoverySnapshot({
      counts: { actions: 10, pendingApprovals: 2, signingKeys: 1, webhooks: 1 },
      outstandingClaims: [{ action_id: 'act_pending', status: 'pending_approval' }],
      historicalVerification: [{ action_id: 'act_old', verified: false, reason: 'key unavailable' }],
      measuredRpoSeconds: 900,
      measuredRtoSeconds: 120,
      objectives: { rpoSeconds: 300, rtoSeconds: 180 },
    });

    expect(result.status).toBe('fail');
    expect(result.checks.outstandingClaims.status).toBe('review');
    expect(result.checks.historicalVerification.status).toBe('fail');
    expect(result.checks.rpo.status).toBe('fail');
    expect(result.checks.rto.status).toBe('pass');
  });
});
