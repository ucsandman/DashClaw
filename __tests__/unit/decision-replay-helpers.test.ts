import { describe, it, expect } from 'vitest';
import {
  buildTimelineEvents,
  computeAssumptionDrift,
  formatTime,
  getRiskColor,
  getStatusVariant,
} from '../../app/decisions/[actionId]/_components/helpers';

// Pins the pure logic extracted from the Decision Replay page (v4.72.0
// decomposition): event ordering, the 40/70 risk bands, and drift math.

describe('buildTimelineEvents', () => {
  const action = {
    timestamp_start: '2026-07-01T10:00:00Z',
    timestamp_end: '2026-07-01T10:05:00Z',
  };

  it('returns [] when action is missing', () => {
    expect(buildTimelineEvents({
      action: null, guardDecision: null, messages: [], assumptions: [], loops: []
    })).toEqual([]);
  });

  it('emits every event type and sorts chronologically', () => {
    const events = buildTimelineEvents({
      action,
      guardDecision: { created_at: '2026-07-01T09:59:00Z', decision: 'allow' },
      messages: [{ id: 'm1', created_at: '2026-07-01T10:01:00Z' }],
      assumptions: [{ assumption_id: 'a1', created_at: '2026-07-01T10:02:00Z' }],
      loops: [{ loop_id: 'l1', created_at: '2026-07-01T10:06:00Z' }],
    });
    expect(events.map(e => e.type)).toEqual([
      'guard', 'action_start', 'message', 'assumption', 'outcome', 'open_loop',
    ]);
  });

  it('falls back to action timestamps when assumption/loop dates are missing', () => {
    const events = buildTimelineEvents({
      action,
      guardDecision: null,
      messages: [],
      assumptions: [{ assumption_id: 'a1' }],
      loops: [{ loop_id: 'l1' }],
    });
    const assumption = events.find(e => e.type === 'assumption');
    const loop = events.find(e => e.type === 'open_loop');
    expect(assumption?.timestamp).toBe(action.timestamp_start);
    expect(loop?.timestamp).toBe(action.timestamp_end);
  });

  it('omits start/outcome events when the action has no timestamps', () => {
    const events = buildTimelineEvents({
      action: {}, guardDecision: null, messages: [], assumptions: [], loops: []
    });
    expect(events).toEqual([]);
  });
});

describe('getRiskColor (40/70 bands)', () => {
  it('is red at 70+', () => {
    expect(getRiskColor(70)).toContain('text-error');
    expect(getRiskColor('95')).toContain('text-error');
  });
  it('is amber at 40-69', () => {
    expect(getRiskColor(40)).toContain('text-warning');
    expect(getRiskColor(69)).toContain('text-warning');
  });
  it('is green below 40 and for unscored values', () => {
    expect(getRiskColor(39)).toContain('text-success');
    expect(getRiskColor(null)).toContain('text-success');
    expect(getRiskColor(undefined)).toContain('text-success');
  });
});

describe('getStatusVariant', () => {
  it('maps known statuses', () => {
    expect(getStatusVariant('completed')).toBe('success');
    expect(getStatusVariant('failed')).toBe('error');
    expect(getStatusVariant('blocked')).toBe('error');
    expect(getStatusVariant('running')).toBe('warning');
    expect(getStatusVariant('pending')).toBe('info');
  });
  it('defaults unknown statuses', () => {
    expect(getStatusVariant('weird')).toBe('default');
  });
});

describe('computeAssumptionDrift', () => {
  it('returns null with no assumptions', () => {
    expect(computeAssumptionDrift([])).toBeNull();
  });
  it('labels zero drift Nominal', () => {
    const d = computeAssumptionDrift([{ validated: true }, {}]);
    expect(d).toMatchObject({ invalidated: 0, driftPct: 0, label: 'Nominal', tone: 'text-success' });
  });
  it('labels <34% Low, <67% Elevated, otherwise High', () => {
    expect(computeAssumptionDrift([{ invalidated: true }, {}, {}])?.label).toBe('Low');       // 33%
    expect(computeAssumptionDrift([{ invalidated: true }, {}])?.label).toBe('Elevated');      // 50%
    expect(computeAssumptionDrift([{ invalidated: true }, { invalidated: true }])?.label).toBe('High'); // 100%
  });
  it('carries matching tone and bar classes', () => {
    const high = computeAssumptionDrift([{ invalidated: true }]);
    expect(high?.tone).toBe('text-error');
    expect(high?.bar).toBe('bg-status-error');
  });
});

describe('formatTime', () => {
  it('renders -- for missing timestamps', () => {
    expect(formatTime(null)).toBe('--');
    expect(formatTime(undefined)).toBe('--');
    expect(formatTime('')).toBe('--');
  });
  it('formats a valid ISO timestamp', () => {
    expect(formatTime('2026-07-01T10:00:00Z')).toMatch(/Jul/);
  });
});
