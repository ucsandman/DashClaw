/**
 * v8.3 silent-lane witness — pure derivation tests.
 *
 * Pins the spec's activity/witness matrix (docs/plans/2026-08-06-silent-lane-witness-spec.md):
 *   present/present -> governed
 *   present/absent  -> recorded-ungoverned (the alarm state)
 *   absent/absent   -> quiet
 *   absent/present  -> governed (witness implies activity)
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  deriveSilentLaneWitnessState,
  getWitnessWindowMinutes,
  SILENT_LANE_WITNESS_DEFAULT_WINDOW_MINUTES,
  SILENT_LANE_WITNESS_MAX_WINDOW_MINUTES,
  SILENT_LANE_WITNESS_MIN_WINDOW_MINUTES,
  type AgentLaneWitnessLike,
} from '../../app/lib/silent-lane-witness';

const NOW = Date.parse('2026-08-06T12:00:00.000Z');
const WINDOW_MIN = 60;

function agent(overrides: Partial<AgentLaneWitnessLike> = {}): AgentLaneWitnessLike {
  return {
    agentId: 'agent_moltfire',
    lastActivityAt: null,
    lastActivitySource: null,
    lastWitnessAt: null,
    ...overrides,
  };
}

function minutesAgo(mins: number): string {
  return new Date(NOW - mins * 60_000).toISOString();
}

describe('deriveSilentLaneWitnessState — the four table rows (v8.3)', () => {
  it('present/present -> governed', () => {
    const a = agent({ lastActivityAt: minutesAgo(5), lastWitnessAt: minutesAgo(3) });
    const r = deriveSilentLaneWitnessState(a, WINDOW_MIN, NOW);
    expect(r.state).toBe('governed');
  });

  it('present/absent -> recorded-ungoverned (the alarm state)', () => {
    const a = agent({ lastActivityAt: minutesAgo(5), lastActivitySource: 'codex-notify', lastWitnessAt: null });
    const r = deriveSilentLaneWitnessState(a, WINDOW_MIN, NOW);
    expect(r.state).toBe('recorded-ungoverned');
    expect(r.lastActivitySource).toBe('codex-notify');
  });

  it('absent/absent -> quiet (no claim either way)', () => {
    const a = agent({ lastActivityAt: null, lastWitnessAt: null });
    const r = deriveSilentLaneWitnessState(a, WINDOW_MIN, NOW);
    expect(r.state).toBe('quiet');
  });

  it('absent/present -> governed (witness implies activity)', () => {
    const a = agent({ lastActivityAt: null, lastWitnessAt: minutesAgo(10) });
    const r = deriveSilentLaneWitnessState(a, WINDOW_MIN, NOW);
    expect(r.state).toBe('governed');
  });
});

describe('deriveSilentLaneWitnessState — window boundary', () => {
  it('a witness exactly at the window edge still clears the alarm (inclusive)', () => {
    const a = agent({
      lastActivityAt: minutesAgo(5),
      lastWitnessAt: new Date(NOW - WINDOW_MIN * 60_000).toISOString(), // exactly at the edge
    });
    const r = deriveSilentLaneWitnessState(a, WINDOW_MIN, NOW);
    expect(r.state).toBe('governed');
  });

  it('a witness one tick past the window edge reads as no witness -> recorded-ungoverned', () => {
    const a = agent({
      lastActivityAt: minutesAgo(5),
      lastWitnessAt: new Date(NOW - WINDOW_MIN * 60_000 - 1).toISOString(), // 1ms past the edge
    });
    const r = deriveSilentLaneWitnessState(a, WINDOW_MIN, NOW);
    expect(r.state).toBe('recorded-ungoverned');
  });

  it('activity exactly at the window edge still counts as activity', () => {
    const a = agent({ lastActivityAt: new Date(NOW - WINDOW_MIN * 60_000).toISOString(), lastWitnessAt: null });
    const r = deriveSilentLaneWitnessState(a, WINDOW_MIN, NOW);
    expect(r.state).toBe('recorded-ungoverned');
  });

  it('activity one tick past the window edge is stale -> quiet, not an alarm', () => {
    const a = agent({ lastActivityAt: new Date(NOW - WINDOW_MIN * 60_000 - 1).toISOString(), lastWitnessAt: null });
    const r = deriveSilentLaneWitnessState(a, WINDOW_MIN, NOW);
    expect(r.state).toBe('quiet');
  });
});

describe('deriveSilentLaneWitnessState — mixed activity sources', () => {
  it('state depends only on presence, not on which self-report channel produced it', () => {
    const notify = agent({ agentId: 'a1', lastActivityAt: minutesAgo(1), lastActivitySource: 'codex-notify' });
    const sdk = agent({ agentId: 'a2', lastActivityAt: minutesAgo(1), lastActivitySource: 'sdk-self-report' });
    const rNotify = deriveSilentLaneWitnessState(notify, WINDOW_MIN, NOW);
    const rSdk = deriveSilentLaneWitnessState(sdk, WINDOW_MIN, NOW);
    expect(rNotify.state).toBe('recorded-ungoverned');
    expect(rSdk.state).toBe('recorded-ungoverned');
    expect(rNotify.lastActivitySource).toBe('codex-notify');
    expect(rSdk.lastActivitySource).toBe('sdk-self-report');
  });

  it('a governed agent carries its activity source through even though witness decided the state', () => {
    const a = agent({ lastActivityAt: minutesAgo(10), lastActivitySource: 'codex-notify', lastWitnessAt: minutesAgo(2) });
    const r = deriveSilentLaneWitnessState(a, WINDOW_MIN, NOW);
    expect(r.state).toBe('governed');
    expect(r.lastActivitySource).toBe('codex-notify');
  });
});

describe('getWitnessWindowMinutes — DASHCLAW_WITNESS_WINDOW_MINUTES', () => {
  const ORIGINAL = process.env.DASHCLAW_WITNESS_WINDOW_MINUTES;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.DASHCLAW_WITNESS_WINDOW_MINUTES;
    else process.env.DASHCLAW_WITNESS_WINDOW_MINUTES = ORIGINAL;
  });

  it('defaults to 60 when unset', () => {
    delete process.env.DASHCLAW_WITNESS_WINDOW_MINUTES;
    expect(getWitnessWindowMinutes()).toBe(SILENT_LANE_WITNESS_DEFAULT_WINDOW_MINUTES);
  });

  it('reads a valid override', () => {
    process.env.DASHCLAW_WITNESS_WINDOW_MINUTES = '120';
    expect(getWitnessWindowMinutes()).toBe(120);
  });

  it('clamps below the floor and above the ceiling', () => {
    process.env.DASHCLAW_WITNESS_WINDOW_MINUTES = '0';
    expect(getWitnessWindowMinutes()).toBe(SILENT_LANE_WITNESS_DEFAULT_WINDOW_MINUTES);
    process.env.DASHCLAW_WITNESS_WINDOW_MINUTES = '1';
    expect(getWitnessWindowMinutes()).toBe(SILENT_LANE_WITNESS_MIN_WINDOW_MINUTES);
    process.env.DASHCLAW_WITNESS_WINDOW_MINUTES = '999999';
    expect(getWitnessWindowMinutes()).toBe(SILENT_LANE_WITNESS_MAX_WINDOW_MINUTES);
  });

  it('falls back on a non-numeric value', () => {
    process.env.DASHCLAW_WITNESS_WINDOW_MINUTES = 'not-a-number';
    expect(getWitnessWindowMinutes()).toBe(SILENT_LANE_WITNESS_DEFAULT_WINDOW_MINUTES);
  });
});
