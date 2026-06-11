import { dashclawConfigFromEnv, dashclawFetch } from "./client.js";
import type { DashclawOutcomeInput, DashclawStatusReport } from "./types.js";

export async function dashclawStatusReport(): Promise<DashclawStatusReport> {
  let config;
  try {
    config = dashclawConfigFromEnv();
  } catch (err) {
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
    } catch {
      await dashclawFetch("/api/agents");
    }
    return { configured: true, baseUrl: config.baseUrl, mode: config.mode, reachable: true };
  } catch (err) {
    return {
      configured: true,
      baseUrl: config.baseUrl,
      mode: config.mode,
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function dashclawRecentDecisionsFetch(query: { project?: string; environment?: string; limit?: number }) {
  return dashclawFetch("/api/guard/decisions", {
    query: {
      project: query.project,
      environment: query.environment,
      limit: query.limit === undefined ? undefined : String(query.limit),
    },
  });
}

export async function recordDashclawOutcome(input: DashclawOutcomeInput): Promise<boolean> {
  await dashclawFetch(`/api/actions/${encodeURIComponent(input.actionId)}/outcome`, {
    method: "POST",
    body: {
      status: input.status,
      duration_ms: input.durationMs,
      summary: input.summary,
      metadata: input.metadata,
      error_message: input.errorMessage,
    },
  });
  return true;
}
