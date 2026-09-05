import { getHomepageDemoActions } from '../homepageDemoActions';
import { describeAction } from '../plain-language';
import { buildDemoSessionList, buildDemoSessionActions } from './demoMiddleware.sessions';

// Demo fixtures are dynamically-shaped demo data assembled fresh per request.
// They are an external boundary to this module, so collections are typed loosely.
export type AnyRecord = Record<string, any>;

export interface DemoFixtures {
  actions: AnyRecord[];
  assumptions: AnyRecord[];
  guardDecisions?: AnyRecord[];
  guardReads?: AnyRecord[];
  policies: AnyRecord[];
  decisions: AnyRecord[];
  lessons: AnyRecord[];
  recommendations: AnyRecord[];
  metrics: AnyRecord[];
  metricsSummary?: AnyRecord;
  tokensCurrent?: AnyRecord;
  tokensToday?: AnyRecord;
  tokenHistory: AnyRecord[];
  content?: AnyRecord[];
  teamMembers?: AnyRecord[];
  teamInvites?: AnyRecord[];
  activityLogs?: AnyRecord[];
  webhooks: AnyRecord[];
  webhookDeliveries?: Record<string, AnyRecord[]>;
  schedules: AnyRecord[];
  digest?: AnyRecord | null;
  contextPoints?: AnyRecord[];
  contextThreads?: AnyRecord[];
  preferences: Record<string, AnyRecord>;
  policyProofReport?: string;
  policyTestResults?: AnyRecord;
  decisionMetrics?: AnyRecord;
  [key: string]: any;
}

// Deterministic demo data for the 1-Minute Governance Test
const DEMO_TEST_ACTION_ID = 'ar_demo_deploy_block_001';
const demoTestAction: AnyRecord = {
  action_id: DEMO_TEST_ACTION_ID,
  org_id: 'org_demo',
  agent_id: 'openai-deployer-1',
  agent_name: 'OpenAI Deployer',
  action_type: 'deploy',
  declared_goal: 'Deploy latest build to production',
  status: 'failed',
  risk_score: 85,
  confidence: 100,
  timestamp_start: new Date().toISOString(),
  timestamp_end: new Date().toISOString(),
  verified: true,
};
// Containment Verdicts (v5.6.0) demo: one staged action awaiting the // version-hardcode-allowed
// operator's promote/discard verdict, with a believable patch artifact
// behind it, so the /approvals containment card renders end to end on the
// demo host. Fields match the enriched list-row contract ContainmentCard
// reads (containment_has_evidence gates Promote; the ref is the reviewed
// diff's branch).
const DEMO_CONTAINED_ACTION_ID = 'ar_demo_contained_001';
const DEMO_CONTAINED_REF = 'dashclaw/contained-demo9f31-a1b2c3';
const demoContainedAction: AnyRecord = {
  action_id: DEMO_CONTAINED_ACTION_ID,
  org_id: 'org_demo',
  agent_id: 'refactor-agent-2',
  agent_name: 'Refactor Agent',
  action_type: 'code_change',
  declared_goal: 'Rename the billing retry helper and update its 14 call sites',
  status: 'completed',
  risk_score: 58,
  confidence: 92,
  timestamp_start: new Date(Date.now() - 40 * 60_000).toISOString(),
  timestamp_end: new Date(Date.now() - 32 * 60_000).toISOString(),
  verified: true,
  containment_status: 'awaiting_promotion',
  containment_ref: DEMO_CONTAINED_REF,
  containment_has_evidence: true,
  containment_evidence_ref: DEMO_CONTAINED_REF,
};

// Database containment (RFC 2026-09-04) demo: the second staging medium. Same // version-hardcode-allowed
// card, same lifecycle, same buttons — the evidence is the statement, the
// schema diff Neon reports, and the output tail instead of a worktree diff,
// and Promote reads "replay on production". Present so /approvals renders the
// db card on the demo host with no Neon account.
const DEMO_CONTAINED_DB_ACTION_ID = 'ar_demo_contained_db_001';
const DEMO_CONTAINED_DB_REF = 'dashclaw/contained-db-demo9f31-a1b2c3';
const demoContainedDbAction: AnyRecord = {
  action_id: DEMO_CONTAINED_DB_ACTION_ID,
  org_id: 'org_demo',
  agent_id: 'migration-agent-1',
  agent_name: 'Migration Agent',
  action_type: 'code_change',
  declared_goal: 'Add the billing tier column to users and backfill it',
  status: 'completed',
  risk_score: 75,
  confidence: 88,
  timestamp_start: new Date(Date.now() - 22 * 60_000).toISOString(),
  timestamp_end: new Date(Date.now() - 19 * 60_000).toISOString(),
  verified: true,
  containment_status: 'awaiting_promotion',
  containment_ref: DEMO_CONTAINED_DB_REF,
  containment_has_evidence: true,
  containment_evidence_ref: DEMO_CONTAINED_DB_REF,
};

/** GET /api/actions/:id/artifacts — the contained demo actions each carry one
 *  patch artifact (the evidence the operator reviews before Promote). */
export function demoActionArtifacts(actionId: string) {
  if (actionId === DEMO_CONTAINED_DB_ACTION_ID) {
    return {
      artifacts: [
        {
          artifact_id: 'art_demo_patch_db_001',
          action_id: DEMO_CONTAINED_DB_ACTION_ID,
          artifact_type: 'patch',
          created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
          content: {
            kind: 'db',
            ref: DEMO_CONTAINED_DB_REF,
            project_id: 'demo-project-9f31',
            branch_id: 'br-demo-contained-9f31',
            parent_branch_id: 'br-demo-main-0001',
            db_name: 'appdb',
            statement: 'psql -c "ALTER TABLE users ADD COLUMN billing_tier text NOT NULL DEFAULT \'free\'"',
            diff: [
              '--- a/public.users',
              '+++ b/public.users',
              '@@',
              ' CREATE TABLE public.users (',
              '   id uuid NOT NULL,',
              '   email text NOT NULL,',
              "+  billing_tier text DEFAULT 'free'::text NOT NULL,",
              '   created_at timestamptz DEFAULT now()',
              ' );',
            ].join('\n'),
            stdout_tail: 'ALTER TABLE\nTime: 41.882 ms',
            note: 'schema unchanged — data changes are not diffable; review the statement and its output',
          },
        },
      ],
    };
  }
  if (actionId !== DEMO_CONTAINED_ACTION_ID) return { artifacts: [] };
  return {
    artifacts: [
      {
        artifact_id: 'art_demo_patch_001',
        action_id: DEMO_CONTAINED_ACTION_ID,
        artifact_type: 'patch',
        created_at: new Date(Date.now() - 33 * 60_000).toISOString(),
        content: {
          ref: DEMO_CONTAINED_REF,
          stat: ' app/lib/billing/retry.ts | 18 +++++++++---------\n 14 files changed, 41 insertions(+), 38 deletions(-)',
          diff: [
            'diff --git a/app/lib/billing/retry.ts b/app/lib/billing/retry.ts',
            '--- a/app/lib/billing/retry.ts',
            '+++ b/app/lib/billing/retry.ts',
            '@@ -12,9 +12,9 @@',
            '-export async function retryPayment(invoiceId: string) {',
            '+export async function retryFailedPayment(invoiceId: string) {',
            '   const invoice = await getInvoice(invoiceId);',
            '   if (!invoice) return null;',
            '-  return schedule(retryPayment, invoiceId, BACKOFF_MS);',
            '+  return schedule(retryFailedPayment, invoiceId, BACKOFF_MS);',
            ' }',
          ].join('\n'),
          truncated: false,
          untracked: [],
        },
      },
    ],
  };
}

export const demoTestEval: AnyRecord = {
  id: `gd_demo_deploy_001`,
  agent_id: 'openai-deployer-1',
  agent_name: 'OpenAI Deployer',
  action_type: 'deploy',
  decision: 'require_approval',
  action_id: DEMO_TEST_ACTION_ID,
  reason: '[Demo mode] Sandbox fixture matched this action — this is not a real policy decision. If you see this from a real agent, your DASHCLAW_BASE_URL is pointed at a demo instance.',
  matched_policies: ['[Demo fixture] Production Guard'],
  risk_score: 85,
  created_at: new Date().toISOString(),
  signals: []
};

// Slim demo agent roster, derived from the demo action fixtures (mirrors the
// real GET /api/agents, which lists distinct agents from action_records). The
// shared agent-filter picker fetches this on every demo page; without it the
// demo dispatch 403s and every sandbox page logs a console error.
export function demoAgents(fixtures: DemoFixtures) {
  const map = new Map<string, AnyRecord>();
  const allActions = [demoTestAction, ...fixtures.actions];
  for (const a of allActions) {
    const prev = map.get(a.agent_id) || { agent_id: a.agent_id, agent_name: a.agent_name, action_count: 0, last_active: null };
    prev.action_count += 1;
    const ts = a.timestamp_start || null;
    if (ts && (!prev.last_active || ts > prev.last_active)) prev.last_active = ts;
    map.set(a.agent_id, prev);
  }
  const agents = Array.from(map.values()).sort((a, b) => (b.last_active || '').localeCompare(a.last_active || ''));
  return { agents, lastUpdated: new Date().toISOString() };
}

export function demoListActions(fixtures: DemoFixtures, url: URL) {
  const sp = url.searchParams;
  const agentId = sp.get('agent_id') || undefined;
  const status = sp.get('status') || undefined;
  const actionType = sp.get('action_type') || undefined;
  const containmentStatus = sp.get('containment_status') || undefined;
  const riskMinRaw = sp.get('risk_min');
  const riskMin = riskMinRaw ? parseInt(riskMinRaw, 10) : undefined;
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);
  const offset = parseInt(sp.get('offset') || '0', 10);

  // Combine deterministic demo actions with fixtures
  let items = [demoTestAction, demoContainedAction, demoContainedDbAction, ...fixtures.actions];

  if (agentId) items = items.filter(a => a.agent_id === agentId);
  if (status) items = items.filter(a => a.status === status);
  if (actionType) items = items.filter(a => a.action_type === actionType);
  // Same allowlist semantics as the real route (parseListActionsFilters): a
  // valid value filters, an invalid one is ignored. Before this filter
  // existed, the /approvals containment section rendered EVERY demo action
  // as an awaiting-promotion card on the demo host.
  if (containmentStatus && ['contained', 'awaiting_promotion', 'promoted', 'discarded'].includes(containmentStatus)) {
    items = items.filter(a => a.containment_status === containmentStatus);
  }
  if (Number.isFinite(riskMin)) items = items.filter(a => (parseInt(a.risk_score, 10) || 0) >= (riskMin as number));

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

  // Plain-language parity with the real route (app/api/actions/route.ts):
  // only the pending-approval queue is enriched, so every other demo list
  // keeps its existing payload. Without this the demo sandbox rendered raw
  // commands while the landing page advertised the plain-English sentence —
  // a prospect clicking through the demo saw the claim contradicted.
  // There are no guard-decision contexts in demo mode, so the intel comes
  // off the fixture row itself.
  const enriched = status === 'pending_approval'
    ? paged.map((a) => ({
        ...a,
        plain: describeAction({
          action_type: a.action_type,
          declared_goal: a.declared_goal,
          risk_score: parseInt(a.risk_score, 10) || 0,
          target: a.target ?? null,
          intel: a.intel ?? null,
        }),
      }))
    : paged;

  return { actions: enriched, total, stats, lastUpdated: new Date().toISOString() };
}

export function demoCreateAction(fixtures: DemoFixtures, body: AnyRecord) {
  // Use a high-impact blocked story for simulator bot
  const isSimulator = body.agent_id === 'simulator-bot';
  const isDemoAgent = body.agent_id === 'openai-deployer-1';
  const isPipelineAgent = body.agent_id === 'pipeline-agent';

  // ID prefix encodes the demo story so demoActionDetail can reconstruct it
  // on replay without relying on fixture mutation (fixtures are rebuilt fresh
  // per-request, so fixtures.actions.unshift() from this call won't survive).
  const defaultPrefix = isPipelineAgent ? 'act_pipe_' : 'act_sim_';
  const action_id = body.action_id || `${defaultPrefix}${Math.random().toString(36).slice(2, 10)}`;

  const now = new Date().toISOString();
  const action = {
    ...body,
    action_id,
    org_id: 'org_demo',
    agent_name: body.agent_name || body.agent_id || 'refund-support-agent',
    timestamp_start: body.timestamp_start || now,
    status: (isSimulator || isDemoAgent) ? 'failed' : (body.status || 'completed'),
    risk_score: isSimulator ? 92 : (body.risk_score || 0),
    confidence: isSimulator ? 88 : (body.confidence || 100),
    declared_goal: isSimulator ? 'CHARGE: Stripe Customer sub_12345 -- $12,000.00' : (body.declared_goal || 'Send refund confirmation email'),
    verified: true,
  };

  // Persist it in the demo fixtures so the replay page can read it back
  if (fixtures.actions) {
    // Check if it already exists to avoid duplicates
    const exists = fixtures.actions.findIndex(a => a.action_id === action_id);
    if (exists !== -1) {
      fixtures.actions[exists] = { ...fixtures.actions[exists], ...action };
    } else {
      fixtures.actions.unshift(action);
    }
  }

  // Inject a real guard decision for pipeline-agent so replay shows correct policy data
  if (isPipelineAgent && fixtures.guardDecisions) {
    const riskScore = body.risk_score || 94;
    const guardDecision = {
      id: `gd_${action_id}`,
      org_id: 'org_demo',
      action_id,
      agent_id: 'pipeline-agent',
      agent_name: 'Pipeline Agent',
      action_type: body.action_type || 'cleanup',
      decision: 'block',
      risk_score: riskScore,
      reason: `Risk score ${riskScore} exceeds org threshold of 75. Irreversible operations on customer data require explicit approval.`,
      matched_policies: JSON.stringify(['PRODUCTION_DATA_PROTECTION']),
      created_at: now,
      signals: [],
    };
    fixtures.guardDecisions.unshift(guardDecision);
  }

  const isPipelineBlock = isPipelineAgent;
  return {
    action,
    action_id,
    decision: {
      decision: (isSimulator || isDemoAgent || isPipelineBlock) ? 'block' : 'allow',
      reason: isSimulator
        ? 'Risk score 92 exceeds automation threshold for financial operations.'
        : isDemoAgent ? '[Demo mode] Sandbox fixture matched this action — this is not a real policy decision. If you see this from a real agent, your DASHCLAW_BASE_URL is pointed at a demo instance.'
        : isPipelineBlock ? `Risk score ${body.risk_score || 94} exceeds org threshold of 75. Policy PRODUCTION_DATA_PROTECTION enforced.`
        : 'Demo mode simulation auto-permitted.',
      matched_policies: (isSimulator || isDemoAgent) ? ['[Demo fixture] Production Guard'] : isPipelineBlock ? ['PRODUCTION_DATA_PROTECTION'] : []
    },
    security: { clean: true, findings_count: 0 }
  };
}

export function demoActionDetail(fixtures: DemoFixtures, actionId: string): AnyRecord | null {
  // Always return the deterministic demo test action so the replay works flawlessly
  if (actionId === DEMO_TEST_ACTION_ID) {
    return {
      action: demoTestAction,
      open_loops: [],
      assumptions: [
        { assumption_id: `asm_demo_1`, action_id: actionId, assumption: 'Demo environment is active', basis: 'Local run', validated: 1 }
      ],
      decision: demoTestEval.decision,
      decision_reason: demoTestEval.reason
    };
  }

  // The contained demo action resolves like the test action — it lives in
  // this module, not fixtures.actions, so the fall-through below misses it.
  if (actionId === DEMO_CONTAINED_ACTION_ID) {
    return {
      action: demoContainedAction,
      open_loops: [],
      assumptions: [],
      decision: 'allow_contained',
      decision_reason: '[Demo fixture] Risk 58 with a containment-eligible act: the work ran on an isolated branch; results merge only after an operator promotes the reviewed diff.',
    };
  }

  if (actionId === DEMO_CONTAINED_DB_ACTION_ID) {
    return {
      action: demoContainedDbAction,
      open_loops: [],
      assumptions: [],
      decision: 'allow_contained',
      decision_reason: '[Demo fixture] Risk 75 on a database act: the statement ran against an ephemeral branch of the database; it reaches production only after an operator promotes the reviewed statement.',
    };
  }

  // Check if we dynamically created this action in the current demo session
  const dynamicAction = fixtures.actions.find(a => a.action_id === actionId);
  if (dynamicAction) {
    const open_loops: AnyRecord[] = [];
    const assumptions = fixtures.assumptions.filter(a => a.action_id === actionId);

    // Attempt to match an evaluation (guard check) for this action
    let decision = 'allow';
    let decision_reason = 'Action permitted under default demo policy.';
    if (fixtures.guardDecisions) {
      const evalMatch = fixtures.guardDecisions.find(g => g.action_id === actionId);
      if (evalMatch) {
         decision = evalMatch.decision;
         decision_reason = evalMatch.reason;
      }
    }

    return { action: dynamicAction, open_loops, assumptions, decision, decision_reason };
  }

  // Marketing home demo scenarios. The /decisions ledger prepends three
  // synthetic rows with stable ids (act_demo_home_sync_001,
  // act_demo_home_deploy_001, act_demo_home_block_001) backed by
  // getHomepageDemoActions in app/lib/homepageDemoActions.js. This branch
  // mirrors that data into the detail endpoint so /decisions/<id> and
  // /replay/<id> resolve instead of 404ing. resolution=null because the
  // server cannot read the visitor's localStorage; the deploy entry
  // therefore renders as pending_approval, which is the correct natural
  // state of that scenario.
  if (actionId.startsWith('act_demo_home_')) {
    const homepageActions = getHomepageDemoActions(null);
    const action = homepageActions.find((a: AnyRecord) => a.action_id === actionId);
    if (!action) return null;

    const decisionByStatus: Record<string, string> = {
      completed: 'allow',
      pending_approval: 'require_approval',
      blocked: 'block',
      cancelled: 'block',
    };
    const decision = decisionByStatus[action.status] || 'allow';

    const assumptionByActionId: Record<string, { assumption: string; basis: string; validated: number }> = {
      act_demo_home_sync_001: {
        assumption: 'Hourly metric syncs are reversible and below the risk threshold.',
        basis: 'Risk threshold classifier',
        validated: 1,
      },
      act_demo_home_deploy_001: {
        assumption: 'Production deploys require human approval before execution.',
        basis: 'Production deploy policy',
        validated: 1,
      },
      act_demo_home_block_001: {
        assumption: 'The agent has authorization to drop production tables.',
        basis: 'Production data protection policy',
        validated: 0,
      },
    };
    const asm = assumptionByActionId[actionId] as { assumption: string; basis: string; validated: number };

    return {
      action,
      open_loops: [],
      assumptions: [
        {
          assumption_id: `asm_${action.action_id}_1`,
          action_id: action.action_id,
          assumption: asm.assumption,
          basis: asm.basis,
          validated: asm.validated,
        },
      ],
      decision,
      decision_reason: action.reasoning || action.output_summary || 'Demo scenario from the marketing home page.',
    };
  }

  if (actionId.startsWith('act_pipe_')) {
    const now = new Date().toISOString();
    return {
      action: {
        action_id: actionId,
        org_id: 'org_demo',
        agent_id: 'pipeline-agent',
        agent_name: 'Pipeline Agent',
        action_type: 'cleanup',
        declared_goal: 'Purge customer records from production database',
        reasoning: 'Automated data retention policy enforcement — purging expired customer records.',
        status: 'blocked',
        risk_score: 94,
        confidence: 100,
        reversible: 0,
        systems_touched: '["postgres-prod", "customer-data", "s3-backups"]',
        error_message: 'Blocked by policy: PRODUCTION_DATA_PROTECTION — irreversible operation on customer data',
        output_summary: 'Blocked by policy PRODUCTION_DATA_PROTECTION. Irreversible operation on customer data requires explicit approval.',
        timestamp_start: now,
        timestamp_end: now,
        duration_ms: 180,
        cost_estimate: 0,
        verified: true,
      },
      open_loops: [],
      assumptions: [
        { assumption_id: 'asm_pipe_1', action_id: actionId, assumption: 'Records flagged as expired are eligible for deletion', basis: 'Retention policy engine', validated: 0 },
        { assumption_id: 'asm_pipe_2', action_id: actionId, assumption: 'No active legal holds on target records', basis: 'Compliance system check', validated: 0 },
      ],
      decision: 'block',
      decision_reason: 'Risk score 94 exceeds org threshold of 75. Policy PRODUCTION_DATA_PROTECTION enforced — irreversible operations on customer data require explicit approval.',
    };
  }

  if (actionId.startsWith('act_sim_')) {
    return {
      action: {
        action_id: actionId,
        org_id: 'org_demo',
        agent_id: 'simulator-bot',
        agent_name: 'Simulator Bot',
        action_type: 'deploy',
        declared_goal: 'DEPLOY: production-api rollout',
        reasoning: 'Deploying latest verified build to production environment.',
        status: 'completed',
        risk_score: 15,
        confidence: 98,
        reversible: 1,
        systems_touched: '["production-api", "aws-lambda"]',
        output_summary: 'Deployment successful. Health checks passed across all regions.',
        timestamp_start: new Date().toISOString(),
        timestamp_end: new Date().toISOString(),
        duration_ms: 12400,
        cost_estimate: 0.042,
        verified: true
      },
      open_loops: [],
      assumptions: [
        { assumption_id: 'asm_sim_1', action_id: actionId, assumption: 'Staging environment is healthy', basis: 'Pre-flight check passed', validated: 1 },
        { assumption_id: 'asm_sim_2', action_id: actionId, assumption: 'No active critical alerts', basis: 'Security scanner report', validated: 1 }
      ]
    };
  }

  // Session-ledger rows: buildDemoSessionActions mints `ar_demo_sess_{n}_{i}`
  // ids for /api/sessions/:id/actions. Rebuild the same deterministic row here
  // so clicking a session action through to /decisions/<id> resolves instead
  // of 404ing (the ids exist nowhere else in the fixtures).
  if (actionId.startsWith('ar_demo_sess_')) {
    const m = actionId.match(/^ar_demo_sess_(\d+)_(\d+)$/);
    if (!m) return null;
    const session = buildDemoSessionList(fixtures).find((s) => s.id === `sess_demo_${m[1]}`);
    if (!session) return null;
    const row = buildDemoSessionActions(session).find((a) => a.action_id === actionId);
    if (!row) return null;
    const blocked = row.status === 'blocked';
    const failed = row.status === 'failed';
    return {
      action: {
        ...row,
        org_id: 'org_demo',
        agent_name: session.agent_name,
        reasoning: `Step in governed session ${session.id} (${session.workspace}, ${session.branch}).`,
        systems_touched: '[]',
        reversible: 1,
        confidence: 90,
        timestamp_start: row.created_at,
        timestamp_end: row.created_at,
        duration_ms: 2400,
        output_summary: blocked
          ? 'Held for approval: deploy touches production configuration.'
          : failed
            ? 'Command exited non-zero twice; session halted for operator review.'
            : 'Completed within policy; recorded to the decision ledger.',
        verified: true,
      },
      open_loops: [],
      assumptions: [],
      decision: blocked ? 'require_approval' : 'allow',
      decision_reason: blocked
        ? (session.blocked_reason || 'Guard requires approval: deploy touches production configuration.')
        : 'Action permitted under the active demo policy set.',
    };
  }

  const action = fixtures.actions.find(a => a.action_id === actionId) || null;
  if (!action) return null;
  const open_loops: AnyRecord[] = [];
  const assumptions = fixtures.assumptions.filter(a => a.action_id === actionId);
  return { action, open_loops, assumptions };
}

export function demoAssumptions(fixtures: DemoFixtures, url: URL) {
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

export function demoTokens(fixtures: DemoFixtures) {
  return {
    current: fixtures.tokensCurrent,
    today: fixtures.tokensToday,
    history: fixtures.tokenHistory.slice().reverse(),
    timeline: [],
    lastUpdated: new Date().toISOString(),
  };
}

export function demoActionTrace(fixtures: DemoFixtures, actionId: string) {
  const detail = demoActionDetail(fixtures, actionId);
  if (!detail) return null;

  const { action, assumptions, open_loops } = detail;
  const loops = open_loops || [];

  return {
    action,
    trace: {
      assumptions: {
        total: assumptions.length,
        validated: assumptions.filter((a: AnyRecord) => a.validated === 1).length,
        invalidated: assumptions.filter((a: AnyRecord) => a.invalidated === 1).length,
        unvalidated: assumptions.filter((a: AnyRecord) => a.validated === 0 && a.invalidated === 0).length,
        items: assumptions
      },
      loops: {
        total: loops.length,
        open: loops.filter((l: AnyRecord) => l.status === 'open').length,
        resolved: loops.filter((l: AnyRecord) => l.status === 'resolved').length,
        cancelled: loops.filter((l: AnyRecord) => l.status === 'cancelled').length,
        items: loops
      },
      parent_chain: [],
      sub_actions: [],
      related_actions: [],
      root_cause_indicators: []
    }
  };
}

export function demoDecisionMetrics(fixtures: DemoFixtures) {
  return {
    ...fixtures.decisionMetrics,
    lastUpdated: new Date().toISOString()
  };
}
