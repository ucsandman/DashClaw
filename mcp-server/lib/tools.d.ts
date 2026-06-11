/**
 * DashClaw MCP tool definitions and handlers.
 * Tool definitions follow JSON Schema (for both MCP registerTool and JSON-RPC).
 * Handlers are pure functions that call DashClawClient and return text content.
 *
 * This file is HAND-CURATED on purpose. Every MCP tool has a semantically
 * precise description and custom handler logic (e.g., dashclaw_wait_for_approval
 * polls until status changes) that can't be auto-generated from route metadata.
 *
 * For the live API surface, see `routes-inventory.generated.json` (regenerated
 * by `npm run livingcode:refresh`). When adding a new route that agents should
 * invoke, diff the inventory against TOOL_DEFINITIONS below to decide whether
 * a new tool wrapper is warranted.
 */
import type { DashClawClient } from "./client.js";
export interface ToolSchemaProperty {
    type?: string;
    description?: string;
    enum?: string[];
    items?: {
        type?: string;
    };
}
export interface ToolInputSchema {
    type: "object";
    properties?: Record<string, ToolSchemaProperty>;
    required?: string[];
}
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: ToolInputSchema;
}
export type ToolHandler = (input: any) => Promise<string>;
export declare const TOOL_DEFINITIONS: ToolDefinition[];
/**
 * Create tool handler functions bound to a DashClawClient instance.
 * Each handler accepts input args and returns a JSON string (MCP text content).
 */
export declare function createToolHandlers(client: DashClawClient): Record<string, ToolHandler>;
