import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getDemoFixtures } from './app/lib/demo/demoFixtures';
import {
  demoAgents,
  demoListActions, demoCreateAction, demoActionDetail, demoAssumptions,
  demoTokens, demoPolicies, demoApprovalFloods, demoPolicySummary, demoContract, demoReview, demoPolicySimulate, demoPolicyProof, demoPolicyTest, demoGuard, demoGuardPost,
  demoCalibrationController, demoDoctor,
  demoPlans, demoPlanDetail, demoActionArtifacts,
  demoTuningProposals, demoTighteningProposals, demoLooseningProposals, demoCalibrationProposals,
  demoContent, demoActivity,
  demoWebhooks, demoWebhookDeliveries, demoSchedules,
  demoDigest, demoContextPoints, demoContextThreads, demoContextThreadDetail,
  demoSnippets, demoPreferences, demoActionTrace,
  demoDecisionMetrics,
  demoSessions, demoSessionDetail, demoSessionEvents, demoSessionActions,
  demoIdentities, demoApiKeys,
  demoUsage,
  demoTeam,
} from './app/lib/demo/demoMiddleware';
import { addSecurityHeaders } from './app/lib/security-headers';
import {
  getCorsHeaders,
  withCors,
  forwardWithHeaders,
  getClientIp,
  checkRateLimit,
  getDashclawMode,
  getLocalAdminSession,
} from './middleware.shared.js';

function isDemoCookieSet(request) {
  return request.cookies.get('dashclaw_demo')?.value === '1';
}

function demoJson(request, payload, status = 200) {
  const response = NextResponse.json(payload, { status });
  addSecurityHeaders(response, request);
  withCors(request, response);
  return response;
}

function parseUrl(request) {
  return new URL(request.url);
}

function getPathSegments(pathname) {
  return pathname.split('/').filter(Boolean);
}

// /demo is always a public entrypoint. Plain /demo lands first-time evaluators
// on the interactive marketing demo (no cookie, no auth-gated routes).
// /demo?sandbox=1 is the explicit "enter the demo dashboard" path (the navbar/
// footer demo CTAs): it mints the non-secret dashclaw_demo cookie and
// forwards into /decisions, where reads are served from deterministic
// fixtures and writes are blocked. /demo?leave=1 exits the sandbox.
export function handleDemoEntry(request) {
  const leave = request.nextUrl.searchParams.get('leave') === '1';
  const sandbox = !leave && request.nextUrl.searchParams.get('sandbox') === '1';
  const target = sandbox ? '/decisions' : '/#live-demo';
  const response = NextResponse.redirect(new URL(target, request.url));

  if (leave) {
    response.cookies.delete('dashclaw_demo');
  } else if (sandbox) {
    response.cookies.set('dashclaw_demo', '1', {
      path: '/',
      maxAge: 60 * 60 * 24, // 24h
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    });
  }

  addSecurityHeaders(response, request);
  return response;
}

// Demo sandbox mode:
// - Serve the REAL dashboard UI.
// - Back /api/* reads with deterministic fixtures.
// - Block all writes (no secrets, no mutations).
// Demo sandbox: cookie or explicit DASHCLAW_MODE=demo. Cookie only provides fixture data, never real data.
// SECURITY: Only honor demo cookie when DASHCLAW_MODE=demo or on dashclaw.io to prevent self-host bypass
// Cookie-driven demo is only honored on marketing hosts and never overrides an
// explicit DASHCLAW_MODE=demo (that path forces demo for everyone, below).
function isCookieDemoRequest(request, mode) {
  // A hosted-trial instance is a REAL runtime, never a marketing sandbox —
  // even though it lives under *.dashclaw.io. Without this guard, a visitor
  // who clicked Live Demo (which mints dashclaw_demo on whatever host
  // they're on) gets every write on hosted.dashclaw.io demo-blocked,
  // including the trial mint itself.
  if (process.env.DASHCLAW_HOSTED === 'true') return false;
  const demoCookie = isDemoCookieSet(request);
  const host = request.headers.get('host') || '';
  const normalizedHost = host.split(':')[0].toLowerCase();
  const isMarketingHost =
    normalizedHost === 'dashclaw.io' || normalizedHost.endsWith('.dashclaw.io');
  return demoCookie && isMarketingHost && mode !== 'demo';
}

export async function resolveDemoState(request) {
  const mode = getDashclawMode();
  const cookieDemo = isCookieDemoRequest(request, mode);
  // THE FIX (Instant Hosted Trial): a visitor who kicked the tires anonymously
  // (got the dashclaw_demo cookie via /demo) and then signed in now has a real
  // trial workspace. Resolve the auth principal LAZILY — only on the narrow
  // cookie-demo path — so normal requests pay nothing. An authenticated
  // principal (NextAuth token OR local-admin session) bypasses the demo and
  // falls through to the real runtime. This covers BOTH page and API requests.
  let demoBypassPrincipal = null;
  if (cookieDemo) {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET }).catch(() => null);
    demoBypassPrincipal = token || (await getLocalAdminSession(request));
  }
  const clearStaleDemoCookie = Boolean(cookieDemo && demoBypassPrincipal);
  const serveDemoSandbox = mode === 'demo' || (cookieDemo && !demoBypassPrincipal);
  return { clearStaleDemoCookie, serveDemoSandbox };
}

// ── Demo sandbox: /api/* dispatch ───────────────────────────────────────────

// Allow simulated actions, assumptions, and guard checks in demo mode.
// The approval pause is operable in demo: its demo state is module-scope and
// gates nothing real, and a pause the visitor cannot turn back OFF would
// demonstrate the opposite of the property that makes the feature safe. DELETE
// is exempt for that reason, not just POST.
//
// /api/halt is deliberately NOT listed. Its POST branch is unreachable behind
// this same write-block, which reads as an oversight given the handler's
// "fully clickable in the demo" comment — but that behaviour is pinned by a
// characterization test (middleware.test.js, "QUIRK: POST /api/halt hits the
// write-block BEFORE the halt handler"), so it is a recorded decision to leave
// alone, not a stray bug. Exempting it would also let one anonymous visitor
// halt the shared demo org for everyone on that instance.
function isDemoSimulationRequest(pathname, method) {
  if (pathname === '/api/approval-pause') {
    return method === 'POST' || method === 'DELETE';
  }
  const simulationPath =
    pathname === '/api/guard' ||
    pathname === '/api/actions' ||
    pathname === '/api/assumptions' ||
    pathname.startsWith('/api/actions/');
  return simulationPath && (method === 'POST' || method === 'PATCH');
}

// Allow NextAuth internals and raw markdown passthrough (these do not write data).
// /api/prompts/{server-setup,agent-connect}/raw serve static markdown for the
// "Copy ... Prompt" buttons on /self-host and should work identically in demo.
// /api/hosted passes through so the instant-trial flow can run on the demo-mode
// marketing host: every hosted route self-guards with isHostedMode() (404 when
// DASHCLAW_HOSTED is unset), so this is inert until the operator flips that env.
// Without it, demo mode 403s /api/hosted/capacity and the trial CTA never renders.
// /api/session/effective returns ONLY the caller's own cookie-derived state
// ({authenticated:false} for an anonymous demo visitor — never org data), so
// it is safe to forward in demo mode. Without it the demo dispatch 403s the
// probe useEffectiveRole fires on every page, and every sandbox page logs a
// console error.
const DEMO_PASSTHROUGH_PREFIXES = ['/api/auth', '/api/docs/raw', '/api/hosted'];
// /api/policies/templates serves the static pack catalog (YAML on disk); its
// org-scoped `installed` check degrades to false without auth, so the real
// route is demo-safe and the Pack Gallery shows real packs.
const DEMO_PASSTHROUGH_EXACT = ['/api/prompts/server-setup/raw', '/api/prompts/agent-connect/raw', '/api/session/effective', '/api/policies/templates'];

function isDemoPassthroughPath(pathname) {
  return DEMO_PASSTHROUGH_PREFIXES.some(prefix => pathname.startsWith(prefix)) ||
    DEMO_PASSTHROUGH_EXACT.includes(pathname);
}

// SSE is allowed to keep UI stable. We attach demo org headers for getOrgId().
function forwardDemoStream(request) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-org-id', 'org_demo');
  requestHeaders.set('x-org-role', 'admin');
  return forwardWithHeaders(request, requestHeaders);
}

// Exact-length segment pattern match; '*' matches any single segment.
function segmentsMatch(segments, pattern) {
  if (segments.length !== pattern.length) return false;
  return pattern.every((part, i) => part === '*' || segments[i] === part);
}

function demoHealthPayload() {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: 'demo',
    // todo-001: surface demo mode so the Python hook can warn the operator
    // when DASHCLAW_BASE_URL is misrouted to a sandbox instance. The real
    // /api/health route also returns this; we mirror it here because the
    // demo-mode middleware short-circuits before that handler runs.
    mode: 'demo',
    checks: { demo: { status: 'healthy' } },
  };
}

async function handleDemoActionsRoute({ request, fixtures, url, method }) {
  if (method === 'POST') {
    // For demo simulations, we try to use the real body if provided
    let body = {};
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : {};
    } catch (e) {
      // fallback to empty
    }
    return demoJson(request, demoCreateAction(fixtures, body), 201);
  }
  return demoJson(request, demoListActions(fixtures, url));
}

function handleDemoSignals({ request, fixtures, url }) {
  const agentId = url.searchParams.get('agent_id');
  const signals = agentId ? fixtures.signals.filter(s => s.agent_id === agentId) : fixtures.signals;
  return demoJson(request, {
    signals,
    counts: {
      red: signals.filter(s => s.severity === 'red').length,
      amber: signals.filter(s => s.severity === 'amber').length,
      total: signals.length,
    },
    lastUpdated: new Date().toISOString(),
  });
}

// Pulse widget snapshot (/widget). Pending rows get a synthetic held-3m
// timestamp so the demo shows the brand "owed" ring rather than an ancient
// fixture reading as days overdue (risk >= 70 has a 5-minute dwell budget,
// so the hold must stay under it). Presence is honestly `unknown` — the demo
// host has no desktop-presence store, and unknown never fakes live.
function handleDemoWidgetPulse({ request, fixtures }) {
  const now = Date.now();
  const pendingRows = (fixtures.actions || [])
    .filter((a) => a.status === 'pending_approval')
    .slice(0, 5)
    .map((a) => ({
      actionId: a.action_id || null,
      actionType: a.action_type || null,
      agentName: a.agent_name || a.agent_id || null,
      riskScore: Number(a.risk_score) || 0,
      timestampStart: new Date(now - 3 * 60 * 1000).toISOString(),
      declaredGoal: null,
    }));
  const signals = fixtures.signals || [];
  const top = signals.find((s) => s.severity === 'red') || signals[0] || null;
  return demoJson(request, {
    asOf: new Date(now).toISOString(),
    windowMinutes: 60,
    pending: { count: pendingRows.length, rows: pendingRows },
    signals: {
      red: signals.filter((s) => s.severity === 'red').length,
      amber: signals.filter((s) => s.severity === 'amber').length,
      top: top ? { severity: top.severity, kind: top.type || 'signal', label: top.label || '' } : null,
    },
    agents: { activeCount: 3, lastActiveAt: new Date(now - 2 * 60 * 1000).toISOString() },
    lastActionAt: new Date(now - 2 * 60 * 1000).toISOString(),
    recentActionCount: 12,
    queriesDegraded: [],
    presence: { verdict: 'unknown', frameAgeSeconds: null },
  });
}

function handleDemoActionTrace({ request, fixtures, segments }) {
  const actionId = segments[2];
  const trace = demoActionTrace(fixtures, actionId);
  if (!trace) return demoJson(request, { error: 'Action not found' }, 404);
  return demoJson(request, trace);
}

function handleDemoActionDetail({ request, fixtures, segments }) {
  const actionId = segments[2];
  const detail = demoActionDetail(fixtures, actionId);
  if (!detail) return demoJson(request, { error: 'Action not found' }, 404);
  return demoJson(request, detail);
}

function handleDemoRelationships({ request, fixtures }) {
  const contacts = fixtures.contacts;
  const today = new Date().toISOString().slice(0, 10);
  const followUpsDue = contacts.filter(c => c.followUpDate && c.followUpDate <= today).length;
  const stats = {
    total: contacts.length,
    hot: contacts.filter(c => c.temperature === 'HOT').length,
    warm: contacts.filter(c => c.temperature === 'WARM').length,
    cold: contacts.filter(c => c.temperature === 'COLD').length,
    followUpsDue,
  };
  return demoJson(request, { contacts, interactions: [], stats, lastUpdated: new Date().toISOString() });
}

function handleDemoPoliciesProof({ request, fixtures, url }) {
  const fmt = url.searchParams.get('format');
  if (fmt === 'json') {
    return demoJson(request, { report: fixtures.policyProofReport });
  }
  // Markdown format — wrap in JSON object for client to parse
  return demoJson(request, { report: fixtures.policyProofReport });
}

function handleDemoFeedback({ request, fixtures, url }) {
  if (request.method === 'GET') {
    let entries = fixtures.feedbackEntries;
    const sentiment = url.searchParams.get('sentiment');
    const resolved = url.searchParams.get('resolved');
    if (sentiment) entries = entries.filter(e => e.sentiment === sentiment);
    if (resolved === 'false') entries = entries.filter(e => !e.resolved);
    if (resolved === 'true') entries = entries.filter(e => e.resolved);
    return demoJson(request, { feedback: entries, total: entries.length });
  }
  return demoJson(request, { id: 'fb_demo_new', sentiment: 'neutral', tags: [] }, 201);
}

function handleDemoFeedbackDetail({ request, fixtures, pathname }) {
  const id = pathname.split('/').pop();
  const fb = fixtures.feedbackEntries.find(e => e.id === id);
  return fb ? demoJson(request, fb) : demoJson(request, { error: 'Not found' }, 404);
}

async function handleDemoGuardRoute({ request, fixtures, url, method }) {
  if (method === 'POST') {
    try {
      const bodyText = await request.text();
      const body = bodyText ? JSON.parse(bodyText) : {};
      const result = demoGuardPost(fixtures, body);
      return demoJson(request, result, 200);
    } catch (e) {
      console.error('[DEMO GUARD ERROR]', e);
      return demoJson(request, { error: `Invalid request body: ${e.message}` }, 400);
    }
  }
  return demoJson(request, demoGuard(fixtures, url));
}

// Demo org kill switch: module-scope state so the org HALT
// control is fully clickable in the demo (halting "blocks" nothing real;
// state resets on cold start). GET mirrors /api/halt's { halt } shape.
let demoHaltState = { halted: false, actor: null, reason: null, at: null };
async function handleDemoHaltRoute({ request, method }) {
  if (method === 'POST') {
    try {
      const bodyText = await request.text();
      const body = bodyText ? JSON.parse(bodyText) : {};
      if (typeof body.halted !== 'boolean') {
        return demoJson(request, { error: 'halted must be a boolean' }, 400);
      }
      demoHaltState = {
        halted: body.halted,
        actor: 'demo-operator',
        reason: typeof body.reason === 'string' ? body.reason.slice(0, 1000) : null,
        at: new Date().toISOString(),
      };
      return demoJson(request, { ok: true, halt: demoHaltState });
    } catch (e) {
      return demoJson(request, { error: `Invalid request body: ${e.message}` }, 400);
    }
  }
  return demoJson(request, { halt: demoHaltState });
}

// Demo approval pause: same module-scope shape as the kill switch above, so
// the pause control on /policies and its banner on /approvals are fully
// clickable in the demo (pausing gates nothing real; state resets on cold
// start). Mirrors /api/approval-pause's { pause, window_hours } shape,
// including the self-expiry — the demo should demonstrate that the pause wears
// off, since that is the property that makes it safe.
const DEMO_PAUSE_WINDOW_HOURS = [1, 4, 8, 24];
const DEMO_NOT_PAUSED = { active: false, until: null, actor: null, reason: null, at: null, remaining_seconds: 0 };
let demoPauseUntil = null;
function demoPauseView() {
  const remainingMs = demoPauseUntil ? Date.parse(demoPauseUntil) - Date.now() : 0;
  if (!demoPauseUntil || !(remainingMs > 0)) return DEMO_NOT_PAUSED;
  return {
    active: true,
    until: demoPauseUntil,
    actor: 'demo-operator',
    reason: null,
    at: null,
    remaining_seconds: Math.round(remainingMs / 1000),
  };
}
async function handleDemoApprovalPauseRoute({ request, method }) {
  if (method === 'POST') {
    try {
      const bodyText = await request.text();
      const body = bodyText ? JSON.parse(bodyText) : {};
      const hours = Number(body.hours);
      if (!DEMO_PAUSE_WINDOW_HOURS.includes(hours)) {
        return demoJson(request, { error: `hours must be one of ${DEMO_PAUSE_WINDOW_HOURS.join(', ')}` }, 400);
      }
      demoPauseUntil = new Date(Date.now() + hours * 3600000).toISOString();
      return demoJson(request, { ok: true, pause: demoPauseView() });
    } catch (e) {
      return demoJson(request, { error: `Invalid request body: ${e.message}` }, 400);
    }
  }
  if (method === 'DELETE') {
    demoPauseUntil = null;
    return demoJson(request, { ok: true, pause: DEMO_NOT_PAUSED });
  }
  return demoJson(request, { pause: demoPauseView(), window_hours: DEMO_PAUSE_WINDOW_HOURS });
}

function handleDemoWebhookDeliveries({ request, fixtures, segments }) {
  const webhookId = segments[2];
  return demoJson(request, demoWebhookDeliveries(fixtures, webhookId));
}

function handleDemoContextThreadDetail({ request, fixtures, segments }) {
  const threadId = segments[3];
  const detail = demoContextThreadDetail(fixtures, threadId);
  if (!detail) return demoJson(request, { error: 'Thread not found' }, 404);
  return demoJson(request, detail);
}

function handleDemoPreferences({ request, fixtures, url }) {
  const payload = demoPreferences(fixtures, url);
  const status = payload?.error ? 400 : 200;
  return demoJson(request, payload, status);
}

function handleDemoPairings({ request, fixtures, url }) {
  const status = url.searchParams.get('status') || 'pending';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  // fixtures.pairings may be undefined — pairings aren't seeded in the
  // demo fixture yet. Fall back to empty list instead of crashing.
  const all = Array.isArray(fixtures.pairings) ? fixtures.pairings : [];
  const pairings = all.filter(p => p.status === status).slice(0, limit);
  return demoJson(request, { pairings });
}

// Session detail trio — fixture ids come from the same builder as the demo
// sessions LIST, so /sessions/<row id> always resolves. Unknown ids 404 like
// the real routes.
function handleDemoSessionDetail({ request, fixtures, segments }) {
  const detail = demoSessionDetail(fixtures, segments[2]);
  if (!detail) return demoJson(request, { error: 'Session not found' }, 404);
  return demoJson(request, detail);
}

function handleDemoSessionEvents({ request, fixtures, segments }) {
  const payload = demoSessionEvents(fixtures, segments[2]);
  if (!payload) return demoJson(request, { error: 'Session not found' }, 404);
  return demoJson(request, payload);
}

function handleDemoSessionActions({ request, fixtures, url, segments }) {
  const payload = demoSessionActions(fixtures, segments[2], url);
  if (!payload) return demoJson(request, { error: 'Session not found' }, 404);
  return demoJson(request, payload);
}

function handleDemoPairingDetail({ request, fixtures, segments }) {
  const pairingId = segments[2];
  const all = Array.isArray(fixtures.pairings) ? fixtures.pairings : [];
  const pairing = all.find(p => p.id === pairingId) || null;
  if (!pairing) return demoJson(request, { error: 'Pairing not found' }, 404);
  return demoJson(request, { pairing });
}

// Table-entry factories: most demo routes are "call a fixture mapper, wrap it
// in demoJson". These keep the table to one expression per route instead of
// repeating the demoJson plumbing for every entry.
const demoFixtureRoute = (fn) => ({ request, fixtures }) => demoJson(request, fn(fixtures));
const demoFixtureUrlRoute = (fn) => ({ request, fixtures, url }) => demoJson(request, fn(fixtures, url));
const demoPayloadRoute = (fn) => ({ request }) => demoJson(request, fn());
const demoFixturePropRoute = (key) => ({ request, fixtures }) => demoJson(request, fixtures[key]);

// Ordered demo route table. Each entry is [matcher, handler]; a string matcher
// is an exact pathname, a function matcher receives (pathname, segments).
// ORDER IS LOAD-BEARING: it reproduces the original if-cascade top-to-bottom,
// including its shadowing quirks (see isDemoAgentDetailPath). Do not sort.
const DEMO_API_ROUTES = [
  // Health
  ['/api/health', demoPayloadRoute(demoHealthPayload)],
  ['/api/agents', demoFixtureRoute(demoAgents)],
  ['/api/actions', handleDemoActionsRoute],
  [(pathname) => pathname === '/api/actions/signals' || pathname === '/api/signals', handleDemoSignals],
  [(pathname) => pathname === '/api/actions/assumptions' || pathname === '/api/assumptions', demoFixtureUrlRoute(demoAssumptions)],
  ['/api/actions/stats', demoFixtureRoute(demoDecisionMetrics)],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'actions', '*', 'trace']), handleDemoActionTrace],
  // Containment Verdicts (v5.6.0): the card's lazy diff load and its
  // promote/discard POST. The verdict answers an honest demo 403 (static
  // fixtures cannot transition; symmetric with the plans entries).
  [(pathname, segments) => segmentsMatch(segments, ['api', 'actions', '*', 'artifacts']), ({ request, segments }) => demoJson(request, demoActionArtifacts(segments[2]))],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'actions', '*', 'containment']), ({ request }) =>
    demoJson(request, { error: 'Demo mode: containment verdicts are disabled. Connect an instance to promote or discard real contained work.' }, 403)],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'actions', '*']), handleDemoActionDetail],
  // Dashboard widgets
  ['/api/goals', ({ request, fixtures }) => demoJson(request, { goals: fixtures.goals, stats: { totalGoals: fixtures.goals.length }, lastUpdated: new Date().toISOString() })],
  ['/api/relationships', handleDemoRelationships],
  ['/api/calendar', ({ request, fixtures }) => demoJson(request, { events: fixtures.events, lastUpdated: new Date().toISOString(), count: fixtures.events.length })],
  ['/api/inspiration', ({ request, fixtures }) => demoJson(request, { ideas: fixtures.ideas, stats: { totalIdeas: fixtures.ideas.length }, lastUpdated: new Date().toISOString() })],
  ['/api/settings', ({ request, fixtures }) => demoJson(request, { settings: fixtures.settings })],
  ['/api/policies', demoFixtureRoute(demoPolicies)],
  // Interruption-budget banner on /approvals. The banner treats any non-OK as
  // "no flood" and renders nothing, so without this entry the demo showed no
  // sign the capability exists — a silent gap rather than a visible error.
  ['/api/approvals/floods', demoFixtureRoute(demoApprovalFloods)],
  ['/api/policies/summary', demoFixtureRoute(demoPolicySummary)],
  ['/api/policies/contract', ({ request }) => demoJson(request, demoContract())],
  ['/api/policies/review', ({ request }) => demoJson(request, demoReview())],
  ['/api/policies/proof', handleDemoPoliciesProof],
  // Triage-inbox proposal queues: empty-but-COMPLETE payloads (see the
  // builders' doc comment — a missing field wedges the inbox on skeletons).
  ['/api/policies/proposals', demoPayloadRoute(demoTuningProposals)],
  ['/api/policies/tightening', demoPayloadRoute(demoTighteningProposals)],
  ['/api/policies/loosening', demoPayloadRoute(demoLooseningProposals)],
  ['/api/calibration/proposals', demoPayloadRoute(demoCalibrationProposals)],
  ['/api/calibration/controller', demoFixtureRoute(demoCalibrationController)],
  ['/api/doctor', demoPayloadRoute(demoDoctor)],
  ['/api/widget/pulse', handleDemoWidgetPulse],
  // Preflight plans (v5.4.0): the /approvals plans card fetches
  // ?status=<s>&limit=N then a detail per plan — without these entries the
  // demo showed no plans at all. Verdict POSTs answer an honest demo 403
  // (stateless fixtures can't transition status).
  ['/api/plans', ({ request, fixtures }) => {
    // Method guard mirrors the detail entry below (the pre-dispatch write
    // block also covers this; the symmetry is deliberate, not redundant
    // by accident — 2026-07-29 security review, LOW).
    if (request.method !== 'GET') {
      return demoJson(request, { error: 'Demo mode: plan submission is disabled. Connect an instance to submit real plans.' }, 403);
    }
    const status = new URL(request.url).searchParams.get('status');
    const plans = demoPlans(fixtures).filter((p) => !status || p.status === status);
    return demoJson(request, { plans });
  }],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'plans', '*']), ({ request, fixtures, segments }) => {
    if (request.method !== 'GET') {
      return demoJson(request, { error: 'Demo mode: plan verdicts are disabled. Connect an instance to review real plans.' }, 403);
    }
    const detail = demoPlanDetail(fixtures, segments[2]);
    return detail ? demoJson(request, detail) : demoJson(request, { error: 'Plan not found' }, 404);
  }],
  // ── Routing demo endpoints ──
  ['/api/routing/health', demoFixturePropRoute('routingHealth')],
  ['/api/routing/stats', demoFixturePropRoute('routingStats')],
  ['/api/routing/agents', ({ request, fixtures }) => demoJson(request, { agents: fixtures.routingAgents })],
  ['/api/routing/tasks', ({ request, fixtures }) => demoJson(request, { tasks: fixtures.routingTasks })],
  // -- Feedback demo endpoints --
  ['/api/feedback', handleDemoFeedback],
  [(pathname) => /^\/api\/feedback\/stats$/.test(pathname), demoFixturePropRoute('feedbackStats')],
  [(pathname) => /^\/api\/feedback\/[^/]+$/.test(pathname), handleDemoFeedbackDetail],
  // Guard + messaging + team + activity
  ['/api/guard', handleDemoGuardRoute],
  ['/api/halt', handleDemoHaltRoute],
  ['/api/approval-pause', handleDemoApprovalPauseRoute],
  ['/api/content', demoFixtureUrlRoute(demoContent)],
  ['/api/activity', demoFixtureUrlRoute(demoActivity)],
  ['/api/webhooks', demoFixtureRoute(demoWebhooks)],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'webhooks', '*', 'deliveries']), handleDemoWebhookDeliveries],
  ['/api/schedules', demoFixtureRoute(demoSchedules)],
  ['/api/usage', demoFixtureRoute(demoUsage)],
  ['/api/team/invites', demoFixtureRoute(demoTeam)],
  ['/api/digest', demoFixtureUrlRoute(demoDigest)],
  ['/api/context/points', demoFixtureUrlRoute(demoContextPoints)],
  ['/api/context/threads', demoFixtureUrlRoute(demoContextThreads)],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'context', 'threads', '*']), handleDemoContextThreadDetail],
  ['/api/snippets', demoFixtureUrlRoute(demoSnippets)],
  ['/api/preferences', handleDemoPreferences],
  ['/api/memory', ({ request, fixtures }) => demoJson(request, { ...fixtures.memory, lastUpdated: new Date().toISOString() })],
  ['/api/tokens', demoFixtureRoute(demoTokens)],
  ['/api/security/status', demoFixturePropRoute('securityStatus')],
  ['/api/pairings', handleDemoPairings],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'pairings', '*']), handleDemoPairingDetail],
  // -- Sitewide-interactions-v2 gap pages: deterministic, read-only fixtures --
  ['/api/sessions', demoFixtureUrlRoute(demoSessions)],
  // Detail trio: 4-segment patterns are listed before the 3-segment detail for
  // readability, though segmentsMatch is exact-length so they can't collide.
  [(pathname, segments) => segmentsMatch(segments, ['api', 'sessions', '*', 'events']), handleDemoSessionEvents],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'sessions', '*', 'actions']), handleDemoSessionActions],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'sessions', '*']), handleDemoSessionDetail],
  ['/api/identities', demoFixtureRoute(demoIdentities)],
  ['/api/keys', demoPayloadRoute(demoApiKeys)],
];

async function dispatchDemoApiRoute(ctx) {
  for (const [matcher, handler] of DEMO_API_ROUTES) {
    const matches = typeof matcher === 'string'
      ? ctx.pathname === matcher
      : matcher(ctx.pathname, ctx.segments);
    if (matches) return handler(ctx);
  }
  return demoJson(ctx.request, { error: 'Demo mode: endpoint disabled.' }, 403);
}

// Policy test/simulate runs are read-like (no mutation) — allow through demo
// write-block. modes/import is mocked the same way: demo "applies" a profile
// without mutating anything, so the /policies UI doesn't 403.
async function handleDemoPolicySimulations(request, pathname, method) {
  if (method !== 'POST') return null;
  if (pathname === '/api/policies/test') {
    return demoJson(request, demoPolicyTest(getDemoFixtures()));
  }
  if (pathname === '/api/policies/simulate') {
    // Pack-mode simulate ({ pack }) returns the pack-shaped payload; the body
    // read is safe here because this handler always responds directly.
    const body = await request.json().catch(() => ({}));
    return demoJson(request, demoPolicySimulate(getDemoFixtures(), body));
  }
  if (pathname === '/api/policies/import') {
    return demoJson(request, {
      imported: 3, skipped: 0, errors: [], policies: [], demo: true,
    }, 201);
  }
  if (pathname === '/api/policies/review/verdict') {
    return demoJson(request, { ok: true, demo: true });
  }
  if (pathname === '/api/policies/modes/import') {
    return demoJson(request, {
      mode_id: 'demo',
      imported: 6,
      reactivated: 0,
      skipped: 0,
      errors: [],
      policies: [],
      demo: true,
    }, 201);
  }
  return null;
}

// Early demo-mode gates that run before the route table, in cascade order:
// marketing passthrough → static passthrough → read-like policy simulations
// → the write block (only guard/actions/assumptions simulations are exempt).
// Passthrough MUST precede the write block: NextAuth sign-in and the hosted
// mint are POSTs, and a passthrough that only exempts reads is a no-op for
// exactly the endpoints it exists to protect.
async function runDemoPreDispatch(request, pathname, method, isRead) {
  // Marketing funnel telemetry is reachable in demo mode too — the
  // marketing site IS the demo deployment. Pass through to the real
  // handler; it validates allowlisted event names and writes to Redis.
  if (pathname.startsWith('/api/marketing/')) {
    return forwardWithHeaders(request);
  }

  if (isDemoPassthroughPath(pathname)) {
    // Never forward caller-supplied org identity on a demo passthrough: the
    // real routes trust x-org-id because this middleware normally sets it
    // post-auth, so an unauthenticated demo caller could spoof it to probe
    // another org's data (e.g. which policy packs an org has installed).
    // Strip identity and mark the request so routes can skip org-scoped reads.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete('x-org-id');
    requestHeaders.delete('x-org-role');
    requestHeaders.delete('x-user-id');
    requestHeaders.set('x-dashclaw-demo', '1');
    return forwardWithHeaders(request, requestHeaders);
  }

  const policySimulation = await handleDemoPolicySimulations(request, pathname, method);
  if (policySimulation) return policySimulation;

  if (!isRead && !isDemoSimulationRequest(pathname, method)) {
    return demoJson(request, { error: 'Demo mode: write APIs are disabled.' }, 403);
  }

  return null;
}

export async function handleDemoApi(request, pathname) {
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
  }

  // SECURITY: Even demo mode should be rate limited.
  const ip = getClientIp(request);
  if (!(await checkRateLimit(ip))) {
    return demoJson(request, { error: 'Rate limit exceeded. Please slow down.' }, 429);
  }

  const method = request.method.toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';

  const preDispatch = await runDemoPreDispatch(request, pathname, method, isRead);
  if (preDispatch) return preDispatch;

  const ctx = {
    request,
    pathname,
    method,
    fixtures: getDemoFixtures(),
    url: parseUrl(request),
    segments: getPathSegments(pathname),
  };

  if (pathname.startsWith('/api/stream')) {
    return forwardDemoStream(request);
  }

  return dispatchDemoApiRoute(ctx);
}
