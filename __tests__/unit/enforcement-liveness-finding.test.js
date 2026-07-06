/**
 * v8.2 enforcement liveness — posture enforcement finding derivation.
 *
 * Pins the acceptance semantics: a fresh 'held' run produces no finding, a
 * fresh 'executed'/'unprovable' run produces one critical finding, and a
 * stale run (no report in ENFORCEMENT_LIVENESS_STALE_MS) produces one
 * warn-level finding — unlike the live canary, staleness is NOT silent here,
 * because a probe that stopped running is the exact v4.72.1 failure shape.
 */
import { describe, expect, it } from 'vitest';
import {
  deriveEnforcementLivenessFinding,
} from '../../app/lib/posture/findings.ts';
import { ENFORCEMENT_LIVENESS_STALE_MS } from '../../app/lib/repositories/enforcement-liveness.repository.ts';

const NOW = Date.parse('2026-07-06T12:00:00.000Z');

function run(overrides = {}) {
  return {
    verdict: 'held',
    detail: 'Held as expected.',
    finished_at: new Date(NOW - 10 * 60 * 1000).toISOString(), // 10 min ago
    ...overrides,
  };
}

describe('deriveEnforcementLivenessFinding (v8.2)', () => {
  it('returns null for a fresh held run (holding)', () => {
    expect(deriveEnforcementLivenessFinding(run(), NOW)).toBeNull();
  });

  it('returns null when there is no run yet (mirrors the live-canary "no signal" convention)', () => {
    expect(deriveEnforcementLivenessFinding(null, NOW)).toBeNull();
  });

  it('derives a critical finding when the probe action executed (broken)', () => {
    const f = deriveEnforcementLivenessFinding(run({ verdict: 'executed', detail: 'The held action executed.' }), NOW);
    expect(f).not.toBeNull();
    expect(f.dimension).toBe('enforcement');
    expect(f.severity).toBe('critical');
    expect(f.fix).toEqual({ type: 'view_coverage', deepLink: '/setup#enforcement-liveness' });
    expect(f.status).toBe('open');
  });

  it('derives a critical finding when the probe outcome is unprovable (broken)', () => {
    const f = deriveEnforcementLivenessFinding(run({ verdict: 'unprovable' }), NOW);
    expect(f).not.toBeNull();
    expect(f.severity).toBe('critical');
  });

  it('derives a warn-level (high severity) finding for a stale probe', () => {
    const stale = run({
      finished_at: new Date(NOW - ENFORCEMENT_LIVENESS_STALE_MS - 1000).toISOString(),
    });
    const f = deriveEnforcementLivenessFinding(stale, NOW);
    expect(f).not.toBeNull();
    expect(f.severity).toBe('high');
    expect(f.title).toBe('Enforcement-liveness probe has not reported in 24h');
  });

  it('uses a content-stable key across broken runs so snooze/accept_risk states survive re-derivation', () => {
    const a = deriveEnforcementLivenessFinding(run({ verdict: 'executed' }), NOW);
    const b = deriveEnforcementLivenessFinding(run({ verdict: 'unprovable', detail: 'different detail' }), NOW);
    expect(a.key).toBe(b.key);
  });

  it('a stale finding key is distinct from a broken finding key', () => {
    const broken = deriveEnforcementLivenessFinding(run({ verdict: 'executed' }), NOW);
    const stale = deriveEnforcementLivenessFinding(
      run({ finished_at: new Date(NOW - ENFORCEMENT_LIVENESS_STALE_MS - 1000).toISOString() }),
      NOW,
    );
    expect(broken.key).not.toBe(stale.key);
  });
});
