import { dashclawConfigFromEnv, dashclawFetch } from "./client.js";
import type { DashclawStatusReport } from "./types.js";

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
