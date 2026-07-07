/**
 * DashClaw MCP resource definitions and handlers.
 * Resources provide read-only governance context.
 */
export const RESOURCE_DEFINITIONS = [
    {
        uri: "dashclaw://policies",
        name: "DashClaw Policies",
        description: "Current active governance policy set for the organization.",
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
];
/**
 * Create resource handler functions bound to a DashClawClient instance.
 * Each handler returns a JSON string of the resource content.
 */
export function createResourceHandlers(client) {
    return {
        "dashclaw://policies": async () => {
            const result = await client.get("/api/policies", {}, { timeout: 10000 });
            return JSON.stringify(result);
        },
        "dashclaw://agent/{agent_id}/history": async ({ agent_id }) => {
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
    };
}
//# sourceMappingURL=resources.js.map