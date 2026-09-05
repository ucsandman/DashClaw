import type { DemoFixtures, AnyRecord } from './demoMiddleware.actions';

// ── Sitewide-interactions-v2 demo handlers (gap pages) ───────────────────────
// Deterministic, READ-ONLY fixtures so no page renders empty in demo mode. Data
// values use fixed timestamps (no Date.now()/random) so tests stay stable; only
// the non-asserted `lastUpdated` metadata uses the live clock, matching the
// existing demo handlers above.

const DEMO_FALLBACK_AGENT_IDS = ['clawdbot', 'refund-support-agent', 'deploy-runner', 'data-pipeline'];

export function demoAgentIdList(fixtures: DemoFixtures): string[] {
  const ids = Array.from(new Set((fixtures.actions || []).map((a) => a.agent_id).filter(Boolean)));
  return ids.length ? ids.slice(0, 6) : DEMO_FALLBACK_AGENT_IDS;
}

const DEMO_SESSION_STATUSES = ['running', 'completed', 'completed', 'blocked', 'failed'];

// Single source for the demo session set: the list route, the detail trio
// (/api/sessions/:id{,/events,/actions}) and their aggregates all derive from
// this builder, so clicking any list row resolves on the detail page.
export function buildDemoSessionList(fixtures: DemoFixtures): AnyRecord[] {
  return demoAgentIdList(fixtures).flatMap((agentId, i) =>
    [0, 1].map((j) => {
      const n = i * 2 + j + 1;
      const day = (n % 7) + 1;
      const min = n % 6;
      const status = DEMO_SESSION_STATUSES[n % DEMO_SESSION_STATUSES.length];
      return {
        id: `sess_demo_${n}`,
        agent_id: agentId,
        agent_name: agentId,
        status,
        workspace: 'demo-governance-workspace',
        branch: n % 2 === 0 ? 'main' : `feat/demo-task-${n}`,
        blocked_reason: status === 'blocked'
          ? 'Guard requires approval: deploy touches production configuration.'
          : null,
        action_count: 3 + ((n * 7) % 18),
        created_at: `2026-06-0${day}T08:0${min}:00.000Z`,
        updated_at: `2026-06-0${day}T09:1${min}:00.000Z`,
        last_activity: `2026-06-0${day}T09:1${min}:00.000Z`,
      };
    }),
  );
}

export function demoSessions(fixtures: DemoFixtures, url: URL) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 200);
  const agentId = url.searchParams.get('agent_id');
  let sessions = buildDemoSessionList(fixtures);
  if (agentId) sessions = sessions.filter((s) => s.agent_id === agentId);
  return { sessions: sessions.slice(0, limit), lastUpdated: new Date().toISOString() };
}

const DEMO_SESSION_ACTION_TYPES = ['review', 'deploy', 'file_write', 'shell', 'api_call', 'research'];
const DEMO_SESSION_GOALS = [
  'Review open pull request for the payments service',
  'Deploy staging build after green test run',
  'Update retry policy in the webhook dispatcher',
  'Run the integration test suite',
  'Sync customer metrics to the warehouse',
  'Summarize incident timeline for the postmortem',
];

// Deterministic per-session action ledger. Generates exactly
// session.action_count rows so the "# Actions" card, the paginated list total,
// and the aggregates always agree — mirroring the live route's invariant.
export function buildDemoSessionActions(session: AnyRecord): AnyRecord[] {
  const n = parseInt(String(session.id).replace(/\D+/g, ''), 10) || 1;
  const count = Number(session.action_count) || 0;
  const day = (n % 7) + 1;
  return Array.from({ length: count }, (_, i) => {
    const failed = session.status === 'failed' && i === 0;
    const blocked = session.status === 'blocked' && i === 0;
    const status = failed ? 'failed' : blocked ? 'blocked' : 'completed';
    return {
      action_id: `ar_demo_sess_${n}_${i + 1}`,
      agent_id: session.agent_id,
      action_type: DEMO_SESSION_ACTION_TYPES[(n + i) % DEMO_SESSION_ACTION_TYPES.length],
      declared_goal: DEMO_SESSION_GOALS[(n + i) % DEMO_SESSION_GOALS.length],
      status,
      outcome_status: status,
      risk_score: (n * 13 + i * 17) % 100,
      cost_estimate: Number((((n * 7 + i * 3) % 40) / 100).toFixed(2)),
      created_at: `2026-06-0${day}T08:${String(10 + ((i * 2) % 50)).padStart(2, '0')}:00.000Z`,
    };
  });
}

function buildDemoSessionEvents(session: AnyRecord): AnyRecord[] {
  const base = String(session.created_at).slice(0, 11); // '2026-06-0XT'
  const events: AnyRecord[] = [
    { id: `se_${session.id}_1`, seq: 1, session_id: session.id, kind: 'spawning', detail: null, created_at: `${base}08:00:00.000Z` },
    { id: `se_${session.id}_2`, seq: 2, session_id: session.id, kind: 'running', detail: 'Agent checked in and began the work loop.', created_at: `${base}08:01:00.000Z` },
  ];
  if (session.status === 'blocked') {
    events.push({ id: `se_${session.id}_3`, seq: 3, session_id: session.id, kind: 'blocked', detail: session.blocked_reason, created_at: `${base}08:45:00.000Z` });
  } else if (session.status === 'failed') {
    events.push({ id: `se_${session.id}_3`, seq: 3, session_id: session.id, kind: 'failed', detail: 'Terminal command exited non-zero twice; session halted for operator review.', created_at: `${base}09:05:00.000Z` });
  } else if (session.status === 'completed') {
    events.push({ id: `se_${session.id}_3`, seq: 3, session_id: session.id, kind: 'completed', detail: 'Completed the governed task list: actions recorded, assumptions logged, no policy violations.', created_at: `${base}09:10:00.000Z` });
  }
  return events;
}

export function demoSessionDetail(fixtures: DemoFixtures, sessionId: string) {
  const session = buildDemoSessionList(fixtures).find((s) => s.id === sessionId);
  if (!session) return null;
  const actions = buildDemoSessionActions(session);
  const events = buildDemoSessionEvents(session);
  return {
    session: {
      ...session,
      total_cost: Number(actions.reduce((sum, a) => sum + (Number(a.cost_estimate) || 0), 0).toFixed(2)),
      max_risk: actions.reduce((m, a) => Math.max(m, Number(a.risk_score) || 0), 0),
      event_count: events.length,
      last_action_at: session.last_activity,
    },
  };
}

export function demoSessionEvents(fixtures: DemoFixtures, sessionId: string) {
  const session = buildDemoSessionList(fixtures).find((s) => s.id === sessionId);
  if (!session) return null;
  return { events: buildDemoSessionEvents(session) };
}

// Paginated, newest-first — same contract as GET /api/sessions/:id/actions.
export function demoSessionActions(fixtures: DemoFixtures, sessionId: string, url: URL) {
  const session = buildDemoSessionList(fixtures).find((s) => s.id === sessionId);
  if (!session) return null;
  const sp = url.searchParams;
  const limit = Math.min(Math.max(parseInt(sp.get('limit') || '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(sp.get('offset') || '0', 10) || 0, 0);
  const all = buildDemoSessionActions(session)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return { actions: all.slice(offset, offset + limit), total: all.length };
}

export function demoIdentities(fixtures: DemoFixtures) {
  const levels = ['admin', 'readwrite', 'readonly'];
  const identities = demoAgentIdList(fixtures).map((agentId, i) => ({
    agent_id: agentId,
    agent_name: agentId,
    permission_level: levels[i % levels.length],
    verified: true,
    fingerprint: `fp_demo_${i + 1}`,
    last_seen: `2026-06-0${(i % 7) + 1}T10:00:00.000Z`,
    created_at: `2026-05-2${i % 9}T10:00:00.000Z`,
  }));
  return { identities, lastUpdated: new Date().toISOString() };
}

export function demoApiKeys() {
  const keys = [
    { id: 'key_demo_1', name: 'CI Pipeline', prefix: 'dk_live_', revoked_at: null, created_at: '2026-04-01T00:00:00.000Z', last_used_at: '2026-06-07T08:00:00.000Z' },
    { id: 'key_demo_2', name: 'Local Dev', prefix: 'dk_test_', revoked_at: null, created_at: '2026-05-12T00:00:00.000Z', last_used_at: '2026-06-05T14:00:00.000Z' },
    { id: 'key_demo_3', name: 'Retired Key', prefix: 'dk_live_', revoked_at: '2026-05-20T00:00:00.000Z', created_at: '2026-03-01T00:00:00.000Z', last_used_at: '2026-05-19T00:00:00.000Z' },
  ];
  return { keys, lastUpdated: new Date().toISOString() };
}

/** Preflight plans for the demo /approvals surface: one pending plan
 *  awaiting the one-card review, one approved plan mid-run (a consumed
 *  step) for the Live plans section. Complete rows — every field
 *  PlanReviewCard/LivePlansSection reads is present (a missing field
 *  wedges the card, same lesson as the proposal-queue payloads). */
export function demoPlans(fixtures: DemoFixtures) {
  const agentId = demoAgentIdList(fixtures)[0] ?? 'deploy-agent';
  const now = Date.now();
  const iso = (minsFromNow: number) => new Date(now + minsFromNow * 60_000).toISOString();
  return [
    {
      plan_id: 'pa_demo_pending01',
      agent_id: agentId,
      declared_goal: 'Ship the payment-retry fix: patch, migrate, deploy',
      status: 'pending',
      ttl_minutes: 120,
      created_at: iso(-12),
      reviewed_by: null,
      reviewed_at: null,
      expires_at: null,
    },
    {
      plan_id: 'pa_demo_live01',
      agent_id: agentId,
      declared_goal: 'Rotate the staging API credentials',
      status: 'approved',
      ttl_minutes: 60,
      created_at: iso(-45),
      reviewed_by: 'ops@demo',
      reviewed_at: iso(-40),
      expires_at: iso(20),
    },
  ];
}

export function demoPlanDetail(fixtures: DemoFixtures, planId: string) {
  const plan = demoPlans(fixtures).find((p) => p.plan_id === planId);
  if (!plan) return null;
  const now = Date.now();
  const step = (
    seq: number, action_type: string, step_goal: string,
    preview: { d: string; r: number }, grant: { status: string; usedMinsAgo?: number },
  ) => ({
    step_id: `ps_demo_${planId.slice(-6)}_${seq}`,
    plan_id: planId,
    seq,
    action_type,
    step_goal,
    act: { kind: action_type, summary: step_goal },
    act_content_hash: `demo${seq}${planId.slice(-6)}`.padEnd(16, '0'),
    preview_decision: preview.d,
    preview_risk_score: preview.r,
    preview_reasons: [],
    grant_status: grant.status,
    grant_used_at: grant.usedMinsAgo != null ? new Date(now - grant.usedMinsAgo * 60_000).toISOString() : null,
    matched_action_id: null,
  });
  const steps = planId === 'pa_demo_pending01'
    ? [
        step(1, 'code_change', 'Patch the retry backoff in billing/worker.ts', { d: 'allow', r: 18 }, { status: 'pending' }),
        step(2, 'database_write', 'Backfill failed-payment rows to retryable', { d: 'warn', r: 52 }, { status: 'pending' }),
        step(3, 'deploy', 'Deploy billing-worker to production', { d: 'require_approval', r: 74 }, { status: 'pending' }),
      ]
    : [
        step(1, 'api_call', 'Mint replacement staging credentials', { d: 'allow', r: 25 }, { status: 'approved', usedMinsAgo: 30 }),
        step(2, 'config_change', 'Swap the credential in staging env config', { d: 'warn', r: 45 }, { status: 'approved' }),
      ];
  // Plan deviations (RFC 2026-08-11): the live plan carries one open
  // act_substitution so the demo /approvals deviation strip, the
  // declared-vs-observed pair, and the resolve buttons all render. Complete
  // rows — every field LivePlansSection reads is present.
  const deviations = planId === 'pa_demo_live01'
    ? [
        {
          deviation_id: 'dv_demo_live01_1',
          org_id: 'org_demo',
          agent_id: plan.agent_id,
          session_id: null,
          action_id: null,
          guard_decision_id: null,
          plan_id: planId,
          step_id: `ps_demo_${planId.slice(-6)}_2`,
          kind: 'act_substitution',
          dimension: 'act',
          severity: 'high',
          declared: {
            action_type: 'config_change',
            step_goal: 'Swap the credential in staging env config',
            act_content_hash: `demo2${planId.slice(-6)}`.padEnd(16, '0'),
          },
          observed: {
            action_type: 'config_change',
            declared_goal: 'Swap the credential in staging env config',
            act_content_hash: 'demoObservedHash0',
            act_summary: 'config_change: production env config',
            systems_touched: ['production'],
          },
          detector: 'server_derived',
          match_confidence: 90,
          agent_note: null,
          policy_outcome: 'none',
          status: 'open',
          resolved_by: null,
          resolved_at: null,
          created_at: new Date(now - 8 * 60_000).toISOString(),
        },
      ]
    : [];
  return { plan, steps, deviations };
}
