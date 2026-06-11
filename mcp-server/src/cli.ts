#!/usr/bin/env node
import { Store } from "./storage.js";
import {
  addEnvironment,
  createConnection,
  createProject,
  dashclawStatus,
  doctor,
  ensureDefaultWorkspace,
  exportAuditLog,
  exportDashclawEvidence,
  exportContextSnapshot,
  getProjectContext,
  listConnections,
  listEnvironments,
  listProjects,
  mapProviderResource,
  selectProject,
  simulateAction,
} from "./service.js";
import { seedFromConfigFile } from "./config.js";
import type { ProviderId, ProviderResource } from "./types.js";
import { resolve } from "node:path";
import { logEvent, startupLoggingEnabled } from "./logger.js";

/**
 * Minimal `dashclaw-mcp` CLI. The MCP tools are the primary interface; this CLI is a
 * convenience for setup and inspection. All commands operate on the same
 * `.dashclaw-local/` state as the server.
 */

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function print(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

function failCli(error: string): void {
  print({ status: "error", error });
  process.exitCode = 1;
}

function optionalPositiveInt(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

const REQUIRED_ENV_VARS = [
  ["GITHUB_TOKEN", "GitHub fine-grained PAT (Metadata: read, Contents: read, Actions: read; Actions: write for rerun/cancel)"],
  ["VERCEL_TOKEN", "Vercel account/team token"],
  ["VERCEL_TEAM_ID", "optional — required for team-owned Vercel resources"],
  ["SUPABASE_ACCESS_TOKEN", "Supabase personal access token"],
  ["STRIPE_TEST_SECRET_KEY", "Stripe sk_test_… key"],
  ["STRIPE_LIVE_SECRET_KEY", "Stripe sk_live_… key (only used when policy allows a live write)"],
  ["RAILWAY_TOKEN", "Railway account/workspace token"],
  ["QSTASH_TOKEN", "Upstash QStash token for background jobs and schedules"],
  ["QSTASH_CURRENT_SIGNING_KEY", "QStash current signing key for request verification"],
  ["QSTASH_NEXT_SIGNING_KEY", "QStash next signing key for request verification"],
  ["CLOUDFLARE_API_TOKEN", "Cloudflare API token for R2 bucket management"],
  ["R2_ACCESS_KEY_ID", "R2 S3-compatible access key id for app env wiring"],
  ["R2_SECRET_ACCESS_KEY", "R2 S3-compatible secret access key for app env wiring"],
  ["CLERK_SECRET_KEY", "Clerk Backend API secret key"],
];

/** Print the MCP client config snippet + required env vars after init. */
function printSetupHelp(serverEntry: string): void {
  const lines: string[] = [];
  lines.push("");
  lines.push("Next steps");
  lines.push("==========");
  lines.push("");
  lines.push("1) Set the provider env vars you'll use (only the ones you need):");
  for (const [name, desc] of REQUIRED_ENV_VARS) lines.push(`   - ${name}  — ${desc}`);
  lines.push("");
  lines.push("2) Add this MCP server to your coding agent:");
  lines.push("");
  lines.push("   Claude Code  → .mcp.json in your repo root:");
  lines.push(
    JSON.stringify(
      {
        mcpServers: {
          "dashclaw-local": {
            type: "stdio",
            command: "node",
            args: [serverEntry],
            env: {
              GITHUB_TOKEN: "${GITHUB_TOKEN}",
              VERCEL_TOKEN: "${VERCEL_TOKEN}",
              SUPABASE_ACCESS_TOKEN: "${SUPABASE_ACCESS_TOKEN}",
              STRIPE_TEST_SECRET_KEY: "${STRIPE_TEST_SECRET_KEY}",
              STRIPE_LIVE_SECRET_KEY: "${STRIPE_LIVE_SECRET_KEY}",
              RAILWAY_TOKEN: "${RAILWAY_TOKEN}",
              QSTASH_TOKEN: "${QSTASH_TOKEN}",
              QSTASH_CURRENT_SIGNING_KEY: "${QSTASH_CURRENT_SIGNING_KEY}",
              QSTASH_NEXT_SIGNING_KEY: "${QSTASH_NEXT_SIGNING_KEY}",
              CLOUDFLARE_API_TOKEN: "${CLOUDFLARE_API_TOKEN}",
              R2_ACCESS_KEY_ID: "${R2_ACCESS_KEY_ID}",
              R2_SECRET_ACCESS_KEY: "${R2_SECRET_ACCESS_KEY}",
              CLERK_SECRET_KEY: "${CLERK_SECRET_KEY}",
            },
          },
        },
      },
      null,
      2,
    )
      .split("\n")
      .map((l) => "   " + l)
      .join("\n"),
  );
  lines.push("");
  lines.push("   Cursor → .cursor/mcp.json (same shape, drop the \"type\" field).");
  lines.push("   Codex  → ~/.codex/config.toml:");
  lines.push("     [mcp_servers.dashclaw-local]");
  lines.push(`     command = "node"`);
  lines.push(`     args = ["${serverEntry.replace(/\\/g, "\\\\")}"]`);
  lines.push("");
  lines.push("3) Then ask your agent (using your project/environment names):");
  lines.push('   "Use dashclaw-local to get the context for <project> <environment> and tell me what is safe to touch."');
  lines.push("");
  console.log(lines.join("\n"));
}

const HELP = `dashclaw-mcp — production context layer for AI coding agents

Usage:
  dashclaw-mcp init [--config <path>]          Seed state from .dashclaw-local/config.yaml if present
  dashclaw-mcp project create <name> [--slug <s>] [--desc <d>]
  dashclaw-mcp project list
  dashclaw-mcp select <project>                Set the active project
  dashclaw-mcp env add <name> [--project <p>] [--kind development|staging|production]
  dashclaw-mcp env list [--project <p>]
  dashclaw-mcp connection create <provider> --label <name> --env-var <VAR> [--vercel-team-id <id>]
  dashclaw-mcp connection list [--provider <provider>]
  dashclaw-mcp map <provider> <environment> --resource '<json>' [--project <p>] [--connection <id>]
  dashclaw-mcp doctor [--project <p>] [--env <e>] [--json]
  dashclaw-mcp simulate <provider> <environment> <capability> [--project <p>] [--live] [--resource <label>]
  dashclaw-mcp audit export [--project <p>] [--env <e>] [--provider <p>] [--limit <n>] [--format jsonl|csv|markdown]
  dashclaw-mcp snapshot [--project <p>] [--env <e>] [--format json|markdown]
  dashclaw-mcp dashclaw status
  dashclaw-mcp dashclaw evidence [--project <p>] [--env <e>] [--provider <p>] [--limit <n>]
  dashclaw-mcp context [project] [--env <e>] [--json]   Print the production-context summary

Providers: github | vercel | supabase | stripe | railway | namecheap | neon | upstash | cloudflare_r2 | sentry | posthog | resend | twilio | clerk
Resource JSON examples:
  github:   {"owner":"your-org","repo":"your-repo"}
  vercel:   {"projectId":"your-vercel-project"}
  supabase: {"projectRef":"your_project_ref"}
  stripe:   {"mode":"live"}
  railway:  {"projectId":"your-railway-project-id","environmentId":"...","serviceId":"..."}
  upstash:  {"databaseId":"your-upstash-redis-database-id","apiHost":"https://api.upstash.com","qstashUrl":"https://qstash.upstash.io"}
  cloudflare_r2: {"accountId":"your-cloudflare-account-id","bucketName":"your-r2-bucket","publicUrl":"https://assets.example.com"}
  sentry:   {"organizationSlug":"your-sentry-org","projectSlug":"your-project","teamSlug":"platform"}
  posthog:  {"organizationId":"your-posthog-org-id","projectId":"12345","apiHost":"https://us.posthog.com","ingestHost":"https://us.i.posthog.com"}
  resend:   {"domain":"example.com","defaultFrom":"Your App <onboarding@example.com>"}
  twilio:   {"accountSid":"AC...","fromNumber":"+15551230000","messagingServiceSid":"MG..."}
  clerk:    {"publishableKey":"pk_test_...","signInUrl":"/sign-in","signUpUrl":"/sign-up"}
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help") {
    console.log(HELP);
    return;
  }

  const cmd = argv[0];
  // Parse flags from ALL args after the command, so flags work whether or not a
  // subcommand is present (e.g. `init --config x`). Subcommands are positional[0].
  const { positional, flags } = parseFlags(argv.slice(1));
  const sub = positional[0];
  if (startupLoggingEnabled()) {
    logEvent("info", "cli.start", { command: cmd, subcommand: sub, cwd: process.cwd() });
  }

  switch (cmd) {
    case "init": {
      const store = new Store();
      ensureDefaultWorkspace(store);
      const serverEntry = resolve(process.cwd(), "dist", "index.js");
      const path = flags.config ?? store.paths.config;
      const result = seedFromConfigFile(store, path);
      if (!result) {
        print({
          status: "ok",
          home: store.paths.home,
          message: `Initialized empty state at ${store.paths.home}. No config.yaml at ${path}. Copy docs/config.example.yaml (in the @dashclaw/mcp-server package) to .dashclaw-local/config.yaml and edit it, then re-run \`dashclaw-mcp init\` (or create projects with \`dashclaw-mcp project create\` / \`dashclaw-mcp map\`).`,
        });
      } else {
        print({ status: "ok", seededFrom: path, home: store.paths.home, ...result });
      }
      printSetupHelp(serverEntry);
      return;
    }

    case "project": {
      if (sub === "create") {
        const name = positional[1];
        if (!name) return failCli("Usage: dashclaw-mcp project create <name>");
        const store = new Store();
        print({ status: "ok", project: createProject(store, { name, slug: flags.slug, description: flags.desc }) });
      } else if (sub === "list") {
        const store = new Store();
        print({ status: "ok", projects: listProjects(store) });
      } else {
        failCli("Unknown project subcommand. Try: create | list");
      }
      return;
    }

    case "select": {
      if (!sub) return failCli("Usage: dashclaw-mcp select <project>");
      const store = new Store();
      print({ status: "ok", project: selectProject(store, sub) });
      return;
    }

    case "env": {
      if (sub === "add") {
        const name = positional[1];
        if (!name) return failCli("Usage: dashclaw-mcp env add <name>");
        const store = new Store();
        print({
          status: "ok",
          environment: addEnvironment(store, {
            project: flags.project,
            name,
            kind: flags.kind as any,
          }),
        });
      } else if (sub === "list") {
        const store = new Store();
        print({ status: "ok", environments: listEnvironments(store, flags.project) });
      } else {
        failCli("Unknown env subcommand. Try: add | list");
      }
      return;
    }

    case "connection": {
      if (sub === "create") {
        const provider = positional[1] as ProviderId | undefined;
        if (!provider || !flags.label || !flags["env-var"]) {
          return failCli("Usage: dashclaw-mcp connection create <provider> --label <name> --env-var <VAR>");
        }
        const store = new Store();
        print({
          status: "ok",
          connection: createConnection(store, {
            provider,
            label: flags.label,
            envVar: flags["env-var"],
            vercelTeamId: flags["vercel-team-id"],
          }),
        });
      } else if (sub === "list") {
        const store = new Store();
        print({ status: "ok", connections: listConnections(store, { provider: flags.provider as ProviderId | undefined }) });
      } else {
        failCli("Unknown connection subcommand. Try: create | list");
      }
      return;
    }

    case "map": {
      const provider = sub as ProviderId;
      const environment = positional[1];
      if (!provider || !environment || !flags.resource) {
        return failCli("Usage: dashclaw-mcp map <provider> <environment> --resource '<json>' [--connection <id>]");
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(flags.resource);
      } catch {
        return failCli("--resource must be valid JSON");
      }
      const store = new Store();
      const resource = { provider, ...parsed } as ProviderResource;
      const res = mapProviderResource(store, {
        project: flags.project,
        environment,
        provider,
        connectionId: flags.connection,
        resource,
      });
      print({ status: "ok", project: res.project.slug, environment: res.environment.name, mappingId: res.mappingId });
      return;
    }

    case "doctor": {
      const store = new Store();
      const report = doctor(store, { project: flags.project, environment: flags.env });
      if (flags.json === "true") {
        print({ status: "ok", report });
      } else {
        console.log(`${report.status.toUpperCase()} ${report.summary.pass}/${report.summary.total} checks passed`);
        for (const check of report.checks) {
          console.log(`${check.status.toUpperCase()} ${check.id}: ${check.message}`);
        }
      }
      return;
    }

    case "simulate": {
      const provider = sub as ProviderId | undefined;
      const environment = positional[1];
      const capability = positional[2] as any;
      if (!provider || !environment || !capability) {
        return failCli("Usage: dashclaw-mcp simulate <provider> <environment> <capability> [--project <p>] [--live]");
      }
      const store = new Store();
      print({
        status: "ok",
        decision: simulateAction(store, {
          project: flags.project,
          environment,
          provider,
          capability,
          live: flags.live === "true",
          resourceLabel: flags.resource,
        }),
      });
      return;
    }

    case "audit": {
      if (sub !== "export") {
        return failCli("Unknown audit subcommand. Try: export");
      }
      const format = (flags.format ?? "jsonl") as "jsonl" | "csv" | "markdown";
      const store = new Store();
      console.log(
        exportAuditLog(store, {
          project: flags.project,
          environment: flags.env,
          provider: flags.provider as ProviderId | undefined,
          limit: optionalPositiveInt(flags.limit, "--limit"),
          format,
        }),
      );
      return;
    }

    case "snapshot": {
      const format = (flags.format ?? "json") as "json" | "markdown";
      const store = new Store();
      console.log(await exportContextSnapshot(store, { project: flags.project, environment: flags.env, format }));
      return;
    }

    case "dashclaw": {
      const store = new Store();
      if (sub === "status") {
        print({ status: "ok", dashclaw: await dashclawStatus() });
      } else if (sub === "evidence") {
        print(
          exportDashclawEvidence(store, {
            project: flags.project,
            environment: flags.env,
            provider: flags.provider as ProviderId | undefined,
            limit: optionalPositiveInt(flags.limit, "--limit"),
          }),
        );
      } else {
        failCli("Unknown dashclaw subcommand. Try: status | evidence");
      }
      return;
    }

    case "context": {
      const store = new Store();
      const context = await getProjectContext(store, sub, flags.env);
      if (flags.json === "true") {
        print({ status: "ok", context });
      } else {
        // Default: print the human-readable summary (the killer view).
        console.log(context.summary);
      }
      return;
    }

    default:
      failCli(`Unknown command "${cmd}". Try: dashclaw-mcp --help`);
  }
}

main().catch((err) => {
  print({ status: "error", error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
