import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Store } from "../storage.js";
import * as svc from "../service.js";
import * as pa from "../provider-actions.js";
import { PROVIDER_IDS } from "../types.js";

/**
 * Registers every DashClaw tool on the MCP server. Handlers are thin: they
 * validate args (via Zod), call the service / provider-action layer, and return
 * the result as a JSON text block. Failures are returned with isError:true and
 * an actionable message (never a raw throw across the wire).
 */

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ status: "error", error: message }, null, 2) }],
    isError: true,
  };
}

/** Wrap a handler so thrown errors become clean isError responses. */
function guard<A>(fn: (args: A) => unknown | Promise<unknown>) {
  return async (args: A): Promise<ToolResult> => {
    try {
      const result = await fn(args);
      // Provider actions already return a {status} envelope; pass through.
      return ok(result);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };
}

const provider = z.enum([
  "github",
  "vercel",
  "supabase",
  "stripe",
  "railway",
  "namecheap",
  "neon",
  "upstash",
  "cloudflare_r2",
  "sentry",
  "posthog",
  "resend",
  "twilio",
  "clerk",
]);
const capability = z.enum(["read", "write", "deploy", "env_change", "delete", "destructive_sql", "purchase"]);
const httpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const nonEmptyString = (description?: string) => {
  const schema = z.string().trim().min(1);
  return description ? schema.describe(description) : schema;
};
const optionalNonEmptyString = (description?: string) => nonEmptyString(description).optional();
const r2BucketName = (description?: string) => {
  const schema = z
    .string()
    .trim()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/)
    .refine((value) => !value.includes(".."));
  return description ? schema.describe(description) : schema;
};
const positiveInt = (description?: string) => {
  const schema = z.number().int().positive();
  return description ? schema.describe(description) : schema;
};
const nonNegativeInt = (description?: string) => {
  const schema = z.number().int().nonnegative();
  return description ? schema.describe(description) : schema;
};
const envVarName = (description?: string) => {
  const schema = z
    .string()
    .trim()
    .min(1)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
  return description ? schema.describe(description) : schema;
};

export function registerTools(server: McpServer, store: Store): void {
  // --- Project / workspace -------------------------------------------------

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "List all known projects and which one is currently selected.",
      inputSchema: {},
    },
    guard(() => ({ status: "ok", projects: svc.listProjects(store) })),
  );

  server.registerTool(
    "create_project",
    {
      title: "Create project",
      description: "Create a new project in the default workspace.",
      inputSchema: {
        name: nonEmptyString("Display name, e.g. 'Your Project'"),
        slug: optionalNonEmptyString("Optional id-safe slug; derived from name if omitted"),
        description: z.string().optional(),
      },
    },
    guard((a: { name: string; slug?: string; description?: string }) => ({
      status: "ok",
      project: svc.createProject(store, a),
    })),
  );

  server.registerTool(
    "select_project",
    {
      title: "Select project",
      description: "Set the active project used by tools that omit an explicit project arg.",
      inputSchema: { project: nonEmptyString("Project id or slug") },
    },
    guard((a: { project: string }) => ({ status: "ok", project: svc.selectProject(store, a.project) })),
  );

  server.registerTool(
    "get_project_context",
    {
      title: "Get project context",
      description:
        "THE tool to call FIRST. Returns the full production context for a project/environment: " +
        "GitHub repo, Vercel project + live latest deployment status/URL/failure, Supabase project, " +
        "Stripe mode, what is allowed / blocked / approval-required, project memory, recent audit " +
        "history, suggested safe next actions, and a human-readable summary. Pass `environment` to " +
        "focus on one (recommended); otherwise all environments are returned.",
      inputSchema: {
        project: optionalNonEmptyString("Project id or slug; uses selected if omitted"),
        environment: optionalNonEmptyString("Environment id or name to focus on (e.g. 'staging')"),
      },
    },
    guard(async (a: { project?: string; environment?: string }) => ({
      status: "ok",
      context: await svc.getProjectContext(store, a.project, a.environment),
    })),
  );

  server.registerTool(
    "export_context",
    {
      title: "Export context snapshot",
      description: "Export a versioned project context snapshot as JSON or Markdown.",
      inputSchema: {
        project: optionalNonEmptyString("Project id or slug; uses selected if omitted"),
        environment: optionalNonEmptyString("Environment id or name to focus on"),
        format: z.enum(["json", "markdown"]),
      },
    },
    guard(async (a: { project?: string; environment?: string; format: "json" | "markdown" }) => ({
      status: "ok",
      format: a.format,
      text: await svc.exportContextSnapshot(store, a),
    })),
  );

  server.registerTool(
    "add_environment",
    {
      title: "Add environment",
      description: "Add an environment (e.g. staging, production) to a project.",
      inputSchema: {
        project: optionalNonEmptyString(),
        name: nonEmptyString("e.g. 'staging' or 'production'"),
        kind: z.enum(["development", "staging", "production"]).optional().describe("Inferred from name if omitted"),
      },
    },
    guard((a: { project?: string; name: string; kind?: "development" | "staging" | "production" }) => ({
      status: "ok",
      environment: svc.addEnvironment(store, a),
    })),
  );

  server.registerTool(
    "list_environments",
    {
      title: "List environments",
      description: "List environments for a project.",
      inputSchema: { project: optionalNonEmptyString() },
    },
    guard((a: { project?: string }) => ({ status: "ok", environments: svc.listEnvironments(store, a.project) })),
  );

  // --- Provider mappings ---------------------------------------------------

  server.registerTool(
    "map_provider_resource",
    {
      title: "Map provider resource",
      description:
        "Bind a provider resource to a project environment. Examples of `resource`: " +
        "{provider:'github',owner:'your-org',repo:'your-repo'}, {provider:'vercel',projectId:'your-vercel-project'}, " +
        "{provider:'supabase',projectRef:'your_project_ref'}, {provider:'stripe',mode:'live'}.",
      inputSchema: {
        project: optionalNonEmptyString(),
        environment: nonEmptyString("Environment id or name"),
        provider,
        connectionId: optionalNonEmptyString("Optional provider connection id to use for this mapping"),
        resource: z
          .record(z.any())
          .describe("Resource object including a 'provider' field matching `provider`"),
      },
    },
    guard((a: { project?: string; environment: string; provider: (typeof PROVIDER_IDS)[number]; connectionId?: string; resource: any }) => {
      const res = svc.mapProviderResource(store, {
        project: a.project,
        environment: a.environment,
        provider: a.provider,
        connectionId: a.connectionId,
        resource: { provider: a.provider, ...a.resource },
      });
      return { status: "ok", project: res.project.slug, environment: res.environment.name, mappingId: res.mappingId };
    }),
  );

  server.registerTool(
    "list_provider_mappings",
    {
      title: "List provider mappings",
      description: "List all environment→provider-resource mappings for a project.",
      inputSchema: { project: optionalNonEmptyString() },
    },
    guard((a: { project?: string }) => ({ status: "ok", mappings: svc.listProviderMappings(store, a.project) })),
  );

  server.registerTool(
    "get_provider_mapping",
    {
      title: "Get provider mapping",
      description: "Get the concrete provider resource mapped to a given environment.",
      inputSchema: { project: optionalNonEmptyString(), environment: nonEmptyString(), provider },
    },
    guard((a: { project?: string; environment: string; provider: (typeof PROVIDER_IDS)[number] }) => ({
      status: "ok",
      mapping: svc.getProviderMapping(store, a),
    })),
  );

  server.registerTool(
    "list_connections",
    {
      title: "List provider connections",
      description: "List configured provider connections. Secrets are never returned; only env var names are shown.",
      inputSchema: { provider: provider.optional() },
    },
    guard((a: { provider?: (typeof PROVIDER_IDS)[number] }) => ({ status: "ok", connections: svc.listConnections(store, a) })),
  );

  server.registerTool(
    "create_connection",
    {
      title: "Create provider connection",
      description:
        "Create an explicit provider connection backed by an environment variable. The secret value is never stored.",
      inputSchema: {
        provider,
        label: nonEmptyString("Friendly connection label"),
        envVar: nonEmptyString("Environment variable name holding the provider secret"),
        vercelTeamId: optionalNonEmptyString("Optional Vercel team id for this connection"),
      },
    },
    guard((a: { provider: (typeof PROVIDER_IDS)[number]; label: string; envVar: string; vercelTeamId?: string }) => ({
      status: "ok",
      connection: svc.createConnection(store, a),
    })),
  );

  server.registerTool(
    "set_app_env_vars",
    {
      title: "Set app env vars",
      description:
        "Set multiple environment variables on the mapped Vercel or Railway app under one governed env_change action. " +
        "Values are sent to the target provider but are not included in DashClaw/audit summaries. Production changes require approval by default.",
      inputSchema: {
        project: optionalNonEmptyString(),
        environment: nonEmptyString("Environment id or name"),
        targetProvider: z.enum(["vercel", "railway"]),
        vars: z.array(z.object({ key: envVarName("Environment variable name"), value: z.string() })).min(1).max(50),
        target: z.array(z.enum(["production", "preview", "development"])).min(1).optional(),
        serviceId: optionalNonEmptyString("Optional Railway service id override"),
        skipDeploys: z.boolean().optional(),
      },
    },
    guard((a: any) => pa.setAppEnvVars(store, a)),
  );

  // --- Policy --------------------------------------------------------------

  server.registerTool(
    "check_policy",
    {
      title: "Check policy",
      description:
        "Ask whether a capability (read/write/deploy/env_change/delete/destructive_sql/purchase) is " +
        "allowed, blocked, or requires approval for a provider in an environment — WITHOUT " +
        "executing anything.",
      inputSchema: {
        project: optionalNonEmptyString(),
        environment: nonEmptyString(),
        provider,
        capability,
        live: z.boolean().optional().describe("Treat as a live/irreversible action (e.g. Stripe live)"),
      },
    },
    guard((a: any) => ({ status: "ok", decision: svc.checkPolicy(store, a) })),
  );

  server.registerTool(
    "simulate_action",
    {
      title: "Simulate action",
      description:
        "Simulate a provider capability in an environment without executing a provider call or writing audit entries.",
      inputSchema: {
        project: optionalNonEmptyString(),
        environment: nonEmptyString(),
        provider,
        capability,
        live: z.boolean().optional(),
        resourceLabel: optionalNonEmptyString(),
      },
    },
    guard((a: any) => ({ status: "ok", decision: svc.simulateAction(store, a) })),
  );

  server.registerTool(
    "list_policy_rules",
    {
      title: "List policy rules",
      description: "List explicit policy rules (highest priority first). Built-in defaults also apply.",
      inputSchema: {},
    },
    guard(() => ({ status: "ok", rules: svc.listPolicyRules(store) })),
  );

  server.registerTool(
    "set_policy_rule",
    {
      title: "Set policy rule",
      description:
        "Add an explicit policy rule that overrides defaults. Higher priority wins. Use this to " +
        "approve something normally gated (effect:'allow') or to tighten further (effect:'block').",
      inputSchema: {
        effect: z.enum(["allow", "block", "approval_required"]),
        description: z.string().optional(),
        priority: nonNegativeInt("Default 100; higher wins").optional(),
        match: z
          .object({
            projectId: optionalNonEmptyString(),
            environmentId: optionalNonEmptyString(),
            environmentKind: z.enum(["development", "staging", "production"]).optional(),
            provider: provider.optional(),
            capability: capability.optional(),
          })
          .describe("Unset fields are wildcards"),
      },
    },
    guard((a: any) => ({ status: "ok", rule: svc.setPolicyRule(store, a) })),
  );

  server.registerTool(
    "list_pending_approvals",
    {
      title: "List pending approvals",
      description: "List approval requests created by gated provider actions.",
      inputSchema: {
        project: optionalNonEmptyString(),
        status: z.enum(["pending", "approved", "rejected", "used"]).optional(),
      },
    },
    guard((a: { project?: string; status?: "pending" | "approved" | "rejected" | "used" }) => ({
      status: "ok",
      approvals: svc.listPendingApprovals(store, a),
    })),
  );

  server.registerTool(
    "doctor",
    {
      title: "Doctor",
      description:
        "Run local readiness checks: project/environment resolution, mappings, credential env vars, and audit writability.",
      inputSchema: {
        project: optionalNonEmptyString("Project id or slug; uses selected if omitted"),
        environment: optionalNonEmptyString("Environment id or name to focus on"),
      },
    },
    guard((a: { project?: string; environment?: string }) => ({ status: "ok", report: svc.doctor(store, a) })),
  );

  server.registerTool(
    "approve_action",
    {
      title: "Approve action",
      description:
        "Approve a pending action request for one matching rerun. This never executes " +
        "the provider call by itself; rerun the original action after approval.",
      inputSchema: {
        approvalId: nonEmptyString("Approval id returned by an approval_required response"),
        note: optionalNonEmptyString("Optional human review note"),
      },
    },
    guard((a: { approvalId: string; note?: string }) => ({ status: "ok", ...svc.approveAction(store, a) })),
  );

  server.registerTool(
    "reject_action",
    {
      title: "Reject action",
      description: "Reject a pending action request so it cannot be approved later.",
      inputSchema: {
        approvalId: nonEmptyString("Approval id returned by an approval_required response"),
        note: optionalNonEmptyString("Optional rejection note"),
      },
    },
    guard((a: { approvalId: string; note?: string }) => ({ status: "ok", ...svc.rejectAction(store, a) })),
  );

  // --- Memory / audit ------------------------------------------------------

  server.registerTool(
    "read_project_memory",
    {
      title: "Read project memory",
      description: "Read short notes saved for a project (optionally scoped to one environment).",
      inputSchema: { project: optionalNonEmptyString(), environment: optionalNonEmptyString() },
    },
    guard((a: { project?: string; environment?: string }) => ({
      status: "ok",
      memory: svc.readProjectMemory(store, a),
    })),
  );

  server.registerTool(
    "write_project_memory",
    {
      title: "Write project memory",
      description:
        "Save a short note for a project/environment so future agent sessions know what happened " +
        "(e.g. 'Last Vercel deploy failed because DATABASE_URL was missing').",
      inputSchema: {
        project: optionalNonEmptyString(),
        environment: optionalNonEmptyString(),
        note: nonEmptyString(),
        tags: z.array(nonEmptyString()).optional(),
      },
    },
    guard((a: { project?: string; environment?: string; note: string; tags?: string[] }) => ({
      status: "ok",
      entry: svc.writeProjectMemory(store, a),
    })),
  );

  server.registerTool(
    "list_audit_log",
    {
      title: "List audit log",
      description: "List recent audit entries (every provider action is logged here). Filter by project, environment, provider.",
      inputSchema: {
        project: optionalNonEmptyString(),
        environment: optionalNonEmptyString(),
        provider: provider.optional(),
        limit: positiveInt().optional(),
      },
    },
    guard((a: { project?: string; environment?: string; provider?: (typeof PROVIDER_IDS)[number]; limit?: number }) => ({
      status: "ok",
      entries: svc.listAuditLog(store, a),
    })),
  );

  server.registerTool(
    "export_audit_log",
    {
      title: "Export audit log",
      description: "Export recent audit entries as jsonl, csv, or markdown.",
      inputSchema: {
        project: optionalNonEmptyString(),
        environment: optionalNonEmptyString(),
        provider: provider.optional(),
        limit: positiveInt().optional(),
        format: z.enum(["jsonl", "csv", "markdown"]),
      },
    },
    guard(
      (a: {
        project?: string;
        environment?: string;
        provider?: (typeof PROVIDER_IDS)[number];
        limit?: number;
        format: "jsonl" | "csv" | "markdown";
      }) => ({
        status: "ok",
        format: a.format,
        text: svc.exportAuditLog(store, a),
      }),
    ),
  );

  server.registerTool(
    "dashclaw_status",
    {
      title: "DashClaw status",
      description: "Check DashClaw authoritative gate configuration and reachability.",
      inputSchema: {},
    },
    guard(async () => ({ status: "ok", dashclaw: await svc.dashclawStatus() })),
  );

  server.registerTool(
    "dashclaw_recent_decisions",
    {
      title: "DashClaw recent decisions",
      description: "Read recent DashClaw guard decisions scoped to project/environment when supported by DashClaw.",
      inputSchema: {
        project: optionalNonEmptyString(),
        environment: optionalNonEmptyString(),
        limit: positiveInt().optional(),
      },
    },
    guard((a: { project?: string; environment?: string; limit?: number }) => svc.dashclawRecentDecisions(store, a)),
  );

  server.registerTool(
    "export_dashclaw_evidence",
    {
      title: "Export DashClaw evidence",
      description: "Export local audit entries that include DashClaw guard/evidence metadata.",
      inputSchema: {
        project: optionalNonEmptyString(),
        environment: optionalNonEmptyString(),
        provider: provider.optional(),
        limit: positiveInt().optional(),
      },
    },
    guard((a: { project?: string; environment?: string; provider?: (typeof PROVIDER_IDS)[number]; limit?: number }) => ({
      status: "ok",
      evidence: svc.exportDashclawEvidence(store, a),
    })),
  );

  server.registerTool(
    "explain_action_risk",
    {
      title: "Explain action risk",
      description: "Dry-run local policy and DashClaw guard context for a provider action without executing it.",
      inputSchema: {
        project: optionalNonEmptyString(),
        environment: nonEmptyString(),
        provider,
        capability,
        tool: nonEmptyString(),
        summary: nonEmptyString(),
        resourceLabel: optionalNonEmptyString(),
        live: z.boolean().optional(),
      },
    },
    guard((a: any) => svc.explainActionRisk(store, a)),
  );

  server.registerTool(
    "governed_action_summary",
    {
      title: "Governed action summary",
      description: "Summarize recent local audit entries with DashClaw correlation fields.",
      inputSchema: {
        project: optionalNonEmptyString(),
        environment: optionalNonEmptyString(),
        provider: provider.optional(),
        limit: positiveInt().optional(),
      },
    },
    guard((a: { project?: string; environment?: string; provider?: (typeof PROVIDER_IDS)[number]; limit?: number }) => ({
      status: "ok",
      summary: svc.governedActionSummary(store, a),
    })),
  );

  registerProviderTools(server, store);
}

function registerProviderTools(server: McpServer, store: Store): void {
  const env = nonEmptyString("Environment id or name");
  const proj = optionalNonEmptyString("Project id or slug; uses selected if omitted");

  // --- App logs ----------------------------------------------------------
  // Log reads are allowed by default in every environment (including
  // production); each read is policy-checked and written to the audit log.

  server.registerTool(
    "get_app_logs",
    {
      title: "Get app logs",
      description:
        "Fetch application/deployment logs for a project environment from the mapped provider(s). " +
        "If `provider` is given, reads that provider only; otherwise reads every mapped provider " +
        "that supports logs (Vercel + Railway in V0, Vercel prioritized). Returns the resource used, time range, log " +
        "lines, and any API limitation. Reads are allowed everywhere and are audited.",
      inputSchema: {
        project: proj,
        environment: env,
        provider: provider.optional().describe("Restrict to one provider (e.g. 'vercel')"),
        deployment_id: optionalNonEmptyString("Specific deployment to read logs for"),
        since: optionalNonEmptyString("Only logs after this time (epoch ms or ISO timestamp)"),
        limit: positiveInt("Max log lines (default 100)").optional(),
      },
    },
    guard((a: any) =>
      pa.appLogs(store, {
        project: a.project,
        environment: a.environment,
        provider: a.provider,
        deploymentId: a.deployment_id,
        since: a.since,
        limit: a.limit,
      }),
    ),
  );

  server.registerTool(
    "get_vercel_logs",
    {
      title: "Get Vercel logs",
      description:
        "Fetch logs from the mapped Vercel project. If `deployment_id` is given, reads that " +
        "deployment; otherwise resolves the latest deployment first. Returns the deployment " +
        "id/url/status plus log lines. Read-only and audited.",
      inputSchema: {
        project: proj,
        environment: env,
        deployment_id: optionalNonEmptyString("Deployment to read logs for; defaults to latest"),
        since: optionalNonEmptyString("Only logs after this time (epoch ms or ISO timestamp)"),
        limit: positiveInt("Max log lines (default 100)").optional(),
      },
    },
    guard((a: any) =>
      pa.vercelLogs(store, {
        project: a.project,
        environment: a.environment,
        deploymentId: a.deployment_id,
        since: a.since,
        limit: a.limit,
      }),
    ),
  );

  server.registerTool(
    "get_latest_deployment_logs",
    {
      title: "Get latest deployment logs",
      description:
        "Convenience: find the latest deployment for the mapped provider (default Vercel) and " +
        "fetch its logs. Returns deployment status + logs. Read-only and audited.",
      inputSchema: {
        project: proj,
        environment: env,
        provider: provider.optional().describe("Defaults to 'vercel'"),
      },
    },
    guard((a: any) =>
      pa.latestDeploymentLogs(store, {
        project: a.project,
        environment: a.environment,
        provider: a.provider,
      }),
    ),
  );

  // GitHub
  server.registerTool(
    "get_github_repo_context",
    {
      title: "GitHub repo context",
      description: "Read metadata (default branch, language, visibility, last push) for the mapped repo.",
      inputSchema: { project: proj, environment: env },
    },
    guard((a: any) => pa.githubRepoContext(store, a)),
  );
  server.registerTool(
    "get_github_repo_readme",
    {
      title: "GitHub README",
      description: "Fetch the README of the mapped repo.",
      inputSchema: { project: proj, environment: env },
    },
    guard((a: any) => pa.githubReadme(store, a)),
  );
  server.registerTool(
    "list_github_repo_files",
    {
      title: "List GitHub repo files",
      description: "List files/directories at a path in the mapped repo (default: root).",
      inputSchema: { project: proj, environment: env, path: z.string().optional() },
    },
    guard((a: any) => pa.githubListFiles(store, a)),
  );
  server.registerTool(
    "list_github_pull_requests",
    {
      title: "List GitHub pull requests",
      description: "List pull requests for the mapped repo.",
      inputSchema: {
        project: proj,
        environment: env,
        state: z.enum(["open", "closed", "all"]).optional(),
        limit: positiveInt().optional(),
      },
    },
    guard((a: any) => pa.githubPullRequests(store, a)),
  );
  server.registerTool(
    "list_github_branches",
    {
      title: "List GitHub branches",
      description: "List branches for the mapped repo.",
      inputSchema: { project: proj, environment: env, limit: positiveInt().optional() },
    },
    guard((a: any) => pa.githubBranches(store, a)),
  );
  server.registerTool(
    "get_github_status_checks",
    {
      title: "Get GitHub status checks",
      description: "Read the combined commit status for a branch, tag, or SHA in the mapped repo.",
      inputSchema: { project: proj, environment: env, ref: nonEmptyString("Branch, tag, or commit SHA") },
    },
    guard((a: any) => pa.githubStatusChecks(store, a)),
  );
  server.registerTool(
    "list_github_workflow_runs",
    {
      title: "List GitHub Actions workflow runs",
      description: "List GitHub Actions workflow runs for the mapped repo with optional branch, event, and status filters.",
      inputSchema: {
        project: proj,
        environment: env,
        branch: optionalNonEmptyString("Optional branch filter"),
        event: optionalNonEmptyString("Optional event filter such as push or pull_request"),
        status: optionalNonEmptyString("Optional Actions status or conclusion filter"),
        limit: positiveInt().optional(),
      },
    },
    guard((a: any) => pa.githubWorkflowRuns(store, a)),
  );
  server.registerTool(
    "list_github_workflow_jobs",
    {
      title: "List GitHub Actions workflow jobs",
      description: "List jobs and step metadata for a GitHub Actions workflow run without downloading raw log bodies.",
      inputSchema: {
        project: proj,
        environment: env,
        runId: positiveInt("GitHub Actions workflow run id"),
        filter: z.enum(["latest", "all"]).optional(),
        limit: positiveInt().optional(),
      },
    },
    guard((a: any) => pa.githubWorkflowJobs(store, a)),
  );
  server.registerTool(
    "rerun_github_workflow_run",
    {
      title: "Rerun GitHub Actions workflow run",
      description: "Rerun a GitHub Actions workflow run for the mapped repo. Requires write policy approval when configured.",
      inputSchema: { project: proj, environment: env, runId: positiveInt("GitHub Actions workflow run id") },
    },
    guard((a: any) => pa.githubRerunWorkflowRun(store, a)),
  );
  server.registerTool(
    "cancel_github_workflow_run",
    {
      title: "Cancel GitHub Actions workflow run",
      description: "Cancel a GitHub Actions workflow run for the mapped repo. Requires write policy approval when configured.",
      inputSchema: { project: proj, environment: env, runId: positiveInt("GitHub Actions workflow run id") },
    },
    guard((a: any) => pa.githubCancelWorkflowRun(store, a)),
  );

  // Vercel
  server.registerTool(
    "get_vercel_project_context",
    {
      title: "Vercel project context",
      description: "Read the mapped Vercel project (framework, id).",
      inputSchema: { project: proj, environment: env },
    },
    guard((a: any) => pa.vercelProjectContext(store, a)),
  );
  server.registerTool(
    "get_vercel_deployments",
    {
      title: "Vercel deployments",
      description: "List recent deployments for the mapped Vercel project.",
      inputSchema: { project: proj, environment: env, limit: positiveInt().optional() },
    },
    guard((a: any) => pa.vercelDeployments(store, a)),
  );
  server.registerTool(
    "get_vercel_deployment_status",
    {
      title: "Vercel deployment status",
      description: "Get the readyState/status of a specific deployment.",
      inputSchema: { project: proj, environment: env, deploymentId: nonEmptyString() },
    },
    guard((a: any) => pa.vercelDeploymentStatus(store, a)),
  );
  server.registerTool(
    "get_vercel_deployment_logs",
    {
      title: "Vercel deployment logs",
      description: "Fetch build/runtime events (logs) for a specific deployment.",
      inputSchema: { project: proj, environment: env, deploymentId: nonEmptyString(), limit: positiveInt().optional() },
    },
    guard((a: any) => pa.vercelDeploymentLogs(store, a)),
  );
  server.registerTool(
    "set_vercel_env_var",
    {
      title: "Set Vercel env var",
      description:
        "Set/upsert an environment variable on the mapped Vercel project. PRODUCTION changes " +
        "require approval by default.",
      inputSchema: {
        project: proj,
        environment: env,
        key: nonEmptyString(),
        value: z.string(),
        target: z.array(nonEmptyString()).optional().describe("e.g. ['production'] or ['preview']"),
      },
    },
    guard((a: any) => pa.vercelSetEnvVar(store, a)),
  );
  server.registerTool(
    "create_vercel_project",
    {
      title: "Create Vercel project",
      description:
        "Create a new Vercel project (optionally with a framework preset). Map it afterwards with " +
        "map_provider_resource so deploys and env vars target it.",
      inputSchema: {
        project: proj,
        environment: env,
        name: nonEmptyString("Vercel project name, e.g. acme-site"),
        framework: optionalNonEmptyString("Framework preset, e.g. nextjs, vite, astro"),
      },
    },
    guard((a: any) => pa.vercelCreateProject(store, a)),
  );
  server.registerTool(
    "add_vercel_domain",
    {
      title: "Add Vercel domain",
      description:
        "Attach a domain to a Vercel project. The result includes the DNS record to create at the " +
        "registrar (A 76.76.21.21 for apex, CNAME cname.vercel-dns.com for subdomains) and any " +
        "verification challenges — set them with set_dns_records.",
      inputSchema: {
        project: proj,
        environment: env,
        vercel_project: nonEmptyString("Vercel project id or name"),
        domain: nonEmptyString("Domain to attach, e.g. example.com or www.example.com"),
      },
    },
    guard((a: any) =>
      pa.vercelAddDomain(store, {
        project: a.project,
        environment: a.environment,
        vercelProject: a.vercel_project,
        domain: a.domain,
      }),
    ),
  );
  server.registerTool(
    "create_vercel_deployment",
    {
      title: "Create Vercel deployment",
      description: "Trigger a deployment of the mapped Vercel project. PRODUCTION deploys require approval by default.",
      inputSchema: {
        project: proj,
        environment: env,
        name: optionalNonEmptyString(),
        deploymentId: optionalNonEmptyString("Redeploy from an existing deployment id"),
        gitSource: z
          .object({
            type: z.literal("github"),
            repoId: nonEmptyString("GitHub repo id"),
            ref: optionalNonEmptyString("Git ref"),
            sha: optionalNonEmptyString("Commit SHA"),
          })
          .optional(),
      },
    },
    guard((a: any) => pa.vercelCreateDeployment(store, a)),
  );

  // Railway (GraphQL API)
  server.registerTool(
    "get_railway_project_context",
    {
      title: "Railway project context",
      description: "Read the mapped Railway project: its name, environments, and services.",
      inputSchema: { project: proj, environment: env },
    },
    guard((a: any) => pa.railwayProjectContext(store, a)),
  );
  server.registerTool(
    "discover_railway_resources",
    {
      title: "Discover Railway resources",
      description: "List Railway projects with their environment and service ids so they can be mapped.",
      inputSchema: { project: proj, environment: env },
    },
    guard((a: any) => pa.railwayDiscover(store, a)),
  );
  server.registerTool(
    "get_railway_deployments",
    {
      title: "Railway deployments",
      description: "List recent deployments for the mapped Railway project (scoped to its environment/service if mapped).",
      inputSchema: { project: proj, environment: env, limit: positiveInt().optional() },
    },
    guard((a: any) => pa.railwayDeployments(store, a)),
  );
  server.registerTool(
    "get_railway_logs",
    {
      title: "Get Railway logs",
      description:
        "Fetch logs from the mapped Railway project. If `deployment_id` is given, reads that " +
        "deployment; otherwise resolves the latest deployment first. Returns the deployment " +
        "id/url/status plus log lines. Read-only and audited.",
      inputSchema: {
        project: proj,
        environment: env,
        deployment_id: optionalNonEmptyString("Deployment to read logs for; defaults to latest"),
        since: optionalNonEmptyString("Only logs after this time (ISO timestamp)"),
        limit: positiveInt("Max log lines (default 100)").optional(),
      },
    },
    guard((a: any) =>
      pa.railwayLogs(store, {
        project: a.project,
        environment: a.environment,
        deploymentId: a.deployment_id,
        since: a.since,
        limit: a.limit,
      }),
    ),
  );
  server.registerTool(
    "create_railway_deployment",
    {
      title: "Create Railway deployment",
      description:
        "Trigger a deployment of the mapped Railway service, or redeploy an existing deployment " +
        "(pass deployment_id). PRODUCTION deploys require approval by default.",
      inputSchema: {
        project: proj,
        environment: env,
        deployment_id: optionalNonEmptyString("Redeploy this existing deployment instead of triggering a fresh one"),
      },
    },
    guard((a: any) =>
      pa.railwayCreateDeployment(store, {
        project: a.project,
        environment: a.environment,
        deploymentId: a.deployment_id,
      }),
    ),
  );
  server.registerTool(
    "set_railway_env_var",
    {
      title: "Set Railway variable",
      description:
        "Create/update a variable on the mapped Railway project/service. PRODUCTION changes " +
        "require approval by default. Railway redeploys the affected service unless skip_deploys is true.",
      inputSchema: {
        project: proj,
        environment: env,
        key: nonEmptyString(),
        value: z.string(),
        service_id: optionalNonEmptyString("Override the mapped serviceId (omit for a shared variable)"),
        skip_deploys: z.boolean().optional().describe("Don't trigger a redeploy after the change"),
      },
    },
    guard((a: any) =>
      pa.railwaySetEnvVar(store, {
        project: a.project,
        environment: a.environment,
        key: a.key,
        value: a.value,
        serviceId: a.service_id,
        skipDeploys: a.skip_deploys,
      }),
    ),
  );

  // Namecheap
  server.registerTool(
    "check_domain_availability",
    {
      title: "Check domain availability",
      description:
        "Check whether domains are available to register, including premium status and pricing. Read-only.",
      inputSchema: {
        project: proj,
        environment: env,
        domains: z.array(nonEmptyString()).min(1).describe("Domain names to check, e.g. [\"example.com\"]"),
      },
    },
    guard((a: any) => pa.checkDomainAvailability(store, a)),
  );
  server.registerTool(
    "list_namecheap_domains",
    {
      title: "List Namecheap domains",
      description: "List domains in the Namecheap account with expiry and lock status. Read-only.",
      inputSchema: {
        project: proj,
        environment: env,
        page: positiveInt("Page number (default 1)").optional(),
        page_size: positiveInt("Domains per page (10-100, default 20)").optional(),
        search_term: optionalNonEmptyString("Keyword filter"),
      },
    },
    guard((a: any) =>
      pa.namecheapListDomains(store, {
        project: a.project,
        environment: a.environment,
        page: a.page,
        pageSize: a.page_size,
        searchTerm: a.search_term,
      }),
    ),
  );
  server.registerTool(
    "purchase_domain",
    {
      title: "Purchase domain",
      description:
        "Register a domain via Namecheap. SPENDS REAL MONEY and ALWAYS requires human approval " +
        "(capability \"purchase\" cannot be policy-allowed). Uses the namecheap.registrant contact " +
        "from .dashclaw-local/config.yaml. Set NAMECHEAP_SANDBOX=true to test without real charges.",
      inputSchema: {
        project: proj,
        environment: env,
        domain: nonEmptyString("Domain to register, e.g. example.com"),
        years: positiveInt("Registration years (default 1)").optional(),
      },
    },
    guard((a: any) => pa.purchaseDomain(store, a)),
  );
  server.registerTool(
    "get_dns_records",
    {
      title: "Get DNS records",
      description: "List the DNS host records Namecheap serves for a domain. Read-only.",
      inputSchema: { project: proj, environment: env, domain: nonEmptyString("Domain, e.g. example.com") },
    },
    guard((a: any) => pa.getDnsRecords(store, a)),
  );
  server.registerTool(
    "set_dns_records",
    {
      title: "Set DNS records",
      description:
        "Set the DNS host records for a domain. WARNING: this REPLACES ALL existing host records " +
        "for the domain — include every record you want to keep (use get_dns_records first). " +
        "Approval required in production by default.",
      inputSchema: {
        project: proj,
        environment: env,
        domain: nonEmptyString("Domain, e.g. example.com"),
        records: z
          .array(
            z.object({
              name: nonEmptyString("Host name, e.g. @ or www"),
              type: nonEmptyString("Record type: A, AAAA, CNAME, MX, TXT, URL, ..."),
              address: nonEmptyString("Record value (IP, hostname, or text)"),
              ttl: positiveInt("TTL seconds (60-60000, default 1800)").optional(),
              mx_pref: positiveInt("MX preference (MX records only)").optional(),
            }),
          )
          .min(1)
          .describe("The COMPLETE set of host records for the domain"),
      },
    },
    guard((a: any) =>
      pa.setDnsRecords(store, {
        project: a.project,
        environment: a.environment,
        domain: a.domain,
        records: (a.records ?? []).map((r: any) => ({
          name: r.name,
          type: r.type,
          address: r.address,
          ttl: r.ttl,
          mxPref: r.mx_pref,
        })),
      }),
    ),
  );

  // Neon
  server.registerTool(
    "list_neon_projects",
    {
      title: "List Neon projects",
      description: "List all Neon projects visible to the API key (account-level, read-only).",
      inputSchema: { project: proj, environment: env },
    },
    guard((a: any) => pa.neonListProjects(store, a)),
  );
  server.registerTool(
    "create_neon_project",
    {
      title: "Create Neon project",
      description:
        "Provision a new Neon Postgres project. The result includes the connection URI for the " +
        "default branch — store it as an env var (e.g. DATABASE_URL); it never appears in the audit log.",
      inputSchema: {
        project: proj,
        environment: env,
        name: optionalNonEmptyString("Project name (Neon generates one if omitted)"),
        region_id: optionalNonEmptyString("Neon region, e.g. aws-us-east-1"),
        pg_version: positiveInt("Postgres major version, e.g. 17").optional(),
      },
    },
    guard((a: any) =>
      pa.neonCreateProject(store, {
        project: a.project,
        environment: a.environment,
        name: a.name,
        regionId: a.region_id,
        pgVersion: a.pg_version,
      }),
    ),
  );
  server.registerTool(
    "get_neon_connection_uri",
    {
      title: "Get Neon connection URI",
      description:
        "Fetch the connection URI (DATABASE_URL) for a Neon project/branch/database/role. The URI " +
        "contains credentials: it is returned to you only and is redacted from audit + DashClaw.",
      inputSchema: {
        project: proj,
        environment: env,
        neon_project_id: nonEmptyString("Neon project id"),
        database_name: nonEmptyString("Database name, e.g. neondb"),
        role_name: nonEmptyString("Role name, e.g. neondb_owner"),
        branch_id: optionalNonEmptyString("Branch id (defaults to the project's default branch)"),
        pooled: z.boolean().optional().describe("Return the pooled connection URI"),
      },
    },
    guard((a: any) =>
      pa.neonGetConnectionUri(store, {
        project: a.project,
        environment: a.environment,
        neonProjectId: a.neon_project_id,
        databaseName: a.database_name,
        roleName: a.role_name,
        branchId: a.branch_id,
        pooled: a.pooled,
      }),
    ),
  );

  // Upstash Redis
  server.registerTool(
    "list_upstash_redis_databases",
    {
      title: "List Upstash Redis databases",
      description: "List Upstash Redis databases visible to the Developer API key. Read-only and audited.",
      inputSchema: {
        project: proj,
        environment: env,
        apiHost: optionalNonEmptyString("Optional Upstash API host override"),
      },
    },
    guard((a: any) => pa.upstashListRedisDatabases(store, a)),
  );
  server.registerTool(
    "create_upstash_redis_database",
    {
      title: "Create Upstash Redis database",
      description:
        "Create an Upstash Redis database and return UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN wiring. Production setup requires approval by default.",
      inputSchema: {
        project: proj,
        environment: env,
        apiHost: optionalNonEmptyString("Optional Upstash API host override"),
        databaseName: nonEmptyString("Redis database name"),
        platform: z.enum(["aws", "gcp"]).describe("Cloud platform"),
        primaryRegion: nonEmptyString("Primary region, e.g. us-east-1"),
        readRegions: z.array(nonEmptyString("Read region")).optional(),
        plan: optionalNonEmptyString("Optional plan, e.g. free or payg"),
        budget: nonNegativeInt("Optional monthly budget").optional(),
        eviction: z.boolean().optional().describe("Whether to enable eviction"),
        tls: z.boolean().optional().describe("Whether to enable TLS"),
      },
    },
    guard((a: any) => pa.upstashCreateRedisDatabase(store, a)),
  );
  server.registerTool(
    "get_upstash_redis_env",
    {
      title: "Get Upstash Redis env",
      description:
        "Return env wiring for UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, and UPSTASH_REDIS_READ_ONLY_REST_TOKEN.",
      inputSchema: {
        project: proj,
        environment: env,
        databaseId: optionalNonEmptyString("Upstash Redis database id; defaults to mapped databaseId"),
      },
    },
    guard((a: any) => pa.upstashGetRedisEnv(store, a)),
  );

  server.registerTool(
    "get_upstash_qstash_env",
    {
      title: "Get Upstash QStash env",
      description:
        "Return env wiring for QSTASH_URL, QSTASH_TOKEN, QSTASH_CURRENT_SIGNING_KEY, and QSTASH_NEXT_SIGNING_KEY.",
      inputSchema: {
        project: proj,
        environment: env,
      },
    },
    guard((a: any) => pa.upstashGetQstashEnv(store, a)),
  );
  server.registerTool(
    "list_upstash_qstash_schedules",
    {
      title: "List Upstash QStash schedules",
      description: "List QStash cron schedules without returning stored request bodies or forwarded headers.",
      inputSchema: {
        project: proj,
        environment: env,
      },
    },
    guard((a: any) => pa.upstashListQstashSchedules(store, a)),
  );
  server.registerTool(
    "create_upstash_qstash_schedule",
    {
      title: "Create Upstash QStash schedule",
      description:
        "Create a QStash cron schedule for an app endpoint. Request bodies and forwarded headers are redacted in QStash; production setup requires approval by default.",
      inputSchema: {
        project: proj,
        environment: env,
        destination: nonEmptyString("Public destination URL or QStash URL group name"),
        cron: nonEmptyString("Cron expression, e.g. CRON_TZ=America/New_York 0 9 * * *"),
        scheduleId: optionalNonEmptyString("Optional stable schedule id"),
        body: optionalNonEmptyString("Optional raw request body"),
        contentType: optionalNonEmptyString("Optional Content-Type; defaults to application/json"),
        method: httpMethod.optional().describe("HTTP method QStash should use when calling the destination"),
        retries: nonNegativeInt("Optional retry count").optional(),
      },
    },
    guard((a: any) => pa.upstashCreateQstashSchedule(store, a)),
  );

  // Cloudflare R2 object storage
  server.registerTool(
    "list_cloudflare_r2_buckets",
    {
      title: "List Cloudflare R2 buckets",
      description: "List Cloudflare R2 buckets visible to CLOUDFLARE_API_TOKEN. Read-only and audited.",
      inputSchema: {
        project: proj,
        environment: env,
        accountId: optionalNonEmptyString("Cloudflare account id; defaults to mapped accountId"),
        cursor: optionalNonEmptyString("Pagination cursor"),
        limit: positiveInt("Page size").optional(),
      },
    },
    guard((a: any) => pa.cloudflareR2ListBuckets(store, a)),
  );
  server.registerTool(
    "create_cloudflare_r2_bucket",
    {
      title: "Create Cloudflare R2 bucket",
      description:
        "Create a Cloudflare R2 bucket and return S3-compatible app env wiring. Production storage setup requires approval by default.",
      inputSchema: {
        project: proj,
        environment: env,
        accountId: optionalNonEmptyString("Cloudflare account id; defaults to mapped accountId"),
        bucketName: r2BucketName("Lowercase R2 bucket name"),
        locationHint: optionalNonEmptyString("Optional R2 location hint, e.g. enam"),
        storageClass: optionalNonEmptyString("Optional R2 storage class, e.g. Standard"),
        jurisdiction: z.enum(["default", "eu", "fedramp"]).optional().describe("R2 jurisdiction"),
      },
    },
    guard((a: any) => pa.cloudflareR2CreateBucket(store, a)),
  );
  server.registerTool(
    "get_cloudflare_r2_env",
    {
      title: "Get Cloudflare R2 env",
      description:
        "Return R2 app env wiring for R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.",
      inputSchema: {
        project: proj,
        environment: env,
        accountId: optionalNonEmptyString("Cloudflare account id; defaults to mapped accountId"),
        bucketName: optionalNonEmptyString("R2 bucket name; defaults to mapped bucketName"),
      },
    },
    guard((a: any) => pa.cloudflareR2GetEnv(store, a)),
  );
  server.registerTool(
    "list_cloudflare_r2_objects",
    {
      title: "List Cloudflare R2 objects",
      description: "List sanitized object summaries for the mapped R2 bucket. Read-only and audited.",
      inputSchema: {
        project: proj,
        environment: env,
        accountId: optionalNonEmptyString("Cloudflare account id; defaults to mapped accountId"),
        bucketName: optionalNonEmptyString("R2 bucket name; defaults to mapped bucketName"),
        prefix: optionalNonEmptyString("Optional object key prefix"),
        cursor: optionalNonEmptyString("Pagination cursor"),
        limit: positiveInt("Page size").optional(),
      },
    },
    guard((a: any) => pa.cloudflareR2ListObjects(store, a)),
  );

  // Clerk auth
  server.registerTool(
    "get_clerk_app_env",
    {
      title: "Get Clerk app env",
      description:
        "Return client-safe Clerk env wiring for NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, sign-in/sign-up URLs, and the optional Frontend API URL.",
      inputSchema: {
        project: proj,
        environment: env,
      },
    },
    guard((a: any) => pa.clerkGetAppEnv(store, a)),
  );
  server.registerTool(
    "list_clerk_users",
    {
      title: "List Clerk users",
      description: "List sanitized Clerk user summaries for the mapped app. Read-only and audited.",
      inputSchema: {
        project: proj,
        environment: env,
        limit: positiveInt().optional(),
        offset: nonNegativeInt().optional(),
        query: optionalNonEmptyString("Optional Clerk user search query"),
      },
    },
    guard((a: any) => pa.clerkListUsers(store, a)),
  );
  server.registerTool(
    "list_clerk_domains",
    {
      title: "List Clerk domains",
      description: "List primary and satellite domains for the mapped Clerk instance. Read-only and audited.",
      inputSchema: {
        project: proj,
        environment: env,
      },
    },
    guard((a: any) => pa.clerkListDomains(store, a)),
  );
  server.registerTool(
    "list_clerk_redirect_urls",
    {
      title: "List Clerk redirect URLs",
      description: "List Clerk whitelisted redirect URLs for OAuth/native auth flows. Read-only and audited.",
      inputSchema: {
        project: proj,
        environment: env,
        limit: positiveInt().optional(),
        offset: nonNegativeInt().optional(),
      },
    },
    guard((a: any) => pa.clerkListRedirectUrls(store, a)),
  );
  server.registerTool(
    "create_clerk_redirect_url",
    {
      title: "Create Clerk redirect URL",
      description:
        "Whitelist a Clerk redirect URL for OAuth/native auth flows. Production auth setup requires approval by default.",
      inputSchema: {
        project: proj,
        environment: env,
        url: nonEmptyString("Full redirect URL, e.g. https://app.example.com/callback or my-app://callback"),
      },
    },
    guard((a: any) => pa.clerkCreateRedirectUrl(store, a)),
  );

  // Supabase
  server.registerTool(
    "list_supabase_projects",
    {
      title: "List Supabase projects",
      description: "List all Supabase projects visible to the access token (account-level, read-only).",
      inputSchema: { project: proj, environment: env },
    },
    guard((a: any) => pa.supabaseListProjects(store, a)),
  );
  server.registerTool(
    "get_supabase_project_context",
    {
      title: "Supabase project context",
      description: "Get details of the mapped Supabase project (status, region).",
      inputSchema: { project: proj, environment: env },
    },
    guard((a: any) => pa.supabaseProjectContext(store, a)),
  );
  server.registerTool(
    "query_supabase",
    {
      title: "Query Supabase",
      description:
        "Run SQL against the mapped Supabase project. Reads run with read_only=true. Destructive SQL " +
        "(DROP/TRUNCATE/DELETE/ALTER…) is blocked everywhere by default; non-read writes in production " +
        "require approval.",
      inputSchema: { project: proj, environment: env, sql: nonEmptyString() },
    },
    guard((a: any) => pa.supabaseQuery(store, a)),
  );
  server.registerTool(
    "get_supabase_logs",
    {
      title: "Get Supabase logs",
      description: "Read project logs from the mapped Supabase project. Availability depends on Supabase plan/API limits.",
      inputSchema: {
        project: proj,
        environment: env,
        service: optionalNonEmptyString("Optional service/log source"),
        since: optionalNonEmptyString("Optional timestamp filter"),
        limit: positiveInt().optional(),
      },
    },
    guard((a: any) => pa.supabaseLogs(store, a)),
  );
  server.registerTool(
    "apply_supabase_migration",
    {
      title: "Apply Supabase migration",
      description:
        "Apply SQL through the Supabase migrations endpoint. Production writes require approval and endpoint access may be restricted by Supabase.",
      inputSchema: { project: proj, environment: env, name: nonEmptyString(), sql: nonEmptyString() },
    },
    guard((a: any) => pa.supabaseApplyMigration(store, a)),
  );

  // Stripe
  server.registerTool(
    "list_stripe_products",
    {
      title: "List Stripe products",
      description: "List products in the environment's Stripe mode (test/live).",
      inputSchema: { project: proj, environment: env, limit: positiveInt().optional() },
    },
    guard((a: any) => pa.stripeListProducts(store, a)),
  );
  server.registerTool(
    "list_stripe_customers",
    {
      title: "List Stripe customers",
      description: "List customers in the environment's Stripe mode (test/live).",
      inputSchema: { project: proj, environment: env, limit: positiveInt().optional() },
    },
    guard((a: any) => pa.stripeListCustomers(store, a)),
  );
  server.registerTool(
    "list_stripe_subscriptions",
    {
      title: "List Stripe subscriptions",
      description: "List subscriptions in the environment's Stripe mode (test/live).",
      inputSchema: { project: proj, environment: env, limit: positiveInt().optional(), status: optionalNonEmptyString() },
    },
    guard((a: any) => pa.stripeListSubscriptions(store, a)),
  );
  server.registerTool(
    "list_stripe_invoices",
    {
      title: "List Stripe invoices",
      description: "List invoices in the environment's Stripe mode (test/live).",
      inputSchema: {
        project: proj,
        environment: env,
        limit: positiveInt().optional(),
        customer: optionalNonEmptyString("Optional Stripe customer id"),
      },
    },
    guard((a: any) => pa.stripeListInvoices(store, a)),
  );
  server.registerTool(
    "create_stripe_webhook",
    {
      title: "Create Stripe webhook",
      description:
        "Create a webhook endpoint in the environment's Stripe mode. The result includes the whsec_ " +
        "signing secret which Stripe shows ONLY ONCE — store it as an env var immediately " +
        "(e.g. set_vercel_env_var STRIPE_WEBHOOK_SECRET). It never appears in the audit log. " +
        "LIVE-mode writes require approval.",
      inputSchema: {
        project: proj,
        environment: env,
        url: nonEmptyString("HTTPS endpoint URL Stripe should call"),
        enabled_events: z
          .array(nonEmptyString())
          .min(1)
          .describe('Stripe event names, e.g. ["checkout.session.completed", "invoice.paid"]'),
        description: z.string().optional(),
      },
    },
    guard((a: any) =>
      pa.stripeCreateWebhook(store, {
        project: a.project,
        environment: a.environment,
        url: a.url,
        enabledEvents: a.enabled_events,
        description: a.description,
      }),
    ),
  );
  server.registerTool(
    "list_stripe_webhooks",
    {
      title: "List Stripe webhooks",
      description:
        "List webhook endpoints in the environment's Stripe mode (signing secrets are never returned by list).",
      inputSchema: { project: proj, environment: env, limit: positiveInt().optional() },
    },
    guard((a: any) => pa.stripeListWebhooks(store, a)),
  );
  server.registerTool(
    "create_stripe_product",
    {
      title: "Create Stripe product",
      description:
        "Create a product. Test-mode writes are allowed by default; LIVE-mode writes require approval.",
      inputSchema: { project: proj, environment: env, name: nonEmptyString(), description: z.string().optional() },
    },
    guard((a: any) => pa.stripeCreateProduct(store, a)),
  );
  server.registerTool(
    "create_stripe_price",
    {
      title: "Create Stripe price",
      description:
        "Create a price for a product. Test-mode writes allowed by default; LIVE-mode writes require approval.",
      inputSchema: {
        project: proj,
        environment: env,
        product: nonEmptyString("Stripe product id"),
        currency: nonEmptyString("ISO currency, e.g. 'usd'"),
        unitAmount: positiveInt("Amount in the smallest currency unit, e.g. cents"),
        recurringInterval: z.enum(["day", "week", "month", "year"]).optional(),
      },
    },
    guard((a: any) => pa.stripeCreatePrice(store, a)),
  );

  // Sentry
  server.registerTool(
    "list_sentry_projects",
    {
      title: "List Sentry projects",
      description: "List Sentry projects in the mapped organization. Read-only and audited.",
      inputSchema: {
        project: proj,
        environment: env,
        limit: positiveInt().optional(),
        query: optionalNonEmptyString("Optional project name/slug filter"),
      },
    },
    guard((a: any) => pa.sentryListProjects(store, a)),
  );
  server.registerTool(
    "create_sentry_project",
    {
      title: "Create Sentry project",
      description:
        "Create a Sentry observability project. Production observability setup requires approval by default.",
      inputSchema: {
        project: proj,
        environment: env,
        name: nonEmptyString("Sentry project name"),
        slug: optionalNonEmptyString("Optional Sentry project slug"),
        platform: optionalNonEmptyString("Optional Sentry platform, e.g. node-express or javascript-nextjs"),
        teamSlug: optionalNonEmptyString("Optional Sentry team slug; defaults to mapped teamSlug"),
        defaultRules: z.boolean().optional().describe("Whether Sentry should create default alert rules"),
      },
    },
    guard((a: any) => pa.sentryCreateProject(store, a)),
  );
  server.registerTool(
    "list_sentry_client_keys",
    {
      title: "List Sentry client keys",
      description: "List Sentry client keys for a project, returning public DSNs only. Secret DSNs are stripped.",
      inputSchema: {
        project: proj,
        environment: env,
        projectSlug: optionalNonEmptyString("Sentry project slug; defaults to mapped projectSlug"),
        status: z.enum(["active", "inactive"]).optional(),
      },
    },
    guard((a: any) => pa.sentryListClientKeys(store, a)),
  );
  server.registerTool(
    "create_sentry_client_key",
    {
      title: "Create Sentry client key",
      description:
        "Create a Sentry client key and return its public DSN for SENTRY_DSN wiring. Production setup requires approval by default.",
      inputSchema: {
        project: proj,
        environment: env,
        projectSlug: optionalNonEmptyString("Sentry project slug; defaults to mapped projectSlug"),
        name: optionalNonEmptyString("Optional client key name, e.g. web"),
        useCase: z.enum(["user", "profiling", "tempest", "demo"]).optional(),
        rateLimitWindow: positiveInt("Rate-limit window in seconds; pair with rateLimitCount").optional(),
        rateLimitCount: positiveInt("Maximum accepted events during rateLimitWindow").optional(),
      },
    },
    guard((a: any) => pa.sentryCreateClientKey(store, a)),
  );
  server.registerTool(
    "list_sentry_releases",
    {
      title: "List Sentry releases",
      description: "List Sentry releases for the mapped organization. Read-only and audited.",
      inputSchema: {
        project: proj,
        environment: env,
        query: optionalNonEmptyString("Optional starts-with filter for release version"),
      },
    },
    guard((a: any) => pa.sentryListReleases(store, a)),
  );
  server.registerTool(
    "create_sentry_release",
    {
      title: "Create Sentry release",
      description:
        "Create a Sentry release marker for the mapped project so issues and regressions correlate to a shipped version.",
      inputSchema: {
        project: proj,
        environment: env,
        version: nonEmptyString("Release version, e.g. acme-api@<git-sha>"),
        projects: z.array(nonEmptyString("Sentry project slug")).min(1).optional(),
        ref: optionalNonEmptyString("Optional commit SHA/ref"),
        url: optionalNonEmptyString("Optional URL for the release/source commit"),
        dateReleased: optionalNonEmptyString("Optional ISO timestamp when the release went live"),
      },
    },
    guard((a: any) => pa.sentryCreateRelease(store, a)),
  );
  server.registerTool(
    "list_sentry_deploys",
    {
      title: "List Sentry deploys",
      description: "List deploy markers for a Sentry release. Read-only and audited.",
      inputSchema: {
        project: proj,
        environment: env,
        version: nonEmptyString("Release version"),
      },
    },
    guard((a: any) => pa.sentryListDeploys(store, a)),
  );
  server.registerTool(
    "create_sentry_deploy",
    {
      title: "Create Sentry deploy",
      description:
        "Create a Sentry deploy marker for a release/environment. Production deploy markers require approval by default.",
      inputSchema: {
        project: proj,
        environment: env,
        version: nonEmptyString("Release version"),
        deployEnvironment: nonEmptyString("Sentry deploy environment, e.g. production or staging"),
        name: optionalNonEmptyString("Optional deploy name, e.g. vercel dpl_..."),
        url: optionalNonEmptyString("Optional deployed URL"),
        dateStarted: optionalNonEmptyString("Optional ISO timestamp when deployment started"),
        dateFinished: optionalNonEmptyString("Optional ISO timestamp when deployment finished"),
        projects: z.array(nonEmptyString("Sentry project slug")).min(1).optional(),
      },
    },
    guard((a: any) => pa.sentryCreateDeploy(store, a)),
  );

  // PostHog
  server.registerTool(
    "list_posthog_projects",
    {
      title: "List PostHog projects",
      description: "List PostHog projects in the mapped organization. Read-only and audited.",
      inputSchema: {
        project: proj,
        environment: env,
        limit: positiveInt().optional(),
        search: optionalNonEmptyString("Optional project name filter"),
      },
    },
    guard((a: any) => pa.posthogListProjects(store, a)),
  );
  server.registerTool(
    "create_posthog_project",
    {
      title: "Create PostHog project",
      description:
        "Create a PostHog analytics project and return NEXT_PUBLIC_POSTHOG_KEY/NEXT_PUBLIC_POSTHOG_HOST wiring. Production setup requires approval by default.",
      inputSchema: {
        project: proj,
        environment: env,
        name: nonEmptyString("PostHog project name"),
        productDescription: optionalNonEmptyString("Optional product description"),
        appUrls: z.array(nonEmptyString("Application URL")).optional(),
        timezone: optionalNonEmptyString("Optional timezone, e.g. UTC"),
        sessionRecording: z.boolean().optional().describe("Whether to opt in to PostHog session recording"),
      },
    },
    guard((a: any) => pa.posthogCreateProject(store, a)),
  );
  server.registerTool(
    "get_posthog_project_env",
    {
      title: "Get PostHog project env",
      description:
        "Return client-safe PostHog env wiring for NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_POSTHOG_HOST, and POSTHOG_PROJECT_ID.",
      inputSchema: {
        project: proj,
        environment: env,
        projectId: optionalNonEmptyString("PostHog project id; defaults to mapped projectId"),
      },
    },
    guard((a: any) => pa.posthogGetProjectEnv(store, a)),
  );
  server.registerTool(
    "list_posthog_feature_flags",
    {
      title: "List PostHog feature flags",
      description: "List feature flags for the mapped PostHog project. Read-only and audited.",
      inputSchema: {
        project: proj,
        environment: env,
        projectId: optionalNonEmptyString("PostHog project id; defaults to mapped projectId"),
        limit: positiveInt().optional(),
        search: optionalNonEmptyString("Optional flag key/name search"),
        active: z.enum(["STALE", "false", "true"]).optional(),
        type: z.enum(["boolean", "experiment", "multivariant", "remote_config"]).optional(),
      },
    },
    guard((a: any) => pa.posthogListFeatureFlags(store, a)),
  );
  server.registerTool(
    "create_posthog_feature_flag",
    {
      title: "Create PostHog feature flag",
      description:
        "Create a PostHog feature flag, inactive by default. Production flag writes require approval by default.",
      inputSchema: {
        project: proj,
        environment: env,
        projectId: optionalNonEmptyString("PostHog project id; defaults to mapped projectId"),
        key: nonEmptyString("Feature flag key used in application code"),
        name: optionalNonEmptyString("Optional display name"),
        active: z.boolean().optional().describe("Defaults to false when omitted"),
        filters: z.record(z.unknown()).optional().describe("Optional PostHog feature flag filters object"),
        tags: z.array(nonEmptyString("PostHog tag")).optional(),
        isRemoteConfiguration: z.boolean().optional(),
      },
    },
    guard((a: any) => pa.posthogCreateFeatureFlag(store, a)),
  );

  // Resend
  server.registerTool(
    "list_resend_domains",
    {
      title: "List Resend domains",
      description: "List Resend email domains and their sending/receiving status for the mapped account.",
      inputSchema: { project: proj, environment: env, limit: positiveInt().optional() },
    },
    guard((a: any) => pa.resendListDomains(store, a)),
  );
  server.registerTool(
    "create_resend_domain",
    {
      title: "Create Resend domain",
      description:
        "Create a Resend sending domain and return the DNS records to set. Production email/DNS setup requires approval.",
      inputSchema: { project: proj, environment: env, name: nonEmptyString("Domain name, e.g. example.com") },
    },
    guard((a: any) => pa.resendCreateDomain(store, a)),
  );
  server.registerTool(
    "verify_resend_domain",
    {
      title: "Verify Resend domain",
      description: "Trigger Resend domain verification after DNS records have been created.",
      inputSchema: { project: proj, environment: env, domainId: nonEmptyString("Resend domain id") },
    },
    guard((a: any) => pa.resendVerifyDomain(store, a)),
  );
  server.registerTool(
    "send_resend_email",
    {
      title: "Send Resend email",
      description:
        "Send an outbound email through Resend. This is a live external communication and requires approval by default.",
      inputSchema: {
        project: proj,
        environment: env,
        from: optionalNonEmptyString("From header; defaults to mapped defaultFrom"),
        to: z.array(nonEmptyString("Recipient email address")).min(1),
        subject: nonEmptyString("Email subject"),
        html: optionalNonEmptyString("HTML message body"),
        text: optionalNonEmptyString("Plain text message body"),
        cc: z.array(nonEmptyString("CC recipient email address")).min(1).optional(),
        bcc: z.array(nonEmptyString("BCC recipient email address")).min(1).optional(),
        replyTo: z.array(nonEmptyString("Reply-To email address")).min(1).optional(),
      },
    },
    guard((a: any) => pa.resendSendEmail(store, a)),
  );

  // Twilio
  server.registerTool(
    "list_twilio_phone_numbers",
    {
      title: "List Twilio phone numbers",
      description: "List Twilio phone numbers and their current SMS/voice webhook URLs for the mapped account.",
      inputSchema: { project: proj, environment: env, limit: positiveInt().optional() },
    },
    guard((a: any) => pa.twilioListPhoneNumbers(store, a)),
  );
  server.registerTool(
    "update_twilio_phone_number_webhooks",
    {
      title: "Update Twilio phone number webhooks",
      description:
        "Wire a Twilio phone number to your app's inbound SMS and/or voice webhook URLs. " +
        "Production changes require approval.",
      inputSchema: {
        project: proj,
        environment: env,
        phoneNumberSid: nonEmptyString("Twilio incoming phone number SID, e.g. PN..."),
        smsUrl: optionalNonEmptyString("HTTPS endpoint Twilio should call for inbound SMS"),
        voiceUrl: optionalNonEmptyString("HTTPS endpoint Twilio should call for inbound voice"),
      },
    },
    guard((a: any) =>
      pa.twilioUpdatePhoneNumberWebhooks(store, {
        project: a.project,
        environment: a.environment,
        phoneNumberSid: a.phoneNumberSid,
        smsUrl: a.smsUrl,
        voiceUrl: a.voiceUrl,
      }),
    ),
  );
  server.registerTool(
    "send_twilio_sms",
    {
      title: "Send Twilio SMS",
      description:
        "Send an outbound SMS through Twilio. This is a live external communication and requires approval by default.",
      inputSchema: {
        project: proj,
        environment: env,
        to: nonEmptyString("Recipient phone number in E.164 format"),
        body: nonEmptyString("Message body"),
        from: optionalNonEmptyString("Sender phone number; defaults to mapped fromNumber"),
        messagingServiceSid: optionalNonEmptyString("Messaging Service SID; defaults to mapped messagingServiceSid"),
        statusCallback: optionalNonEmptyString("Optional delivery status callback URL"),
      },
    },
    guard((a: any) => pa.twilioSendSms(store, a)),
  );
  server.registerTool(
    "create_twilio_call",
    {
      title: "Create Twilio call",
      description:
        "Create an outbound voice call through Twilio. This is a live external communication and requires approval by default.",
      inputSchema: {
        project: proj,
        environment: env,
        to: nonEmptyString("Recipient phone number in E.164 format"),
        url: nonEmptyString("TwiML URL Twilio requests when the call connects"),
        from: optionalNonEmptyString("Caller phone number; defaults to mapped fromNumber"),
        statusCallback: optionalNonEmptyString("Optional call status callback URL"),
      },
    },
    guard((a: any) => pa.twilioCreateCall(store, a)),
  );
}
