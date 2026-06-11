import type { Store } from "./storage.js";
import { runGuarded } from "./actions.js";
import { evaluatePolicy } from "./policy.js";
import { findConnection, findMapping } from "./resolve.js";
import { resolveToken } from "./providers/auth.js";
import * as vc from "./providers/vercel.js";
import type {
  ActionContext,
  Capability,
  Environment,
  PolicyEffect,
  Project,
  ProviderId,
} from "./types.js";

/**
 * get_project_context — the killer tool.
 *
 * Returns the production-context bundle an AI coding agent needs BEFORE touching
 * real infrastructure: which project/environment is active, which provider
 * resources belong to it, the live deployment status (best-effort), what is
 * allowed / blocked / approval-required, project memory, recent audit history,
 * and suggested safe next actions — plus a human-readable summary the agent can
 * reason from directly.
 *
 * Note on the embedded live Vercel snapshot: it is a best-effort, read-only
 * convenience read, but it still goes through runGuarded so policy/audit
 * invariants hold before any provider API is called. It degrades gracefully to
 * mappings-only when audit reservation, credentials, or the API fail.
 */

function effectWord(effect: PolicyEffect): "allowed" | "blocked" | "approval-required" {
  return effect === "allow" ? "allowed" : effect === "block" ? "blocked" : "approval-required";
}

function decide(
  store: Store,
  project: Project,
  environment: Environment,
  provider: ProviderId,
  capability: Capability,
  live?: boolean,
): PolicyEffect {
  const ctx: ActionContext = {
    project,
    environment,
    provider,
    capability,
    tool: "preview",
    summary: "policy preview",
    live,
  };
  return evaluatePolicy(store.data.policyRules, ctx).effect;
}

interface ActionCatalogItem {
  provider: ProviderId;
  capability: Capability;
  live?: boolean;
  label: string;
}

function actionCatalog(envName: string, stripeMode: "test" | "live"): ActionCatalogItem[] {
  return [
    { provider: "github", capability: "read", label: "inspect GitHub repo (metadata, README, files)" },
    { provider: "vercel", capability: "read", label: "read Vercel deployment status & logs" },
    { provider: "railway", capability: "read", label: "read Railway deployment status & logs" },
    { provider: "railway", capability: "deploy", label: `deploy to Railway (${envName})` },
    { provider: "railway", capability: "env_change", label: `change Railway variables (${envName})` },
    { provider: "supabase", capability: "read", label: `query ${envName} Supabase (read-only)` },
    { provider: "stripe", capability: "read", label: "list Stripe products/prices" },
    { provider: "stripe", capability: "write", live: stripeMode === "live", label: `create Stripe ${stripeMode}-mode products/prices` },
    { provider: "vercel", capability: "deploy", label: `deploy to Vercel (${envName})` },
    { provider: "vercel", capability: "env_change", label: `change Vercel env vars (${envName})` },
    { provider: "supabase", capability: "write", label: `write to ${envName} Supabase DB` },
    { provider: "supabase", capability: "destructive_sql", label: "run destructive SQL (DROP/TRUNCATE/DELETE/ALTER)" },
    { provider: "github", capability: "delete", label: "delete resources" },
  ];
}

interface ActionBuckets {
  allowed: string[];
  blocked: string[];
  approvalRequired: string[];
}

function classifyActions(
  store: Store,
  project: Project,
  environment: Environment,
  stripeMode: "test" | "live",
): ActionBuckets {
  const buckets: ActionBuckets = { allowed: [], blocked: [], approvalRequired: [] };
  for (const item of actionCatalog(environment.name, stripeMode)) {
    const effect = decide(store, project, environment, item.provider, item.capability, item.live);
    if (effect === "allow") buckets.allowed.push(item.label);
    else if (effect === "block") buckets.blocked.push(item.label);
    else buckets.approvalRequired.push(item.label);
  }
  return buckets;
}

interface VercelSnapshot {
  vercelProject: string;
  latest: { state: string; url?: string; createdAt?: number; errorMessage?: string } | null;
  liveDataError?: string;
}

async function fetchVercelSnapshot(
  store: Store,
  project: Project,
  environment: Environment,
  projectId: string,
  connectionId?: string,
  teamId?: string,
): Promise<VercelSnapshot> {
  const result = await runGuarded(
    store,
    {
      project,
      environment,
      provider: "vercel",
      capability: "read",
      tool: "get_project_context",
      summary: `read live Vercel deployment snapshot for ${projectId}`,
      resourceLabel: projectId,
    },
    async () => {
      const conn = findConnection(store, "vercel", connectionId);
      if (connectionId && !conn) {
        throw new Error(`Mapping references missing vercel connection "${connectionId}".`);
      }
      const token = conn
        ? resolveToken(conn)
        : process.env.VERCEL_TOKEN;
      if (!token) {
        throw new Error("VERCEL_TOKEN not set — live status unavailable.");
      }
      const deps = await vc.listDeployments(token, projectId, teamId, 3);
      if (deps.length === 0) return { vercelProject: projectId, latest: null };
      const first = deps[0]!;
      const latest: VercelSnapshot["latest"] = {
        state: first.readyState ?? first.state,
        url: first.url ? `https://${first.url}` : undefined,
        createdAt: first.createdAt,
      };
      if (/error/i.test(latest.state)) {
        try {
          const status = await vc.getDeploymentStatus(token, first.uid, teamId);
          if (typeof status.errorMessage === "string") latest.errorMessage = status.errorMessage;
        } catch {
          /* best-effort */
        }
      }
      return { vercelProject: projectId, latest };
    },
  );

  if (result.status === "ok") {
    return result.data as VercelSnapshot;
  }
  if (result.status === "error") {
    return { vercelProject: projectId, latest: null, liveDataError: result.error };
  }
  return {
    vercelProject: projectId,
    latest: null,
    liveDataError: `${result.status}: ${result.reason}`,
  };
}

export interface EnvironmentContext {
  environment: string;
  kind: string;
  isProduction: boolean;
  source: { githubRepo?: string };
  deployment: { vercelProject?: string; latest: VercelSnapshot["latest"]; lastKnownIssue?: string; liveDataError?: string };
  railway?: { projectId: string; environmentId?: string; serviceId?: string };
  database: { supabaseProjectRef?: string; writes: string };
  payments: { stripeMode?: string; testWrites: string; liveWrites: string };
  allowed: string[];
  blocked: string[];
  approvalRequired: string[];
  memory: Array<{ note: string; tags?: string[]; createdAt: string }>;
  suggestedNextActions: string[];
  summary: string;
}

export interface ProjectContext {
  project: { id: string; slug: string; name: string; description?: string };
  focusedEnvironment?: string;
  environments: EnvironmentContext[];
  projectMemory: Array<{ note: string; tags?: string[]; createdAt: string }>;
  recentAudit: Array<Record<string, unknown>>;
  policyDefaults: string[];
  summary: string;
  notes: string;
}

async function buildEnvironmentContext(
  store: Store,
  project: Project,
  env: Environment,
): Promise<EnvironmentContext> {
  const githubMap = findMapping(store, env, "github");
  const vercelMap = findMapping(store, env, "vercel");
  const supabaseMap = findMapping(store, env, "supabase");
  const stripeMap = findMapping(store, env, "stripe");
  const railwayMap = findMapping(store, env, "railway");
  const railway =
    railwayMap && railwayMap.resource.provider === "railway"
      ? {
          projectId: railwayMap.resource.projectId,
          environmentId: railwayMap.resource.environmentId,
          serviceId: railwayMap.resource.serviceId,
        }
      : undefined;

  const githubRepo =
    githubMap && githubMap.resource.provider === "github"
      ? `${githubMap.resource.owner}/${githubMap.resource.repo}`
      : undefined;
  const supabaseRef =
    supabaseMap && supabaseMap.resource.provider === "supabase"
      ? supabaseMap.resource.projectRef
      : undefined;
  const stripeMode: "test" | "live" =
    stripeMap && stripeMap.resource.provider === "stripe"
      ? stripeMap.resource.mode
      : env.isProduction
        ? "live"
        : "test";

  // Live Vercel snapshot (best-effort).
  let vercelSnapshot: VercelSnapshot | undefined;
  if (vercelMap && vercelMap.resource.provider === "vercel") {
    const teamId =
      vercelMap.resource.teamId ??
      findConnection(store, "vercel", vercelMap.connectionId)?.scope?.vercelTeamId ??
      process.env.VERCEL_TEAM_ID;
    vercelSnapshot = await fetchVercelSnapshot(store, project, env, vercelMap.resource.projectId, vercelMap.connectionId, teamId);
  }

  const buckets = classifyActions(store, project, env, stripeMode);

  // Memory scoped to this env (and project-wide notes that mention provider keys).
  const envMemory = store
    .listMemory({ projectId: project.id, environmentId: env.id })
    .map((m) => ({ note: m.note, tags: m.tags, createdAt: m.createdAt }));

  // Last known issue: live error first, then most recent incident-tagged memory.
  const incidentNote = envMemory.find(
    (m) => m.tags?.includes("incident") || /fail|error|missing|broke/i.test(m.note),
  );
  const lastKnownIssue =
    vercelSnapshot?.latest?.errorMessage ?? incidentNote?.note;

  const supabaseWrites = effectWord(decide(store, project, env, "supabase", "write"));
  const stripeTestWrites = effectWord(decide(store, project, env, "stripe", "write", false));
  const stripeLiveWrites = effectWord(decide(store, project, env, "stripe", "write", true));

  const suggested = buildSuggestedActions(buckets, {
    hasFailedDeploy: !!(vercelSnapshot?.latest && /error/i.test(vercelSnapshot.latest.state)),
    envName: env.name,
    isProduction: env.isProduction,
  });

  const ec: EnvironmentContext = {
    environment: env.name,
    kind: env.kind,
    isProduction: env.isProduction,
    source: { githubRepo },
    deployment: {
      vercelProject: vercelSnapshot?.vercelProject ?? (vercelMap?.resource.provider === "vercel" ? vercelMap.resource.projectId : undefined),
      latest: vercelSnapshot?.latest ?? null,
      lastKnownIssue,
      liveDataError: vercelSnapshot?.liveDataError,
    },
    railway,
    database: { supabaseProjectRef: supabaseRef, writes: supabaseWrites },
    payments: { stripeMode, testWrites: stripeTestWrites, liveWrites: stripeLiveWrites },
    allowed: buckets.allowed,
    blocked: buckets.blocked,
    approvalRequired: buckets.approvalRequired,
    memory: envMemory,
    suggestedNextActions: suggested,
    summary: "",
  };
  ec.summary = renderEnvSummary(project, ec);
  return ec;
}

function buildSuggestedActions(
  buckets: ActionBuckets,
  ctx: { hasFailedDeploy: boolean; envName: string; isProduction: boolean },
): string[] {
  const out: string[] = [];
  if (ctx.hasFailedDeploy) {
    out.push("inspect the latest Vercel deployment logs to find the failure cause");
    out.push("check required env var names against the repo (e.g. DATABASE_URL)");
  }
  // Lead with safe reads.
  for (const a of buckets.allowed) {
    if (/read|inspect|query|list/i.test(a)) out.push(a);
  }
  if (ctx.isProduction) {
    out.push("stay read-only here — production writes/deploys require approval");
  } else {
    out.push(`use ${ctx.envName} mappings for test changes; do not touch production`);
  }
  return Array.from(new Set(out)).slice(0, 6);
}

function renderEnvSummary(project: Project, ec: EnvironmentContext): string {
  const L: string[] = [];
  L.push(`Project: ${project.slug}`);
  L.push(`Environment: ${ec.environment}${ec.isProduction ? " (PRODUCTION)" : ""}`);
  L.push("");
  L.push("Source:");
  L.push(`- GitHub repo: ${ec.source.githubRepo ?? "(not mapped)"}`);
  L.push("");
  L.push("Deployment:");
  L.push(`- Vercel project: ${ec.deployment.vercelProject ?? "(not mapped)"}`);
  if (ec.deployment.latest) {
    L.push(`- Latest deployment: ${ec.deployment.latest.state}`);
    if (ec.deployment.latest.url) L.push(`- URL: ${ec.deployment.latest.url}`);
  } else if (ec.deployment.liveDataError) {
    L.push(`- Latest deployment: unavailable (${ec.deployment.liveDataError})`);
  } else {
    L.push("- Latest deployment: (no deployments / not fetched)");
  }
  if (ec.deployment.lastKnownIssue) L.push(`- Last known issue: ${ec.deployment.lastKnownIssue}`);
  if (ec.railway) {
    L.push(`- Railway project: ${ec.railway.projectId}`);
    if (ec.railway.serviceId) L.push(`- Railway service: ${ec.railway.serviceId}`);
  }
  L.push("");
  L.push("Database:");
  L.push(`- Supabase project: ${ec.database.supabaseProjectRef ?? "(not mapped)"}`);
  L.push(`- ${cap(ec.environment)} DB writes: ${ec.database.writes}`);
  L.push("");
  L.push("Payments:");
  L.push(`- Stripe mode: ${ec.payments.stripeMode}`);
  L.push(`- Test writes: ${ec.payments.testWrites}`);
  L.push(`- Live Stripe writes: ${ec.payments.liveWrites}`);
  L.push("");
  L.push("Allowed:");
  ec.allowed.forEach((a) => L.push(`- ${a}`));
  L.push("Blocked:");
  ec.blocked.forEach((a) => L.push(`- ${a}`));
  L.push("Approval required:");
  ec.approvalRequired.forEach((a) => L.push(`- ${a}`));
  if (ec.memory.length) {
    L.push("");
    L.push("Memory:");
    ec.memory.forEach((m) => L.push(`- ${m.note}`));
  }
  if (ec.suggestedNextActions.length) {
    L.push("");
    L.push("Suggested safe next actions:");
    ec.suggestedNextActions.forEach((a) => L.push(`- ${a}`));
  }
  return L.join("\n");
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export async function buildProjectContext(
  store: Store,
  project: Project,
  envRef?: string,
): Promise<ProjectContext> {
  const allEnvs = store.data.environments.filter((e) => e.projectId === project.id);
  let envs = allEnvs;
  let focused: string | undefined;
  if (envRef) {
    const match = allEnvs.find((e) => e.id === envRef || e.name === envRef);
    if (match) {
      envs = [match];
      focused = match.name;
    }
  }

  const environments: EnvironmentContext[] = [];
  for (const env of envs) {
    environments.push(await buildEnvironmentContext(store, project, env));
  }

  // Project-level memory (no environment scope).
  const projectMemory = store
    .listMemory({ projectId: project.id })
    .filter((m) => !m.environmentId)
    .map((m) => ({ note: m.note, tags: m.tags, createdAt: m.createdAt }));

  const recentAudit = store
    .readAudit(15, { projectSlug: project.slug, environment: focused })
    .map((e) => ({
      timestamp: e.timestamp,
      environment: e.environment,
      provider: e.provider,
      tool: e.tool,
      decision: e.policyDecision,
      result: e.result,
      summary: e.actionSummary,
      error: e.errorMessage,
    }));

  const summaryParts = environments.map((e) => e.summary);
  if (recentAudit.length) {
    summaryParts.push(
      ["", "Recent audit (project):", ...recentAudit
        .slice(0, 5)
        .map((a) => `- ${a.timestamp} ${a.tool} → ${a.decision}/${a.result}`)].join("\n"),
    );
  }

  return {
    project: { id: project.id, slug: project.slug, name: project.name, description: project.description },
    focusedEnvironment: focused,
    environments,
    projectMemory,
    recentAudit,
    policyDefaults: [
      "Reads allowed everywhere.",
      "Dev/staging writes allowed (unless destructive).",
      "Production writes / deploys / env-var changes require approval.",
      "Live Stripe writes require approval.",
      "Destructive SQL blocked everywhere.",
      "Deleting resources blocked everywhere.",
      "Every provider action is logged to the audit trail.",
    ],
    summary: summaryParts.join("\n\n"),
    notes:
      "This is the production context for the project. Resolve project + environment + policy " +
      "before any provider action. Prefer the suggested safe next actions. Anything listed under " +
      "'Approval required' or 'Blocked' will NOT execute until policy is changed.",
  };
}
