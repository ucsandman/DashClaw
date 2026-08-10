// DashClaw Pulse — invariant matrix for the pure view-model composition.
// Spec: docs/decisions/2026-08-09-widget-pulse.md §4 (posture precedence),
// §8 (honesty rules), §11 (required invariants). Honesty that is not tested
// is decoration — every rule the spec calls an invariant is asserted here.

import { describe, it, expect } from 'vitest';
import {
  composePulse,
  computeFreshness,
  budgetMsForRisk,
  dwellRatio,
  truncateWords,
  baselineKindForEvent,
  FRESH_MS,
  STALE_MS,
  DATA_STALE_MS,
} from '../../app/lib/widget/pulse';

const NOW = Date.UTC(2026, 7, 9, 18, 0, 0);
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const MIN = 60_000;

function snapshot(overrides = {}) {
  return {
    asOf: iso(0),
    windowMinutes: 60,
    pending: { count: 0, rows: [] },
    signals: { red: 0, amber: 0, top: null },
    agents: { activeCount: 2, lastActiveAt: iso(5 * MIN) },
    lastActionAt: iso(5 * MIN),
    recentActionCount: 3,
    queriesDegraded: [],
    presence: { verdict: 'live', frameAgeSeconds: 3 },
    ...overrides,
  };
}

function fresh(data) {
  return { data, lastDataAt: NOW - 1000, lastTransportAt: NOW - 1000, sseUnhealthy: false };
}

function pendingRow(overrides = {}) {
  return {
    actionId: 'act_1',
    actionType: 'db_migrate',
    agentName: 'atlas',
    riskScore: 50,
    timestampStart: iso(6 * MIN),
    declaredGoal: 'migrate the schema',
    ...overrides,
  };
}

describe('posture precedence (spec §4)', () => {
  it('active fleet with nothing owed is ACTIVE with a solid dash', () => {
    const view = composePulse(fresh(snapshot()), NOW);
    expect(view.posture).toBe('active');
    expect(view.glyph.kind).toBe('dash-solid');
    expect(view.ring.breathe).toBe(false);
  });

  it('no action in 15 min but evidence in window is CALM', () => {
    const view = composePulse(
      fresh(snapshot({ lastActionAt: iso(20 * MIN), agents: { activeCount: 0, lastActiveAt: iso(20 * MIN) } })),
      NOW,
    );
    expect(view.posture).toBe('calm');
    expect(view.glyph.kind).toBe('dash-solid');
    expect(view.caption).toContain('all clear');
  });

  it('R1: pending approvals own the glyph for EVERY red-signal count', () => {
    for (const red of [0, 1, 2, 5, 9]) {
      const view = composePulse(
        fresh(
          snapshot({
            pending: { count: 2, rows: [pendingRow()] },
            signals: { red, amber: 0, top: red ? { severity: 'red', kind: 'heartbeat-lost', label: 'x' } : null },
          }),
        ),
        NOW,
      );
      expect(view.posture).toBe('owed-approval');
      expect(view.glyph.kind).toBe('count');
      expect(view.glyph.text).toBe('2');
    }
  });

  it('R2: displaced red signals render as the rail, never silent', () => {
    const view = composePulse(
      fresh(
        snapshot({
          pending: { count: 1, rows: [pendingRow()] },
          signals: { red: 2, amber: 0, top: { severity: 'red', kind: 'heartbeat-lost', label: 'x' } },
        }),
      ),
      NOW,
    );
    expect(view.rail).toEqual({ severity: 'red', count: 2 });
    expect(view.reveal.signalLine).toContain('2 red signals unreviewed');
  });

  it('R2: when signals own the glyph the rail is not drawn (no double-encoding)', () => {
    const view = composePulse(
      fresh(snapshot({ signals: { red: 2, amber: 0, top: { severity: 'red', kind: 'heartbeat-lost', label: 'x' } } })),
      NOW,
    );
    expect(view.posture).toBe('owed-signal');
    expect(view.glyph.kind).toBe('count-signal');
    expect(view.rail).toBeNull();
  });

  it('R3: amber never owns the ring or escalates posture; rail has no count', () => {
    const view = composePulse(
      fresh(snapshot({ signals: { red: 0, amber: 3, top: { severity: 'amber', kind: 'stalled-decision', label: 'x' } } })),
      NOW,
    );
    expect(view.posture).toBe('active');
    expect(view.ring.breathe).toBe(false);
    expect(view.rail).toEqual({ severity: 'amber', count: null });
  });

  it('R4: presence never drives the ring — a stale frame pipeline is a notch, not a caution', () => {
    const view = composePulse(fresh(snapshot({ presence: { verdict: 'stale', frameAgeSeconds: 74 } })), NOW);
    expect(view.posture).toBe('active');
    expect(view.ring.breathe).toBe(false);
    expect(view.presence.notch).toBe('warning-filled');
    expect(view.presence.line).toContain('frame 74s');
  });
});

describe('dwell escalation (spec §4)', () => {
  it('risk-scaled budgets: 5m / 20m / 60m', () => {
    expect(budgetMsForRisk(88)).toBe(5 * MIN);
    expect(budgetMsForRisk(70)).toBe(5 * MIN);
    expect(budgetMsForRisk(55)).toBe(20 * MIN);
    expect(budgetMsForRisk(40)).toBe(20 * MIN);
    expect(budgetMsForRisk(10)).toBe(60 * MIN);
  });

  it('inside budget: brand ring, no breathe, "held" caption', () => {
    const view = composePulse(
      fresh(snapshot({ pending: { count: 1, rows: [pendingRow({ riskScore: 50, timestampStart: iso(6 * MIN) })] } })),
      NOW,
    );
    expect(view.overdue).toBe(false);
    expect(view.ring.colorVar).toBe('var(--color-brand)');
    expect(view.ring.breathe).toBe(false);
    expect(view.caption).toBe('db_migrate · atlas · held 6m');
  });

  it('past budget: error ring, breathe, "overdue" caption prefix', () => {
    const view = composePulse(
      fresh(snapshot({ pending: { count: 1, rows: [pendingRow({ riskScore: 88, timestampStart: iso(29 * MIN) })] } })),
      NOW,
    );
    expect(view.overdue).toBe(true);
    expect(view.ring.colorVar).toBe('var(--color-error)');
    expect(view.ring.breathe).toBe(true);
    expect(view.caption).toMatch(/^overdue 24m · /);
  });

  it('the highest dwell RATIO owns the caption, not the oldest row', () => {
    const risky = pendingRow({ actionId: 'a', actionType: 'deploy_prod', riskScore: 92, timestampStart: iso(4 * MIN) });
    const idle = pendingRow({ actionId: 'b', actionType: 'read_docs', riskScore: 15, timestampStart: iso(25 * MIN) });
    expect(dwellRatio(risky, NOW)).toBeGreaterThan(dwellRatio(idle, NOW));
    const view = composePulse(fresh(snapshot({ pending: { count: 2, rows: [idle, risky] } })), NOW);
    expect(view.caption).toContain('deploy_prod');
    expect(view.reveal.rows[0].actionType).toBe('deploy_prod');
  });

  it('a queue (>=5) reads as a queue, not a single row', () => {
    const rows = [1, 2, 3, 4, 5].map((i) => pendingRow({ actionId: `a${i}`, timestampStart: iso(i * MIN) }));
    const view = composePulse(fresh(snapshot({ pending: { count: 5, rows } })), NOW);
    expect(view.caption).toBe('5 waiting · oldest 5m');
  });
});

describe('honesty rules (spec §8)', () => {
  it('H1: the solid dash REQUIRES pending=0, red=0, heartbeat evidence, no degraded queries', () => {
    // The invariant, asserted over a matrix: solid-dash implies all four.
    const cases = [];
    for (const pending of [0, 1]) {
      for (const red of [0, 1]) {
        for (const evidence of [true, false]) {
          for (const degraded of [[], ['pending']]) {
            cases.push({ pending, red, evidence, degraded });
          }
        }
      }
    }
    for (const c of cases) {
      const view = composePulse(
        fresh(
          snapshot({
            pending: { count: c.pending, rows: c.pending ? [pendingRow()] : [] },
            signals: { red: c.red, amber: 0, top: c.red ? { severity: 'red', kind: 'k', label: 'l' } : null },
            lastActionAt: c.evidence ? iso(5 * MIN) : null,
            agents: { activeCount: 0, lastActiveAt: c.evidence ? iso(5 * MIN) : null },
            queriesDegraded: c.degraded,
          }),
        ),
        NOW,
      );
      const impliesClean = c.pending === 0 && c.red === 0 && c.evidence && c.degraded.length === 0;
      expect(view.glyph.kind === 'dash-solid', JSON.stringify(c)).toBe(impliesClean);
    }
  });

  it('a quiet fleet with no evidence in the window is UNCONFIRMED and renders weaker', () => {
    const view = composePulse(
      fresh(snapshot({ lastActionAt: iso(3 * 60 * MIN), agents: { activeCount: 0, lastActiveAt: iso(3 * 60 * MIN) } })),
      NOW,
    );
    expect(view.posture).toBe('unconfirmed');
    expect(view.glyph.kind).toBe('dash-hollow');
    expect(view.ring.dashed).toBe(true);
    expect(view.caption).toBe('no agent check-in · 60m+'); // H6 window clamp
  });

  it('H5: a failed sub-query is DEGRADED, never a zero', () => {
    const view = composePulse(fresh(snapshot({ queriesDegraded: ['pending'] })), NOW);
    expect(view.posture).toBe('degraded');
    expect(view.glyph.kind).toBe('dash-hatched');
    expect(view.caption).toBe("can't confirm approval queue");
  });

  it('H3: drifting feed annotates the caption without changing posture', () => {
    const state = {
      data: snapshot(),
      lastDataAt: NOW - (FRESH_MS + 6_000),
      lastTransportAt: NOW - (FRESH_MS + 6_000),
      sseUnhealthy: false,
    };
    const view = composePulse(state, NOW);
    expect(view.posture).toBe('active');
    expect(view.caption).toMatch(/· unconfirmed 41s$/);
  });

  it('H3: >90s of silence is a STALE takeover, past tense, wall-clock stamped', () => {
    const state = {
      data: snapshot(),
      lastDataAt: NOW - (STALE_MS + 30_000),
      lastTransportAt: NOW - (STALE_MS + 30_000),
      sseUnhealthy: false,
    };
    const view = composePulse(state, NOW);
    expect(view.posture).toBe('stale');
    expect(view.hatch).toBe(true);
    expect(view.caption).toMatch(/^link lost 2m · last confirmed \d{2}:\d{2}$/);
  });

  it('H4: a live transport cannot resurrect old data — stale data stays STALE', () => {
    const state = {
      data: snapshot(),
      lastDataAt: NOW - (DATA_STALE_MS + 10_000),
      lastTransportAt: NOW - 1_000, // heartbeats flowing again
      sseUnhealthy: false,
    };
    expect(computeFreshness(state, NOW)).toBe('stale');
    expect(composePulse(state, NOW).posture).toBe('stale');
  });

  it('STALE outranks an owed approval in the payload — old obligations are not repainted as live', () => {
    const state = {
      data: snapshot({ pending: { count: 3, rows: [pendingRow()] } }),
      lastDataAt: NOW - (STALE_MS + 60_000),
      lastTransportAt: null,
      sseUnhealthy: true,
    };
    const view = composePulse(state, NOW);
    expect(view.posture).toBe('stale');
    expect(view.title).toBe('? DashClaw');
  });

  it('H7: loading is the resting mark at 30% opacity, no caption', () => {
    const view = composePulse({ data: null, lastDataAt: null, lastTransportAt: null }, NOW);
    expect(view.glyph.opacity).toBe(0.3);
    expect(view.caption).toBe('');
  });

  it('first run with no governed action ever says so', () => {
    const state = fresh(
      snapshot({ lastActionAt: null, agents: { activeCount: 0, lastActiveAt: null }, recentActionCount: 0 }),
    );
    const view = composePulse(state, NOW);
    expect(view.posture).toBe('unconfirmed');
    expect(view.caption).toBe('waiting for first governed action');
  });
});

describe('presence (spec §7 — never fake live)', () => {
  it('P1: an absent verdict is unknown, never live', () => {
    const view = composePulse(fresh(snapshot({ presence: undefined })), NOW);
    expect(view.presence.notch).toBe('outline-dashed');
    expect(view.presence.aria).toBe('desktop presence unknown');
  });

  it('live renders NO notch — absence is the report — but aria still carries it', () => {
    const view = composePulse(fresh(snapshot({ presence: { verdict: 'live', frameAgeSeconds: 2 } })), NOW);
    expect(view.presence.notch).toBe('none');
    expect(view.presence.line).toBeNull();
    expect(view.presence.aria).toBe('desktop presence live');
  });

  it('unknown renders weaker than known-bad (dashed outline vs filled warning)', () => {
    const unknown = composePulse(fresh(snapshot({ presence: { verdict: 'unknown', frameAgeSeconds: null } })), NOW);
    const stale = composePulse(fresh(snapshot({ presence: { verdict: 'stale', frameAgeSeconds: 30 } })), NOW);
    expect(unknown.presence.notch).toBe('outline-dashed');
    expect(stale.presence.notch).toBe('warning-filled');
  });
});

describe('privacy (non-goal #6)', () => {
  it('no rendered string carries an untruncated declared_goal or any signal detail', () => {
    const longGoal = 'x'.repeat(500);
    const view = composePulse(
      fresh(
        snapshot({
          pending: { count: 1, rows: [pendingRow({ declaredGoal: longGoal })] },
          signals: { red: 1, amber: 0, top: { severity: 'red', kind: 'k', label: 'l'.repeat(300) } },
        }),
      ),
      NOW,
    );
    const rendered = JSON.stringify([view.caption, view.reveal]);
    expect(rendered).not.toContain(longGoal);
    expect(rendered).not.toContain('l'.repeat(100));
  });

  it('truncateWords cuts on a word boundary with an explicit ellipsis', () => {
    expect(truncateWords('Ungoverned high-risk decision: deploy the payment service', 40)).toMatch(/…$/);
    expect(truncateWords('short', 40)).toBe('short');
    const t = truncateWords('alpha beta gamma delta epsilon', 20);
    expect(t.length).toBeLessThanOrEqual(20);
    expect(t).not.toMatch(/ …$/); // no trailing space before the ellipsis
    expect(t).toBe('alpha beta gamma…');
  });
});

describe('title + favicon (the doorbell reaches behind the poker table)', () => {
  it('maps posture to the four document.title forms', () => {
    expect(composePulse(fresh(snapshot()), NOW).title).toBe('— DashClaw');
    expect(
      composePulse(fresh(snapshot({ pending: { count: 2, rows: [pendingRow()] } })), NOW).title,
    ).toBe('2 · DashClaw');
    expect(
      composePulse(
        fresh(snapshot({ signals: { red: 1, amber: 0, top: { severity: 'red', kind: 'k', label: 'l' } } })),
        NOW,
      ).title,
    ).toBe('! DashClaw');
    expect(composePulse({ data: null, lastDataAt: null, lastTransportAt: null }, NOW).title).toBe('? DashClaw');
  });
});

describe('baseline strip event mapping (spec §5.4)', () => {
  it('maps event kinds to colors; unknown events map to null', () => {
    expect(baselineKindForEvent('action.updated', { status: 'completed' })).toBe('success');
    expect(baselineKindForEvent('action.updated', { outcome_status: 'failure' })).toBe('error');
    expect(baselineKindForEvent('action.created', { status: 'pending_approval' })).toBe('brand');
    expect(baselineKindForEvent('action.created', { status: 'completed' })).toBe('info');
    expect(baselineKindForEvent('guard.decision.created', { decision: 'block' })).toBe('brand');
    expect(baselineKindForEvent('signal.detected', {})).toBe('warning');
    expect(baselineKindForEvent('decision.created', {})).toBe('info');
    expect(baselineKindForEvent('heartbeat', null)).toBeNull();
  });
});
