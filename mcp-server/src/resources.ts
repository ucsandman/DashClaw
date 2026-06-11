/**
 * DashClaw MCP resource definitions and handlers.
 * Resources provide read-only governance context.
 */

import type { DashClawClient } from "./client.js";

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  isTemplate?: boolean;
}

export type ResourceHandler = (variables?: any) => Promise<string>;

export const RESOURCE_DEFINITIONS: ResourceDefinition[] = [
  {
    uri: "dashclaw://policies",
    name: "DashClaw Policies",
    description: "Current active governance policy set for the organization.",
    mimeType: "application/json",
  },
  {
    uri: "dashclaw://capabilities",
    name: "DashClaw Capabilities",
    description: "Available capabilities and their health status.",
    mimeType: "application/json",
  },
  {
    uri: "dashclaw://agent/{agent_id}/history",
    name: "Agent Action History",
    description: "Recent action history for a specific agent (last 50 records).",
    mimeType: "application/json",
    isTemplate: true,
  },
  {
    uri: "dashclaw://status",
    name: "DashClaw Status",
    description: "Instance health and operational summary metrics.",
    mimeType: "application/json",
  },
  {
    uri: "dashclaw://code-sessions/projects",
    name: "Code Sessions Projects",
    description: "All Claude Code projects with ingested session data plus per-project rollups.",
    mimeType: "application/json",
  },
  {
    uri: "dashclaw://code-sessions/sessions/{session_id}",
    name: "Code Session Detail",
    description: "Full detail for one ingested Code Session: session row, messages, tool uses.",
    mimeType: "application/json",
    isTemplate: true,
  },
];

/**
 * Create resource handler functions bound to a DashClawClient instance.
 * Each handler returns a JSON string of the resource content.
 */
export function createResourceHandlers(client: DashClawClient): Record<string, ResourceHandler> {
  return {
    "dashclaw://policies": async () => {
      const result = await client.get("/api/policies", {}, { timeout: 10000 });
      return JSON.stringify(result);
    },

    "dashclaw://capabilities": async () => {
      const result = await client.get("/api/capabilities", {}, { timeout: 10000 });
      return JSON.stringify(result);
    },

    "dashclaw://agent/{agent_id}/history": async ({ agent_id }: any) => {
      const result = await client.get("/api/actions", {
        agent_id,
        limit: "50",
      }, { timeout: 10000 });
      return JSON.stringify(result);
    },

    "dashclaw://status": async () => {
      const [health, operations] = await Promise.all([
        client.get("/api/health", {}, { timeout: 10000 }),
        client.get("/api/operations/summary", {}, { timeout: 10000 }),
      ]);
      return JSON.stringify({ health, operations });
    },

    "dashclaw://code-sessions/projects": async () => {
      const result = await client.get("/api/code-sessions/projects", {}, { timeout: 15000 });
      return JSON.stringify(result);
    },

    "dashclaw://code-sessions/sessions/{session_id}": async ({ session_id }: any) => {
      const result = await client.get(`/api/code-sessions/sessions/${encodeURIComponent(session_id)}`,
        {}, { timeout: 15000 });
      return JSON.stringify(result);
    },
  };
}
