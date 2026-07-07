import { z } from "zod";
import * as svc from "../service.js";
function ok(data) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function fail(message) {
    return {
        content: [{ type: "text", text: JSON.stringify({ status: "error", error: message }, null, 2) }],
        isError: true,
    };
}
/** Wrap a handler so thrown errors become clean isError responses. */
function guard(fn) {
    return async (args) => {
        try {
            const result = await fn(args);
            return ok(result);
        }
        catch (err) {
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
const nonEmptyString = (description) => {
    const schema = z.string().trim().min(1);
    return description ? schema.describe(description) : schema;
};
const optionalNonEmptyString = (description) => nonEmptyString(description).optional();
const positiveInt = (description) => {
    const schema = z.number().int().positive();
    return description ? schema.describe(description) : schema;
};
export function registerTools(server, store) {
    server.registerTool("dashclaw_status", {
        title: "DashClaw status",
        description: "Check DashClaw authoritative gate configuration and reachability.",
        inputSchema: {},
    }, guard(async () => ({ status: "ok", dashclaw: await svc.dashclawStatus() })));
    server.registerTool("dashclaw_recent_decisions", {
        title: "DashClaw recent decisions",
        description: "Read recent DashClaw guard decisions scoped to project/environment when supported by DashClaw.",
        inputSchema: {
            project: optionalNonEmptyString(),
            environment: optionalNonEmptyString(),
            limit: positiveInt().optional(),
        },
    }, guard((a) => svc.dashclawRecentDecisions(store, a)));
    server.registerTool("export_dashclaw_evidence", {
        title: "Export DashClaw evidence",
        description: "Export local audit entries that include DashClaw guard/evidence metadata.",
        inputSchema: {
            project: optionalNonEmptyString(),
            environment: optionalNonEmptyString(),
            provider: provider.optional(),
            limit: positiveInt().optional(),
        },
    }, guard((a) => ({
        status: "ok",
        evidence: svc.exportDashclawEvidence(store, a),
    })));
}
//# sourceMappingURL=index.js.map