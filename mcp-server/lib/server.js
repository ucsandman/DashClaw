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
import { TOOL_DEFINITIONS, createToolHandlers } from "./tools.js";
import { RESOURCE_DEFINITIONS, createResourceHandlers } from "./resources.js";
import { registerTools } from "./tools/index.js";
import { DASHCLAW_GATED_TOOLS, enabledProviders, governanceEnabled, providerForTool, } from "./registration.js";
const require = createRequire(import.meta.url);
export const PACKAGE_VERSION = require("../package.json").version;
/**
 * Convert one JSON Schema property (the subset TOOL_DEFINITIONS uses: string,
 * integer, number, boolean, enum, array-of-string/object, freeform object)
 * into the Zod type the MCP SDK's registerTool expects.
 */
function propertyToZod(prop) {
    let schema;
    if (prop.enum && prop.enum.length > 0) {
        schema = z.enum(prop.enum);
    }
    else {
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
function jsonSchemaToZodShape(schema) {
    const required = new Set(schema.required ?? []);
    const shape = {};
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
export function registerGovernance(server, client) {
    const toolHandlers = createToolHandlers(client);
    for (const toolDef of TOOL_DEFINITIONS) {
        const handler = toolHandlers[toolDef.name];
        if (!handler) {
            throw new Error(`Missing handler for tool: ${toolDef.name}`);
        }
        server.registerTool(toolDef.name, {
            description: toolDef.description,
            inputSchema: jsonSchemaToZodShape(toolDef.inputSchema),
        }, async (args) => {
            // The MCP SDK does NOT wrap handler exceptions; an unhandled throw
            // propagates to the entry's unhandledRejection handler and tears down
            // the entire stdio server. Catch here and surface as an MCP error
            // result so the client can recover.
            try {
                const text = await handler(args ?? {});
                return {
                    content: [{ type: "text", text }],
                };
            }
            catch (err) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
                    isError: true,
                };
            }
        });
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
            server.registerResource(resDef.name, template, {
                description: resDef.description,
                mimeType: resDef.mimeType,
            }, async (uri, variables) => {
                const text = await resourceHandler(variables);
                return {
                    contents: [{ uri: uri.href, mimeType: resDef.mimeType, text }],
                };
            });
        }
        else {
            // Static resource
            server.registerResource(resDef.name, resDef.uri, {
                description: resDef.description,
                mimeType: resDef.mimeType,
            }, async (uri) => {
                const text = await resourceHandler();
                return {
                    contents: [{ uri: uri.href, mimeType: resDef.mimeType, text }],
                };
            });
        }
    }
}
/**
 * Create and configure an McpServer instance with all governance tools and
 * resources from TOOL_DEFINITIONS and RESOURCE_DEFINITIONS (v1-compatible
 * embedding API — registration is unconditional).
 */
export function createServer(config = {}) {
    const client = new DashClawClient({
        url: config.url,
        apiKey: config.apiKey,
        agentId: config.agentId,
    });
    const server = new McpServer({
        name: "@dashclaw/mcp-server",
        version: PACKAGE_VERSION,
    }, {
        capabilities: {
            tools: {},
            resources: {},
        },
    });
    registerGovernance(server, client);
    return { server, client };
}
/**
 * Conditional composition for the stdio server: governance set iff DashClaw
 * credentials are present in the environment; each provider's tools iff its
 * token env var(s) are set; local context/state tools always.
 */
export function composeServer(server, store) {
    const client = new DashClawClient({
        url: process.env.DASHCLAW_URL,
        apiKey: process.env.DASHCLAW_API_KEY,
        agentId: process.env.DASHCLAW_AGENT_ID,
    });
    const governance = governanceEnabled();
    if (governance) {
        registerGovernance(server, client);
    }
    const providers = enabledProviders(store);
    const allowed = (name) => {
        const provider = providerForTool(name);
        if (provider)
            return providers.includes(provider);
        if (DASHCLAW_GATED_TOOLS.has(name))
            return governance;
        return true;
    };
    // registerTools only calls server.registerTool — a filtering facade is
    // enough to make registration conditional without touching the 100+ tool
    // registrations themselves.
    const filtered = {
        registerTool: (name, config, handler) => {
            if (!allowed(name))
                return undefined;
            return server.registerTool(name, config, handler);
        },
    };
    registerTools(filtered, store);
    return { client, governance, providers };
}
//# sourceMappingURL=server.js.map