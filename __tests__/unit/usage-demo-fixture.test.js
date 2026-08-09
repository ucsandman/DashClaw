// Demo-mode fixture for /api/usage must exist (else the /usage page renders
// blank behind the middleware demo dispatch 403) and must be complete: every
// field the /usage page dereferences synchronously has to be present.
import { describe, expect, it } from 'vitest';
import { demoUsage } from '../../app/lib/demo/demoMiddleware.ts';

describe('demoUsage fixture', () => {
  it('matches the full GET /api/usage payload shape the page dereferences', () => {
    const payload = demoUsage();
    expect(typeof payload.period).toBe('string');
    expect(payload.period).toMatch(/^\d{4}-\d{2}$/);
    expect(typeof payload.governed_actions).toBe('number');
    expect(typeof payload.blocked_actions).toBe('number');
    expect(typeof payload.seats.users).toBe('number');
    expect(typeof payload.seats.active_api_keys).toBe('number');
    expect(Array.isArray(payload.history)).toBe(true);
    expect(payload.history.length).toBeGreaterThan(0);
    for (const row of payload.history) {
      expect(row.period).toMatch(/^\d{4}-\d{2}$/);
      expect(typeof row.governed_actions).toBe('number');
      expect(typeof row.blocked_actions).toBe('number');
    }
  });

  it('is deterministic (no live clock or randomness in the data)', () => {
    const a = demoUsage();
    const b = demoUsage();
    expect(a).toEqual(b);
  });
});
