import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { neon } from '@neondatabase/serverless';
import { getDemoFixtures } from './app/lib/demo/demoFixtures.js';

/**
 * Authentication middleware for DashClaw
 *
 * SECURITY: Protects API routes with API key authentication.
 * Resolves API keys to org_id via SHA-256 hash lookup.
 * Set DASHCLAW_API_KEY environment variable in production.
 */

// Routes that are always public (health checks, setup, auth)
const PUBLIC_ROUTES = [
  '/api/health',
  '/api/setup/status',
  '/api/auth',
  '/api/cron',
  // Public read-only content endpoints
  '/api/docs/raw',
  '/api/prompts',
  '/practical-systems',
];

function getDashclawMode() {
  return process.env.DASHCLAW_MODE || 'self_host';
}

function isDemoCookieSet(request) {
  return request.cookies.get('dashclaw_demo')?.value === '1';
}

function addSecurityHeaders(response) {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  // SECURITY: Apply HSTS in production to prevent protocol downgrade attacks
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return response;
}

function withCors(request, response) {
  for (const [k, v] of Object.entries(getCorsHeaders(request))) response.headers.set(k, v);
  return response;
}

function demoJson(request, payload, status = 200) {
  const response = NextResponse.json(payload, { status });
  addSecurityHeaders(response);
  withCors(request, response);
  return response;
}

function parseUrl(request) {
  return new URL(request.url);
}

function getPathSegments(pathname) {
  return pathname.split('/').filter(Boolean);
}

function demoListActions(fixtures, url) {
  const sp = url.searchParams;
  const agentId = sp.get('agent_id') || undefined;
  const status = sp.get('status') || undefined;
  const actionType = sp.get('action_type') || undefined;
  const riskMinRaw = sp.get('risk_min');
  const riskMin = riskMinRaw ? parseInt(riskMinRaw, 10) : undefined;
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);
  const offset = parseInt(sp.get('offset') || '0', 10);

  let items = fixtures.actions.slice();
  if (agentId) items = items.filter(a => a.agent_id === agentId);
  if (status) items = items.filter(a => a.status === status);
  if (actionType) items = items.filter(a => a.action_type === actionType);
  if (Number.isFinite(riskMin)) items = items.filter(a => (parseInt(a.risk_score, 10) || 0) >= riskMin);

  items.sort((a, b) => (b.timestamp_start || '').localeCompare(a.timestamp_start || ''));

  const total = items.length;
  const paged = items.slice(offset, offset + limit);

  const statsSource = items;
  const stats = {
    total: statsSource.length,
    completed: statsSource.filter(a => a.status === 'completed').length,
    failed: statsSource.filter(a => a.status === 'failed').length,
    running: statsSource.filter(a => a.status === 'running').length,
    high_risk: statsSource.filter(a => (parseInt(a.risk_score, 10) || 0) >= 70).length,
    avg_risk: statsSource.length ? (statsSource.reduce((s, a) => s + (parseInt(a.risk_score, 10) || 0), 0) / statsSource.length) : 0,
    total_cost: statsSource.reduce((s, a) => s + (parseFloat(a.cost_estimate) || 0), 0),
  };

  return { actions: paged, total, stats, lastUpdated: new Date().toISOString() };
}

function demoAgents(fixtures) {
  const map = new Map();
  for (const a of fixtures.actions) {
    const prev = map.get(a.agent_id) || { agent_id: a.agent_id, agent_name: a.agent_name, action_count: 0, last_active: null };
    prev.action_count += 1;
    const ts = a.timestamp_start || null;
    if (ts && (!prev.last_active || ts > prev.last_active)) prev.last_active = ts;
    map.set(a.agent_id, prev);
  }
  const agents = Array.from(map.values()).sort((a, b) => (b.last_active || '').localeCompare(a.last_active || ''));
  return { agents, lastUpdated: new Date().toISOString() };
}

function demoActionDetail(fixtures, actionId) {
  const action = fixtures.actions.find(a => a.action_id === actionId) || null;
  if (!action) return null;
  const open_loops = fixtures.loops
    .filter(l => l.action_id === actionId)
    .map(({ agent_id, agent_name, declared_goal, action_type, ...rest }) => rest);
  const assumptions = fixtures.assumptions.filter(a => a.action_id === actionId);
  return { action, open_loops, assumptions };
}

function demoAssumptions(fixtures, url) {
  const sp = url.searchParams;
  const drift = sp.get('drift') === 'true';
  const agentId = sp.get('agent_id') || undefined;
  const actionId = sp.get('action_id') || undefined;
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);
  const offset = parseInt(sp.get('offset') || '0', 10);

  let items = fixtures.assumptions.slice();
  if (agentId) items = items.filter(a => a.agent_id === agentId);
  if (actionId) items = items.filter(a => a.action_id === actionId);

  items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const total = items.length;
  const paged = items.slice(offset, offset + limit);

  if (!drift) {
    return { assumptions: paged, total, lastUpdated: new Date().toISOString() };
  }

  const now = Date.now();
  let atRisk = 0;
  for (const asm of paged) {
    if (asm.validated === 1) {
      asm.drift_score = 0;
    } else if (asm.invalidated === 1) {
      asm.drift_score = null;
    } else {
      const createdAt = new Date(asm.created_at).getTime();
      const daysOld = (now - createdAt) / (1000 * 60 * 60 * 24);
      asm.drift_score = Math.min(100, Math.round((daysOld / 30) * 100));
      if (asm.drift_score >= 50) atRisk++;
    }
  }

  return {
    assumptions: paged,
    total,
    drift_summary: {
      total,
      at_risk: atRisk,
      validated: paged.filter(a => a.validated === 1).length,
      invalidated: paged.filter(a => a.invalidated === 1).length,
      unvalidated: paged.filter(a => a.validated === 0 && a.invalidated === 0).length,
    },
    lastUpdated: new Date().toISOString(),
  };
}

function demoLearning(fixtures, url) {
  const agentId = url.searchParams.get('agent_id');
  const decisions = agentId ? fixtures.decisions.filter(d => d.agent_id === agentId) : fixtures.decisions;
  const lessons = fixtures.lessons;

  const successCount = decisions.filter(d => d.outcome === 'success').length;
  const totalWithOutcome = decisions.filter(d => d.outcome && d.outcome !== 'pending').length;
  const successRate = totalWithOutcome > 0 ? Math.round((successCount / totalWithOutcome) * 100) : 0;

  const stats = {
    totalDecisions: decisions.length,
    totalLessons: lessons.length,
    successRate,
    patterns: lessons.filter(l => (l.confidence || 0) >= 80).length,
  };

  return { decisions: decisions.slice(0, 20), lessons, stats, lastUpdated: new Date().toISOString() };
}

function demoLearningRecommendations(fixtures, url) {
  const sp = url.searchParams;
  const agentId = sp.get('agent_id') || undefined;
  const actionType = sp.get('action_type') || undefined;
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);
  const includeInactive = sp.get('include_inactive') === 'true';

  let recs = fixtures.recommendations.slice();
  if (agentId) recs = recs.filter(r => r.agent_id === agentId);
  if (actionType) recs = recs.filter(r => r.action_type === actionType);
  if (!includeInactive) recs = recs.filter(r => r.active);

  return {
    recommendations: recs.slice(0, limit),
    metrics: undefined,
    lookback_days: 30,
    total: Math.min(limit, recs.length),
    lastUpdated: new Date().toISOString(),
  };
}

function demoLearningRecommendationMetrics(fixtures, url) {
  const sp = url.searchParams;
  const agentId = sp.get('agent_id') || undefined;
  const actionType = sp.get('action_type') || undefined;
  const limit = Math.min(parseInt(sp.get('limit') || '100', 10), 200);

  let metrics = fixtures.metrics.slice();
  if (agentId) metrics = metrics.filter(m => m.agent_id === agentId);
  if (actionType) metrics = metrics.filter(m => m.action_type === actionType);

  return {
    metrics: metrics.slice(0, limit),
    summary: fixtures.metricsSummary,
    lookback_days: 30,
    lastUpdated: new Date().toISOString(),
  };
}

function demoTokens(fixtures) {
  return {
    current: fixtures.tokensCurrent,
    today: fixtures.tokensToday,
    history: fixtures.tokenHistory.slice().reverse(),
    timeline: [],
    lastUpdated: new Date().toISOString(),
  };
}


function demoPolicies(fixtures) {
  return { policies: fixtures.policies || [] };
}

function demoGuard(fixtures, url) {
  const sp = url.searchParams;
  const agentId = sp.get('agent_id') || undefined;
  const decision = sp.get('decision') || undefined;
  const limit = Math.min(parseInt(sp.get('limit') || '20', 10), 200);
  const offset = parseInt(sp.get('offset') || '0', 10);

  let items = (fixtures.guardDecisions || []).slice();
  if (agentId) items = items.filter(d => d.agent_id === agentId);
  if (decision) items = items.filter(d => d.decision === decision);

  items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const total = items.length;
  const paged = items.slice(offset, offset + limit);

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recent = items.filter(d => (d.created_at ? new Date(d.created_at).getTime() : 0) >= dayAgo);
  const stats = {
    total_24h: String(recent.length),
    blocks_24h: String(recent.filter(d => d.decision === 'block').length),
    warns_24h: String(recent.filter(d => d.decision === 'warn').length),
    approvals_24h: String(recent.filter(d => d.decision === 'require_approval').length),
  };

  return { decisions: paged, total, stats, limit, offset };
}

function demoMessages(fixtures, url) {
  const sp = url.searchParams;
  const agentId = sp.get('agent_id') || undefined;
  const direction = sp.get('direction') || 'inbox';
  const type = sp.get('type') || undefined;
  const threadId = sp.get('thread_id') || undefined;
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 500);
  const offset = parseInt(sp.get('offset') || '0', 10);

  let items = (fixtures.messages || []).slice();
  if (direction === 'all' || direction === 'thread') {
    // Return all messages regardless of sender (for thread views)
  } else if (direction === 'sent') {
    items = items.filter(m => m.from_agent_id === 'dashboard');
  } else {
    items = items.filter(m => m.to_agent_id === 'dashboard' || m.to_agent_id == null);
  }

  if (agentId) items = items.filter(m => m.from_agent_id === agentId || m.to_agent_id === agentId);
  if (threadId) items = items.filter(m => m.thread_id === threadId);
  if (type) items = items.filter(m => m.message_type === type);

  items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const total = items.length;
  const paged = items.slice(offset, offset + limit);

  const unreadCount = items.filter(m => m.status === 'sent' && (m.to_agent_id === 'dashboard' || m.to_agent_id == null)).length;
  return { messages: paged, total, unread_count: unreadCount };
}

function demoMessageThreads(fixtures, url) {
  const sp = url.searchParams;
  const agentId = sp.get('agent_id') || undefined;
  const limit = Math.min(parseInt(sp.get('limit') || '20', 10), 100);

  let items = (fixtures.messageThreads || []).slice();
  if (agentId) {
    items = items.filter(t => {
      if (t.created_by === agentId) return true;
      try {
        const p = JSON.parse(t.participants || '[]');
        return Array.isArray(p) && p.includes(agentId);
      } catch {
        return false;
      }
    });
  }

  items.sort((a, b) => ((b.last_message_at || b.created_at || '')).localeCompare((a.last_message_at || a.created_at || '')));
  return { threads: items.slice(0, limit), total: Math.min(limit, items.length) };
}

function demoMessageDocs(fixtures, url) {
  const sp = url.searchParams;
  const search = sp.get('search') || '';
  const limit = Math.min(parseInt(sp.get('limit') || '20', 10), 100);

  let items = (fixtures.sharedDocs || []).slice();
  if (search) items = items.filter(d => String(d.name || '').toLowerCase().includes(search.toLowerCase()));
  items.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  return { docs: items.slice(0, limit), total: Math.min(limit, items.length) };
}

function demoContent(fixtures, url) {
  const agentId = url.searchParams.get('agent_id') || undefined;
  let items = (fixtures.content || []).slice();
  if (agentId) items = items.filter(c => c.agent_id === agentId);
  items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const byPlatform = {};
  for (const c of items) {
    const platform = c.platform || 'other';
    if (!byPlatform[platform]) byPlatform[platform] = { count: 0, published: 0, draft: 0 };
    byPlatform[platform].count += 1;
    if (c.status === 'published') byPlatform[platform].published += 1;
    if (c.status === 'draft') byPlatform[platform].draft += 1;
  }

  return {
    content: items,
    stats: {
      totalContent: items.length,
      published: items.filter(c => c.status === 'published').length,
      draft: items.filter(c => c.status === 'draft').length,
      byPlatform,
    },
    lastUpdated: new Date().toISOString(),
  };
}

function demoTeam(fixtures) {
  const members = (fixtures.teamMembers || []).slice();
  const org = fixtures.teamOrg || { id: 'org_demo', name: 'Demo Workspace' };
  return { org, members, member_count: members.length };
}

function demoTeamInvites(fixtures) {
  return { invites: fixtures.teamInvites || [] };
}

function demoActivity(fixtures, url) {
  const sp = url.searchParams;
  const action = sp.get('action') || undefined;
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);
  const offset = parseInt(sp.get('offset') || '0', 10);

  let items = (fixtures.activityLogs || []).slice();
  if (action && action !== 'all') items = items.filter(l => l.action === action);
  items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const paged = items.slice(offset, offset + limit);
  const today = new Date().toISOString().slice(0, 10);
  const stats = {
    total: items.length,
    today: items.filter(l => (l.created_at || '').startsWith(today)).length,
    unique_actors: new Set(items.map(l => l.actor_id)).size,
  };

  return { logs: paged, stats, pagination: { limit, offset } };
}

function demoWebhooks(fixtures) {
  return { webhooks: fixtures.webhooks || [] };
}

function demoWebhookDeliveries(fixtures, webhookId) {
  const deliveries = fixtures.webhookDeliveries?.[webhookId] || [];
  return { deliveries };
}

function demoWorkflows(fixtures, url) {
  const agentId = url.searchParams.get('agent_id') || undefined;

  let workflows = (fixtures.workflows || []).slice();
  let executions = (fixtures.executions || []).slice();
  const scheduledJobs = (fixtures.schedules || []).slice();

  if (agentId) {
    workflows = workflows.filter(w => w.agent_id === agentId);
    executions = executions.filter(e => e.agent_id === agentId);
  }

  workflows.sort((a, b) => (b.last_run || '').localeCompare(a.last_run || ''));
  executions.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));

  const enabled = workflows.filter(w => w.enabled === 1).length;
  const totalRuns = workflows.reduce((s, w) => s + (parseInt(w.run_count, 10) || 0), 0);
  const recentSuccess = executions.filter(e => e.status === 'success').length;
  const recentFailed = executions.filter(e => e.status === 'failed').length;

  return {
    workflows,
    executions: executions.slice(0, 20),
    scheduledJobs,
    stats: {
      totalWorkflows: workflows.length,
      enabled,
      totalRuns,
      recentExecutions: Math.min(20, executions.length),
      recentSuccess,
      recentFailed,
      scheduledJobs: scheduledJobs.length,
    },
    lastUpdated: new Date().toISOString(),
  };
}

function demoSchedules(fixtures) {
  const schedules = (fixtures.schedules || []).slice();
  const now = new Date().toISOString();
  const stats = {
    totalJobs: schedules.length,
    enabledJobs: schedules.filter(s => s.enabled === 1).length,
    dueNow: schedules.filter(s => s.next_run && s.next_run <= now).length,
  };
  return { schedules, stats, lastUpdated: new Date().toISOString() };
}

function demoDigest(fixtures, url) {
  const sp = url.searchParams;
  const agentId = sp.get('agent_id') || undefined;
  const date = sp.get('date') || new Date().toISOString().slice(0, 10);

  const isOnDate = (iso) => (iso || '').slice(0, 10) === date;

  const actions = fixtures.actions
    .filter(a => isOnDate(a.timestamp_start) && (!agentId || a.agent_id === agentId))
    .slice(0, 20)
    .map(a => ({
      action_id: a.action_id,
      action_type: a.action_type,
      goal: a.declared_goal,
      description: a.output_summary,
      risk_score: a.risk_score,
      status: a.status,
    }));

  const decisions = (fixtures.decisions || [])
    .filter(d => isOnDate(d.timestamp) && (!agentId || d.agent_id === agentId))
    .slice(0, 10)
    .map(d => ({ id: d.id, decision: d.decision, outcome: d.outcome }));

  const lessons = (fixtures.lessons || [])
    .filter(l => isOnDate(l.timestamp))
    .slice(0, 10)
    .map(l => ({ id: l.id, lesson: l.lesson, confidence: l.confidence }));

  const content = (fixtures.content || [])
    .filter(c => isOnDate(c.created_at) && (!agentId || c.agent_id === agentId))
    .slice(0, 10)
    .map(c => ({ id: c.id, title: c.title, platform: c.platform, status: c.status }));

  const ideas = (fixtures.ideas || [])
    .filter(i => isOnDate(i.captured_at))
    .slice(0, 10)
    .map(i => ({ id: i.id, title: i.title, score: i.score }));

  const interactions = (fixtures.interactions || [])
    .filter(ix => isOnDate(ix.created_at) && (!agentId || ix.agent_id === agentId))
    .slice(0, 10)
    .map(ix => ({ id: ix.id, contact_name: ix.contact_name, summary: ix.summary, direction: ix.direction }));

  const goals = (fixtures.goals || [])
    .filter(g => isOnDate(g.created_at) && (!agentId || g.agent_id === agentId))
    .slice(0, 10)
    .map(g => ({ id: g.id, title: g.title, progress: g.progress, status: g.status }));

  return {
    date,
    agent_id: agentId || null,
    actions,
    decisions,
    lessons,
    content,
    ideas,
    interactions,
    goals,
  };
}

function demoContextPoints(fixtures, url) {
  const sp = url.searchParams;
  const agentId = sp.get('agent_id') || undefined;
  const category = sp.get('category') || undefined;
  const sessionDate = sp.get('session_date') || undefined;
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);

  let items = (fixtures.contextPoints || []).slice();
  if (agentId) items = items.filter(p => p.agent_id === agentId);
  if (category) items = items.filter(p => p.category === category);
  if (sessionDate) items = items.filter(p => p.session_date === sessionDate);

  items.sort((a, b) => ((b.importance || 0) - (a.importance || 0)) || (b.created_at || '').localeCompare(a.created_at || ''));
  return { points: items.slice(0, limit), total: Math.min(limit, items.length) };
}

function demoContextThreads(fixtures, url) {
  const sp = url.searchParams;
  const agentId = sp.get('agent_id') || undefined;
  const status = sp.get('status') || undefined;
  const limit = Math.min(parseInt(sp.get('limit') || '20', 10), 100);

  let items = (fixtures.contextThreads || []).slice();
  if (agentId) items = items.filter(t => t.agent_id === agentId);
  if (status) items = items.filter(t => t.status === status);
  items.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  return { threads: items.slice(0, limit), total: Math.min(limit, items.length) };
}

function demoContextThreadDetail(fixtures, threadId) {
  const thread = (fixtures.contextThreads || []).find(t => t.id === threadId) || null;
  if (!thread) return null;
  const entries = (fixtures.contextEntries || []).filter(e => e.thread_id === threadId).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  return { thread, entries };
}

function demoHandoffs(fixtures, url) {
  const sp = url.searchParams;
  const agentId = sp.get('agent_id') || undefined;
  const date = sp.get('date') || undefined;
  const latest = sp.get('latest') === 'true';
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 1000);

  let items = (fixtures.handoffs || []).slice();
  if (agentId) items = items.filter(h => h.agent_id === agentId);
  if (date) items = items.filter(h => h.session_date === date);

  items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  if (latest) return { handoff: items[0] || null };
  return { handoffs: items.slice(0, limit), total: Math.min(limit, items.length) };
}

function demoSnippets(fixtures, url) {
  const sp = url.searchParams;
  const search = sp.get('search') || '';
  const tag = sp.get('tag') || '';
  const language = sp.get('language') || '';
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);

  let items = (fixtures.snippets || []).slice();
  if (search) {
    const s = search.toLowerCase();
    items = items.filter(sn => String(sn.name || '').toLowerCase().includes(s) || String(sn.description || '').toLowerCase().includes(s));
  }
  if (tag) items = items.filter(sn => String(sn.tags || '').includes(tag));
  if (language) items = items.filter(sn => String(sn.language || '') === language);

  items.sort((a, b) => ((b.use_count || 0) - (a.use_count || 0)) || (b.created_at || '').localeCompare(a.created_at || ''));
  return { snippets: items.slice(0, limit), total: Math.min(limit, items.length) };
}

function demoPreferences(fixtures, url) {
  const sp = url.searchParams;
  const type = sp.get('type') || 'summary';

  const summary = fixtures.preferences || {};
  if (type === 'summary') return { summary };
  if (type === 'observations') return { observations: [], total: 0 };
  if (type === 'preferences') return { preferences: summary.preferences || [], total: (summary.preferences || []).length };
  if (type === 'moods') return { moods: summary.recent_moods || [], total: (summary.recent_moods || []).length };
  if (type === 'approaches') return { approaches: summary.top_approaches || [], total: (summary.top_approaches || []).length };

  return { error: `Invalid type: ${type}. Use: summary, observations, preferences, moods, approaches` };
}

function demoSwarmGraph(fixtures, url) {
  // Demo goal: a readable, "alive-looking" graph that sells the concept.
  // We intentionally show the most active subset of agents to keep the map uncluttered.
  const swarmId = url.searchParams.get('swarm_id') || 'all';

  // Aggregate from fixture actions.
  const byAgent = new Map();
  for (const a of fixtures.actions) {
    const id = a.agent_id;
    if (!id) continue;
    const prev = byAgent.get(id) || { id, name: a.agent_name || id, actions: 0, riskSum: 0, riskN: 0, costSum: 0 };
    prev.actions += 1;
    const r = parseFloat(a.risk_score || 0);
    if (Number.isFinite(r)) {
      prev.riskSum += r;
      prev.riskN += 1;
    }
    const c = parseFloat(a.cost_estimate || 0);
    if (Number.isFinite(c)) prev.costSum += c;
    byAgent.set(id, prev);
  }

  const agents = Array.from(byAgent.values())
    .sort((a, b) => (b.actions - a.actions) || String(a.id).localeCompare(String(b.id)));

  const MAX_NODES = 50;
  const chosen = agents.slice(0, MAX_NODES);

  const nodes = chosen.map((a) => ({
    id: a.id,
    name: a.name,
    actions: a.actions,
    risk: a.riskN ? (a.riskSum / a.riskN) : 0,
    cost: Math.round(a.costSum * 100) / 100,
    val: Math.log10((a.actions || 1) + 1) * 10,
  }));

  const ids = nodes.map(n => n.id);
  const idSet = new Set(ids);

  // Deterministic, clustered links for "swarm" feel.
  const links = [];
  const clusterSize = 6;
  for (let i = 0; i < ids.length; i++) {
    const src = ids[i];
    const ringTgt = ids[(i + 1) % ids.length];
    links.push({ source: src, target: ringTgt, weight: 4 + (i % 7) });

    const c0 = Math.floor(i / clusterSize) * clusterSize;
    const p1 = ids[c0 + ((i + 2) % clusterSize)] || null;
    const p2 = ids[c0 + ((i + 4) % clusterSize)] || null;
    if (p1 && idSet.has(p1)) links.push({ source: src, target: p1, weight: 8 + (i % 9) });
    if (p2 && idSet.has(p2)) links.push({ source: src, target: p2, weight: 6 + (i % 5) });
  }

  // Add a few cross-cluster edges to avoid looking partitioned.
  if (ids.length >= 12) {
    links.push({ source: ids[1], target: ids[9], weight: 7 });
    links.push({ source: ids[3], target: ids[12], weight: 5 });
    links.push({ source: ids[8], target: ids[14], weight: 6 });
  }

  return {
    nodes,
    links,
    swarm_id: swarmId,
    total_agents: nodes.length,
    total_links: links.length,
  };
}

// SECURITY: In-memory rate limiting is local to the instance.
// For production multi-region deployments, use Redis or Upstash.
const rateLimitMap = new Map();
const RATE_LIMIT_DISABLED = (() => {
  const wants = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.DASHCLAW_DISABLE_RATE_LIMIT || '').toLowerCase()
  );
  // SECURITY: Never allow rate limiting to be disabled in production.
  if (wants && process.env.NODE_ENV === 'production') {
    console.warn('[SECURITY] DASHCLAW_DISABLE_RATE_LIMIT is set but ignored in production.');
    return false;
  }
  return wants;
})();
const RATE_LIMIT_WINDOW = (() => {
  const v = parseInt(String(process.env.DASHCLAW_RATE_LIMIT_WINDOW_MS || ''), 10);
  return Number.isFinite(v) && v > 0 ? v : (60 * 1000); // 1 minute
})();
const RATE_LIMIT_MAX = (() => {
  const def = process.env.NODE_ENV === 'development' ? 1000 : 100;
  const v = parseInt(String(process.env.DASHCLAW_RATE_LIMIT_MAX || ''), 10);
  return Number.isFinite(v) && v > 0 ? v : def;
})(); // requests per window
const RATE_LIMIT_MAX_ENTRIES = 50000;

function checkRateLimitLocal(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now - record.timestamp > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { timestamp: now, count: 1 });
    // Bound memory growth (best-effort).
    if (rateLimitMap.size > RATE_LIMIT_MAX_ENTRIES) {
      let toDelete = rateLimitMap.size - RATE_LIMIT_MAX_ENTRIES;
      for (const key of rateLimitMap.keys()) {
        rateLimitMap.delete(key);
        toDelete--;
        if (toDelete <= 0) break;
      }
    }
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  record.count++;
  return true;
}

async function checkRateLimitDistributed(ip) {
  const baseUrl = process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || '';
  if (!baseUrl || !token) return null;

  const key = `dashclaw:rl:${ip}`;
  const urlBase = baseUrl.replace(/\/+$/, '');

  const call = async (path) => {
    const res = await fetch(`${urlBase}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`upstash ${res.status}`);
    const data = await res.json().catch(() => ({}));
    return data?.result;
  };

  // Atomic-ish limiter: INCR then PEXPIRE on first hit.
  const n = await call(`INCR/${encodeURIComponent(key)}`);
  if (n === 1) {
    await call(`PEXPIRE/${encodeURIComponent(key)}/${RATE_LIMIT_WINDOW}`);
  }
  return typeof n === 'number' ? (n <= RATE_LIMIT_MAX) : null;
}

async function checkRateLimit(ip) {
  if (RATE_LIMIT_DISABLED) return true;
  try {
    const distributed = await checkRateLimitDistributed(ip);
    if (distributed !== null) return distributed;
  } catch (e) {
    // Fail open to local limiter if Upstash is misconfigured/unreachable.
    console.warn('[SECURITY] Distributed rate limit unavailable; falling back to local limiter.');
  }
  return checkRateLimitLocal(ip);
}

// SECURITY: Timing-safe string comparison to prevent timing attacks.
// Normalizes both inputs to the same length to avoid leaking length info.
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);

  // Use the longer length so we always do the same amount of work
  const maxLen = Math.max(aBuf.length, bBuf.length);
  let result = aBuf.length ^ bBuf.length; // non-zero if lengths differ

  for (let i = 0; i < maxLen; i++) {
    result |= (aBuf[i] || 0) ^ (bBuf[i] || 0);
  }
  return result === 0;
}

// SECURITY: Hash API key using Web Crypto API (Edge-compatible)
async function hashApiKey(key) {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// In-memory cache for org existence verification (1-hour TTL — orgs rarely change)
const orgExistsCache = new Map();
const ORG_EXISTS_CACHE_TTL = 60 * 60 * 1000;

async function verifyOrgExists(orgId) {
  const now = Date.now();
  const cached = orgExistsCache.get(orgId);
  if (cached && now - cached.timestamp < ORG_EXISTS_CACHE_TTL) {
    return cached.exists;
  }
  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT 1 FROM organizations WHERE id = ${orgId} LIMIT 1`;
    const exists = rows.length > 0;
    orgExistsCache.set(orgId, { timestamp: now, exists });
    return exists;
  } catch (err) {
    console.error('[MIDDLEWARE] Failed to verify org existence:', err.message);
    // SECURITY: Fail closed — a deleted/revoked org's key must not work during outages
    return false;
  }
}

// In-memory cache for API key -> org resolution (5-min TTL)
const apiKeyCache = new Map();
const API_KEY_CACHE_TTL = 5 * 60 * 1000;
const API_KEY_CACHE_MAX_ENTRIES = 10000;

function pruneApiKeyCache(now) {
  if (apiKeyCache.size <= API_KEY_CACHE_MAX_ENTRIES) return;

  // Drop expired entries first.
  for (const [k, v] of apiKeyCache.entries()) {
    if (!v || now - v.timestamp >= API_KEY_CACHE_TTL) {
      apiKeyCache.delete(k);
    }
  }

  // If still too large, evict oldest entries (insertion order).
  if (apiKeyCache.size > API_KEY_CACHE_MAX_ENTRIES) {
    let toDelete = apiKeyCache.size - API_KEY_CACHE_MAX_ENTRIES;
    for (const key of apiKeyCache.keys()) {
      apiKeyCache.delete(key);
      toDelete--;
      if (toDelete <= 0) break;
    }
  }
}

async function resolveApiKey(keyHash) {
  const now = Date.now();
  pruneApiKeyCache(now);
  const cached = apiKeyCache.get(keyHash);
  if (cached && now - cached.timestamp < API_KEY_CACHE_TTL) {
    return cached.result;
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT ak.org_id, ak.role, ak.revoked_at
      FROM api_keys ak
      WHERE ak.key_hash = ${keyHash}
      LIMIT 1
    `;

    if (rows.length === 0) {
      apiKeyCache.set(keyHash, { timestamp: now, result: null });
      return null;
    }

    const row = rows[0];
    if (row.revoked_at) {
      apiKeyCache.set(keyHash, { timestamp: now, result: null });
      return null;
    }

    const result = { orgId: row.org_id, role: row.role };
    apiKeyCache.set(keyHash, { timestamp: now, result });

    // Update last_used_at (fire and forget)
    sql`UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE key_hash = ${keyHash}`.catch(() => {});

    return result;
  } catch (err) {
    console.error('[AUTH] API key lookup failed:', err.message);
    return null;
  }
}

// SECURITY: CORS - restrict to deployment origin
function getCorsHeaders(request) {
  const origin = request.headers.get('origin');
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '';

  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Max-Age': '86400',
  };

  // In dev mode (no ALLOWED_ORIGIN set), allow the requesting origin
  // In production, only allow the configured origin
  if (allowedOrigin && origin === allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  } else if (!allowedOrigin && process.env.NODE_ENV === 'development') {
    headers['Access-Control-Allow-Origin'] = origin || '*';
  }
  // In production with no match, no Access-Control-Allow-Origin header is set (blocks CORS)

  return headers;
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const mode = getDashclawMode();
  const demoCookie = isDemoCookieSet(request);

  // /demo is always a public entrypoint: it sets a non-secret cookie and forwards into the dashboard.
  // This makes the live demo work even if the deployment forgot to set DASHCLAW_MODE=demo.
  if (pathname === '/demo') {
    const response = NextResponse.redirect(new URL('/dashboard', request.url));
    response.cookies.set('dashclaw_demo', '1', {
      path: '/',
      maxAge: 60 * 60 * 24, // 24h
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    });
    addSecurityHeaders(response);
    return response;
  }

  // Demo sandbox mode:
  // - Serve the REAL dashboard UI.
  // - Back /api/* reads with deterministic fixtures.
  // - Block all writes (no secrets, no mutations).
  // Demo sandbox: cookie or explicit DASHCLAW_MODE=demo. Cookie only provides fixture data, never real data.
  // SECURITY: Only honor demo cookie when DASHCLAW_MODE=demo to prevent self-host bypass
  if (mode === 'demo') {
    if (pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') {
        return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
      }

      // SECURITY: Even demo mode should be rate limited.
      const trustProxy = ['1', 'true', 'yes', 'on'].includes(String(process.env.TRUST_PROXY || process.env.VERCEL || '').toLowerCase());
      const forwardedIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
      let ip = (trustProxy ? (forwardedIp || request.headers.get('x-real-ip')) : null) ||
               request.ip ||
               'unknown';
      if (ip === 'unknown' && process.env.NODE_ENV === 'development') {
        ip = forwardedIp || '127.0.0.1';
      }
      if (!(await checkRateLimit(ip))) {
        return demoJson(request, { error: 'Rate limit exceeded. Please slow down.' }, 429);
      }

      const method = request.method.toUpperCase();
      const isRead = method === 'GET' || method === 'HEAD';

      // Policy test runs are read-like (no mutation) — allow through demo write-block.
      if (pathname === '/api/policies/test' && method === 'POST') {
        const fixtures = getDemoFixtures();
        return demoJson(request, fixtures.policyTestResults);
      }

      if (!isRead) {
        return demoJson(request, { error: 'Demo mode: write APIs are disabled.' }, 403);
      }

      // Allow NextAuth internals and raw markdown passthrough (these do not write data).
      if (pathname.startsWith('/api/auth') || pathname.startsWith('/api/docs/raw') || pathname.startsWith('/api/prompts/')) {
        const response = NextResponse.next();
        addSecurityHeaders(response);
        withCors(request, response);
        return response;
      }

      const fixtures = getDemoFixtures();
      const url = parseUrl(request);
      const segments = getPathSegments(pathname);

      // SSE is allowed to keep UI stable. We attach demo org headers for getOrgId().
      if (pathname.startsWith('/api/stream')) {
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set('x-org-id', 'org_demo');
        requestHeaders.set('x-org-role', 'admin');
        const response = NextResponse.next({ request: { headers: requestHeaders } });
        addSecurityHeaders(response);
        withCors(request, response);
        return response;
      }

      // Health + onboarding
      if (pathname === '/api/health') {
        return demoJson(request, {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          version: 'demo',
          checks: { demo: { status: 'healthy' } },
        });
      }

      if (pathname === '/api/onboarding/status') {
        return demoJson(request, {
          onboarding_required: false,
          org_id: 'org_demo',
          steps: {
            workspace_created: true,
            api_key_exists: true,
            first_action_sent: true,
          },
        });
      }

      // Agents + actions
      if (pathname === '/api/agents') {
        return demoJson(request, demoAgents(fixtures));
      }

      if (pathname === '/api/actions') {
        return demoJson(request, demoListActions(fixtures, url));
      }

      if (pathname === '/api/actions/signals') {
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

      if (pathname === '/api/actions/loops') {
        const sp = url.searchParams;
        const agentId = sp.get('agent_id') || undefined;
        const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);
        const offset = parseInt(sp.get('offset') || '0', 10);
        let loops = fixtures.loops.slice();
        if (agentId) loops = loops.filter(l => l.agent_id === agentId);
        const total = loops.length;
        const paged = loops.slice(offset, offset + limit);
        const stats = {
          open_count: String(loops.length),
          resolved_count: '0',
          critical_open: String(loops.filter(l => l.priority === 'critical').length),
          high_open: String(loops.filter(l => l.priority === 'high').length),
        };
        return demoJson(request, { loops: paged, total, stats, lastUpdated: new Date().toISOString() });
      }

      if (pathname === '/api/actions/assumptions') {
        return demoJson(request, demoAssumptions(fixtures, url));
      }

      if (segments[0] === 'api' && segments[1] === 'actions' && segments.length === 3) {
        const actionId = segments[2];
        const detail = demoActionDetail(fixtures, actionId);
        if (!detail) return demoJson(request, { error: 'Action not found' }, 404);
        return demoJson(request, detail);
      }

      // Dashboard widgets
      if (pathname === '/api/goals') {
        return demoJson(request, { goals: fixtures.goals, stats: { totalGoals: fixtures.goals.length }, lastUpdated: new Date().toISOString() });
      }

      if (pathname === '/api/learning') {
        return demoJson(request, demoLearning(fixtures, url));
      }

      if (pathname === '/api/learning/recommendations') {
        return demoJson(request, demoLearningRecommendations(fixtures, url));
      }

      if (pathname === '/api/learning/recommendations/metrics') {
        return demoJson(request, demoLearningRecommendationMetrics(fixtures, url));
      }

      if (pathname === '/api/relationships') {
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

      if (pathname === '/api/calendar') {
        return demoJson(request, { events: fixtures.events, lastUpdated: new Date().toISOString(), count: fixtures.events.length });
      }

      if (pathname === '/api/inspiration') {
        return demoJson(request, { ideas: fixtures.ideas, stats: { totalIdeas: fixtures.ideas.length }, lastUpdated: new Date().toISOString() });
      }

      if (pathname === '/api/settings') {
        return demoJson(request, { settings: fixtures.settings });
      }

      if (pathname === '/api/policies') {
        return demoJson(request, demoPolicies(fixtures));
      }

      if (pathname === '/api/policies/proof') {
        const fmt = url.searchParams.get('format');
        if (fmt === 'json') {
          return demoJson(request, { report: fixtures.policyProofReport });
        }
        const response = new Response(fixtures.policyProofReport, {
          status: 200,
          headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
        });
        addSecurityHeaders(response);
        withCors(request, response);
        return response;
      }

      // ── Routing demo endpoints ──
      if (pathname === '/api/routing/health') {
        return demoJson(request, fixtures.routingHealth);
      }
      if (pathname === '/api/routing/stats') {
        return demoJson(request, fixtures.routingStats);
      }
      if (pathname === '/api/routing/agents') {
        return demoJson(request, { agents: fixtures.routingAgents });
      }
      if (pathname === '/api/routing/tasks') {
        return demoJson(request, { tasks: fixtures.routingTasks });
      }

      // ── Compliance demo endpoints ──
      if (pathname === '/api/compliance/frameworks') {
        return demoJson(request, { frameworks: fixtures.complianceFrameworks });
      }
      if (pathname === '/api/compliance/map') {
        const framework = url.searchParams.get('framework') || 'soc2';
        const mapped = fixtures.complianceMap[framework];
        if (!mapped) return demoJson(request, { error: `Unknown framework: ${framework}` }, 404);
        return demoJson(request, mapped);
      }
      if (pathname === '/api/compliance/gaps') {
        const framework = url.searchParams.get('framework') || 'soc2';
        const gaps = fixtures.complianceGaps[framework];
        if (!gaps) return demoJson(request, { error: `Unknown framework: ${framework}` }, 404);
        return demoJson(request, gaps);
      }
      if (pathname === '/api/compliance/evidence') {
        return demoJson(request, fixtures.complianceEvidence);
      }
      if (pathname === '/api/compliance/report') {
        const lines = [
          '# Compliance Report',
          '',
          `**Generated:** ${new Date().toISOString()}`,
          '',
          '## Framework Coverage',
          '',
        ];
        for (const fw of fixtures.complianceFrameworks) {
          const m = fixtures.complianceMap[fw.id];
          lines.push(`### ${fw.name}`);
          lines.push(`- Covered: ${m.coverage.covered}/${m.coverage.total}`);
          lines.push(`- Partial: ${m.coverage.partial}`);
          lines.push(`- Gaps: ${m.coverage.gaps}`);
          lines.push('');
        }
        lines.push('---', '*Generated by DashClaw Compliance Engine*');
        const report = lines.join('\n');
        const response = new Response(report, {
          status: 200,
          headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
        });
        addSecurityHeaders(response);
        withCors(request, response);
        return response;
      }

      // -- Evaluations demo endpoints --
      if (pathname === '/api/evaluations') {
        return demoJson(request, { scores: fixtures.evalScores, total: fixtures.evalScores.length });
      }
      if (pathname === '/api/evaluations/scorers') {
        return demoJson(request, { scorers: fixtures.evalScorers, llm_available: false });
      }
      if (pathname === '/api/evaluations/runs') {
        return demoJson(request, { runs: fixtures.evalRuns });
      }
      if (pathname === '/api/evaluations/stats') {
        return demoJson(request, fixtures.evalStats);
      }
      if (pathname === '/api/settings/llm-status') {
        return demoJson(request, { available: false, provider: null, model: null });
      }

      // -- Compliance Export demo endpoints --
      if (pathname === '/api/compliance/exports') {
        if (request.method === 'POST') {
          return demoJson(request, { id: 'ce_demo_new' }, 201);
        }
        return demoJson(request, { exports: [
          { id: 'ce_demo_001', name: 'Q4 SOC 2 Audit Package', frameworks: '["soc2","iso27001"]', format: 'markdown', window_days: 90, status: 'completed', file_size_bytes: 24680, requested_by: 'user', started_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), completed_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 8500).toISOString(), created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
          { id: 'ce_demo_002', name: 'NIST AI RMF Review', frameworks: '["nist-ai-rmf"]', format: 'markdown', window_days: 30, status: 'completed', file_size_bytes: 12340, requested_by: 'user', started_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), completed_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 5200).toISOString(), created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() },
          { id: 'ce_demo_003', name: 'Weekly Compliance Snapshot', frameworks: '["soc2"]', format: 'markdown', window_days: 7, status: 'completed', file_size_bytes: 8920, requested_by: 'scheduled', started_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), completed_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000 + 3100).toISOString(), created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() },
        ] });
      }
      if (pathname.match(/^\/api\/compliance\/exports\/[^/]+$/)) {
        return demoJson(request, { id: pathname.split('/').pop(), name: 'Demo Export', status: 'completed', report_content: '# SOC 2 Compliance Report -- Agent Operations\n\n**Project:** org-demo  \n**Generated:** ' + new Date().toISOString() + '  \n**Risk Level:** LOW\n\n## Executive Summary\n\n| Metric | Value |\n|---|---|\n| Framework | SOC 2 |\n| Total Controls | 12 |\n| Covered | 9 |\n| Partial | 2 |\n| Gaps | 1 |\n| **Coverage** | **83%** |\n\n## Enforcement Evidence\n\n**Window:** 30 days  \n**Total Guard Decisions:** 847  \n**Blocked:** 23  \n**Action Records:** 1,204' });
      }
      if (pathname === '/api/compliance/schedules') {
        if (request.method === 'POST') return demoJson(request, { id: 'csch_demo_new' }, 201);
        return demoJson(request, { schedules: [
          { id: 'csch_demo_001', name: 'Weekly SOC 2 Snapshot', frameworks: '["soc2"]', format: 'markdown', window_days: 7, cron_expression: '0 9 * * 1', enabled: true, last_run_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() },
          { id: 'csch_demo_002', name: 'Monthly Full Audit', frameworks: '["soc2","iso27001","nist-ai-rmf"]', format: 'markdown', window_days: 30, cron_expression: '0 9 1 * *', enabled: true, last_run_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString() },
        ] });
      }
      if (pathname === '/api/compliance/trends') {
        return demoJson(request, { trends: [
          { framework: 'soc2', coverage_percentage: 83, covered: 9, partial: 2, gaps: 1, risk_level: 'LOW', created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() },
          { framework: 'soc2', coverage_percentage: 79, covered: 8, partial: 3, gaps: 1, risk_level: 'MEDIUM', created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() },
          { framework: 'soc2', coverage_percentage: 75, covered: 8, partial: 2, gaps: 2, risk_level: 'MEDIUM', created_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString() },
          { framework: 'iso27001', coverage_percentage: 71, covered: 7, partial: 3, gaps: 4, risk_level: 'MEDIUM', created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
          { framework: 'iso27001', coverage_percentage: 64, covered: 6, partial: 3, gaps: 5, risk_level: 'HIGH', created_at: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString() },
        ] });
      }

      // -- Prompt Management demo endpoints --
      if (pathname === '/api/prompts/templates') {
        return demoJson(request, { templates: fixtures.promptTemplates });
      }
      if (pathname.match(/^\/api\/prompts\/templates\/[^/]+$/)) {
        const id = pathname.split('/').pop();
        const tmpl = fixtures.promptTemplates.find(t => t.id === id);
        return tmpl ? demoJson(request, tmpl) : demoJson(request, { error: 'Not found' }, 404);
      }
      if (pathname.match(/^\/api\/prompts\/templates\/[^/]+\/versions$/)) {
        const templateId = pathname.split('/')[4];
        const versions = fixtures.promptVersions[templateId] || [];
        return demoJson(request, { versions });
      }
      if (pathname === '/api/prompts/render') {
        return demoJson(request, { rendered: 'Analyze the following agent decision and rate quality 1-10.\n\nAgent: ClawdBot\nAction: deploy\nGoal: Deploy latest build\nOutcome: Success\n\nCriteria:\n- Goal alignment\n- Risk awareness\n- Efficiency\n\nProvide a structured assessment.', version_id: 'pv_demo_001_3', template_id: 'pt_demo_001', version: 3, parameters: ['agent_name', 'action_type', 'declared_goal', 'outcome'] });
      }
      if (pathname === '/api/prompts/runs') {
        return demoJson(request, { runs: fixtures.promptRuns });
      }
      if (pathname === '/api/prompts/stats') {
        return demoJson(request, fixtures.promptStats);
      }

      // -- Feedback demo endpoints --
      if (pathname === '/api/feedback') {
        if (request.method === 'GET') {
          const url = new URL(request.url);
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
      if (pathname.match(/^\/api\/feedback\/stats$/)) {
        return demoJson(request, fixtures.feedbackStats);
      }
      if (pathname.match(/^\/api\/feedback\/[^/]+$/)) {
        const id = pathname.split('/').pop();
        const fb = fixtures.feedbackEntries.find(e => e.id === id);
        return fb ? demoJson(request, fb) : demoJson(request, { error: 'Not found' }, 404);
      }

      // -- Drift Detection demo endpoints --
      if (pathname === '/api/drift/alerts') {
        if (request.method === 'POST') {
          return demoJson(request, { baselines_computed: 5, alerts_generated: 2, results: [], alerts: [] }, 201);
        }
        return demoJson(request, { alerts: fixtures.driftAlerts, total: fixtures.driftAlerts.length });
      }
      if (pathname.match(/^\/api\/drift\/alerts\/[^/]+$/)) {
        return demoJson(request, { ...fixtures.driftAlerts[0], acknowledged: true });
      }
      if (pathname === '/api/drift/stats') {
        return demoJson(request, fixtures.driftStats);
      }
      if (pathname === '/api/drift/snapshots') {
        return demoJson(request, { snapshots: fixtures.driftSnapshots });
      }
      if (pathname === '/api/drift/metrics') {
        return demoJson(request, { metrics: [
          { id: 'risk_score', label: 'Risk Score' },
          { id: 'confidence', label: 'Confidence' },
          { id: 'duration_ms', label: 'Duration (ms)' },
          { id: 'cost_estimate', label: 'Cost Estimate' },
          { id: 'tokens_total', label: 'Total Tokens' },
          { id: 'learning_score', label: 'Learning Score' },
        ] });
      }

      if (pathname === '/api/guard') {
        return demoJson(request, demoGuard(fixtures, url));
      }

      if (pathname === '/api/messages') {
        return demoJson(request, demoMessages(fixtures, url));
      }

      if (pathname === '/api/messages/threads') {
        return demoJson(request, demoMessageThreads(fixtures, url));
      }

      if (pathname === '/api/messages/docs') {
        return demoJson(request, demoMessageDocs(fixtures, url));
      }

      if (pathname === '/api/content') {
        return demoJson(request, demoContent(fixtures, url));
      }

      if (pathname === '/api/agents/connections') {
        const agentId = url.searchParams.get('agent_id');
        const connections = agentId ? fixtures.connections.filter(c => c.agent_id === agentId) : fixtures.connections;
        return demoJson(request, { connections, total: connections.length });
      }

      if (pathname === '/api/team') {
        return demoJson(request, demoTeam(fixtures));
      }

      if (pathname === '/api/team/invite') {
        return demoJson(request, demoTeamInvites(fixtures));
      }

      if (pathname === '/api/activity') {
        return demoJson(request, demoActivity(fixtures, url));
      }

      if (pathname === '/api/webhooks') {
        return demoJson(request, demoWebhooks(fixtures));
      }

      if (segments[0] === 'api' && segments[1] === 'webhooks' && segments.length === 4 && segments[3] === 'deliveries') {
        const webhookId = segments[2];
        return demoJson(request, demoWebhookDeliveries(fixtures, webhookId));
      }

      if (pathname === '/api/workflows') {
        return demoJson(request, demoWorkflows(fixtures, url));
      }

      if (pathname === '/api/schedules') {
        return demoJson(request, demoSchedules(fixtures));
      }

      if (pathname === '/api/digest') {
        return demoJson(request, demoDigest(fixtures, url));
      }

      if (pathname === '/api/context/points') {
        return demoJson(request, demoContextPoints(fixtures, url));
      }

      if (pathname === '/api/context/threads') {
        return demoJson(request, demoContextThreads(fixtures, url));
      }

      if (segments[0] === 'api' && segments[1] === 'context' && segments[2] === 'threads' && segments.length === 4) {
        const threadId = segments[3];
        const detail = demoContextThreadDetail(fixtures, threadId);
        if (!detail) return demoJson(request, { error: 'Thread not found' }, 404);
        return demoJson(request, detail);
      }

      if (pathname === '/api/handoffs') {
        return demoJson(request, demoHandoffs(fixtures, url));
      }

      if (pathname === '/api/snippets') {
        return demoJson(request, demoSnippets(fixtures, url));
      }

      if (pathname === '/api/preferences') {
        const payload = demoPreferences(fixtures, url);
        const status = payload?.error ? 400 : 200;
        return demoJson(request, payload, status);
      }

      if (pathname === '/api/memory') {
        return demoJson(request, { ...fixtures.memory, lastUpdated: new Date().toISOString() });
      }

      if (pathname === '/api/tokens') {
        return demoJson(request, demoTokens(fixtures));
      }

      if (pathname === '/api/usage') {
        return demoJson(request, fixtures.usage);
      }

      if (pathname === '/api/swarm/graph') {
        return demoJson(request, demoSwarmGraph(fixtures, url));
      }

      if (pathname === '/api/security/status') {
        return demoJson(request, fixtures.securityStatus);
      }

      if (pathname === '/api/pairings') {
        const status = url.searchParams.get('status') || 'pending';
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
        const pairings = fixtures.pairings.filter(p => p.status === status).slice(0, limit);
        return demoJson(request, { pairings });
      }

      if (segments[0] === 'api' && segments[1] === 'pairings' && segments.length === 3) {
        const pairingId = segments[2];
        const pairing = fixtures.pairings.find(p => p.id === pairingId) || null;
        if (!pairing) return demoJson(request, { error: 'Pairing not found' }, 404);
        return demoJson(request, { pairing });
      }

      return demoJson(request, { error: 'Demo mode: endpoint disabled.' }, 403);
    }

    // Demo pages are public: skip NextAuth session enforcement.
    return NextResponse.next();
  }

  // Page routes (non-API): check NextAuth session
  if (!pathname.startsWith('/api/')) {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

    // /login — redirect to dashboard if already logged in
    if (pathname === '/login') {
      if (token) return NextResponse.redirect(new URL('/dashboard', request.url));
      return NextResponse.next();
    }

    // Landing page is always public
    if (pathname === '/') {
      return NextResponse.next();
    }

    // All other matched page routes — require session
    if (!token) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return NextResponse.next();
  }

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
  }

  // SECURITY: Always strip externally-provided org context headers for API routes.
  // Only middleware should inject these after authenticating the request.
  const strippedApiRequestHeaders = (() => {
    const h = new Headers(request.headers);
    h.delete('x-org-id');
    h.delete('x-org-role');
    h.delete('x-user-id');
    h.delete('x-client-ip');
    return h;
  })();

  // Get client IP for rate limiting.
  // SECURITY: In self-host deployments, x-forwarded-for may be attacker-controlled unless you trust your proxy.
  // SECURITY: Only trust proxy headers (x-forwarded-for, x-real-ip) when TRUST_PROXY is enabled.
  const trustProxy = ['1', 'true', 'yes', 'on'].includes(String(process.env.TRUST_PROXY || process.env.VERCEL || '').toLowerCase());
  const forwardedIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  let ip = (trustProxy ? (forwardedIp || request.headers.get('x-real-ip')) : null) ||
           request.ip ||
           'unknown';
  if (ip === 'unknown' && process.env.NODE_ENV === 'development') {
    ip = forwardedIp || '127.0.0.1';
  }

  // SECURITY: Apply rate limiting to all API routes, including PUBLIC_ROUTES.
  // PUBLIC_ROUTES are unauthenticated but still should not be abusable for DoS/brute force.
  if (!(await checkRateLimit(ip))) {
    console.warn(`[SECURITY] Rate limit exceeded for ${ip}: ${pathname}`);
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please slow down.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  // SECURITY: Reject oversized request bodies to prevent DoS.
  // Applies to all write methods (POST, PUT, PATCH) on API routes.
  const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB
  const writeMethod = ['POST', 'PUT', 'PATCH'].includes(request.method);
  if (writeMethod) {
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: 'Request body too large', maxBytes: MAX_BODY_BYTES },
        { status: 413 }
      );
    }
  }

  // Allow public routes without auth
  if (PUBLIC_ROUTES.some(route => pathname.startsWith(route))) {
    const publicHeaders = new Headers(strippedApiRequestHeaders);
    publicHeaders.set('x-client-ip', ip);
    const response = NextResponse.next({ request: { headers: publicHeaders } });
    for (const [k, v] of Object.entries(getCorsHeaders(request))) response.headers.set(k, v);
    return response;
  }

  // SECURITY: Default-deny for /api/* except explicit PUBLIC_ROUTES above.
  // This prevents new endpoints from silently becoming unauthenticated.
  const isProtectedRoute = true;

  if (isProtectedRoute) {
    // SECURITY: Only accept API key via header (not query params - those leak in logs/URLs)
    const apiKey = request.headers.get('x-api-key');

    // Get expected API key from environment
    const expectedKey = process.env.DASHCLAW_API_KEY;

    // SECURITY: Start from stripped headers (prevent injection).
    const requestHeaders = new Headers(strippedApiRequestHeaders);
    // SECURITY: Provide a trusted client IP header for audit logging (never trust inbound x-forwarded-for directly).
    requestHeaders.set('x-client-ip', ip);

    // If no API key is configured:
    // - dev/local: allow with org_default (convenience)
    // - production: block (prevents accidentally exposing your dashboard data)
    if (!expectedKey) {
      // SECURITY: Fail closed if not strictly in development mode
      if (process.env.NODE_ENV !== 'development') {
        console.warn(`[SECURITY] DASHCLAW_API_KEY not set - blocking access to: ${pathname}`);
        return NextResponse.json(
          { error: 'Server misconfigured: set DASHCLAW_API_KEY to protect /api/* endpoints.' },
          { status: 503 }
        );
      }
      // Dev mode: allow through with default org
      requestHeaders.set('x-org-id', 'org_default');
      requestHeaders.set('x-org-role', 'admin');
      const response = NextResponse.next({ request: { headers: requestHeaders } });
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.set('X-Frame-Options', 'DENY');
      response.headers.set('X-XSS-Protection', '1; mode=block');
      response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      for (const [k, v] of Object.entries(getCorsHeaders(request))) response.headers.set(k, v);
      return response;
    }

    // No key provided — check if this is a same-origin dashboard request
    if (!apiKey) {
      const secFetchSite = request.headers.get('sec-fetch-site');
      
      // SECURITY: Only trust Sec-Fetch-Site for same-origin detection.
      const isSameOrigin = secFetchSite === 'same-origin';

      if (isSameOrigin) {
        // Resolve org from NextAuth session token
        const sessionToken = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
        
        if (!sessionToken) {
          return NextResponse.json({ error: 'Unauthorized - Session required' }, { status: 401 });
        }

        const orgId = sessionToken.orgId || 'org_default';
        const role = sessionToken.role || 'member';


        // SECURITY: Users on org_default are only allowed to access onboarding and health APIs
        const ONBOARDING_PREFIXES = ['/api/onboarding', '/api/setup', '/api/health'];
        const isAllowedForOnboarding = ONBOARDING_PREFIXES.some(p => pathname.startsWith(p));

        if (orgId === 'org_default' && !isAllowedForOnboarding) {
          console.warn(`[SECURITY] Blocked org_default access to: ${pathname} from user ${sessionToken.userId}`);
          return NextResponse.json(
            { error: 'Forbidden - Complete onboarding to access this resource', needsOnboarding: true },
            { status: 403 }
          );
        }

        requestHeaders.set('x-org-id', orgId);
        requestHeaders.set('x-org-role', role);
        requestHeaders.set('x-user-id', sessionToken.userId || '');
        const response = NextResponse.next({ request: { headers: requestHeaders } });
        response.headers.set('X-Content-Type-Options', 'nosniff');
        response.headers.set('X-Frame-Options', 'DENY');
        response.headers.set('X-XSS-Protection', '1; mode=block');
        for (const [k, v] of Object.entries(getCorsHeaders(request))) response.headers.set(k, v);
        return response;
      }

      console.warn(`[SECURITY] Missing API key: ${pathname} from ${ip}`);
      return NextResponse.json(
        { error: 'Unauthorized - Invalid or missing API key' },
        { status: 401 }
      );
    }

    // Fast path: DASHCLAW_API_KEY matches → configured org (default: org_default)
    if (timingSafeEqual(apiKey, expectedKey)) {
      const configuredOrgId = process.env.DASHCLAW_API_KEY_ORG || 'org_default';

      // Validate that the configured org actually exists in the database (cached).
      const orgExists = await verifyOrgExists(configuredOrgId);
      if (!orgExists) {
        console.error('[SECURITY] DASHCLAW_API_KEY_ORG is set to a value that does not exist in the organizations table. Run migrations or create the org.');
        // SECURITY: Do not leak the configured org ID to the client or logs.
        return NextResponse.json(
          { error: 'Server misconfigured: configured org does not exist. Check server logs and run migrations.' },
          { status: 503 }
        );
      }

      requestHeaders.set('x-org-id', configuredOrgId);
      requestHeaders.set('x-org-role', 'admin');

      // SECURITY: Enforce readonly semantics for API keys.
      if (request.method !== 'GET' && request.method !== 'HEAD' && requestHeaders.get('x-org-role') === 'readonly') {
        return NextResponse.json({ error: 'Forbidden - readonly API key' }, { status: 403 });
      }

      const response = NextResponse.next({ request: { headers: requestHeaders } });
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.set('X-Frame-Options', 'DENY');
      response.headers.set('X-XSS-Protection', '1; mode=block');
      for (const [k, v] of Object.entries(getCorsHeaders(request))) response.headers.set(k, v);
      return response;
    }

    // Slow path: hash the key and look up in api_keys table
    const keyHash = await hashApiKey(apiKey);
    const resolved = await resolveApiKey(keyHash);

    if (!resolved) {
      console.warn(`[SECURITY] Unauthorized API access attempt: ${pathname} from ${ip}`);
      return NextResponse.json(
        { error: 'Unauthorized - Invalid or missing API key' },
        { status: 401 }
      );
    }

    requestHeaders.set('x-org-id', resolved.orgId);
    requestHeaders.set('x-org-role', resolved.role);

    // SECURITY: Enforce readonly semantics for API keys.
    if (request.method !== 'GET' && request.method !== 'HEAD' && resolved.role === 'readonly') {
      return NextResponse.json({ error: 'Forbidden - readonly API key' }, { status: 403 });
    }

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('X-XSS-Protection', '1; mode=block');
    for (const [k, v] of Object.entries(getCorsHeaders(request))) response.headers.set(k, v);
    return response;
  }

  // Non-protected API routes: add security headers + CORS
  const response = NextResponse.next({ request: { headers: strippedApiRequestHeaders } });
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  for (const [k, v] of Object.entries(getCorsHeaders(request))) response.headers.set(k, v);

  return response;
}

export const config = {
  matcher: [
    '/',
    '/api/:path*',
    '/demo',
    '/dashboard',
    '/dashboard/:path*',
    '/mission-control',
    '/mission-control/:path*',
    '/swarm',
    '/swarm/:path*',
    '/approvals',
    '/approvals/:path*',
    '/actions',
    '/actions/:path*',
    '/goals',
    '/goals/:path*',
    '/learning',
    '/learning/:path*',
    '/content',
    '/content/:path*',
    '/relationships',
    '/relationships/:path*',
    '/integrations',
    '/integrations/:path*',
    '/workflows',
    '/workflows/:path*',
    '/pair',
    '/pair/:path*',
    '/pairings',
    '/pairings/:path*',
    '/bug-hunter',
    '/bug-hunter/:path*',
    '/calendar',
    '/calendar/:path*',
    '/security',
    '/security/:path*',
    '/tokens',
    '/tokens/:path*',
    '/setup',
    '/setup/:path*',
    '/api-keys',
    '/api-keys/:path*',
    '/team',
    '/team/:path*',
    '/usage',
    '/usage/:path*',
    '/activity',
    '/activity/:path*',
    '/webhooks',
    '/webhooks/:path*',
    '/notifications',
    '/notifications/:path*',
    '/messages',
    '/messages/:path*',
    '/workspace',
    '/workspace/:path*',
    '/policies',
    '/policies/:path*',
    '/routing',
    '/routing/:path*',
    '/compliance',
    '/compliance/:path*',
    '/drift',
    '/drift/:path*',
    '/api/drift/:path*',
    '/api/compliance/exports/:path*',
    '/api/compliance/schedules/:path*',
    '/api/compliance/trends',
    '/evaluations',
    '/evaluations/:path*',
    '/api/evaluations/:path*',
    '/feedback',
    '/feedback/:path*',
    '/api/feedback/:path*',
    '/prompts',
    '/prompts/:path*',
    '/api/prompts/:path*',
    '/api/settings/llm-status',
    '/invite/:path*',
    '/login',
  ],
};
