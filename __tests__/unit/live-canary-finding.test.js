/**
 * v3.4 live-host canary — posture auditability finding derivation.
 *
 * Pins the acceptance semantics: a fresh failed run becomes exactly one
 * collapsed finding with a content-stable key; a passing or stale run
 * produces nothing (staleness = LIVE_CANARY_STALE_MS, 3h).
 */
import { describe, expect, it } from 'vitest';
import {
  deriveLiveCanaryFinding,
  LIVE_CANARY_STALE_MS,
} from '../../app/lib/posture/findings.ts';

const NOW = Date.parse('2026-07-04T12:00:00.000Z');

function run(overrides = {}) {
  return {
    status: 'fail',
    finished_at: new Date(NOW - 10 * 60 * 1000).toISOString(), // 10 min ago
    checks: [
      { id: 'marketing-home', title: 'Marketing homepage', status: 'pass' },
      { id: 'mcp-handshake', title: 'Hosted MCP handshake', status: 'fail' },
      { id: 'trial-connect', title: 'Trial /connect', status: 'fail' },
    ],
    ...overrides,
  };
}

describe('deriveLiveCanaryFinding (v3.4)', () => {
  it('derives one auditability finding from a fresh failed run', () => {
    const f = deriveLiveCanaryFinding(run(), NOW);
    expect(f).not.toBeNull();
    expect(f.dimension).toBe('auditability');
    expect(f.severity).toBe('high');
    expect(f.title).toBe('Live host canary failing: 2 public surfaces');
    expect(f.evidence.observedCount).toBe(2);
    expect(f.fix).toEqual({ type: 'view_live_canary', deepLink: '/setup#live-canary' });
    expect(f.status).toBe('open');
  });

  it('uses a content-stable key so stored snooze/accept_risk states survive re-derivation', () => {
    const a = deriveLiveCanaryFinding(run(), NOW);
    const b = deriveLiveCanaryFinding(run({
      checks: [{ id: 'other', title: 'Other probe', status: 'fail' }],
      finished_at: new Date(NOW - 60 * 1000).toISOString(),
    }), NOW);
    expect(a.key).toBe(b.key);
  });

  it('returns null for a passing run, no run, or a stale failure', () => {
    expect(deriveLiveCanaryFinding(run({ status: 'pass' }), NOW)).toBeNull();
    expect(deriveLiveCanaryFinding(null, NOW)).toBeNull();
    const stale = run({
      finished_at: new Date(NOW - LIVE_CANARY_STALE_MS - 1000).toISOString(),
    });
    expect(deriveLiveCanaryFinding(stale, NOW)).toBeNull();
  });

  it('singularizes the title for one failing surface', () => {
    const one = run({ checks: [{ id: 'x', title: 'X', status: 'fail' }] });
    expect(deriveLiveCanaryFinding(one, NOW).title)
      .toBe('Live host canary failing: 1 public surface');
  });
});
