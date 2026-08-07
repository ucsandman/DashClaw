/**
 * v8.3 silent-lane witness — posture finding derivation.
 *
 * Pins the F5 guardrail semantics: the finding is a v3.1 collapse (one
 * finding lists every offending agent), scoreDelta is fixed display weight
 * at 'medium' severity — below the canary/coverage findings (both 'high')
 * and well below the enforcement-liveness findings ('high'/'critical') —
 * because a recorded-ungoverned lane is a known standing posture, not a
 * fresh alarm.
 */
import { describe, expect, it } from 'vitest';
import {
  deriveSilentLaneWitnessFinding,
  SILENT_LANE_WITNESS_SCORE_DELTA,
  type AgentLaneWitnessLike,
} from '../../app/lib/posture/findings';

const NOW = Date.parse('2026-08-06T12:00:00.000Z');
const WINDOW_MIN = 60;

function minutesAgo(mins: number): string {
  return new Date(NOW - mins * 60_000).toISOString();
}

function agent(overrides: Partial<AgentLaneWitnessLike> = {}): AgentLaneWitnessLike {
  return {
    agentId: 'agent_1',
    lastActivityAt: null,
    lastActivitySource: null,
    lastWitnessAt: null,
    ...overrides,
  };
}

describe('deriveSilentLaneWitnessFinding (v8.3)', () => {
  it('returns null when no agent is ungoverned', () => {
    const agents = [
      agent({ agentId: 'a1', lastActivityAt: minutesAgo(5), lastWitnessAt: minutesAgo(2) }), // governed
      agent({ agentId: 'a2' }), // quiet
    ];
    expect(deriveSilentLaneWitnessFinding(agents, WINDOW_MIN, NOW)).toBeNull();
  });

  it('returns null for an empty agent list', () => {
    expect(deriveSilentLaneWitnessFinding([], WINDOW_MIN, NOW)).toBeNull();
  });

  it('collapses every recorded-ungoverned agent into one finding (v3.1 collapse)', () => {
    const agents = [
      agent({ agentId: 'moltfire', lastActivityAt: minutesAgo(5), lastActivitySource: 'codex-notify' }),
      agent({ agentId: 'moltfire-2', lastActivityAt: minutesAgo(1), lastActivitySource: 'codex-notify' }),
      agent({ agentId: 'a-governed', lastActivityAt: minutesAgo(5), lastWitnessAt: minutesAgo(1) }),
    ];
    const f = deriveSilentLaneWitnessFinding(agents, WINDOW_MIN, NOW);
    expect(f).not.toBeNull();
    expect(f!.evidence.observedCount).toBe(2);
    expect(f!.title).toBe('2 agents are recorded but ungoverned');
  });

  it('is informational only — dimension enforcement, medium severity, fixed display-weight scoreDelta', () => {
    const agents = [agent({ lastActivityAt: minutesAgo(5) })];
    const f = deriveSilentLaneWitnessFinding(agents, WINDOW_MIN, NOW);
    expect(f).not.toBeNull();
    expect(f!.dimension).toBe('enforcement');
    expect(f!.severity).toBe('medium');
    expect(f!.scoreDelta).toBe(SILENT_LANE_WITNESS_SCORE_DELTA);
    expect(f!.status).toBe('open');
  });

  it('points the fix deep link at the /setup panel', () => {
    const agents = [agent({ lastActivityAt: minutesAgo(5) })];
    const f = deriveSilentLaneWitnessFinding(agents, WINDOW_MIN, NOW);
    expect(f!.fix).toEqual({ type: 'view_coverage', deepLink: '/setup#silent-lane-witness' });
  });

  it('uses a content-stable key so snooze/accept_risk states survive re-derivation', () => {
    const a = deriveSilentLaneWitnessFinding([agent({ agentId: 'x', lastActivityAt: minutesAgo(1) })], WINDOW_MIN, NOW);
    const b = deriveSilentLaneWitnessFinding([agent({ agentId: 'y', lastActivityAt: minutesAgo(2) })], WINDOW_MIN, NOW);
    expect(a!.key).toBe(b!.key);
  });

  it('singular title for exactly one offending agent', () => {
    const f = deriveSilentLaneWitnessFinding([agent({ lastActivityAt: minutesAgo(1) })], WINDOW_MIN, NOW);
    expect(f!.title).toBe('1 agent is recorded but ungoverned');
  });
});
