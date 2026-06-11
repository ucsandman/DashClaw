import type { Store } from "./storage.js";
import { runGuarded, type GuardedResponse } from "./actions.js";
import {
  resolveProject,
  resolveEnvironment,
  requireMapping,
  findMapping,
} from "./resolve.js";
import { classifySql } from "./sql.js";
import { resolveStripeKey } from "./providers/auth.js";
import * as gh from "./providers/github.js";
import * as vc from "./providers/vercel.js";
import * as sb from "./providers/supabase.js";
import * as st from "./providers/stripe.js";
import * as rw from "./providers/railway.js";
import * as ne from "./providers/neon.js";
import * as us from "./providers/upstash.js";
import * as qs from "./providers/upstash-qstash.js";
import * as r2 from "./providers/cloudflare-r2.js";
import * as nc from "./providers/namecheap.js";
import * as se from "./providers/sentry.js";
import * as ph from "./providers/posthog.js";
import * as rs from "./providers/resend.js";
import * as tw from "./providers/twilio.js";
import * as ck from "./providers/clerk.js";
import { loadRegistrantContact } from "./config.js";
import type { ActionContext, Capability, CloudflareR2Resource, Environment, Project, ProviderId, UpstashResource } from "./types.js";
import { findConnection } from "./resolve.js";
import { resolveToken } from "./providers/auth.js";
import { defaultEnvVar } from "./providers/auth.js";
import { OfflocalError } from "./util.js";

/**
 * Provider actions. Every function:
 *   1. resolves project + environment,
 *   2. resolves the provider mapping (concrete resource) + credentials,
 *   3. builds an ActionContext and runs it through runGuarded,
 *      which enforces policy and writes the audit log.
 * The real provider call only runs inside the `exec` thunk when policy allows.
 */

interface Base {
  project?: string;
  environment: string;
}

function resolve(store: Store, input: Base): { project: Project; environment: Environment } {
  const project = resolveProject(store, input.project);
  const environment = resolveEnvironment(store, project, input.environment);
  return { project, environment };
}

function tokenFor(store: Store, provider: ProviderId, connectionId?: string): string {
  const conn = findConnection(store, provider, connectionId);
  if (conn) return resolveToken(conn);
  if (connectionId) {
    throw new OfflocalError(`Mapping references missing ${provider} connection "${connectionId}".`);
  }
  const envVar = defaultEnvVar(provider);
  const v = process.env[envVar];
  if (!v || v.trim().length === 0) {
    throw new OfflocalError(
      `No ${provider} connection and ${envVar} is not set. Configure credentials first.`,
    );
  }
  return v.trim();
}

function vercelTeamId(store: Store, mappingTeamId?: string, connectionId?: string): string | undefined {
  if (mappingTeamId) return mappingTeamId;
  const conn = findConnection(store, "vercel", connectionId);
  return conn?.scope?.vercelTeamId ?? process.env.VERCEL_TEAM_ID;
}

function ctx(
  project: Project,
  environment: Environment,
  provider: ProviderId,
  capability: Capability,
  tool: string,
  summary: string,
  extra?: { live?: boolean; resourceLabel?: string },
): ActionContext {
  return { project, environment, provider, capability, tool, summary, ...extra };
}

function assertPositiveInteger(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new OfflocalError(`${name} must be a positive integer.`);
  }
}

function assertNonNegativeInteger(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new OfflocalError(`${name} must be a non-negative integer.`);
  }
}

function assertNonEmptyString(name: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new OfflocalError(`${name} must be a non-empty string.`);
  }
  return trimmed;
}

function assertNonEmptyStringList(name: string, value: string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new OfflocalError(`${name} must be a non-empty list of strings.`);
  }
  return value.map((item, index) => assertNonEmptyString(`${name}[${index}]`, item));
}

function assertSentryClientKeyUseCase(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = assertNonEmptyString("useCase", value);
  if (trimmed !== "user" && trimmed !== "profiling" && trimmed !== "tempest" && trimmed !== "demo") {
    throw new OfflocalError('useCase must be one of "user", "profiling", "tempest", or "demo".');
  }
  return trimmed;
}

function assertRecord(name: string, value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OfflocalError(`${name} must be an object.`);
  }
  return value;
}

type AppEnvTargetProvider = "vercel" | "railway";
type AppEnvVarInput = { key: string; value: string };

function assertAppEnvTargetProvider(value: string): AppEnvTargetProvider {
  if (value !== "vercel" && value !== "railway") {
    throw new OfflocalError('targetProvider must be one of "vercel" or "railway".');
  }
  return value;
}

function assertEnvVarKey(name: string, value: string): string {
  const key = assertNonEmptyString(name, value);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new OfflocalError(`${name} must be a valid environment variable name.`);
  }
  return key;
}

function assertAppEnvVars(value: AppEnvVarInput[]): AppEnvVarInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new OfflocalError("vars must be a non-empty list of environment variables.");
  }
  if (value.length > 50) {
    throw new OfflocalError("vars must contain 50 or fewer environment variables.");
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new OfflocalError(`vars[${index}] must be an object with key and value.`);
    }
    const key = assertEnvVarKey(`vars[${index}].key`, entry.key);
    if (seen.has(key)) {
      throw new OfflocalError(`Duplicate environment variable key "${key}".`);
    }
    seen.add(key);
    if (typeof entry.value !== "string") {
      throw new OfflocalError(`vars[${index}].value must be a string.`);
    }
    return { key, value: entry.value };
  });
}

function assertVercelTargets(value: string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const targets = assertNonEmptyStringList("target", value) ?? [];
  for (const target of targets) {
    if (target !== "production" && target !== "preview" && target !== "development") {
      throw new OfflocalError('target must contain only "production", "preview", or "development".');
    }
  }
  return targets;
}

function envKeySummary(keys: string[]): string {
  return keys.length <= 5 ? keys.join(", ") : `${keys.slice(0, 5).join(", ")} +${keys.length - 5} more`;
}

function rawEnvKeys(value: AppEnvVarInput[]): string[] {
  if (!Array.isArray(value) || value.length === 0) return ["<none>"];
  return value.map((entry) => {
    const key = typeof entry?.key === "string" ? entry.key.trim() : "";
    return key || "<invalid>";
  });
}

// --- GitHub ----------------------------------------------------------------

export async function githubRepoContext(store: Store, input: Base): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const m = requireMapping(store, project, environment, "github");
  const r = m.resource as { owner: string; repo: string };
  const label = `${r.owner}/${r.repo}`;
  return runGuarded(
    store,
    ctx(project, environment, "github", "read", "get_github_repo_context", `repo ${label}`, {
      resourceLabel: label,
    }),
    () => gh.getRepoContext(tokenFor(store, "github", m.connectionId), r.owner, r.repo),
  );
}

export async function githubReadme(store: Store, input: Base): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const m = requireMapping(store, project, environment, "github");
  const r = m.resource as { owner: string; repo: string };
  const label = `${r.owner}/${r.repo}`;
  return runGuarded(
    store,
    ctx(project, environment, "github", "read", "get_github_repo_readme", `readme ${label}`, {
      resourceLabel: label,
    }),
    () => gh.getReadme(tokenFor(store, "github", m.connectionId), r.owner, r.repo),
  );
}

export async function githubListFiles(
  store: Store,
  input: Base & { path?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const m = requireMapping(store, project, environment, "github");
  const r = m.resource as { owner: string; repo: string };
  const label = `${r.owner}/${r.repo}`;
  return runGuarded(
    store,
    ctx(project, environment, "github", "read", "list_github_repo_files", `files ${label}`, {
      resourceLabel: label,
    }),
    () => gh.listFiles(tokenFor(store, "github", m.connectionId), r.owner, r.repo, input.path ?? ""),
  );
}

// --- Vercel ----------------------------------------------------------------

function vercelResource(store: Store, project: Project, environment: Environment) {
  const m = requireMapping(store, project, environment, "vercel");
  return { ...(m.resource as { projectId: string; projectName?: string; teamId?: string }), connectionId: m.connectionId };
}

export async function vercelProjectContext(store: Store, input: Base): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = vercelResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "vercel", "read", "get_vercel_project_context", `project ${r.projectId}`, {
      resourceLabel: r.projectId,
    }),
    () => vc.getProjectContext(tokenFor(store, "vercel", r.connectionId), r.projectId, vercelTeamId(store, r.teamId, r.connectionId)),
  );
}

export async function vercelDeployments(
  store: Store,
  input: Base & { limit?: number },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = vercelResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "vercel", "read", "get_vercel_deployments", `deployments ${r.projectId}`, {
      resourceLabel: r.projectId,
    }),
    () =>
      {
        assertPositiveInteger("limit", input.limit);
        return vc.listDeployments(tokenFor(store, "vercel", r.connectionId), r.projectId, vercelTeamId(store, r.teamId, r.connectionId), input.limit ?? 10);
      },
  );
}

export async function githubPullRequests(
  store: Store,
  input: Base & { state?: "open" | "closed" | "all"; limit?: number },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const m = requireMapping(store, project, environment, "github");
  const r = m.resource as { owner: string; repo: string };
  const label = `${r.owner}/${r.repo}`;
  return runGuarded(
    store,
    ctx(project, environment, "github", "read", "list_github_pull_requests", `pull requests ${label}`, {
      resourceLabel: label,
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      return gh.listPullRequests(tokenFor(store, "github", m.connectionId), r.owner, r.repo, {
        state: input.state,
        limit: input.limit ?? 10,
      });
    },
  );
}

export async function githubBranches(store: Store, input: Base & { limit?: number }): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const m = requireMapping(store, project, environment, "github");
  const r = m.resource as { owner: string; repo: string };
  const label = `${r.owner}/${r.repo}`;
  return runGuarded(
    store,
    ctx(project, environment, "github", "read", "list_github_branches", `branches ${label}`, {
      resourceLabel: label,
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      return gh.listBranches(tokenFor(store, "github", m.connectionId), r.owner, r.repo, input.limit ?? 30);
    },
  );
}

export async function githubStatusChecks(store: Store, input: Base & { ref: string }): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const m = requireMapping(store, project, environment, "github");
  const r = m.resource as { owner: string; repo: string };
  const ref = assertNonEmptyString("ref", input.ref);
  const label = `${r.owner}/${r.repo}@${ref}`;
  return runGuarded(
    store,
    ctx(project, environment, "github", "read", "get_github_status_checks", `status checks ${label}`, {
      resourceLabel: label,
    }),
    () => gh.getCombinedStatus(tokenFor(store, "github", m.connectionId), r.owner, r.repo, ref),
  );
}

export async function githubWorkflowRuns(
  store: Store,
  input: Base & { branch?: string; event?: string; status?: string; limit?: number },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const m = requireMapping(store, project, environment, "github");
  const r = m.resource as { owner: string; repo: string };
  const label = `${r.owner}/${r.repo}`;
  return runGuarded(
    store,
    ctx(project, environment, "github", "read", "list_github_workflow_runs", `workflow runs ${label}`, {
      resourceLabel: label,
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      return gh.listWorkflowRuns(tokenFor(store, "github", m.connectionId), r.owner, r.repo, {
        branch: input.branch === undefined ? undefined : assertNonEmptyString("branch", input.branch),
        event: input.event === undefined ? undefined : assertNonEmptyString("event", input.event),
        status: input.status === undefined ? undefined : assertNonEmptyString("status", input.status),
        limit: input.limit ?? 30,
      });
    },
  );
}

export async function githubWorkflowJobs(
  store: Store,
  input: Base & { runId: number; filter?: "latest" | "all"; limit?: number },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const m = requireMapping(store, project, environment, "github");
  const r = m.resource as { owner: string; repo: string };
  const label = `${r.owner}/${r.repo} run ${input.runId}`;
  return runGuarded(
    store,
    ctx(project, environment, "github", "read", "list_github_workflow_jobs", `workflow jobs ${label}`, {
      resourceLabel: label,
    }),
    () => {
      assertPositiveInteger("runId", input.runId);
      assertPositiveInteger("limit", input.limit);
      if (input.filter !== undefined && input.filter !== "latest" && input.filter !== "all") {
        throw new OfflocalError('filter must be one of "latest" or "all".');
      }
      return gh.listWorkflowJobs(tokenFor(store, "github", m.connectionId), r.owner, r.repo, input.runId, {
        filter: input.filter,
        limit: input.limit ?? 30,
      });
    },
  );
}

export async function githubRerunWorkflowRun(
  store: Store,
  input: Base & { runId: number },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const m = requireMapping(store, project, environment, "github");
  const r = m.resource as { owner: string; repo: string };
  const label = `${r.owner}/${r.repo} run ${input.runId}`;
  return runGuarded(
    store,
    ctx(project, environment, "github", "write", "rerun_github_workflow_run", `rerun workflow run ${label}`, {
      resourceLabel: label,
    }),
    () => {
      assertPositiveInteger("runId", input.runId);
      return gh.rerunWorkflowRun(tokenFor(store, "github", m.connectionId), r.owner, r.repo, input.runId);
    },
  );
}

export async function githubCancelWorkflowRun(
  store: Store,
  input: Base & { runId: number },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const m = requireMapping(store, project, environment, "github");
  const r = m.resource as { owner: string; repo: string };
  const label = `${r.owner}/${r.repo} run ${input.runId}`;
  return runGuarded(
    store,
    ctx(project, environment, "github", "write", "cancel_github_workflow_run", `cancel workflow run ${label}`, {
      resourceLabel: label,
    }),
    () => {
      assertPositiveInteger("runId", input.runId);
      return gh.cancelWorkflowRun(tokenFor(store, "github", m.connectionId), r.owner, r.repo, input.runId);
    },
  );
}

export async function vercelDeploymentStatus(
  store: Store,
  input: Base & { deploymentId: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = vercelResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "vercel", "read", "get_vercel_deployment_status", `status ${input.deploymentId}`, {
      resourceLabel: input.deploymentId,
    }),
    () => vc.getDeploymentStatus(tokenFor(store, "vercel", r.connectionId), input.deploymentId, vercelTeamId(store, r.teamId, r.connectionId)),
  );
}

export async function vercelDeploymentLogs(
  store: Store,
  input: Base & { deploymentId: string; limit?: number },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = vercelResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "vercel", "read", "get_vercel_deployment_logs", `logs ${input.deploymentId}`, {
      resourceLabel: input.deploymentId,
    }),
    () =>
      {
        assertPositiveInteger("limit", input.limit);
        return vc.getDeploymentLogs(tokenFor(store, "vercel", r.connectionId), input.deploymentId, vercelTeamId(store, r.teamId, r.connectionId), input.limit ?? 100);
      },
  );
}

export async function vercelSetEnvVar(
  store: Store,
  input: Base & { key: string; value: string; target?: string[] },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = vercelResource(store, project, environment);
  const target = input.target ?? [environment.isProduction ? "production" : "preview"];
  return runGuarded(
    store,
    ctx(project, environment, "vercel", "env_change", "set_vercel_env_var", `set env ${input.key} on ${r.projectId}`, {
      resourceLabel: `${r.projectId}:${input.key}`,
    }),
    () =>
      vc.setEnvVar(
        tokenFor(store, "vercel", r.connectionId),
        r.projectId,
        { key: assertNonEmptyString("key", input.key), value: input.value, target },
        vercelTeamId(store, r.teamId, r.connectionId),
      ),
  );
}

export async function vercelCreateDeployment(
  store: Store,
  input: Base & {
    name?: string;
    deploymentId?: string;
    gitSource?: { type: "github"; repoId: string; ref?: string; sha?: string };
  },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = vercelResource(store, project, environment);
  const target = environment.isProduction ? "production" : "preview";
  return runGuarded(
    store,
    ctx(project, environment, "vercel", "deploy", "create_vercel_deployment", `deploy ${r.projectId} (${target})`, {
      resourceLabel: r.projectId,
    }),
    () =>
      vc.createDeployment(
        tokenFor(store, "vercel", r.connectionId),
        {
          name: input.name ?? r.projectName ?? r.projectId,
          project: r.projectId,
          target,
          deploymentId: input.deploymentId,
          gitSource: input.gitSource,
        },
        vercelTeamId(store, r.teamId, r.connectionId),
      ),
  );
}

/**
 * create_vercel_project — create a Vercel project (capability "write"). No
 * mapping is required: the project usually doesn't exist locally yet; any
 * existing Vercel mapping only supplies credentials/team scope.
 */
export async function vercelCreateProject(
  store: Store,
  input: Base & { name: string; framework?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const name = assertNonEmptyString("name", input.name);
  const mapping = findMapping(store, environment, "vercel");
  const teamId = mapping?.resource.provider === "vercel" ? mapping.resource.teamId : undefined;
  return runGuarded(
    store,
    ctx(project, environment, "vercel", "write", "create_vercel_project", `create Vercel project ${name}`, {
      resourceLabel: name,
    }),
    () =>
      vc.createProject(
        tokenFor(store, "vercel", mapping?.connectionId),
        { name, framework: input.framework },
        vercelTeamId(store, teamId, mapping?.connectionId),
      ),
  );
}

/**
 * add_vercel_domain — attach a domain to a Vercel project (capability
 * "write"). The result includes the DNS target (A 76.76.21.21 for apex,
 * CNAME cname.vercel-dns.com for subdomains) to set at the registrar.
 */
export async function vercelAddDomain(
  store: Store,
  input: Base & { vercelProject: string; domain: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const vercelProject = assertNonEmptyString("vercelProject", input.vercelProject);
  const domain = assertNonEmptyString("domain", input.domain);
  const mapping = findMapping(store, environment, "vercel");
  const teamId = mapping?.resource.provider === "vercel" ? mapping.resource.teamId : undefined;
  return runGuarded(
    store,
    ctx(project, environment, "vercel", "write", "add_vercel_domain", `attach ${domain} to Vercel project ${vercelProject}`, {
      resourceLabel: `${vercelProject}:${domain}`,
    }),
    () =>
      vc.addProjectDomain(
        tokenFor(store, "vercel", mapping?.connectionId),
        vercelProject,
        domain,
        vercelTeamId(store, teamId, mapping?.connectionId),
      ),
  );
}

// --- App logs --------------------------------------------------------------
//
// Log reads are a "read" capability, so they are allowed by default in every
// environment (including production) and audited like any other guarded action.

/** Providers that can serve app logs in V0, in priority order (Vercel first). */
const LOG_PROVIDERS: ProviderId[] = ["vercel", "railway"];

interface NormalizedLog {
  timestamp: string;
  level: string;
  message: string;
}

interface LogResult {
  resource: Record<string, unknown>;
  time_range: { since?: string };
  logs: NormalizedLog[];
  limitation?: string;
  audit_written: true;
}

/**
 * Best-effort redaction so a log read never echoes a secret back to the agent.
 * Conservative substring/pattern matching only — better to leave a real log
 * line intact than to mangle it, but obvious credential shapes are masked.
 */
function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    // Provider/key tokens with recognizable prefixes.
    .replace(/\b(sk_live|sk_test|rk_live|rk_test)_[A-Za-z0-9]{6,}/g, "$1_***REDACTED***")
    .replace(/\bghp_[A-Za-z0-9]{20,}/g, "ghp_***REDACTED***")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "github_pat_***REDACTED***")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "AKIA***REDACTED***")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "***REDACTED_JWT***")
    // Authorization: Bearer <token>
    .replace(/(authorization:\s*bearer\s+)\S+/gi, "$1***REDACTED***")
    // Credentials embedded in connection strings (postgres://user:pass@host).
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@]+(@)/gi, "$1***REDACTED***$2")
    // KEY=value where the key name looks secret-bearing.
    .replace(
      /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_?KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*[=:]\s*("?)[^\s"]+\2/gi,
      "$1=***REDACTED***",
    );
}

function normalizeVercelEvent(e: vc.VercelLogEvent): NormalizedLog {
  const level = e.type === "stderr" || e.type === "error" ? "error" : "info";
  const timestamp =
    typeof e.created === "number" && e.created > 0 ? new Date(e.created).toISOString() : "";
  return { level, timestamp, message: redactSecrets(e.text ?? "") };
}

function normalizeRailwayLog(l: rw.RailwayLog): NormalizedLog {
  const sev = (l.severity ?? "").toLowerCase();
  const level = /err|fatal|crit/.test(sev) ? "error" : /warn/.test(sev) ? "warn" : "info";
  return { level, timestamp: l.timestamp ?? "", message: redactSecrets(l.message ?? "") };
}

/** Prefix a bare host (e.g. "app.up.railway.app") with https:// if it has no scheme. */
function httpsUrl(u?: string): string | undefined {
  if (!u) return undefined;
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

/** Validate the optional `since` filter before any provider calls are made. */
function assertValidSince(since?: string): void {
  if (!since) return;
  const asNum = Number(since);
  if (Number.isFinite(asNum) && asNum > 0) return;
  const parsed = Date.parse(since);
  if (Number.isNaN(parsed)) {
    throw new OfflocalError("since must be a positive epoch millisecond value or a valid ISO timestamp.");
  }
}

/** Parse the optional `since` (epoch ms or ISO timestamp) into epoch ms. */
function sinceMs(since?: string): number | undefined {
  assertValidSince(since);
  if (!since) return undefined;
  const asNum = Number(since);
  if (Number.isFinite(asNum) && asNum > 0) return asNum;
  return Date.parse(since);
}

/**
 * Resolve the target deployment (latest if none given), then fetch its logs.
 * Runs inside the guarded `exec` thunk. Log-availability problems are returned
 * as a `limitation` (with the deployment status still attached) rather than
 * thrown, so the read never fails silently.
 */
async function fetchVercelLogsData(
  token: string,
  r: { projectId: string; teamId?: string },
  teamId: string | undefined,
  opts: { deploymentId?: string; since?: string; limit?: number },
): Promise<LogResult> {
  assertPositiveInteger("limit", opts.limit);
  const since = sinceMs(opts.since);
  const limit = opts.limit ?? 100;
  const time_range = { since: opts.since };

  let deploymentId = opts.deploymentId;
  let deployment_url: string | undefined;
  let deployment_status: string | undefined;

  if (!deploymentId) {
    const deps = await vc.listDeployments(token, r.projectId, teamId, 1);
    if (deps.length === 0) {
      return {
        resource: { project: r.projectId },
        time_range,
        logs: [],
        limitation: "No deployments found for this Vercel project — nothing to fetch logs for.",
        audit_written: true,
      };
    }
    const latest = deps[0]!;
    deploymentId = latest.uid;
    deployment_url = latest.url ? `https://${latest.url}` : undefined;
    deployment_status = latest.readyState ?? latest.state;
  } else {
    // Explicit deployment id: fetch its status so we can report url/state.
    try {
      const status = await vc.getDeploymentStatus(token, deploymentId, teamId);
      if (typeof status.readyState === "string") deployment_status = status.readyState;
      if (typeof status.url === "string") deployment_url = `https://${status.url}`;
    } catch {
      /* best-effort — logs may still be fetchable */
    }
  }

  const resource = {
    project: r.projectId,
    deployment_id: deploymentId,
    deployment_url,
    deployment_status,
  };

  try {
    const events = await vc.getDeploymentLogs(token, deploymentId, teamId, limit, since);
    const logs = events.map(normalizeVercelEvent);
    const limitation =
      logs.length === 0
        ? "Vercel's events API returned no log lines. It exposes build logs and recent " +
          "runtime events; older runtime logs require a configured log drain and are not " +
          "available through this API."
        : undefined;
    return { resource, time_range, logs, limitation, audit_written: true };
  } catch (err) {
    return {
      resource,
      time_range,
      logs: [],
      limitation:
        `Could not fetch deployment logs (${err instanceof Error ? err.message : String(err)}). ` +
        "Returning the deployment status only.",
      audit_written: true,
    };
  }
}

/** Shared guarded Vercel log read; `tool` distinguishes the audited entry. */
function runVercelLogs(
  store: Store,
  input: Base & { deploymentId?: string; since?: string; limit?: number },
  tool: string,
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = vercelResource(store, project, environment);
  const teamId = vercelTeamId(store, r.teamId, r.connectionId);
  const label = input.deploymentId ?? r.projectId;
  return runGuarded(
    store,
    ctx(project, environment, "vercel", "read", tool, `logs ${label}`, { resourceLabel: label }),
    () =>
      fetchVercelLogsData(tokenFor(store, "vercel", r.connectionId), r, teamId, {
        deploymentId: input.deploymentId,
        since: input.since,
        limit: input.limit,
      }),
  );
}

/** get_vercel_logs — Vercel-specific; resolves latest deployment if none given. */
export function vercelLogs(
  store: Store,
  input: Base & { deploymentId?: string; since?: string; limit?: number },
): Promise<GuardedResponse> {
  return runVercelLogs(store, input, "get_vercel_logs");
}

// --- Railway (logs) --------------------------------------------------------

function railwayResource(store: Store, project: Project, environment: Environment) {
  const m = requireMapping(store, project, environment, "railway");
  return { ...(m.resource as {
    projectId: string;
    environmentId?: string;
    serviceId?: string;
    projectName?: string;
  }), connectionId: m.connectionId };
}

/**
 * Resolve the target Railway deployment (latest if none given) and fetch its
 * logs. Mirrors fetchVercelLogsData: log-availability problems become a
 * `limitation` (with status attached) rather than a thrown error.
 */
async function fetchRailwayLogsData(
  token: string,
  r: { projectId: string; environmentId?: string; serviceId?: string },
  opts: { deploymentId?: string; since?: string; limit?: number },
): Promise<LogResult> {
  assertPositiveInteger("limit", opts.limit);
  assertValidSince(opts.since);
  const limit = opts.limit ?? 100;
  const time_range = { since: opts.since };

  let deploymentId = opts.deploymentId;
  let deployment_url: string | undefined;
  let deployment_status: string | undefined;

  if (!deploymentId) {
    const deps = await rw.listDeployments(
      token,
      { projectId: r.projectId, environmentId: r.environmentId, serviceId: r.serviceId },
      1,
    );
    if (deps.length === 0) {
      return {
        resource: { project: r.projectId },
        time_range,
        logs: [],
        limitation: "No deployments found for this Railway project/service — nothing to fetch logs for.",
        audit_written: true,
      };
    }
    const latest = deps[0]!;
    deploymentId = latest.id;
    deployment_url = httpsUrl(latest.staticUrl ?? latest.url);
    deployment_status = latest.status;
  }

  const resource = {
    project: r.projectId,
    deployment_id: deploymentId,
    deployment_url,
    deployment_status,
  };

  try {
    const raw = await rw.getDeploymentLogs(token, deploymentId, limit, opts.since);
    const logs = raw.map(normalizeRailwayLog);
    const limitation =
      logs.length === 0
        ? "Railway returned no log lines for this deployment (logs may have expired or the " +
          "deployment produced none)."
        : undefined;
    return { resource, time_range, logs, limitation, audit_written: true };
  } catch (err) {
    return {
      resource,
      time_range,
      logs: [],
      limitation:
        `Could not fetch Railway deployment logs (${err instanceof Error ? err.message : String(err)}). ` +
        "Returning the deployment status only.",
      audit_written: true,
    };
  }
}

/** Shared guarded Railway log read; `tool` distinguishes the audited entry. */
function runRailwayLogs(
  store: Store,
  input: Base & { deploymentId?: string; since?: string; limit?: number },
  tool: string,
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = railwayResource(store, project, environment);
  const label = input.deploymentId ?? r.projectId;
  return runGuarded(
    store,
    ctx(project, environment, "railway", "read", tool, `logs ${label}`, { resourceLabel: label }),
    () =>
      fetchRailwayLogsData(tokenFor(store, "railway", r.connectionId), r, {
        deploymentId: input.deploymentId,
        since: input.since,
        limit: input.limit,
      }),
  );
}

/** get_railway_logs — Railway-specific; resolves latest deployment if none given. */
export function railwayLogs(
  store: Store,
  input: Base & { deploymentId?: string; since?: string; limit?: number },
): Promise<GuardedResponse> {
  return runRailwayLogs(store, input, "get_railway_logs");
}

/** get_railway_project_context — Railway project + its environments/services. */
export async function railwayProjectContext(store: Store, input: Base): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = railwayResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "railway", "read", "get_railway_project_context", `project ${r.projectId}`, {
      resourceLabel: r.projectId,
    }),
    () => rw.getProject(tokenFor(store, "railway", r.connectionId), r.projectId),
  );
}

/** get_railway_deployments — recent deployments for the mapped project/service. */
export async function railwayDeployments(
  store: Store,
  input: Base & { limit?: number },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = railwayResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "railway", "read", "get_railway_deployments", `deployments ${r.projectId}`, {
      resourceLabel: r.projectId,
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      return rw.listDeployments(
        tokenFor(store, "railway", r.connectionId),
        { projectId: r.projectId, environmentId: r.environmentId, serviceId: r.serviceId },
        input.limit ?? 10,
      );
    },
  );
}

export async function railwayDiscover(store: Store, input: Base): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const mapping = findMapping(store, environment, "railway");
  return runGuarded(
    store,
    ctx(project, environment, "railway", "read", "discover_railway_resources", "discover railway projects"),
    () => rw.listProjects(tokenFor(store, "railway", mapping?.connectionId)),
  );
}

/**
 * create_railway_deployment — trigger a deployment of the mapped Railway
 * service, or redeploy an existing deployment by id. PRODUCTION deploys require
 * approval by default (capability "deploy").
 */
export async function railwayCreateDeployment(
  store: Store,
  input: Base & { deploymentId?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = railwayResource(store, project, environment);
  const label = input.deploymentId ?? r.projectId;
  return runGuarded(
    store,
    ctx(project, environment, "railway", "deploy", "create_railway_deployment", `deploy ${label}`, {
      resourceLabel: label,
    }),
    () => {
      const token = tokenFor(store, "railway", r.connectionId);
      if (input.deploymentId) return rw.redeploy(token, input.deploymentId);
      if (!r.environmentId || !r.serviceId) {
        throw new OfflocalError(
          "Railway deploy needs the mapping to include environmentId and serviceId " +
            "(or pass deploymentId to redeploy an existing deployment).",
        );
      }
      return rw.triggerDeploy(token, {
        projectId: r.projectId,
        environmentId: r.environmentId,
        serviceId: r.serviceId,
      });
    },
  );
}

/**
 * set_railway_env_var — create/update a Railway variable. PRODUCTION env changes
 * require approval by default (capability "env_change"). Railway redeploys the
 * affected service on change unless `skipDeploys` is true.
 */
export async function railwaySetEnvVar(
  store: Store,
  input: Base & { key: string; value: string; serviceId?: string; skipDeploys?: boolean },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = railwayResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "railway", "env_change", "set_railway_env_var", `set var ${input.key} on ${r.projectId}`, {
      resourceLabel: `${r.projectId}:${input.key}`,
    }),
    () => {
      if (!r.environmentId) {
        throw new OfflocalError(
          "Railway variable changes need the mapping to include environmentId.",
        );
      }
      return rw.upsertVariable(tokenFor(store, "railway", r.connectionId), {
        projectId: r.projectId,
        environmentId: r.environmentId,
        serviceId: input.serviceId ?? r.serviceId,
        name: assertNonEmptyString("key", input.key),
        value: input.value,
        skipDeploys: input.skipDeploys,
      });
    },
  );
}

/** set_app_env_vars — apply a bundle of deployment env vars under one governed action. */
export async function setAppEnvVars(
  store: Store,
  input: Base & {
    targetProvider: AppEnvTargetProvider;
    vars: AppEnvVarInput[];
    target?: string[];
    serviceId?: string;
    skipDeploys?: boolean;
  },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const targetProvider = assertAppEnvTargetProvider(input.targetProvider);
  const summaryKeys = rawEnvKeys(input.vars);

  if (targetProvider === "vercel") {
    const r = vercelResource(store, project, environment);
    const summary = `set ${summaryKeys.length} env vars on ${r.projectId}: ${envKeySummary(summaryKeys)}`;
    return runGuarded(
      store,
      ctx(project, environment, "vercel", "env_change", "set_app_env_vars", summary, {
        resourceLabel: `${r.projectId}:${envKeySummary(summaryKeys)}`,
      }),
      async () => {
        const vars = assertAppEnvVars(input.vars);
        const keys = vars.map((item) => item.key);
        const target = assertVercelTargets(input.target) ?? [environment.isProduction ? "production" : "preview"];
        for (const item of vars) {
          await vc.setEnvVar(
            tokenFor(store, "vercel", r.connectionId),
            r.projectId,
            { key: item.key, value: item.value, target },
            vercelTeamId(store, r.teamId, r.connectionId),
          );
        }
        return { targetProvider, count: vars.length, keys };
      },
    );
  }

  const r = railwayResource(store, project, environment);
  const summary = `set ${summaryKeys.length} env vars on ${r.projectId}: ${envKeySummary(summaryKeys)}`;
  return runGuarded(
    store,
    ctx(project, environment, "railway", "env_change", "set_app_env_vars", summary, {
      resourceLabel: `${r.projectId}:${envKeySummary(summaryKeys)}`,
    }),
    async () => {
      const vars = assertAppEnvVars(input.vars);
      const keys = vars.map((item) => item.key);
      const serviceId = input.serviceId === undefined ? r.serviceId : assertNonEmptyString("serviceId", input.serviceId);
      if (!r.environmentId) {
        throw new OfflocalError(
          "Railway variable changes need the mapping to include environmentId.",
        );
      }
      for (const item of vars) {
        await rw.upsertVariable(tokenFor(store, "railway", r.connectionId), {
          projectId: r.projectId,
          environmentId: r.environmentId,
          serviceId,
          name: item.key,
          value: item.value,
          skipDeploys: input.skipDeploys,
        });
      }
      return { targetProvider, count: vars.length, keys };
    },
  );
}

// --- Namecheap -----------------------------------------------------------------

/** check_domain_availability — availability + premium pricing (read-only). */
export async function checkDomainAvailability(
  store: Store,
  input: Base & { domains: string[] },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  if (!Array.isArray(input.domains) || input.domains.length === 0) {
    throw new OfflocalError("domains must be a non-empty list of domain names.");
  }
  const label = input.domains.join(",");
  return runGuarded(
    store,
    ctx(project, environment, "namecheap", "read", "check_domain_availability", `check availability of ${label}`, {
      resourceLabel: label,
    }),
    () => nc.checkDomains(tokenFor(store, "namecheap"), input.domains),
  );
}

/** list_namecheap_domains — domains in the Namecheap account (read-only). */
export async function namecheapListDomains(
  store: Store,
  input: Base & { page?: number; pageSize?: number; searchTerm?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  return runGuarded(
    store,
    ctx(project, environment, "namecheap", "read", "list_namecheap_domains", "list Namecheap domains"),
    () => {
      assertPositiveInteger("page", input.page);
      assertPositiveInteger("pageSize", input.pageSize);
      return nc.listDomains(tokenFor(store, "namecheap"), {
        page: input.page,
        pageSize: input.pageSize,
        searchTerm: input.searchTerm,
      });
    },
  );
}

/**
 * purchase_domain — registers a domain and SPENDS REAL MONEY. Capability
 * "purchase" is clamped to approval_required by policy and marked live, so it
 * always needs a human. The registrant contact is validated before any HTTP
 * (including the DashClaw guard call) so a missing config never burns an
 * approval round-trip.
 */
export async function purchaseDomain(
  store: Store,
  input: Base & { domain: string; years?: number },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const domain = assertNonEmptyString("domain", input.domain);
  const registrant = loadRegistrantContact(store.paths.config);
  if (!registrant) {
    throw new OfflocalError(
      `Domain purchase needs a registrant contact. Add a "namecheap.registrant" block to ` +
        `${store.paths.config} with first_name, last_name, address1, city, state_province, ` +
        `postal_code, country, phone (format +1.NNNNNNNNNN), email_address — then retry.`,
    );
  }
  return runGuarded(
    store,
    ctx(project, environment, "namecheap", "purchase", "purchase_domain", `purchase domain ${domain}`, {
      live: true,
      resourceLabel: domain,
    }),
    () => {
      assertPositiveInteger("years", input.years);
      return nc.createDomain(tokenFor(store, "namecheap"), {
        domain,
        years: input.years,
        registrant,
      });
    },
  );
}

/** get_dns_records — DNS host records for a domain (read-only). */
export async function getDnsRecords(
  store: Store,
  input: Base & { domain: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const domain = assertNonEmptyString("domain", input.domain);
  return runGuarded(
    store,
    ctx(project, environment, "namecheap", "read", "get_dns_records", `DNS records for ${domain}`, {
      resourceLabel: domain,
    }),
    () => nc.getDnsHosts(tokenFor(store, "namecheap"), domain),
  );
}

/**
 * set_dns_records — REPLACES ALL host records for the domain (Namecheap
 * setHosts semantics). Capability "env_change": approval required in
 * production by default.
 */
export async function setDnsRecords(
  store: Store,
  input: Base & { domain: string; records: nc.DnsRecordInput[] },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const domain = assertNonEmptyString("domain", input.domain);
  if (!Array.isArray(input.records) || input.records.length === 0) {
    throw new OfflocalError(
      "records must be a non-empty list — setHosts REPLACES ALL host records, so an empty list would wipe the domain's DNS.",
    );
  }
  return runGuarded(
    store,
    ctx(project, environment, "namecheap", "env_change", "set_dns_records", `REPLACE all DNS host records for ${domain}`, {
      resourceLabel: domain,
    }),
    () => nc.setDnsHosts(tokenFor(store, "namecheap"), domain, input.records),
  );
}

// --- Neon --------------------------------------------------------------------

/** list_neon_projects — Neon projects visible to the API key (read-only). */
export async function neonListProjects(store: Store, input: Base): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  return runGuarded(
    store,
    ctx(project, environment, "neon", "read", "list_neon_projects", "list Neon projects"),
    () => ne.listProjects(tokenFor(store, "neon")),
  );
}

/** create_neon_project — provision a Neon project (capability "write"). */
export async function neonCreateProject(
  store: Store,
  input: Base & { name?: string; regionId?: string; pgVersion?: number },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const label = input.name ?? "(default name)";
  return runGuarded(
    store,
    ctx(project, environment, "neon", "write", "create_neon_project", `create Neon project ${label}`, {
      resourceLabel: label,
    }),
    () =>
      ne.createProject(tokenFor(store, "neon"), {
        name: input.name,
        regionId: input.regionId,
        pgVersion: input.pgVersion,
      }),
  );
}

/**
 * get_neon_connection_uri — fetch the connection URI for a Neon project. The
 * URI (with credentials) goes to the tool result ONLY; summary and resource
 * label deliberately name the project, never the URI.
 */
export async function neonGetConnectionUri(
  store: Store,
  input: Base & {
    neonProjectId: string;
    databaseName: string;
    roleName: string;
    branchId?: string;
    pooled?: boolean;
  },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const id = assertNonEmptyString("neonProjectId", input.neonProjectId);
  return runGuarded(
    store,
    ctx(project, environment, "neon", "read", "get_neon_connection_uri", `connection URI for Neon project ${id}`, {
      resourceLabel: id,
    }),
    () =>
      ne.getConnectionUri(tokenFor(store, "neon"), {
        projectId: id,
        databaseName: assertNonEmptyString("databaseName", input.databaseName),
        roleName: assertNonEmptyString("roleName", input.roleName),
        branchId: input.branchId,
        pooled: input.pooled,
      }),
  );
}

// --- Upstash Redis -----------------------------------------------------------

function upstashCredentials(store: Store, connectionId?: string): { email: string; apiKey: string } {
  const email = process.env.UPSTASH_EMAIL?.trim();
  if (!email) {
    throw new OfflocalError("UPSTASH_EMAIL is not set. Upstash Developer API uses Basic auth with EMAIL:API_KEY.");
  }
  return { email, apiKey: tokenFor(store, "upstash", connectionId) };
}

function upstashResource(store: Store, project: Project, environment: Environment) {
  const m = requireMapping(store, project, environment, "upstash");
  return {
    ...(m.resource as UpstashResource),
    connectionId: m.connectionId,
  };
}

function qstashToken(resource: UpstashResource): string {
  const envVar = resource.qstashTokenEnvVar ?? "QSTASH_TOKEN";
  const value = process.env[envVar]?.trim();
  if (!value) {
    throw new OfflocalError(`Environment variable ${envVar} is not set for QStash.`);
  }
  return value;
}

function assertUpstashPlatform(value: string): "aws" | "gcp" {
  const platform = assertNonEmptyString("platform", value);
  if (platform !== "aws" && platform !== "gcp") {
    throw new OfflocalError('platform must be "aws" or "gcp".');
  }
  return platform;
}

function assertQstashMethod(value: string | undefined): "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | undefined {
  if (value === undefined) return undefined;
  const method = assertNonEmptyString("method", value).toUpperCase();
  if (method !== "GET" && method !== "POST" && method !== "PUT" && method !== "PATCH" && method !== "DELETE") {
    throw new OfflocalError('method must be one of "GET", "POST", "PUT", "PATCH", or "DELETE".');
  }
  return method;
}

/** list_upstash_redis_databases — Redis databases visible to the Upstash API key. */
export async function upstashListRedisDatabases(
  store: Store,
  input: Base & { apiHost?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  return runGuarded(
    store,
    ctx(project, environment, "upstash", "read", "list_upstash_redis_databases", "list Upstash Redis databases"),
    () => {
      const creds = upstashCredentials(store);
      const apiHost = input.apiHost === undefined ? undefined : assertNonEmptyString("apiHost", input.apiHost);
      return us.listRedisDatabases(creds.email, creds.apiKey, apiHost);
    },
  );
}

/** create_upstash_redis_database — create Redis and return REST env wiring. */
export async function upstashCreateRedisDatabase(
  store: Store,
  input: Base & {
    apiHost?: string;
    databaseName: string;
    platform: "aws" | "gcp";
    primaryRegion: string;
    readRegions?: string[];
    plan?: string;
    budget?: number;
    eviction?: boolean;
    tls?: boolean;
  },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const databaseName = assertNonEmptyString("databaseName", input.databaseName);
  return runGuarded(
    store,
    ctx(project, environment, "upstash", "env_change", "create_upstash_redis_database", `create Upstash Redis database ${databaseName}`, {
      resourceLabel: databaseName,
    }),
    async () => {
      const creds = upstashCredentials(store);
      if (input.budget !== undefined && (!Number.isSafeInteger(input.budget) || input.budget < 0)) {
        throw new OfflocalError("budget must be a non-negative integer.");
      }
      const created = await us.createRedisDatabase(creds.email, creds.apiKey, {
        apiHost: input.apiHost === undefined ? undefined : assertNonEmptyString("apiHost", input.apiHost),
        databaseName,
        platform: assertUpstashPlatform(input.platform),
        primaryRegion: assertNonEmptyString("primaryRegion", input.primaryRegion),
        readRegions: assertNonEmptyStringList("readRegions", input.readRegions),
        plan: input.plan === undefined ? undefined : assertNonEmptyString("plan", input.plan),
        budget: input.budget,
        eviction: input.eviction,
        tls: input.tls,
      });
      return { database: us.databaseSummary(created), ...us.redisEnv(created) };
    },
  );
}

/** get_upstash_redis_env — return REST URL/token env wiring for a mapped Redis database. */
export async function upstashGetRedisEnv(
  store: Store,
  input: Base & { databaseId?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = input.databaseId
    ? { databaseId: assertNonEmptyString("databaseId", input.databaseId), apiHost: undefined, connectionId: undefined }
    : upstashResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "upstash", "read", "get_upstash_redis_env", `get Upstash Redis env wiring for ${r.databaseId}`, {
      resourceLabel: r.databaseId,
    }),
    async () => {
      const creds = upstashCredentials(store, r.connectionId);
      const data = await us.getRedisDatabase(creds.email, creds.apiKey, r.databaseId, r.apiHost);
      return us.redisEnv(data);
    },
  );
}

/** get_upstash_qstash_env — return QStash URL/token/signing-key env wiring for background jobs. */
export async function upstashGetQstashEnv(store: Store, input: Base): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = upstashResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "upstash", "read", "get_upstash_qstash_env", "get QStash env wiring", {
      resourceLabel: "qstash",
    }),
    async () => {
      const token = qstashToken(r);
      const signingKeys = await qs.getSigningKeys(token, r.qstashUrl);
      return qs.appEnv(r, token, signingKeys);
    },
  );
}

/** list_upstash_qstash_schedules — cron/background schedules visible to the QStash token. */
export async function upstashListQstashSchedules(store: Store, input: Base): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = upstashResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "upstash", "read", "list_upstash_qstash_schedules", "list QStash schedules", {
      resourceLabel: "qstash",
    }),
    () => qs.listSchedules(qstashToken(r), r.qstashUrl),
  );
}

/** create_upstash_qstash_schedule — create a cron delivery schedule for an app endpoint. */
export async function upstashCreateQstashSchedule(
  store: Store,
  input: Base & {
    destination: string;
    cron: string;
    scheduleId?: string;
    body?: string;
    contentType?: string;
    method?: string;
    retries?: number;
  },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = upstashResource(store, project, environment);
  const destination = assertNonEmptyString("destination", input.destination);
  const cron = assertNonEmptyString("cron", input.cron);
  const scheduleId = input.scheduleId === undefined ? undefined : assertNonEmptyString("scheduleId", input.scheduleId);
  return runGuarded(
    store,
    ctx(
      project,
      environment,
      "upstash",
      "env_change",
      "create_upstash_qstash_schedule",
      `create QStash schedule ${scheduleId ?? destination}`,
      { resourceLabel: scheduleId ?? "qstash-schedule" },
    ),
    () => {
      assertNonNegativeInteger("retries", input.retries);
      return qs.createSchedule(qstashToken(r), {
        qstashUrl: r.qstashUrl,
        destination,
        cron,
        scheduleId,
        body: input.body === undefined ? undefined : assertNonEmptyString("body", input.body),
        contentType: input.contentType === undefined ? undefined : assertNonEmptyString("contentType", input.contentType),
        method: assertQstashMethod(input.method),
        retries: input.retries,
      });
    },
  );
}

// --- Cloudflare R2 object storage ------------------------------------------

type CloudflareR2MappedResource = CloudflareR2Resource & { connectionId?: string };

function cloudflareR2Resource(
  store: Store,
  project: Project,
  environment: Environment,
  accountId?: string,
): CloudflareR2MappedResource {
  const mapped = findMapping(store, environment, "cloudflare_r2");
  if (!mapped && accountId === undefined) {
    throw new OfflocalError(
      `No cloudflare_r2 mapping for ${project.slug}/${environment.name}. Add one with map_provider_resource.`,
    );
  }
  const resource = (mapped?.resource ?? { provider: "cloudflare_r2", accountId }) as CloudflareR2Resource;
  return {
    ...resource,
    accountId: accountId === undefined ? resource.accountId : assertNonEmptyString("accountId", accountId),
    connectionId: mapped?.connectionId,
  };
}

function assertCloudflareR2BucketName(value: string, field = "bucketName"): string {
  const bucketName = assertNonEmptyString(field, value);
  if (
    bucketName.length < 3 ||
    bucketName.length > 63 ||
    !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucketName) ||
    bucketName.includes("..")
  ) {
    throw new OfflocalError(`${field} must be a valid R2 bucket name: 3-63 lowercase letters, numbers, dots, or hyphens.`);
  }
  return bucketName;
}

function assertCloudflareR2Jurisdiction(value: string | undefined): CloudflareR2Resource["jurisdiction"] | undefined {
  if (value === undefined) return undefined;
  const jurisdiction = assertNonEmptyString("jurisdiction", value);
  if (jurisdiction !== "default" && jurisdiction !== "eu" && jurisdiction !== "fedramp") {
    throw new OfflocalError('jurisdiction must be "default", "eu", or "fedramp".');
  }
  return jurisdiction;
}

function cloudflareR2BucketName(r: CloudflareR2MappedResource, inputBucketName?: string): string {
  const bucketName = inputBucketName ?? r.bucketName;
  if (!bucketName) {
    throw new OfflocalError("bucketName is required either in the mapping or the tool input.");
  }
  return assertCloudflareR2BucketName(bucketName);
}

function cloudflareR2AppCredentials(r: CloudflareR2MappedResource): { accessKeyId: string; secretAccessKey: string } {
  const accessKeyIdEnvVar = r.accessKeyIdEnvVar ?? "R2_ACCESS_KEY_ID";
  const secretAccessKeyEnvVar = r.secretAccessKeyEnvVar ?? "R2_SECRET_ACCESS_KEY";
  const accessKeyId = process.env[accessKeyIdEnvVar]?.trim();
  const secretAccessKey = process.env[secretAccessKeyEnvVar]?.trim();
  if (!accessKeyId) {
    throw new OfflocalError(`Environment variable ${accessKeyIdEnvVar} is not set for R2 app env wiring.`);
  }
  if (!secretAccessKey) {
    throw new OfflocalError(`Environment variable ${secretAccessKeyEnvVar} is not set for R2 app env wiring.`);
  }
  return { accessKeyId, secretAccessKey };
}

/** list_cloudflare_r2_buckets — buckets visible in the mapped Cloudflare account. */
export async function cloudflareR2ListBuckets(
  store: Store,
  input: Base & { accountId?: string; cursor?: string; limit?: number },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = cloudflareR2Resource(store, project, environment, input.accountId);
  return runGuarded(
    store,
    ctx(project, environment, "cloudflare_r2", "read", "list_cloudflare_r2_buckets", `list R2 buckets for ${r.accountId}`, {
      resourceLabel: r.accountId,
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      const cursor = input.cursor === undefined ? undefined : assertNonEmptyString("cursor", input.cursor);
      return r2.listBuckets(tokenFor(store, "cloudflare_r2", r.connectionId), {
        accountId: r.accountId,
        apiHost: r.apiHost,
        cursor,
        limit: input.limit,
      });
    },
  );
}

/** create_cloudflare_r2_bucket — create a bucket and return S3-compatible app env wiring. */
export async function cloudflareR2CreateBucket(
  store: Store,
  input: Base & {
    accountId?: string;
    bucketName: string;
    locationHint?: string;
    storageClass?: string;
    jurisdiction?: string;
  },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = cloudflareR2Resource(store, project, environment, input.accountId);
  const bucketName = assertCloudflareR2BucketName(input.bucketName);
  const jurisdiction = assertCloudflareR2Jurisdiction(input.jurisdiction) ?? r.jurisdiction;
  return runGuarded(
    store,
    ctx(project, environment, "cloudflare_r2", "env_change", "create_cloudflare_r2_bucket", `create R2 bucket ${bucketName}`, {
      resourceLabel: `${r.accountId}/${bucketName}`,
    }),
    async () => {
      const bucket = await r2.createBucket(tokenFor(store, "cloudflare_r2", r.connectionId), {
        accountId: r.accountId,
        apiHost: r.apiHost,
        name: bucketName,
        jurisdiction,
        locationHint: input.locationHint === undefined ? undefined : assertNonEmptyString("locationHint", input.locationHint),
        storageClass: input.storageClass === undefined ? undefined : assertNonEmptyString("storageClass", input.storageClass),
      });
      return { bucket, ...r2.appEnv({ ...r, jurisdiction }, bucketName) };
    },
  );
}

/** get_cloudflare_r2_env — return S3-compatible R2 app env wiring for a mapped bucket. */
export async function cloudflareR2GetEnv(
  store: Store,
  input: Base & { accountId?: string; bucketName?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = cloudflareR2Resource(store, project, environment, input.accountId);
  const bucketName = cloudflareR2BucketName(r, input.bucketName);
  return runGuarded(
    store,
    ctx(project, environment, "cloudflare_r2", "read", "get_cloudflare_r2_env", `get R2 env wiring for ${bucketName}`, {
      resourceLabel: `${r.accountId}/${bucketName}`,
    }),
    async () => r2.appEnv(r, bucketName, cloudflareR2AppCredentials(r)),
  );
}

/** list_cloudflare_r2_objects — list object summaries for the mapped R2 bucket. */
export async function cloudflareR2ListObjects(
  store: Store,
  input: Base & { accountId?: string; bucketName?: string; prefix?: string; cursor?: string; limit?: number },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = cloudflareR2Resource(store, project, environment, input.accountId);
  const bucketName = cloudflareR2BucketName(r, input.bucketName);
  return runGuarded(
    store,
    ctx(project, environment, "cloudflare_r2", "read", "list_cloudflare_r2_objects", `list R2 objects in ${bucketName}`, {
      resourceLabel: `${r.accountId}/${bucketName}`,
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      const prefix = input.prefix === undefined ? undefined : assertNonEmptyString("prefix", input.prefix);
      const cursor = input.cursor === undefined ? undefined : assertNonEmptyString("cursor", input.cursor);
      return r2.listObjects(tokenFor(store, "cloudflare_r2", r.connectionId), {
        accountId: r.accountId,
        bucketName,
        apiHost: r.apiHost,
        jurisdiction: r.jurisdiction,
        prefix,
        cursor,
        limit: input.limit,
      });
    },
  );
}

// --- Clerk ------------------------------------------------------------------

function clerkResource(store: Store, project: Project, environment: Environment) {
  const m = requireMapping(store, project, environment, "clerk");
  return {
    ...(m.resource as {
      publishableKey: string;
      apiHost?: string;
      frontendApiUrl?: string;
      signInUrl?: string;
      signUpUrl?: string;
      signInFallbackRedirectUrl?: string;
      signUpFallbackRedirectUrl?: string;
    }),
    connectionId: m.connectionId,
  };
}

function assertClerkRedirectUrl(value: string): string {
  const url = assertNonEmptyString("url", value);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    throw new OfflocalError("url must be a full URL, e.g. https://app.example.com/callback or my-app://callback.");
  }
  return url;
}

/** get_clerk_app_env — return public Clerk frontend env wiring for the mapped app. */
export async function clerkGetAppEnv(store: Store, input: Base): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = clerkResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "clerk", "read", "get_clerk_app_env", "get Clerk app env wiring", {
      resourceLabel: "app",
    }),
    async () => ck.appEnv(r, await ck.listDomains(tokenFor(store, "clerk", r.connectionId), r.apiHost)),
  );
}

/** list_clerk_users — user summaries visible to the Clerk secret key. */
export async function clerkListUsers(
  store: Store,
  input: Base & { limit?: number; offset?: number; query?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = clerkResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "clerk", "read", "list_clerk_users", "list Clerk users", {
      resourceLabel: "users",
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      assertNonNegativeInteger("offset", input.offset);
      const query = input.query === undefined ? undefined : assertNonEmptyString("query", input.query);
      return ck.listUsers(tokenFor(store, "clerk", r.connectionId), {
        apiHost: r.apiHost,
        limit: input.limit,
        offset: input.offset,
        query,
      });
    },
  );
}

/** list_clerk_domains — primary/satellite domain configuration for the Clerk instance. */
export async function clerkListDomains(store: Store, input: Base): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = clerkResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "clerk", "read", "list_clerk_domains", "list Clerk domains", {
      resourceLabel: "domains",
    }),
    () => ck.listDomains(tokenFor(store, "clerk", r.connectionId), r.apiHost),
  );
}

/** list_clerk_redirect_urls — whitelisted OAuth/native redirect URLs for the Clerk instance. */
export async function clerkListRedirectUrls(
  store: Store,
  input: Base & { limit?: number; offset?: number },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = clerkResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "clerk", "read", "list_clerk_redirect_urls", "list Clerk redirect URLs", {
      resourceLabel: "redirect_urls",
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      assertNonNegativeInteger("offset", input.offset);
      return ck.listRedirectUrls(tokenFor(store, "clerk", r.connectionId), {
        apiHost: r.apiHost,
        limit: input.limit,
        offset: input.offset,
      });
    },
  );
}

/** create_clerk_redirect_url — whitelist a redirect URL for OAuth/native auth flows. */
export async function clerkCreateRedirectUrl(store: Store, input: Base & { url: string }): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = clerkResource(store, project, environment);
  const url = assertClerkRedirectUrl(input.url);
  return runGuarded(
    store,
    ctx(project, environment, "clerk", "env_change", "create_clerk_redirect_url", "create Clerk redirect URL", {
      resourceLabel: "redirect_url",
    }),
    () => ck.createRedirectUrl(tokenFor(store, "clerk", r.connectionId), { apiHost: r.apiHost, url }),
  );
}

// --- Sentry -----------------------------------------------------------------

function sentryResource(store: Store, project: Project, environment: Environment) {
  const m = requireMapping(store, project, environment, "sentry");
  return {
    ...(m.resource as { organizationSlug: string; projectSlug?: string; teamSlug?: string }),
    connectionId: m.connectionId,
  };
}

function sentryProjectSlug(r: { projectSlug?: string }, inputProjectSlug?: string): string {
  const projectSlug = inputProjectSlug ?? r.projectSlug;
  if (!projectSlug) {
    throw new OfflocalError("Sentry projectSlug is required either in the mapping or the tool input.");
  }
  return assertNonEmptyString("projectSlug", projectSlug);
}

function sentryProjectSlugs(r: { projectSlug?: string }, inputProjects?: string[]): string[] {
  const projects = inputProjects ?? (r.projectSlug ? [r.projectSlug] : undefined);
  const validated = assertNonEmptyStringList("projects", projects);
  if (!validated) {
    throw new OfflocalError("Sentry projects are required either in the mapping projectSlug or the tool input.");
  }
  return validated;
}

/** list_sentry_projects — Sentry projects visible within the mapped organization. */
export async function sentryListProjects(
  store: Store,
  input: Base & { limit?: number; query?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = sentryResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "sentry", "read", "list_sentry_projects", `list Sentry projects for ${r.organizationSlug}`, {
      resourceLabel: r.organizationSlug,
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      const query = input.query === undefined ? undefined : assertNonEmptyString("query", input.query);
      return se.listProjects(tokenFor(store, "sentry", r.connectionId), r.organizationSlug, input.limit ?? 20, query);
    },
  );
}

/** create_sentry_project — create an observability project for SDK event ingest. */
export async function sentryCreateProject(
  store: Store,
  input: Base & { name: string; slug?: string; platform?: string; teamSlug?: string; defaultRules?: boolean },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = sentryResource(store, project, environment);
  const name = assertNonEmptyString("name", input.name);
  const teamSlug = input.teamSlug ?? r.teamSlug;
  return runGuarded(
    store,
    ctx(project, environment, "sentry", "env_change", "create_sentry_project", `create Sentry project ${name}`, {
      resourceLabel: r.organizationSlug,
    }),
    () =>
      se.createProject(tokenFor(store, "sentry", r.connectionId), r.organizationSlug, {
        name,
        slug: input.slug === undefined ? undefined : assertNonEmptyString("slug", input.slug),
        platform: input.platform === undefined ? undefined : assertNonEmptyString("platform", input.platform),
        defaultRules: input.defaultRules,
        teamSlug: teamSlug === undefined ? undefined : assertNonEmptyString("teamSlug", teamSlug),
      }),
  );
}

/** list_sentry_client_keys — return public DSNs only; secret DSNs are stripped. */
export async function sentryListClientKeys(
  store: Store,
  input: Base & { projectSlug?: string; status?: "active" | "inactive" },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = sentryResource(store, project, environment);
  const projectSlug = sentryProjectSlug(r, input.projectSlug);
  return runGuarded(
    store,
    ctx(project, environment, "sentry", "read", "list_sentry_client_keys", `list Sentry client keys for ${r.organizationSlug}/${projectSlug}`, {
      resourceLabel: `${r.organizationSlug}/${projectSlug}`,
    }),
    () => {
      if (input.status !== undefined && input.status !== "active" && input.status !== "inactive") {
        throw new OfflocalError('status must be "active" or "inactive".');
      }
      return se.listClientKeys(tokenFor(store, "sentry", r.connectionId), r.organizationSlug, projectSlug, input.status);
    },
  );
}

/** create_sentry_client_key — create a public DSN for wiring SENTRY_DSN. */
export async function sentryCreateClientKey(
  store: Store,
  input: Base & {
    projectSlug?: string;
    name?: string;
    useCase?: string;
    rateLimitWindow?: number;
    rateLimitCount?: number;
  },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = sentryResource(store, project, environment);
  const projectSlug = sentryProjectSlug(r, input.projectSlug);
  return runGuarded(
    store,
    ctx(project, environment, "sentry", "env_change", "create_sentry_client_key", `create Sentry client key for ${r.organizationSlug}/${projectSlug}`, {
      resourceLabel: `${r.organizationSlug}/${projectSlug}`,
    }),
    () => {
      const hasRateLimit = input.rateLimitWindow !== undefined || input.rateLimitCount !== undefined;
      let rateLimit: { window: number; count: number } | undefined;
      if (hasRateLimit) {
        assertPositiveInteger("rateLimitWindow", input.rateLimitWindow);
        assertPositiveInteger("rateLimitCount", input.rateLimitCount);
        if (input.rateLimitWindow === undefined || input.rateLimitCount === undefined) {
          throw new OfflocalError("rateLimitWindow and rateLimitCount must be provided together.");
        }
        rateLimit = { window: input.rateLimitWindow, count: input.rateLimitCount };
      }
      return se.createClientKey(tokenFor(store, "sentry", r.connectionId), r.organizationSlug, projectSlug, {
        name: input.name === undefined ? undefined : assertNonEmptyString("name", input.name),
        useCase: assertSentryClientKeyUseCase(input.useCase),
        rateLimit,
      });
    },
  );
}

/** list_sentry_releases — release records for the mapped Sentry organization. */
export async function sentryListReleases(
  store: Store,
  input: Base & { query?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = sentryResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "sentry", "read", "list_sentry_releases", `list Sentry releases for ${r.organizationSlug}`, {
      resourceLabel: r.organizationSlug,
    }),
    () => {
      const query = input.query === undefined ? undefined : assertNonEmptyString("query", input.query);
      return se.listReleases(tokenFor(store, "sentry", r.connectionId), r.organizationSlug, query);
    },
  );
}

/** create_sentry_release — create a version marker Sentry can correlate to issues. */
export async function sentryCreateRelease(
  store: Store,
  input: Base & { version: string; projects?: string[]; ref?: string; url?: string; dateReleased?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = sentryResource(store, project, environment);
  const version = assertNonEmptyString("version", input.version);
  return runGuarded(
    store,
    ctx(project, environment, "sentry", "write", "create_sentry_release", `create Sentry release ${version}`, {
      resourceLabel: `${r.organizationSlug}/${version}`,
    }),
    () =>
      se.createRelease(tokenFor(store, "sentry", r.connectionId), r.organizationSlug, {
        version,
        projects: sentryProjectSlugs(r, input.projects),
        ref: input.ref === undefined ? undefined : assertNonEmptyString("ref", input.ref),
        url: input.url === undefined ? undefined : assertNonEmptyString("url", input.url),
        dateReleased: input.dateReleased === undefined ? undefined : assertNonEmptyString("dateReleased", input.dateReleased),
      }),
  );
}

/** list_sentry_deploys — deploy markers for a Sentry release. */
export async function sentryListDeploys(
  store: Store,
  input: Base & { version: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = sentryResource(store, project, environment);
  const version = assertNonEmptyString("version", input.version);
  return runGuarded(
    store,
    ctx(project, environment, "sentry", "read", "list_sentry_deploys", `list Sentry deploys for ${version}`, {
      resourceLabel: `${r.organizationSlug}/${version}`,
    }),
    () => se.listDeploys(tokenFor(store, "sentry", r.connectionId), r.organizationSlug, version),
  );
}

/** create_sentry_deploy — record that a release reached an environment. */
export async function sentryCreateDeploy(
  store: Store,
  input: Base & {
    version: string;
    deployEnvironment: string;
    name?: string;
    url?: string;
    dateStarted?: string;
    dateFinished?: string;
    projects?: string[];
  },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = sentryResource(store, project, environment);
  const version = assertNonEmptyString("version", input.version);
  const deployEnvironment = assertNonEmptyString("deployEnvironment", input.deployEnvironment);
  return runGuarded(
    store,
    ctx(project, environment, "sentry", "deploy", "create_sentry_deploy", `create Sentry deploy marker ${version} to ${deployEnvironment}`, {
      live: deployEnvironment.toLowerCase() === "production",
      resourceLabel: `${r.organizationSlug}/${version}/${deployEnvironment}`,
    }),
    () =>
      se.createDeploy(tokenFor(store, "sentry", r.connectionId), r.organizationSlug, version, {
        environment: deployEnvironment,
        name: input.name === undefined ? undefined : assertNonEmptyString("name", input.name),
        url: input.url === undefined ? undefined : assertNonEmptyString("url", input.url),
        dateStarted: input.dateStarted === undefined ? undefined : assertNonEmptyString("dateStarted", input.dateStarted),
        dateFinished: input.dateFinished === undefined ? undefined : assertNonEmptyString("dateFinished", input.dateFinished),
        projects: sentryProjectSlugs(r, input.projects),
      }),
  );
}

// --- PostHog ----------------------------------------------------------------

function posthogResource(store: Store, project: Project, environment: Environment) {
  const m = requireMapping(store, project, environment, "posthog");
  return {
    ...(m.resource as { organizationId: string; projectId?: string; apiHost?: string; ingestHost?: string }),
    connectionId: m.connectionId,
  };
}

function posthogProjectId(r: { projectId?: string }, inputProjectId?: string): string {
  const projectId = inputProjectId ?? r.projectId;
  if (!projectId) {
    throw new OfflocalError("PostHog projectId is required either in the mapping or the tool input.");
  }
  return assertNonEmptyString("projectId", projectId);
}

function assertPostHogActive(value: string | undefined): "STALE" | "false" | "true" | undefined {
  if (value === undefined) return undefined;
  const active = assertNonEmptyString("active", value);
  if (active !== "STALE" && active !== "false" && active !== "true") {
    throw new OfflocalError('active must be one of "STALE", "false", or "true".');
  }
  return active;
}

function assertPostHogFlagType(value: string | undefined): "boolean" | "experiment" | "multivariant" | "remote_config" | undefined {
  if (value === undefined) return undefined;
  const type = assertNonEmptyString("type", value);
  if (type !== "boolean" && type !== "experiment" && type !== "multivariant" && type !== "remote_config") {
    throw new OfflocalError('type must be one of "boolean", "experiment", "multivariant", or "remote_config".');
  }
  return type;
}

/** list_posthog_projects — PostHog projects visible in the mapped organization. */
export async function posthogListProjects(
  store: Store,
  input: Base & { limit?: number; search?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = posthogResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "posthog", "read", "list_posthog_projects", `list PostHog projects for ${r.organizationId}`, {
      resourceLabel: r.organizationId,
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      const search = input.search === undefined ? undefined : assertNonEmptyString("search", input.search);
      return ph.listProjects(tokenFor(store, "posthog", r.connectionId), r.organizationId, {
        apiHost: r.apiHost,
        ingestHost: r.ingestHost,
        limit: input.limit,
        search,
      });
    },
  );
}

/** get_posthog_project_env — return client-safe env wiring for a mapped project. */
export async function posthogGetProjectEnv(
  store: Store,
  input: Base & { projectId?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = posthogResource(store, project, environment);
  const projectId = posthogProjectId(r, input.projectId);
  const hosts = ph.resolveHosts(r.apiHost, r.ingestHost);
  return runGuarded(
    store,
    ctx(project, environment, "posthog", "read", "get_posthog_project_env", `get PostHog env wiring for ${projectId}`, {
      resourceLabel: `${r.organizationId}/${projectId}`,
    }),
    async () => ph.projectEnv(await ph.getProject(tokenFor(store, "posthog", r.connectionId), r.organizationId, projectId, hosts), hosts.ingestHost),
  );
}

/** create_posthog_project — create an analytics project and return NEXT_PUBLIC_POSTHOG_* wiring. */
export async function posthogCreateProject(
  store: Store,
  input: Base & {
    name: string;
    productDescription?: string;
    appUrls?: string[];
    timezone?: string;
    sessionRecording?: boolean;
  },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = posthogResource(store, project, environment);
  const name = assertNonEmptyString("name", input.name);
  const hosts = ph.resolveHosts(r.apiHost, r.ingestHost);
  return runGuarded(
    store,
    ctx(project, environment, "posthog", "env_change", "create_posthog_project", `create PostHog project ${name}`, {
      resourceLabel: r.organizationId,
    }),
    async () => {
      const created = await ph.createProject(tokenFor(store, "posthog", r.connectionId), r.organizationId, {
        apiHost: hosts.apiHost,
        ingestHost: hosts.ingestHost,
        name,
        productDescription:
          input.productDescription === undefined ? undefined : assertNonEmptyString("productDescription", input.productDescription),
        appUrls: assertNonEmptyStringList("appUrls", input.appUrls),
        timezone: input.timezone === undefined ? undefined : assertNonEmptyString("timezone", input.timezone),
        sessionRecording: input.sessionRecording,
      });
      return { project: created, ...ph.projectEnv(created, hosts.ingestHost) };
    },
  );
}

/** list_posthog_feature_flags — feature flags for the mapped PostHog project. */
export async function posthogListFeatureFlags(
  store: Store,
  input: Base & {
    projectId?: string;
    limit?: number;
    search?: string;
    active?: "STALE" | "false" | "true";
    type?: "boolean" | "experiment" | "multivariant" | "remote_config";
  },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = posthogResource(store, project, environment);
  const projectId = posthogProjectId(r, input.projectId);
  return runGuarded(
    store,
    ctx(project, environment, "posthog", "read", "list_posthog_feature_flags", `list PostHog feature flags for ${projectId}`, {
      resourceLabel: `${r.organizationId}/${projectId}`,
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      const search = input.search === undefined ? undefined : assertNonEmptyString("search", input.search);
      return ph.listFeatureFlags(tokenFor(store, "posthog", r.connectionId), projectId, {
        apiHost: r.apiHost,
        ingestHost: r.ingestHost,
        limit: input.limit,
        search,
        active: assertPostHogActive(input.active),
        type: assertPostHogFlagType(input.type),
      });
    },
  );
}

/** create_posthog_feature_flag — create a feature flag, inactive by default. */
export async function posthogCreateFeatureFlag(
  store: Store,
  input: Base & {
    projectId?: string;
    key: string;
    name?: string;
    active?: boolean;
    filters?: Record<string, unknown>;
    tags?: string[];
    isRemoteConfiguration?: boolean;
  },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = posthogResource(store, project, environment);
  const projectId = posthogProjectId(r, input.projectId);
  const key = assertNonEmptyString("key", input.key);
  return runGuarded(
    store,
    ctx(project, environment, "posthog", "write", "create_posthog_feature_flag", `create PostHog feature flag ${key}`, {
      resourceLabel: `${r.organizationId}/${projectId}/${key}`,
    }),
    () =>
      ph.createFeatureFlag(tokenFor(store, "posthog", r.connectionId), projectId, {
        apiHost: r.apiHost,
        ingestHost: r.ingestHost,
        key,
        name: input.name === undefined ? undefined : assertNonEmptyString("name", input.name),
        active: input.active ?? false,
        filters: assertRecord("filters", input.filters),
        tags: assertNonEmptyStringList("tags", input.tags),
        isRemoteConfiguration: input.isRemoteConfiguration,
      }),
  );
}

// --- Resend -----------------------------------------------------------------

function resendResource(store: Store, project: Project, environment: Environment) {
  const m = requireMapping(store, project, environment, "resend");
  return {
    ...(m.resource as { domain: string; defaultFrom?: string }),
    connectionId: m.connectionId,
  };
}

/** list_resend_domains — email domains visible to the API key. */
export async function resendListDomains(store: Store, input: Base & { limit?: number }): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = resendResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "resend", "read", "list_resend_domains", `list Resend domains for ${r.domain}`, {
      resourceLabel: r.domain,
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      return rs.listDomains(tokenFor(store, "resend", r.connectionId), input.limit ?? 20);
    },
  );
}

/** create_resend_domain — create a sending domain and return DNS records to set. */
export async function resendCreateDomain(store: Store, input: Base & { name: string }): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = resendResource(store, project, environment);
  const name = assertNonEmptyString("name", input.name);
  return runGuarded(
    store,
    ctx(project, environment, "resend", "env_change", "create_resend_domain", `create Resend domain ${name}`, {
      resourceLabel: name,
    }),
    () => rs.createDomain(tokenFor(store, "resend", r.connectionId), name),
  );
}

/** verify_resend_domain — start Resend's asynchronous DNS verification cycle. */
export async function resendVerifyDomain(store: Store, input: Base & { domainId: string }): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = resendResource(store, project, environment);
  const domainId = assertNonEmptyString("domainId", input.domainId);
  return runGuarded(
    store,
    ctx(project, environment, "resend", "env_change", "verify_resend_domain", `verify Resend domain ${r.domain}`, {
      resourceLabel: r.domain,
    }),
    () => rs.verifyDomain(tokenFor(store, "resend", r.connectionId), domainId),
  );
}

/** send_resend_email — outbound email reaches users and is always treated live. */
export async function resendSendEmail(
  store: Store,
  input: Base & {
    from?: string;
    to: string[];
    subject: string;
    html?: string;
    text?: string;
    cc?: string[];
    bcc?: string[];
    replyTo?: string[];
  },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = resendResource(store, project, environment);
  const from = input.from ?? r.defaultFrom;
  return runGuarded(
    store,
    ctx(project, environment, "resend", "write", "send_resend_email", "send outbound email via Resend", {
      live: true,
      resourceLabel: r.domain,
    }),
    () => {
      if (!from) {
        throw new OfflocalError("send_resend_email requires either from or a mapped Resend defaultFrom.");
      }
      const html = input.html === undefined ? undefined : assertNonEmptyString("html", input.html);
      const text = input.text === undefined ? undefined : assertNonEmptyString("text", input.text);
      if (!html && !text) {
        throw new OfflocalError("send_resend_email requires at least one of html or text.");
      }
      const to = assertNonEmptyStringList("to", input.to);
      if (!to) {
        throw new OfflocalError("to must be a non-empty list of strings.");
      }
      return rs.sendEmail(tokenFor(store, "resend", r.connectionId), {
        from: assertNonEmptyString("from", from),
        to,
        subject: assertNonEmptyString("subject", input.subject),
        html,
        text,
        cc: assertNonEmptyStringList("cc", input.cc),
        bcc: assertNonEmptyStringList("bcc", input.bcc),
        replyTo: assertNonEmptyStringList("replyTo", input.replyTo),
      });
    },
  );
}

// --- Twilio -----------------------------------------------------------------

function twilioResource(store: Store, project: Project, environment: Environment) {
  const m = requireMapping(store, project, environment, "twilio");
  return {
    ...(m.resource as { accountSid: string; fromNumber?: string; messagingServiceSid?: string }),
    connectionId: m.connectionId,
  };
}

/** list_twilio_phone_numbers — communication numbers visible to the account. */
export async function twilioListPhoneNumbers(store: Store, input: Base & { limit?: number }): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = twilioResource(store, project, environment);
  return runGuarded(
    store,
    ctx(project, environment, "twilio", "read", "list_twilio_phone_numbers", `list Twilio phone numbers for ${r.accountSid}`, {
      resourceLabel: r.accountSid,
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      return tw.listPhoneNumbers(r.accountSid, tokenFor(store, "twilio", r.connectionId), input.limit ?? 20);
    },
  );
}

/** update_twilio_phone_number_webhooks — wire inbound SMS/voice URLs. */
export async function twilioUpdatePhoneNumberWebhooks(
  store: Store,
  input: Base & { phoneNumberSid: string; smsUrl?: string; voiceUrl?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = twilioResource(store, project, environment);
  const phoneNumberSid = assertNonEmptyString("phoneNumberSid", input.phoneNumberSid);
  const smsUrl = input.smsUrl === undefined ? undefined : assertNonEmptyString("smsUrl", input.smsUrl);
  const voiceUrl = input.voiceUrl === undefined ? undefined : assertNonEmptyString("voiceUrl", input.voiceUrl);
  return runGuarded(
    store,
    ctx(
      project,
      environment,
      "twilio",
      "env_change",
      "update_twilio_phone_number_webhooks",
      `update Twilio phone number webhooks for ${phoneNumberSid}`,
      { resourceLabel: phoneNumberSid },
    ),
    () => {
      if (!smsUrl && !voiceUrl) {
        throw new OfflocalError("At least one of smsUrl or voiceUrl is required.");
      }
      return tw.updatePhoneNumberWebhooks(r.accountSid, tokenFor(store, "twilio", r.connectionId), phoneNumberSid, {
        smsUrl,
        voiceUrl,
      });
    },
  );
}

/** send_twilio_sms — outbound messages cost money and are always treated live. */
export async function twilioSendSms(
  store: Store,
  input: Base & { to: string; body: string; from?: string; messagingServiceSid?: string; statusCallback?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = twilioResource(store, project, environment);
  const messagingServiceSid = input.messagingServiceSid ?? r.messagingServiceSid;
  const from = input.from ?? (messagingServiceSid ? undefined : r.fromNumber);
  return runGuarded(
    store,
    ctx(project, environment, "twilio", "write", "send_twilio_sms", "send outbound SMS via Twilio", {
      live: true,
      resourceLabel: r.accountSid,
    }),
    () => {
      if (!from && !messagingServiceSid) {
        throw new OfflocalError(
          "send_twilio_sms requires either from, messagingServiceSid, or a mapped Twilio fromNumber/messagingServiceSid.",
        );
      }
      return tw.sendSms(r.accountSid, tokenFor(store, "twilio", r.connectionId), {
        to: assertNonEmptyString("to", input.to),
        body: assertNonEmptyString("body", input.body),
        from,
        messagingServiceSid,
        statusCallback: input.statusCallback,
      });
    },
  );
}

/** create_twilio_call — outbound voice calls cost money and are always treated live. */
export async function twilioCreateCall(
  store: Store,
  input: Base & { to: string; url: string; from?: string; statusCallback?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const r = twilioResource(store, project, environment);
  const from = input.from ?? r.fromNumber;
  return runGuarded(
    store,
    ctx(project, environment, "twilio", "write", "create_twilio_call", "create outbound voice call via Twilio", {
      live: true,
      resourceLabel: r.accountSid,
    }),
    () => {
      if (!from) {
        throw new OfflocalError("create_twilio_call requires either from or a mapped Twilio fromNumber.");
      }
      return tw.createCall(r.accountSid, tokenFor(store, "twilio", r.connectionId), {
        to: assertNonEmptyString("to", input.to),
        from,
        url: assertNonEmptyString("url", input.url),
        statusCallback: input.statusCallback,
      });
    },
  );
}

/** get_latest_deployment_logs — convenience; latest deployment for the provider. */
export async function latestDeploymentLogs(
  store: Store,
  input: Base & { provider?: ProviderId },
): Promise<GuardedResponse> {
  const provider = input.provider ?? "vercel";
  const base = { project: input.project, environment: input.environment };
  if (provider === "vercel") {
    return runVercelLogs(store, base, "get_latest_deployment_logs");
  }
  if (provider === "railway") {
    return runRailwayLogs(store, base, "get_latest_deployment_logs");
  }
  // Other providers don't serve deployment logs in V0 — audit the read and
  // return a clear limitation instead of pretending.
  const { project, environment } = resolve(store, input);
  return runGuarded(
    store,
    ctx(project, environment, provider, "read", "get_latest_deployment_logs", `latest logs (${provider})`),
    async (): Promise<LogResult> => ({
      resource: { provider },
      time_range: {},
      logs: [],
      limitation: `Log fetching for ${provider} is not supported in V0 — only Vercel and Railway logs are available.`,
      audit_written: true,
    }),
  );
}

/**
 * get_app_logs — generic entry point. With an explicit `provider`, reads that
 * provider only; otherwise reads every mapped provider that supports logs
 * (Vercel prioritized). Each provider read is independently policy-checked and
 * audited; results are returned per provider.
 */
export async function appLogs(
  store: Store,
  input: Base & { provider?: ProviderId; deploymentId?: string; since?: string; limit?: number },
): Promise<{
  status: "ok";
  project: string;
  environment: string;
  providers: GuardedResponse[];
  limitation?: string;
}> {
  const { project, environment } = resolve(store, input);

  const targets: ProviderId[] = input.provider
    ? [input.provider]
    : LOG_PROVIDERS.filter((p) => !!findMapping(store, environment, p));

  if (targets.length === 0) {
    return {
      status: "ok",
      project: project.slug,
      environment: environment.name,
      providers: [],
      limitation:
        "No mapped providers support log fetching for this environment. Map a Vercel or " +
        "Railway project with map_provider_resource, or pass an explicit `provider`.",
    };
  }

  const logInput = {
    project: input.project,
    environment: input.environment,
    deploymentId: input.deploymentId,
    since: input.since,
    limit: input.limit,
  };

  const providers: GuardedResponse[] = [];
  for (const p of targets) {
    if (p === "vercel") {
      providers.push(await runVercelLogs(store, logInput, "get_app_logs"));
    } else if (p === "railway") {
      providers.push(await runRailwayLogs(store, logInput, "get_app_logs"));
    } else {
      providers.push(
        await runGuarded(
          store,
          ctx(project, environment, p, "read", "get_app_logs", `logs (${p})`),
          async (): Promise<LogResult> => ({
            resource: { provider: p },
            time_range: { since: input.since },
            logs: [],
            limitation: `Log fetching for ${p} is not supported in V0 — only Vercel and Railway logs are available.`,
            audit_written: true,
          }),
        ),
      );
    }
  }

  return { status: "ok", project: project.slug, environment: environment.name, providers };
}

// --- Supabase --------------------------------------------------------------

export async function supabaseListProjects(store: Store, input: Base): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  // Account-level read; uses the env-scoped connection only for the token + audit.
  const mapping = findMapping(store, environment, "supabase");
  return runGuarded(
    store,
    ctx(project, environment, "supabase", "read", "list_supabase_projects", "list supabase projects"),
    () => sb.listProjects(tokenFor(store, "supabase", mapping?.connectionId)),
  );
}

export async function supabaseProjectContext(store: Store, input: Base): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const m = requireMapping(store, project, environment, "supabase");
  const r = m.resource as { projectRef: string };
  return runGuarded(
    store,
    ctx(project, environment, "supabase", "read", "get_supabase_project_context", `project ${r.projectRef}`, {
      resourceLabel: r.projectRef,
    }),
    () => sb.getProject(tokenFor(store, "supabase", m.connectionId), r.projectRef),
  );
}

export async function supabaseQuery(
  store: Store,
  input: Base & { sql: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const m = requireMapping(store, project, environment, "supabase");
  const r = m.resource as { projectRef: string };
  const classified = classifySql(input.sql);
  return runGuarded(
    store,
    ctx(
      project,
      environment,
      "supabase",
      classified.capability,
      "query_supabase",
      `SQL (${classified.keyword}) on ${r.projectRef}`,
      { resourceLabel: r.projectRef },
    ),
    // Reads are sent with read_only:true (real backend enforcement). Writes that
    // are allowed by policy run as read_only:false.
    () => sb.runQuery(tokenFor(store, "supabase", m.connectionId), r.projectRef, assertNonEmptyString("sql", input.sql), classified.readOnly),
  );
}

export async function supabaseLogs(
  store: Store,
  input: Base & { service?: string; since?: string; limit?: number },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const m = requireMapping(store, project, environment, "supabase");
  const r = m.resource as { projectRef: string };
  return runGuarded(
    store,
    ctx(project, environment, "supabase", "read", "get_supabase_logs", `logs ${r.projectRef}`, {
      resourceLabel: r.projectRef,
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      return sb.getProjectLogs(tokenFor(store, "supabase", m.connectionId), r.projectRef, {
        service: input.service,
        since: input.since,
        limit: input.limit ?? 100,
      });
    },
  );
}

export async function supabaseApplyMigration(
  store: Store,
  input: Base & { name: string; sql: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const m = requireMapping(store, project, environment, "supabase");
  const r = m.resource as { projectRef: string };
  return runGuarded(
    store,
    ctx(project, environment, "supabase", "write", "apply_supabase_migration", `migration ${input.name} on ${r.projectRef}`, {
      resourceLabel: r.projectRef,
    }),
    () =>
      sb.applyMigration(tokenFor(store, "supabase", m.connectionId), r.projectRef, {
        name: assertNonEmptyString("name", input.name),
        query: assertNonEmptyString("sql", input.sql),
      }),
  );
}

// --- Stripe ----------------------------------------------------------------

function stripeMode(store: Store, environment: Environment): "test" | "live" {
  const m = findMapping(store, environment, "stripe");
  if (m && m.resource.provider === "stripe") return m.resource.mode;
  // Fall back to env kind if no explicit mapping.
  return environment.isProduction ? "live" : "test";
}

function stripeKeyFor(store: Store, environment: Environment, mode: "test" | "live"): string {
  const m = findMapping(store, environment, "stripe");
  if (m?.connectionId) return tokenFor(store, "stripe", m.connectionId);
  return resolveStripeKey(mode);
}

export async function stripeListProducts(
  store: Store,
  input: Base & { limit?: number },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const mode = stripeMode(store, environment);
  return runGuarded(
    store,
    ctx(project, environment, "stripe", "read", "list_stripe_products", `list products (${mode})`, {
      resourceLabel: mode,
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      return st.listProducts(stripeKeyFor(store, environment, mode), input.limit ?? 10);
    },
  );
}

export async function stripeListCustomers(
  store: Store,
  input: Base & { limit?: number },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const mode = stripeMode(store, environment);
  return runGuarded(
    store,
    ctx(project, environment, "stripe", "read", "list_stripe_customers", `list customers (${mode})`, {
      resourceLabel: mode,
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      return st.listCustomers(stripeKeyFor(store, environment, mode), input.limit ?? 10);
    },
  );
}

export async function stripeListSubscriptions(
  store: Store,
  input: Base & { limit?: number; status?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const mode = stripeMode(store, environment);
  return runGuarded(
    store,
    ctx(project, environment, "stripe", "read", "list_stripe_subscriptions", `list subscriptions (${mode})`, {
      resourceLabel: mode,
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      return st.listSubscriptions(stripeKeyFor(store, environment, mode), {
        limit: input.limit ?? 10,
        status: input.status,
      });
    },
  );
}

export async function stripeListInvoices(
  store: Store,
  input: Base & { limit?: number; customer?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const mode = stripeMode(store, environment);
  return runGuarded(
    store,
    ctx(project, environment, "stripe", "read", "list_stripe_invoices", `list invoices (${mode})`, {
      resourceLabel: mode,
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      return st.listInvoices(stripeKeyFor(store, environment, mode), {
        limit: input.limit ?? 10,
        customer: input.customer,
      });
    },
  );
}

export async function stripeCreateProduct(
  store: Store,
  input: Base & { name: string; description?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const mode = stripeMode(store, environment);
  return runGuarded(
    store,
    ctx(project, environment, "stripe", "write", "create_stripe_product", `create product "${input.name}" (${mode})`, {
      live: mode === "live",
      resourceLabel: mode,
    }),
    () => st.createProduct(stripeKeyFor(store, environment, mode), { name: assertNonEmptyString("name", input.name), description: input.description }),
  );
}

/**
 * create_stripe_webhook — create a webhook endpoint (capability "write").
 * Stripe returns the whsec_ signing secret ONLY at creation; it goes to the
 * tool result and is redacted from audit + DashClaw by the sanitizer.
 */
export async function stripeCreateWebhook(
  store: Store,
  input: Base & { url: string; enabledEvents: string[]; description?: string },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const mode = stripeMode(store, environment);
  const url = assertNonEmptyString("url", input.url);
  return runGuarded(
    store,
    ctx(project, environment, "stripe", "write", "create_stripe_webhook", `create webhook endpoint for ${url} (${mode})`, {
      live: mode === "live",
      resourceLabel: mode,
    }),
    () => {
      if (!Array.isArray(input.enabledEvents) || input.enabledEvents.length === 0) {
        throw new OfflocalError("enabledEvents must be a non-empty list of Stripe event names.");
      }
      return st.createWebhookEndpoint(stripeKeyFor(store, environment, mode), {
        url,
        enabledEvents: input.enabledEvents,
        description: input.description,
      });
    },
  );
}

/** list_stripe_webhooks — webhook endpoints for the environment's mode (read). */
export async function stripeListWebhooks(
  store: Store,
  input: Base & { limit?: number },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const mode = stripeMode(store, environment);
  return runGuarded(
    store,
    ctx(project, environment, "stripe", "read", "list_stripe_webhooks", `list webhook endpoints (${mode})`, {
      resourceLabel: mode,
    }),
    () => {
      assertPositiveInteger("limit", input.limit);
      return st.listWebhookEndpoints(stripeKeyFor(store, environment, mode), input.limit ?? 10);
    },
  );
}

export async function stripeCreatePrice(
  store: Store,
  input: Base & {
    product: string;
    currency: string;
    unitAmount: number;
    recurringInterval?: "day" | "week" | "month" | "year";
  },
): Promise<GuardedResponse> {
  const { project, environment } = resolve(store, input);
  const mode = stripeMode(store, environment);
  return runGuarded(
    store,
    ctx(project, environment, "stripe", "write", "create_stripe_price", `create price for ${input.product} (${mode})`, {
      live: mode === "live",
      resourceLabel: mode,
    }),
    () => {
      assertPositiveInteger("unitAmount", input.unitAmount);
      return st.createPrice(stripeKeyFor(store, environment, mode), {
        product: input.product,
        currency: input.currency,
        unitAmount: input.unitAmount,
        recurringInterval: input.recurringInterval,
      });
    },
  );
}
