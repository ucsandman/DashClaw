import { describe, it, expect } from 'vitest';
import { filterSignalsBySeverity, SEVERITY_ROUTE } from '@/lib/security-filter';

const SIGNALS = [
  { id: 's1', severity: 'red' },
  { id: 's2', severity: 'amber' },
  { id: 's3', severity: 'red' },
  { id: 's4', severity: 'amber' },
];

describe('filterSignalsBySeverity', () => {
  it('returns only red signals for severity=red', () => {
    expect(filterSignalsBySeverity(SIGNALS, 'red').map((s) => s.id)).toEqual(['s1', 's3']);
  });

  it('returns only amber signals for severity=amber', () => {
    expect(filterSignalsBySeverity(SIGNALS, 'amber').map((s) => s.id)).toEqual(['s2', 's4']);
  });

  it('returns all signals when no param / all / unknown', () => {
    expect(filterSignalsBySeverity(SIGNALS, null)).toHaveLength(4);
    expect(filterSignalsBySeverity(SIGNALS, undefined)).toHaveLength(4);
    expect(filterSignalsBySeverity(SIGNALS, 'all')).toHaveLength(4);
    expect(filterSignalsBySeverity(SIGNALS, 'green')).toHaveLength(4);
  });

  it('exposes the canonical severity→route map', () => {
    // The dedicated /security dashboard was removed in the v5 cull; governance
    // signals now live on the decisions ledger, so both tiers deep-link there.
    expect(SEVERITY_ROUTE.red).toBe('/decisions');
    expect(SEVERITY_ROUTE.amber).toBe('/decisions');
  });
});
