import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Store } from "../storage.js";
import * as svc from "../service.js";
import { PROVIDER_IDS } from "../types.js";

/**
 * Registers the DashClaw-gated stdio tools on the MCP server. These two tools
 * read DashClaw status and export local evidence, gated on the same
 * DASHCLAW_URL/DASHCLAW_API_KEY
 * credentials as the governance set (see registration.ts / server.ts). Handlers
 * are thin: validate args (via Zod), call the service layer, and return the
 * result as a JSON text block. Failures are returned with isError:true and an
 * actionable message (never a raw throw across the wire).
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
const nonEmptyString = (description?: string) => {
  const schema = z.string().trim().min(1);
  return description ? schema.describe(description) : schema;
};
const optionalNonEmptyString = (description?: string) => nonEmptyString(description).optional();
const positiveInt = (description?: string) => {
  const schema = z.number().int().positive();
  return description ? schema.describe(description) : schema;
};

export function registerTools(server: McpServer, store: Store): void {
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
}
