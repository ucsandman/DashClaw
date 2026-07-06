/**
 * Server composition for @dashclaw/mcp-server.
 *
 * - createServer(config): v1-compatible factory — an McpServer with the full
 *   governance tool/resource set registered unconditionally (embedding API).
 * - composeServer(server, store): the stdio entry's composition — registers
 *   the governance set only when DashClaw credentials are present, and each
 *   provider's tools only when that provider's token env var(s) are set.
 */

import { createRequire } from "node:module";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DashClawClient } from "./client.js";
import { TOOL_DEFINITIONS, createToolHandlers, type ToolInputSchema, type ToolSchemaProperty } from "./tools.js";
import { RESOURCE_DEFINITIONS, createResourceHandlers } from "./resources.js";
import { registerTools } from "./tools/index.js";
import {
  DASHCLAW_GATED_TOOLS,
  enabledProviders,
  governanceEnabled,
  governanceMisconfigured,
  providerForTool,
} from "./registration.js";
import type { Store } from "./storage.js";
import type { ProviderId } from "./types.js";

const require = createRequire(import.meta.url);
export const PACKAGE_VERSION: string = (require("../package.json") as { version: string }).version;

export interface ServerConfig {
  /** DashClaw instance URL (default: http://localhost:3000) */
  url?: string;
  /** API key (oc_live_ prefix) */
  apiKey?: string;
  /** Default agent ID for tool calls */
  agentId?: string;
}

/**
 * Convert one JSON Schema property (the subset TOOL_DEFINITIONS uses: string,
 * integer, number, boolean, enum, array-of-string/object, freeform object)
 * into the Zod type the MCP SDK's registerTool expects.
 */
function propertyToZod(prop: ToolSchemaProperty): z.ZodTypeAny {
  let schema: z.ZodTypeAny;
  if (prop.enum && prop.enum.length > 0) {
    schema = z.enum(prop.enum as [string, ...string[]]);
  } else {
    switch (prop.type) {
      case "integer":
        schema = z.number().int();
        break;
      case "number":
        schema = z.number();
        break;
      case "boolean":
        schema = z.boolean();
        break;
      case "array":
        schema = z.array(prop.items?.type === "string" ? z.string() : z.record(z.unknown()));
        break;
      case "object":
        schema = z.record(z.unknown());
        break;
      default:
        schema = z.string();
    }
  }
  return prop.description ? schema.describe(prop.description) : schema;
}

function jsonSchemaToZodShape(schema: ToolInputSchema): Record<string, z.ZodTypeAny> {
  const required = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const zodType = propertyToZod(prop);
    shape[key] = required.has(key) ? zodType : zodType.optional();
  }
  return shape;
}

/**
 * Register the full governance tool + resource set on a server, bound to one
 * DashClawClient.
 */
export function registerGovernance(server: McpServer, client: DashClawClient): void {
  const toolHandlers = createToolHandlers(client);
  for (const toolDef of TOOL_DEFINITIONS) {
    const handler = toolHandlers[toolDef.name];
    if (!handler) {
      throw new Error(`Missing handler for tool: ${toolDef.name}`);
    }

    server.registerTool(
      toolDef.name,
      {
        description: toolDef.description,
        inputSchema: jsonSchemaToZodShape(toolDef.inputSchema),
      },
      async (args: any) => {
        // The MCP SDK does NOT wrap handler exceptions; an unhandled throw
        // propagates to the entry's unhandledRejection handler and tears down
        // the entire stdio server. Catch here and surface as an MCP error
        // result so the client can recover.
        try {
          const text = await handler(args ?? {});
          return {
            content: [{ type: "text" as const, text }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
            isError: true,
          };
        }
      },
    );
  }

  const resourceHandlers = createResourceHandlers(client);
  for (const resDef of RESOURCE_DEFINITIONS) {
    const resourceHandler = resourceHandlers[resDef.uri];
    if (!resourceHandler) {
      throw new Error(`Missing handler for resource: ${resDef.uri}`);
    }

    if (resDef.isTemplate) {
      // URI template resource: dashclaw://agent/{agent_id}/history
      const template = new ResourceTemplate(resDef.uri, { list: undefined });
      server.registerResource(
        resDef.name,
        template,
        {
          description: resDef.description,
          mimeType: resDef.mimeType,
        },
        async (uri, variables) => {
          const text = await resourceHandler(variables);
          return {
            contents: [{ uri: uri.href, mimeType: resDef.mimeType, text }],
          };
        },
      );
    } else {
      // Static resource
      server.registerResource(
        resDef.name,
        resDef.uri,
        {
          description: resDef.description,
          mimeType: resDef.mimeType,
        },
        async (uri) => {
          const text = await resourceHandler();
          return {
            contents: [{ uri: uri.href, mimeType: resDef.mimeType, text }],
          };
        },
      );
    }
  }
}

/**
 * Create and configure an McpServer instance with all governance tools and
 * resources from TOOL_DEFINITIONS and RESOURCE_DEFINITIONS (v1-compatible
 * embedding API — registration is unconditional).
 */
export function createServer(config: ServerConfig = {}): { server: McpServer; client: DashClawClient } {
  const client = new DashClawClient({
    url: config.url,
    apiKey: config.apiKey,
    agentId: config.agentId,
  });

  const server = new McpServer(
    {
      name: "@dashclaw/mcp-server",
      version: PACKAGE_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  registerGovernance(server, client);
  return { server, client };
}

export interface ComposeResult {
  client: DashClawClient;
  /** Whether the governance set was registered (DASHCLAW_URL + DASHCLAW_API_KEY). */
  governance: boolean;
  /** Providers whose tools were registered (credential env present). */
  providers: ProviderId[];
}

/**
 * Conditional composition for the stdio server: governance set iff DashClaw
 * credentials are present in the environment; each provider's tools iff its
 * token env var(s) are set; local context/state tools always.
 */
export function composeServer(server: McpServer, store: Store): ComposeResult {
  const client = new DashClawClient({
    url: process.env.DASHCLAW_URL,
    apiKey: process.env.DASHCLAW_API_KEY,
    agentId: process.env.DASHCLAW_AGENT_ID,
  });

  const governance = governanceEnabled();
  if (governance) {
    registerGovernance(server, client);
  } else {
    // Half-configured = almost certainly a broken deploy, not an opt-out.
    // Say so loudly on stderr: without this the governance tools just never
    // register and the agent runs completely ungoverned in silence.
    const missing = governanceMisconfigured();
    if (missing) {
      console.error(
        `[dashclaw] WARNING: governance tools NOT registered — ${missing} is missing while its counterpart is set. ` +
        `Agents on this server are running UNGOVERNED (no dashclaw_guard/dashclaw_record). ` +
        `Set ${missing} to restore governance.`,
      );
    }
  }

  const providers = enabledProviders(store);
  const allowed = (name: string): boolean => {
    const provider = providerForTool(name);
    if (provider) return providers.includes(provider);
    if (DASHCLAW_GATED_TOOLS.has(name)) return governance;
    return true;
  };

  // registerTools only calls server.registerTool — a filtering facade is
  // enough to make registration conditional without touching the 100+ tool
  // registrations themselves.
  const filtered = {
    registerTool: (name: string, config: unknown, handler: unknown): unknown => {
      if (!allowed(name)) return undefined;
      return (server.registerTool as (...a: unknown[]) => unknown)(name, config, handler);
    },
  } as unknown as McpServer;

  registerTools(filtered, store);
  return { client, governance, providers };
}
