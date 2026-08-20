import { describe, it, expect } from 'vitest';
import {
  demoSessions, demoSessionDetail, demoSessionEvents, demoSessionActions,
  demoIdentities, demoApiKeys,
  demoActionDetail, demoPolicies, demoApprovalFloods, demoPolicySummary, demoCalibrationController, demoDoctor,
  demoTuningProposals, demoTighteningProposals, demoLooseningProposals, demoCalibrationProposals,
} from '@/lib/demo/demoMiddleware';
import { getDemoFixtures } from '@/lib/demo/demoFixtures';
import { reliefReady, CALIBRATION_DEFAULTS } from '@/lib/guard/calibration';
import { actions as personaActions } from '@/lib/demo/fixtures/persona-agents';

// Minimal fixtures stub — the gap handlers derive agent ids from fixtures.actions
// (with a built-in fallback) and otherwise return self-contained literals.
const fixtures = { actions: [{ agent_id: 'a1' }, { agent_id: 'a2' }] } as any;
const url = (s = 'http://x/api') => new URL(s);

describe('demo gap-page fixtures — non-empty + correctly shaped', () => {
  it('sessions (/api/sessions)', () => {
    const r = demoSessions(fixtures, url());
    expect(r.sessions.length).toBeGreaterThan(0);
    expect(r.sessions[0]!).toMatchObject({ id: expect.any(String), agent_id: expect.any(String), status: expect.any(String), action_count: expect.any(Number) });
  });
  it('identities (/api/identities)', () => {
    const r = demoIdentities(fixtures);
    expect(r.identities.length).toBeGreaterThan(0);
    expect(r.identities[0]!).toMatchObject({ agent_id: expect.any(String), permission_level: expect.any(String) });
  });
  it('api keys (/api/keys)', () => {
    const r = demoApiKeys();
    expect(r.keys.length).toBeGreaterThan(0);
    expect(r.keys[0]!).toMatchObject({ id: expect.any(String), name: expect.any(String), prefix: expect.any(String) });
  });
});

describe('demo session detail trio — /api/sessions/:id{,/events,/actions}', () => {
  it('detail resolves every id the LIST handler returns (clicking a row works)', () => {
    const list = demoSessions(fixtures, url('http://x/api/sessions?limit=100'));
    expect(list.sessions.length).toBeGreaterThan(0);
    for (const s of list.sessions) {
      const detail = demoSessionDetail(fixtures, s.id);
      expect(detail?.session).toMatchObject({ id: s.id, agent_id: s.agent_id, status: s.status });
    }
  });
  it('detail carries the aggregate card fields', () => {
    const d = demoSessionDetail(fixtures, 'sess_demo_1') as any;
    expect(d.session).toMatchObject({
      action_count: expect.any(Number),
      total_cost: expect.any(Number),
      max_risk: expect.any(Number),
      event_count: expect.any(Number),
      workspace: expect.any(String),
    });
  });
  it('actions are paginated and total always equals the "# Actions" card', () => {
    const d = demoSessionDetail(fixtures, 'sess_demo_1') as any;
    const page = demoSessionActions(fixtures, 'sess_demo_1', url('http://x/api?limit=3')) as any;
    expect(page.total).toBe(d.session.action_count);
    expect(page.actions.length).toBe(Math.min(3, page.total));
    expect(page.actions[0]).toMatchObject({
      action_id: expect.any(String), action_type: expect.any(String),
      declared_goal: expect.any(String), risk_score: expect.any(Number),
      cost_estimate: expect.any(Number), created_at: expect.any(String),
    });
    // Newest first, like the live route.
    const sorted = [...page.actions].sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
    expect(page.actions).toEqual(sorted);
    // offset paging never overlaps page one
    const page2 = demoSessionActions(fixtures, 'sess_demo_1', url('http://x/api?limit=3&offset=3')) as any;
    expect(page2.actions.every((a: any) => !page.actions.some((b: any) => b.action_id === a.action_id))).toBe(true);
  });
  it('events form a lifecycle timeline; blocked sessions surface a blocked event', () => {
    const list = demoSessions(fixtures, url('http://x/api/sessions?limit=100'));
    const blocked = list.sessions.find((s: any) => s.status === 'blocked');
    expect(blocked).toBeTruthy();
    const ev = demoSessionEvents(fixtures, blocked!.id) as any;
    expect(ev.events[0]).toMatchObject({ kind: 'spawning', seq: 1 });
    expect(ev.events.some((e: any) => e.kind === 'blocked' && e.detail)).toBe(true);
  });
  it('unknown session ids return null → middleware 404s like the real route', () => {
    expect(demoSessionDetail(fixtures, 'sess_nope')).toBeNull();
    expect(demoSessionEvents(fixtures, 'sess_nope')).toBeNull();
    expect(demoSessionActions(fixtures, 'sess_nope', url())).toBeNull();
  });
});

describe('session actions resolve as decisions — /api/actions/:id for ar_demo_sess_* ids', () => {
  // The reported bug: clicking a session action navigated to
  // /decisions/ar_demo_sess_* and got "decision not found" because the ids
  // existed only in the session ledger, never in the action-detail handler.
  it('every id the session-actions handler returns resolves to a detail', () => {
    const list = demoSessions(fixtures, url('http://x/api/sessions?limit=100'));
    for (const s of list.sessions) {
      const page = demoSessionActions(fixtures, s.id, url('http://x/api?limit=200')) as any;
      for (const a of page.actions) {
        const detail = demoActionDetail(fixtures, a.action_id) as any;
        expect(detail, `detail for ${a.action_id}`).toBeTruthy();
        expect(detail.action).toMatchObject({ action_id: a.action_id, agent_id: s.agent_id });
        expect(['allow', 'require_approval']).toContain(detail.decision);
      }
    }
  });
  it('malformed session-action ids return null → 404, not a crash', () => {
    expect(demoActionDetail(fixtures, 'ar_demo_sess_bogus')).toBeNull();
    expect(demoActionDetail(fixtures, 'ar_demo_sess_9999_1')).toBeNull();
  });
});

describe('demo workbench fixtures — /policies, /calibration, /doctor', () => {
  const real = getDemoFixtures() as any;

  it('policy summary (/api/policies/summary) is governed and shaped for PostureHero', () => {
    const s = demoPolicySummary(real);
    expect(s.governed).toBe(true);
    expect(s.primaryMode).toMatchObject({ id: expect.any(String), name: expect.any(String) });
    expect(s.enforcement.total).toBeGreaterThan(0);
    expect(s.enforcement.total).toBe(s.rules.length);
    expect(s.rules[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), bucket: expect.any(String), fired30d: expect.any(Number) });
    expect(s.shields.length).toBeGreaterThan(0);
    expect(s.shields.some((sh) => sh.on)).toBe(true);
    expect(s.decisions30d.total).toBeGreaterThan(0);
    expect(s.agents.total).toBeGreaterThan(0);
    // Short List + budget report: the /policies rewrite reads these off the
    // summary, so an empty demo response would render an empty page.
    expect(s.shortListCap).toBe(10);
    expect(s.shortList.length).toBeGreaterThan(0);
    expect(s.shortList.length).toBeLessThanOrEqual(10);
    expect(s.shortList[0]).toMatchObject({
      id: expect.any(String), name: expect.any(String), tier: expect.any(String),
      policy_type: expect.any(String), scope: expect.any(String), fired30d: expect.any(Number),
      ungrantable: expect.any(Boolean), shape_exceptions: expect.any(Array),
      active: expect.any(Boolean), seeded: expect.any(Boolean),
    });
    expect(Array.isArray(s.suggestions)).toBe(true);
    expect(s.budgetReport).toMatchObject({
      policiesOverBudget: expect.any(Number), shapesOverBudget: expect.any(Number),
      window_hours: 24, budget: expect.any(Number), shape_budget: expect.any(Number),
    });
  });

  it('approval floods (/api/approvals/floods) trip a real rule so the banner renders', () => {
    const r = demoApprovalFloods(real) as any;
    // ApprovalFloodBanner returns null on an empty list, so "shaped correctly but
    // empty" is indistinguishable from the 403 this entry exists to replace.
    expect(r.floods.length).toBeGreaterThan(0);
    const flood = r.floods[0];
    expect(flood).toMatchObject({
      policy_id: expect.any(String), name: expect.any(String),
      count: expect.any(Number), tripped_at: expect.any(String),
    });
    // A flood under the budget is not a flood — the banner would claim an alarm
    // the numbers it prints right next to it don't support.
    expect(flood.count).toBeGreaterThan(r.budget.perPolicy);
    expect(r.budget.windowMin).toBeGreaterThan(0);
    // The banner names the rule and its Pause button PATCHes this id, so a
    // visitor clicking through to /policies has to find it actually there.
    const { policies } = demoPolicies(real) as any;
    expect(policies.map((p: any) => p.id)).toContain(flood.policy_id);
    expect(policies.find((p: any) => p.id === flood.policy_id).name).toBe(flood.name);
  });

  it('policies (/api/policies) answer in guard_policies column shape for the Ledger', () => {
    const { policies } = demoPolicies(real) as any;
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) {
      expect(p.policy_type, `policy ${p.name}`).toEqual(expect.any(String));
      expect(p.rules).toBeDefined();
      expect([0, 1]).toContain(p.active);
    }
  });

  it('calibration controller (/api/calibration/controller) matches the page contract', () => {
    const c = demoCalibrationController(real);
    expect(['off', 'shadow', 'active']).toContain(c.settings.mode);
    expect(c.state.labeled_total).toBe(c.events.length);
    expect(c.state.loss_sum).toBe(c.events.filter((e) => e.loss).length);
    expect(c.state.theta).toBe(c.events[0]!.theta_after);
    expect(c.events[0]).toMatchObject({ agent_id: expect.any(String), risk_score: expect.any(Number), label: expect.any(String), created_at: expect.any(String) });
    // relief_ready is a three-gate answer in the real route (total labels,
    // LIVE labels, ceiling). A fixture that computes its own version drifts
    // and promises relief the engine would refuse.
    expect(c.state.labeled_live).toBe(c.events.length);
    expect(c.state.relief_ready).toBe(reliefReady({
      labeledTotal: c.state.labeled_total,
      labeledLive: c.state.labeled_live,
      reliefCeiling: c.state.relief_ceiling,
    }));
    expect(c.defaults.relief_min_live_labels).toBe(CALIBRATION_DEFAULTS.reliefMinLiveLabels);
    expect(c.alarms.some((a) => a.alarmed_at)).toBe(true);
    expect(c.risk_threshold_policies.length).toBeGreaterThan(0);
    expect(c.risk_threshold_policies[0]).toMatchObject({ threshold: expect.any(Number), action: expect.any(String) });
  });

  it('triage-queue payloads carry every field TriageInbox dereferences synchronously', () => {
    // A missing field here throws inside TriageInbox.load() AFTER
    // Promise.allSettled resolves, so setLoading(false) never runs and the
    // "Needs your call" section wedges on skeletons (2026-07-08 live bug:
    // `tun.value.policies.length` on a payload without `policies`).
    const tun = demoTuningProposals();
    expect(Array.isArray(tun.policies)).toBe(true);
    expect(Array.isArray(tun.proposals)).toBe(true);
    const tig = demoTighteningProposals();
    expect(Array.isArray(tig.proposals)).toBe(true);
    expect(tig.counts).toMatchObject({ pending: expect.any(Number) });
    const loo = demoLooseningProposals();
    expect(Array.isArray(loo.proposals)).toBe(true);
    expect(loo.counts).toMatchObject({ pending: expect.any(Number) });
    const cal = demoCalibrationProposals();
    expect(Array.isArray(cal.proposals)).toBe(true);
    expect(cal.inputs).toMatchObject({ decisions: expect.any(Number) });
  });

  it('doctor (/api/doctor) reports pass/warn checks and an honest demo warn', () => {
    const d = demoDoctor();
    expect(d.checks.length).toBeGreaterThan(0);
    expect(d.summary.pass).toBe(d.checks.filter((c) => c.status === 'pass').length);
    expect(d.summary.warn).toBeGreaterThan(0);
    expect(d.checks.some((c) => c.id === 'demo_mode' && c.status === 'warn')).toBe(true);
  });
});

describe('persona-agents fixture — webhook event names are real', () => {
  // The webhook route only accepts VALID_EVENT_TYPES; the persona narrative
  // used to advertise fictional dot-namespaced events (action.blocked,
  // guard.escalation, security.signal, agent.offline, action.completed).
  it('no fictional dot-namespaced webhook event names in persona copy', () => {
    const fictional = /action\.(completed|blocked)|guard\.escalation|security\.signal|agent\.offline/;
    for (const a of personaActions as any[]) {
      expect(String(a.output_summary || '')).not.toMatch(fictional);
    }
  });
});
