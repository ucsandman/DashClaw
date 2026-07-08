import { dashclawConfigFromEnv, dashclawFetch } from "./client.js";
export async function dashclawStatusReport() {
    let config;
    try {
        config = dashclawConfigFromEnv();
    }
    catch (err) {
        return {
            configured: false,
            mode: "authoritative",
            reachable: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
    try {
        try {
            await dashclawFetch("/api/doctor");
        }
        catch {
            await dashclawFetch("/api/agents");
        }
        return { configured: true, baseUrl: config.baseUrl, mode: config.mode, reachable: true };
    }
    catch (err) {
        return {
            configured: true,
            baseUrl: config.baseUrl,
            mode: config.mode,
            reachable: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
// The platform's outcome endpoint accepts only its terminal states
// (completed | partial | failed) and rejects outcomes for actions that were
// never dispatched (blocked / pending approval) — see
// app/api/actions/[actionId]/outcome/route.ts (R10).
const WIRE_STATUS = {
    success: "completed",
    error: "failed",
    not_executed: undefined,
};
export async function recordDashclawOutcome(input) {
    const wireStatus = WIRE_STATUS[input.status];
    if (!wireStatus)
        return false;
    await dashclawFetch(`/api/actions/${encodeURIComponent(input.actionId)}/outcome`, {
        method: "POST",
        body: {
            status: wireStatus,
            duration_ms: input.durationMs,
            summary: input.summary,
            metadata: input.metadata,
            error_message: input.errorMessage,
        },
    });
    return true;
}
//# sourceMappingURL=evidence.js.map