import type { Store } from "./storage.js";
import { buildProjectContext, type ProjectContext } from "./context.js";
import { dashclawRecentDecisionsFetch, dashclawStatusReport } from "./dashclaw/evidence.js";
import { buildDashclawGuardPayload, guardWithDashclaw, isRiskyAction, localPolicyPreview } from "./dashclaw/guard.js";
import { evaluatePolicy } from "./policy.js";
import { resolveEnvironment, resolveProject, requireMapping } from "./resolve.js";
import { defaultEnvVar } from "./providers/auth.js";
import type {
  ActionContext,
  AuditLogEntry,
  Capability,
  Environment,
  EnvironmentKind,
  PolicyEffect,
  PendingApproval,
  PolicyRule,
  Project,
  ProviderConnection,
  ProviderId,
  ProviderResource,
  Workspace,
} from "./types.js";
import { PROVIDER_IDS } from "./types.js";
import { newId, nowIso, DashclawError, slugify } from "./util.js";

/**
 * Service layer: all business logic lives here as plain functions over a Store.
 * The MCP server (src/tools) and the CLI (src/cli.ts) are thin wrappers around
 * these — so everything is unit-testable without a transport.
 */

// ---------------------------------------------------------------------------
// Workspace / project / environment
// ---------------------------------------------------------------------------

export function ensureDefaultWorkspace(store: Store): Workspace {
  const existing = store.data.workspaces.find((w) => w.id === store.data.defaultWorkspaceId)
    ?? store.data.workspaces[0];
  if (existing) {
    if (!store.data.defaultWorkspaceId) {
      store.update((s) => {
        s.defaultWorkspaceId = existing.id;
      });
    }
    return existing;
  }
  const ws: Workspace = { id: newId("ws"), name: "default", createdAt: nowIso() };
  store.update((s) => {
    s.workspaces.push(ws);
    s.defaultWorkspaceId = ws.id;
  });
  return ws;
}

export function createProject(
  store: Store,
  input: { name: string; slug?: string; description?: string },
): Project {
  const ws = ensureDefaultWorkspace(store);
  const name = input.name.trim();
  if (!name) throw new DashclawError("Project name must be a non-empty string.");
  const slug = slugify(input.slug ?? name);
  if (!slug) throw new DashclawError("Project name/slug produced an empty slug.");
  if (store.data.projects.some((p) => p.workspaceId === ws.id && p.slug === slug)) {
    throw new DashclawError(`A project with slug "${slug}" already exists.`);
  }
  const project: Project = {
    id: newId("proj"),
    workspaceId: ws.id,
    name,
    slug,
    description: input.description,
    createdAt: nowIso(),
  };
  store.update((s) => {
    s.projects.push(project);
    if (!s.selectedProjectId) s.selectedProjectId = project.id;
  });
  return project;
}

export function listProjects(store: Store): Array<Project & { selected: boolean }> {
  return store.data.projects.map((p) => ({
    ...p,
    selected: p.id === store.data.selectedProjectId,
  }));
}

export function selectProject(store: Store, projectRef: string): Project {
  const project = resolveProject(store, projectRef);
  store.update((s) => {
    s.selectedProjectId = project.id;
  });
  return project;
}

const KIND_BY_NAME: Record<string, EnvironmentKind> = {
  dev: "development",
  development: "development",
  local: "development",
  staging: "staging",
  stage: "staging",
  preview: "staging",
  prod: "production",
  production: "production",
};

export function addEnvironment(
  store: Store,
  input: { project?: string; name: string; kind?: EnvironmentKind },
): Environment {
  const name = input.name.trim();
  if (!name) {
    throw new DashclawError("Environment name must be a non-empty string.");
  }
  if (input.kind !== undefined) assertEnvironmentKind(input.kind);
  const project = resolveProject(store, input.project);
  const kind: EnvironmentKind = input.kind ?? KIND_BY_NAME[name.toLowerCase()] ?? "development";
  if (
    store.data.environments.some(
      (e) => e.projectId === project.id && e.name === name,
    )
  ) {
    throw new DashclawError(
      `Environment "${name}" already exists for project "${project.slug}".`,
    );
  }
  const env: Environment = {
    id: newId("env"),
    projectId: project.id,
    name,
    kind,
    isProduction: kind === "production",
    createdAt: nowIso(),
  };
  store.update((s) => {
    s.environments.push(env);
  });
  return env;
}

export function listEnvironments(store: Store, projectRef?: string): Environment[] {
  const project = resolveProject(store, projectRef);
  return store.data.environments.filter((e) => e.projectId === project.id);
}

export function getProjectContext(
  store: Store,
  projectRef?: string,
  environment?: string,
): Promise<ProjectContext> {
  const project = resolveProject(store, projectRef);
  return buildProjectContext(store, project, environment);
}

// ---------------------------------------------------------------------------
// Provider connections + mappings
// ---------------------------------------------------------------------------

function assertProviderId(provider: unknown): asserts provider is ProviderId {
  if (typeof provider !== "string" || !PROVIDER_IDS.includes(provider as ProviderId)) {
    throw new DashclawError(`Unknown provider "${String(provider)}". Expected one of: ${PROVIDER_IDS.join(", ")}.`);
  }
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DashclawError(`Invalid provider resource: ${label} must be a non-empty string.`);
  }
  return value;
}

function assertPositiveInteger(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DashclawError(`${label} must be a positive integer.`);
  }
}

function validateProviderResource(provider: ProviderId, resource: ProviderResource): void {
  if (!resource || typeof resource !== "object") {
    throw new DashclawError("Invalid provider resource: expected an object.");
  }
  if (resource.provider !== provider) {
    throw new DashclawError(
      `Resource provider "${resource.provider}" does not match "${provider}".`,
    );
  }

  switch (provider) {
    case "github":
      requireNonEmptyString((resource as Partial<{ owner: unknown }>).owner, "github.owner");
      requireNonEmptyString((resource as Partial<{ repo: unknown }>).repo, "github.repo");
      return;
    case "vercel":
      requireNonEmptyString((resource as Partial<{ projectId: unknown }>).projectId, "vercel.projectId");
      return;
    case "supabase":
      requireNonEmptyString((resource as Partial<{ projectRef: unknown }>).projectRef, "supabase.projectRef");
      return;
    case "stripe": {
      const mode = (resource as Partial<{ mode: unknown }>).mode;
      if (mode !== "test" && mode !== "live") {
        throw new DashclawError('Invalid provider resource: stripe.mode must be "test" or "live".');
      }
      return;
    }
    case "railway":
      requireNonEmptyString((resource as Partial<{ projectId: unknown }>).projectId, "railway.projectId");
      return;
    case "upstash":
      requireNonEmptyString((resource as Partial<{ databaseId: unknown }>).databaseId, "upstash.databaseId");
      return;
    case "cloudflare_r2":
      requireNonEmptyString((resource as Partial<{ accountId: unknown }>).accountId, "cloudflare_r2.accountId");
      return;
    case "sentry":
      requireNonEmptyString((resource as Partial<{ organizationSlug: unknown }>).organizationSlug, "sentry.organizationSlug");
      return;
    case "posthog":
      requireNonEmptyString((resource as Partial<{ organizationId: unknown }>).organizationId, "posthog.organizationId");
      return;
    case "resend":
      requireNonEmptyString((resource as Partial<{ domain: unknown }>).domain, "resend.domain");
      return;
    case "twilio":
      requireNonEmptyString((resource as Partial<{ accountSid: unknown }>).accountSid, "twilio.accountSid");
      return;
    case "clerk":
      requireNonEmptyString((resource as Partial<{ publishableKey: unknown }>).publishableKey, "clerk.publishableKey");
      return;
  }
}

function assertPolicyEffect(effect: unknown): asserts effect is PolicyEffect {
  if (effect !== "allow" && effect !== "block" && effect !== "approval_required") {
    throw new DashclawError('Invalid policy effect; expected "allow", "block", or "approval_required".');
  }
}

function assertCapability(capability: unknown): asserts capability is Capability {
  const capabilities: Capability[] = ["read", "write", "deploy", "env_change", "delete", "destructive_sql", "purchase"];
  if (typeof capability !== "string" || !capabilities.includes(capability as Capability)) {
    throw new DashclawError(
      `Invalid policy capability "${String(capability)}". Expected one of: ${capabilities.join(", ")}.`,
    );
  }
}

function assertEnvironmentKind(kind: unknown): asserts kind is EnvironmentKind {
  const kinds: EnvironmentKind[] = ["development", "staging", "production"];
  if (typeof kind !== "string" || !kinds.includes(kind as EnvironmentKind)) {
    throw new DashclawError(
      `Invalid environment kind "${String(kind)}". Expected one of: ${kinds.join(", ")}.`,
    );
  }
}

function validatePolicyRuleInput(input: {
  effect: PolicyEffect;
  priority?: number;
  match: PolicyRule["match"];
}): void {
  assertPolicyEffect(input.effect);
  if (input.priority !== undefined && (!Number.isFinite(input.priority) || input.priority < 0)) {
    throw new DashclawError("Invalid policy priority; expected a non-negative finite number.");
  }
  const match = input.match;
  if (!match || typeof match !== "object") {
    throw new DashclawError("Invalid policy match; expected an object.");
  }
  if (match.provider !== undefined) assertProviderId(match.provider);
  if (match.capability !== undefined) assertCapability(match.capability);
  if (match.environmentKind !== undefined) assertEnvironmentKind(match.environmentKind);
  if (match.projectId !== undefined) requireNonEmptyString(match.projectId, "policy.match.projectId");
  if (match.environmentId !== undefined) requireNonEmptyString(match.environmentId, "policy.match.environmentId");
}

export function ensureConnection(
  store: Store,
  provider: ProviderId,
  opts?: { label?: string; envVar?: string; vercelTeamId?: string },
): string {
  assertProviderId(provider);
  const existing = store.data.connections.find((c) => c.provider === provider);
  if (existing) return existing.id;
  const ws = ensureDefaultWorkspace(store);
  const id = newId("conn");
  store.update((s) => {
    s.connections.push({
      id,
      workspaceId: ws.id,
      provider,
      label: opts?.label ?? `${provider}-default`,
      auth: { kind: "env", envVar: opts?.envVar ?? defaultEnvVar(provider) },
      scope: opts?.vercelTeamId ? { vercelTeamId: opts.vercelTeamId } : undefined,
      createdAt: nowIso(),
    });
  });
  return id;
}

export function createConnection(
  store: Store,
  input: { provider: ProviderId; label: string; envVar: string; vercelTeamId?: string },
): ProviderConnection {
  assertProviderId(input.provider);
  const label = requireNonEmptyString(input.label, "connection.label").trim();
  const envVar = requireNonEmptyString(input.envVar, "connection.envVar").trim();
  if (store.data.connections.some((c) => c.provider === input.provider && c.label === label)) {
    throw new DashclawError(`A ${input.provider} connection named "${label}" already exists.`);
  }
  const ws = ensureDefaultWorkspace(store);
  const connection: ProviderConnection = {
    id: newId("conn"),
    workspaceId: ws.id,
    provider: input.provider,
    label,
    auth: { kind: "env", envVar },
    scope: input.vercelTeamId ? { vercelTeamId: input.vercelTeamId } : undefined,
    createdAt: nowIso(),
  };
  store.update((s) => {
    s.connections.push(connection);
  });
  return connection;
}

export function listConnections(store: Store, input: { provider?: ProviderId } = {}): ProviderConnection[] {
  if (input.provider !== undefined) assertProviderId(input.provider);
  return store.data.connections
    .filter((c) => !input.provider || c.provider === input.provider)
    .slice()
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label));
}

export function mapProviderResource(
  store: Store,
  input: {
    project?: string;
    environment: string;
    provider: ProviderId;
    resource: ProviderResource;
    connectionId?: string;
  },
): { project: Project; environment: Environment; mappingId: string } {
  assertProviderId(input.provider);
  validateProviderResource(input.provider, input.resource);
  const project = resolveProject(store, input.project);
  const environment = resolveEnvironment(store, project, input.environment);
  let connectionId = input.connectionId?.trim();
  if (input.connectionId !== undefined) {
    if (!connectionId) {
      throw new DashclawError("Connection id must be a non-empty string when provided.");
    }
    const connection = store.data.connections.find((c) => c.id === connectionId);
    if (!connection) {
      throw new DashclawError(`Connection "${connectionId}" was not found.`);
    }
    if (connection.provider !== input.provider) {
      throw new DashclawError(
        `Connection "${connectionId}" is for ${connection.provider}, not ${input.provider}.`,
      );
    }
  } else if (input.provider !== "stripe") {
    connectionId = ensureConnection(store, input.provider);
  }
  const id = newId("map");
  store.update((s) => {
    // Replace any existing mapping for this env+provider (one resource per pair).
    s.mappings = s.mappings.filter(
      (m) => !(m.environmentId === environment.id && m.provider === input.provider),
    );
    s.mappings.push({
      id,
      projectId: project.id,
      environmentId: environment.id,
      provider: input.provider,
      connectionId,
      resource: input.resource,
      createdAt: nowIso(),
    });
  });
  return { project, environment, mappingId: id };
}

export function listProviderMappings(store: Store, projectRef?: string) {
  const project = resolveProject(store, projectRef);
  const envName = (id: string) =>
    store.data.environments.find((e) => e.id === id)?.name ?? id;
  return store.data.mappings
    .filter((m) => m.projectId === project.id)
    .map((m) => ({
      id: m.id,
      environment: envName(m.environmentId),
      provider: m.provider,
      connectionId: m.connectionId,
      resource: m.resource,
    }));
}

export function getProviderMapping(
  store: Store,
  input: { project?: string; environment: string; provider: ProviderId },
) {
  const project = resolveProject(store, input.project);
  const environment = resolveEnvironment(store, project, input.environment);
  const mapping = requireMapping(store, project, environment, input.provider);
  return {
    id: mapping.id,
    project: project.slug,
    environment: environment.name,
    provider: mapping.provider,
    connectionId: mapping.connectionId,
    resource: mapping.resource,
  };
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export function checkPolicy(
  store: Store,
  input: {
    project?: string;
    environment: string;
    provider: ProviderId;
    capability: Capability;
    live?: boolean;
  },
) {
  assertProviderId(input.provider);
  assertCapability(input.capability);
  const project = resolveProject(store, input.project);
  const environment = resolveEnvironment(store, project, input.environment);
  const ctx: ActionContext = {
    project,
    environment,
    provider: input.provider,
    capability: input.capability,
    tool: "check_policy",
    summary: `policy check for ${input.provider}.${input.capability}`,
    live: input.live,
  };
  const decision = evaluatePolicy(store.data.policyRules, ctx);
  return {
    project: project.slug,
    environment: environment.name,
    provider: input.provider,
    capability: input.capability,
    effect: decision.effect,
    reason: decision.reason,
    source: decision.source,
  };
}

export function simulateAction(
  store: Store,
  input: {
    project?: string;
    environment: string;
    provider: ProviderId;
    capability: Capability;
    live?: boolean;
    resourceLabel?: string;
  },
) {
  assertProviderId(input.provider);
  assertCapability(input.capability);
  const project = resolveProject(store, input.project);
  const environment = resolveEnvironment(store, project, input.environment);
  const ctx: ActionContext = {
    project,
    environment,
    provider: input.provider,
    capability: input.capability,
    tool: "simulate_action",
    summary: `simulate ${input.provider}.${input.capability}`,
    live: input.live,
    resourceLabel: input.resourceLabel,
  };
  const decision = evaluatePolicy(store.data.policyRules, ctx);
  return {
    project: project.slug,
    environment: environment.name,
    provider: input.provider,
    capability: input.capability,
    live: !!input.live,
    resourceLabel: input.resourceLabel,
    effect: decision.effect,
    reason: decision.reason,
    source: decision.source,
    wouldExecute: decision.effect === "allow",
  };
}

export function listPolicyRules(store: Store): PolicyRule[] {
  return [...store.data.policyRules].sort((a, b) => b.priority - a.priority);
}

export function setPolicyRule(
  store: Store,
  input: {
    effect: PolicyEffect;
    description?: string;
    priority?: number;
    match: PolicyRule["match"];
  },
): PolicyRule {
  validatePolicyRuleInput(input);
  const rule: PolicyRule = {
    id: newId("rule"),
    description: input.description,
    priority: input.priority ?? 100,
    effect: input.effect,
    match: input.match,
    createdAt: nowIso(),
  };
  store.update((s) => {
    s.policyRules.push(rule);
  });
  return rule;
}

function requirePendingApproval(store: Store, approvalId: string): PendingApproval {
  const id = approvalId.trim();
  if (!id) {
    throw new DashclawError("Approval id must be a non-empty string.");
  }
  const approval = store.data.pendingApprovals.find((a) => a.id === id);
  if (!approval) {
    throw new DashclawError(`Approval request "${id}" was not found.`);
  }
  if (approval.status !== "pending") {
    throw new DashclawError(`Approval request "${id}" is already ${approval.status}.`);
  }
  return approval;
}

function approvalAuditContext(store: Store, approval: PendingApproval): {
  projectSlug?: string;
  environment?: string;
  providerResource?: string;
} {
  const project = store.data.projects.find((p) => p.id === approval.projectId);
  const environment = store.data.environments.find((e) => e.id === approval.environmentId);
  return {
    projectSlug: project?.slug,
    environment: environment?.name,
    providerResource: approval.providerResource,
  };
}

function appendApprovalAudit(
  store: Store,
  approval: PendingApproval,
  tool: "approve_action" | "reject_action",
  result: "success" | "not_executed",
  note?: string,
): void {
  const ctx = approvalAuditContext(store, approval);
  store.appendAudit({
    timestamp: nowIso(),
    projectSlug: ctx.projectSlug,
    environment: ctx.environment,
    provider: "core",
    tool,
    actionSummary:
      `${tool === "approve_action" ? "approved" : "rejected"} ${approval.id}: ${approval.actionSummary}`,
    policyDecision: "n/a",
    result,
    errorMessage: note,
    providerResource: ctx.providerResource,
  });
}

export function listPendingApprovals(
  store: Store,
  input: { project?: string; status?: PendingApproval["status"] } = {},
): PendingApproval[] {
  let projectId: string | undefined;
  if (input.project) projectId = resolveProject(store, input.project).id;
  if (
    input.status !== undefined &&
    input.status !== "pending" &&
    input.status !== "approved" &&
    input.status !== "rejected" &&
    input.status !== "used"
  ) {
    throw new DashclawError('Invalid approval status; expected "pending", "approved", "rejected", or "used".');
  }
  return store.data.pendingApprovals
    .filter((a) => !projectId || a.projectId === projectId)
    .filter((a) => !input.status || a.status === input.status)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function approveAction(
  store: Store,
  input: { approvalId: string; note?: string },
): { approval: PendingApproval } {
  const approval = requirePendingApproval(store, input.approvalId);
  const note = input.note?.trim();
  if (input.note !== undefined && !note) {
    throw new DashclawError("Approval note must be non-empty when provided.");
  }
  const now = nowIso();
  let updatedApproval = approval;
  store.update((s) => {
    const current = s.pendingApprovals.find((a) => a.id === approval.id);
    if (!current || current.status !== "pending") {
      throw new DashclawError(`Approval request "${approval.id}" is no longer pending.`);
    }
    current.status = "approved";
    current.decidedAt = now;
    current.decisionNote = note;
    updatedApproval = current;
  });
  appendApprovalAudit(store, updatedApproval, "approve_action", "success", note);
  return { approval: updatedApproval };
}

export function rejectAction(
  store: Store,
  input: { approvalId: string; note?: string },
): { approval: PendingApproval } {
  const approval = requirePendingApproval(store, input.approvalId);
  const note = input.note?.trim();
  if (input.note !== undefined && !note) {
    throw new DashclawError("Rejection note must be non-empty when provided.");
  }
  const now = nowIso();
  let updatedApproval = approval;
  store.update((s) => {
    const current = s.pendingApprovals.find((a) => a.id === approval.id);
    if (!current || current.status !== "pending") {
      throw new DashclawError(`Approval request "${approval.id}" is no longer pending.`);
    }
    current.status = "rejected";
    current.decidedAt = now;
    current.decisionNote = note;
    updatedApproval = current;
  });
  appendApprovalAudit(store, updatedApproval, "reject_action", "not_executed", note);
  return { approval: updatedApproval };
}

// ---------------------------------------------------------------------------
// Memory + audit
// ---------------------------------------------------------------------------

export function writeProjectMemory(
  store: Store,
  input: { project?: string; environment?: string; note: string; tags?: string[] },
) {
  const note = input.note.trim();
  if (!note) throw new DashclawError("Project memory note must be a non-empty string.");
  const tags = input.tags?.map((tag) => tag.trim());
  if (tags?.some((tag) => tag.length === 0)) {
    throw new DashclawError("Project memory tags must be non-empty strings.");
  }
  const project = resolveProject(store, input.project);
  const environmentId = input.environment
    ? resolveEnvironment(store, project, input.environment).id
    : undefined;
  const entry = {
    id: newId("mem"),
    projectId: project.id,
    environmentId,
    note,
    tags,
    createdAt: nowIso(),
  };
  store.addMemory(entry);
  return entry;
}

export function readProjectMemory(
  store: Store,
  input: { project?: string; environment?: string },
) {
  const project = resolveProject(store, input.project);
  const environmentId = input.environment
    ? resolveEnvironment(store, project, input.environment).id
    : undefined;
  return store.listMemory({ projectId: project.id, environmentId });
}

export function listAuditLog(
  store: Store,
  input: { project?: string; environment?: string; provider?: ProviderId; limit?: number } = {},
) {
  assertPositiveInteger(input.limit, "limit");
  if (input.provider !== undefined) assertProviderId(input.provider);
  let projectSlug: string | undefined;
  if (input.project) projectSlug = resolveProject(store, input.project).slug;
  return store.readAudit(input.limit ?? 50, {
    projectSlug,
    environment: input.environment,
    provider: input.provider,
  });
}

type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface DoctorReport {
  status: DoctorStatus;
  summary: { pass: number; warn: number; fail: number; total: number };
  checks: DoctorCheck[];
}

function combineDoctorStatus(checks: DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "pass";
}

function envVarCheckId(provider: ProviderId): string {
  return `env.${provider}`;
}

function envVarSuffix(envVar: string): string {
  return envVar.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "credential";
}

function hasEnvVar(envVar: string): boolean {
  return typeof process.env[envVar] === "string" && process.env[envVar]!.trim().length > 0;
}

function stripeCredentialEnvVar(resource?: ProviderResource): string {
  if (resource?.provider === "stripe" && resource.mode === "live") return "STRIPE_LIVE_SECRET_KEY";
  return "STRIPE_TEST_SECRET_KEY";
}

function credentialEnvVars(
  provider: ProviderId,
  resource?: ProviderResource,
  connection?: ProviderConnection,
): string[] {
  const envVars = [connection?.auth.envVar ?? (provider === "stripe" ? stripeCredentialEnvVar(resource) : defaultEnvVar(provider))];

  if (provider === "upstash") {
    envVars.push("UPSTASH_EMAIL");
    if (resource?.provider === "upstash") envVars.push(resource.qstashTokenEnvVar ?? "QSTASH_TOKEN");
  }

  if (provider === "cloudflare_r2" && resource?.provider === "cloudflare_r2") {
    envVars.push(resource.accessKeyIdEnvVar ?? "R2_ACCESS_KEY_ID", resource.secretAccessKeyEnvVar ?? "R2_SECRET_ACCESS_KEY");
  }

  if (provider === "namecheap") {
    envVars.push("NAMECHEAP_API_USER", "NAMECHEAP_CLIENT_IP");
  }

  return Array.from(new Set(envVars));
}

function globalCredentialEnvVars(provider: ProviderId): string[] {
  const envVars = credentialEnvVars(provider);

  if (provider === "stripe") {
    envVars.push("STRIPE_LIVE_SECRET_KEY");
  }

  if (provider === "upstash") {
    envVars.push("QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY");
  }

  if (provider === "cloudflare_r2") {
    envVars.push("R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY");
  }

  return Array.from(new Set(envVars));
}

function addCredentialChecks(
  checks: DoctorCheck[],
  provider: ProviderId,
  envVars: string[],
  idFor: (envVar: string, index: number) => string,
): void {
  envVars.forEach((envVar, index) => {
    const present = hasEnvVar(envVar);
    checks.push({
      id: idFor(envVar, index),
      status: present ? "pass" : "warn",
      message: present ? `${envVar} is set for ${provider}.` : `${envVar} is not set for ${provider}.`,
    });
  });
}

function connectionForMapping(store: Store, provider: ProviderId, connectionId?: string): ProviderConnection | undefined {
  if (connectionId) return store.data.connections.find((c) => c.id === connectionId && c.provider === provider);
  if (provider === "stripe") return undefined;
  return store.data.connections.find((c) => c.provider === provider);
}

export function doctor(store: Store, input: { project?: string; environment?: string } = {}): DoctorReport {
  const checks: DoctorCheck[] = [];
  checks.push({
    id: "storage.home",
    status: "pass",
    message: `Using local state directory ${store.paths.home}.`,
  });

  let project: Project | undefined;
  try {
    project = resolveProject(store, input.project);
    checks.push({ id: "project", status: "pass", message: `Project ${project.slug} resolved.` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const noProjectSelected = input.project === undefined && message.includes("No project specified");
    checks.push({
      id: "project",
      status: noProjectSelected ? "warn" : "fail",
      message: noProjectSelected ? `${message} Reporting provider credential checks only.` : message,
    });
  }

  let environments: Environment[] = [];
  if (project) {
    if (input.environment) {
      try {
        environments = [resolveEnvironment(store, project, input.environment)];
        checks.push({ id: "environment", status: "pass", message: `Environment ${environments[0]!.name} resolved.` });
      } catch (err) {
        checks.push({ id: "environment", status: "fail", message: err instanceof Error ? err.message : String(err) });
      }
    } else {
      environments = store.data.environments.filter((env) => env.projectId === project!.id);
      checks.push({
        id: "environment",
        status: environments.length > 0 ? "pass" : "warn",
        message: environments.length > 0 ? `${environments.length} environment(s) configured.` : "No environments configured.",
      });
    }
  }

  for (const env of environments) {
    const mappings = store.data.mappings.filter((mapping) => mapping.environmentId === env.id);
    checks.push({
      id: `mappings.${env.name}`,
      status: mappings.length > 0 ? "pass" : "warn",
      message: mappings.length > 0 ? `${mappings.length} provider mapping(s) for ${env.name}.` : `No provider mappings for ${env.name}.`,
    });
    for (const provider of PROVIDER_IDS) {
      const mapping = mappings.find((m) => m.provider === provider);
      if (!mapping) {
        checks.push({ id: `mapping.${provider}`, status: "warn", message: `No ${provider} mapping for ${env.name}.` });
        continue;
      }
      checks.push({
        id: `mapping.${provider}`,
        status: "pass",
        message: `${provider} mapping configured for ${env.name}.`,
        details: { connectionId: mapping.connectionId, resource: mapping.resource },
      });
      const connection = connectionForMapping(store, provider, mapping.connectionId);
      addCredentialChecks(checks, provider, credentialEnvVars(provider, mapping.resource, connection), (envVar, index) =>
        index === 0 ? envVarCheckId(provider) : `${envVarCheckId(provider)}.${envVarSuffix(envVar)}`,
      );
    }
  }

  if (environments.length === 0) {
    checks.push({
      id: "credentials.global",
      status: "pass",
      message: "Checking provider credential environment variables without project mappings.",
    });
    for (const provider of PROVIDER_IDS) {
      addCredentialChecks(checks, provider, globalCredentialEnvVars(provider), (envVar, index) =>
        index === 0 ? envVarCheckId(provider) : `${envVarCheckId(provider)}.${envVarSuffix(envVar)}`,
      );
    }
  }

  for (const connection of listConnections(store)) {
    checks.push({
      id: `connection.${connection.id}`,
      status: "pass",
      message: `${connection.provider} connection "${connection.label}" uses ${connection.auth.envVar}.`,
      details: { provider: connection.provider, label: connection.label, envVar: connection.auth.envVar },
    });
    addCredentialChecks(checks, connection.provider, credentialEnvVars(connection.provider, undefined, connection), (envVar, index) =>
      index === 0 ? `env.connection.${connection.id}` : `env.connection.${connection.id}.${envVarSuffix(envVar)}`,
    );
  }

  try {
    store.appendAudit({
      timestamp: nowIso(),
      provider: "core",
      tool: "doctor",
      actionSummary: "doctor audit writability check",
      policyDecision: "n/a",
      result: "success",
    });
    checks.push({ id: "audit.writable", status: "pass", message: "Audit log is writable." });
  } catch (err) {
    checks.push({ id: "audit.writable", status: "fail", message: err instanceof Error ? err.message : String(err) });
  }

  const summary = {
    pass: checks.filter((check) => check.status === "pass").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length,
    total: checks.length,
  };
  return { status: combineDoctorStatus(checks), summary, checks };
}

export function dashclawStatus() {
  return dashclawStatusReport();
}

export function exportDashclawEvidence(
  store: Store,
  input: { project?: string; environment?: string; provider?: ProviderId; limit?: number } = {},
) {
  const entries = listAuditLog(store, input).filter(
    (entry) => entry.dashclawDecisionId || entry.dashclawActionId || entry.dashclawError,
  );
  return {
    schema: "dashclaw.evidence.v1",
    exportedAt: nowIso(),
    entries,
  };
}

export async function dashclawRecentDecisions(
  store: Store,
  input: { project?: string; environment?: string; limit?: number } = {},
) {
  assertPositiveInteger(input.limit, "limit");
  const project = input.project ? resolveProject(store, input.project).slug : undefined;
  return dashclawRecentDecisionsFetch({
    project,
    environment: input.environment,
    limit: input.limit ?? 20,
  });
}

export async function explainActionRisk(
  store: Store,
  input: {
    project?: string;
    environment: string;
    provider: ProviderId;
    capability: Capability;
    tool: string;
    summary: string;
    resourceLabel?: string;
    live?: boolean;
  },
) {
  assertProviderId(input.provider);
  assertCapability(input.capability);
  const project = resolveProject(store, input.project);
  const environment = resolveEnvironment(store, project, input.environment);
  const ctx: ActionContext = {
    project,
    environment,
    provider: input.provider,
    capability: input.capability,
    tool: input.tool,
    summary: input.summary,
    resourceLabel: input.resourceLabel,
    live: input.live,
  };
  const localPolicy = localPolicyPreview(store, ctx);
  const dashclawPayload = buildDashclawGuardPayload(ctx, localPolicy, newId("audit"));
  let dashclaw: unknown;
  try {
    dashclaw = await guardWithDashclaw(store, ctx);
  } catch (err) {
    dashclaw = { error: err instanceof Error ? err.message : String(err) };
  }
  return { risky: isRiskyAction(ctx), localPolicy, dashclawPayload, dashclaw };
}

export function governedActionSummary(
  store: Store,
  input: { project?: string; environment?: string; provider?: ProviderId; limit?: number } = {},
) {
  const entries = listAuditLog(store, input);
  return {
    project: input.project,
    environment: input.environment,
    provider: input.provider,
    entries: entries.map((entry) => ({
      timestamp: entry.timestamp,
      tool: entry.tool,
      result: entry.result,
      policyDecision: entry.policyDecision,
      dashclawDecisionId: entry.dashclawDecisionId,
      dashclawActionId: entry.dashclawActionId,
      dashclawOutcomeRecorded: entry.dashclawOutcomeRecorded,
      dashclawError: entry.dashclawError,
    })),
  };
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function auditExportRows(entries: AuditLogEntry[]): string[][] {
  return entries.map((entry) => [
    entry.timestamp,
    entry.projectSlug ?? "",
    entry.environment ?? "",
    entry.provider ?? "",
    entry.tool,
    entry.policyDecision,
    entry.result,
    entry.providerResource ?? "",
    entry.errorMessage ?? "",
    entry.dashclawDecisionId ?? "",
    entry.dashclawActionId ?? "",
    entry.dashclawOutcomeRecorded === undefined ? "" : String(entry.dashclawOutcomeRecorded),
    entry.dashclawError ?? "",
    entry.auditCorrelationId ?? "",
  ]);
}

export function exportAuditLog(
  store: Store,
  input: {
    project?: string;
    environment?: string;
    provider?: ProviderId;
    limit?: number;
    format: "jsonl" | "csv" | "markdown";
  },
): string {
  const entries = listAuditLog(store, input);
  if (input.format === "jsonl") {
    return entries.map((entry) => JSON.stringify(entry)).join("\n");
  }
  const headers = [
    "timestamp",
    "project",
    "environment",
    "provider",
    "tool",
    "policyDecision",
    "result",
    "providerResource",
    "errorMessage",
    "dashclawDecisionId",
    "dashclawActionId",
    "dashclawOutcomeRecorded",
    "dashclawError",
    "auditCorrelationId",
  ];
  const rows = auditExportRows(entries);
  if (input.format === "csv") {
    return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  }
  if (input.format === "markdown") {
    const titleHeaders = [
      "Timestamp",
      "Project",
      "Environment",
      "Provider",
      "Tool",
      "Policy",
      "Result",
      "Resource",
      "Error",
      "DashClaw Decision",
      "DashClaw Action",
      "DashClaw Outcome",
      "DashClaw Error",
      "Correlation",
    ];
    return [
      `| ${titleHeaders.join(" | ")} |`,
      `| ${titleHeaders.map(() => "---").join(" | ")} |`,
      ...rows.map((row) => `| ${row.map((cell) => String(cell).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r\n|\r|\n/g, " ")).join(" | ")} |`),
    ].join("\n");
  }
  throw new DashclawError('Audit export format must be "jsonl", "csv", or "markdown".');
}

export async function exportContextSnapshot(
  store: Store,
  input: { project?: string; environment?: string; format: "json" | "markdown" },
): Promise<string> {
  if (input.format !== "json" && input.format !== "markdown") {
    throw new DashclawError('Context snapshot format must be "json" or "markdown".');
  }
  const context = await getProjectContext(store, input.project, input.environment);
  const snapshot = {
    schema: "dashclaw.context.snapshot.v1",
    exportedAt: nowIso(),
    context,
  };
  if (input.format === "json") {
    return JSON.stringify(snapshot, null, 2);
  }
  return [
    `# dashclaw context snapshot: ${context.project.slug}`,
    "",
    `Exported: ${snapshot.exportedAt}`,
    context.focusedEnvironment ? `Environment: ${context.focusedEnvironment}` : undefined,
    "",
    "## Summary",
    "",
    context.summary,
    "",
    "## Policy defaults",
    "",
    ...context.policyDefaults.map((item) => `- ${item}`),
    "",
    "## Notes",
    "",
    context.notes,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

