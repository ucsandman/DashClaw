/**
 * Conditional tool registration: which tool sets the stdio server exposes is
 * decided at startup by credential presence.
 *
 * - Governance tools/resources (dashclaw_* from src/tools.ts) register only
 *   when DASHCLAW_URL and DASHCLAW_API_KEY are both set.
 * - Provider tools register only when that provider's credential env var(s)
 *   are present (default names from providers/auth.ts, or any stored
 *   connection's custom env var).
 * - Local context/state tools (projects, policy, doctor, audit, memory)
 *   always register — they need no credentials.
 */

import { PROVIDER_IDS, type ProviderId } from "./types.js";
import { defaultEnvVar } from "./providers/auth.js";
import { listConnections } from "./service.js";
import type { Store } from "./storage.js";

/**
 * Provider-scoped tools whose names don't contain the provider id.
 * Everything else is classified by the provider slug in the tool name.
 */
const TOOL_PROVIDER_OVERRIDES: Record<string, ProviderId> = {
  check_domain_availability: "namecheap",
  purchase_domain: "namecheap",
  get_dns_records: "namecheap",
  set_dns_records: "namecheap",
};

/**
 * Local tools that talk to the DashClaw API via env config (not the
 * governance client) — useless without DASHCLAW_URL/DASHCLAW_API_KEY, so
 * they gate on the same credentials as the governance set.
 */
export const DASHCLAW_GATED_TOOLS: ReadonlySet<string> = new Set([
  "dashclaw_status",
  "dashclaw_recent_decisions",
  "export_dashclaw_evidence",
]);

function envPresent(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

/** Env vars that can credential a provider — ANY one present enables it. */
export function credentialEnvCandidates(provider: ProviderId): string[] {
  if (provider === "stripe") return ["STRIPE_TEST_SECRET_KEY", "STRIPE_LIVE_SECRET_KEY"];
  return [defaultEnvVar(provider)];
}

export function providerEnabled(provider: ProviderId, store?: Store): boolean {
  if (credentialEnvCandidates(provider).some(envPresent)) return true;
  if (store) {
    return listConnections(store).some(
      (connection) => connection.provider === provider && envPresent(connection.auth.envVar),
    );
  }
  return false;
}

export function enabledProviders(store?: Store): ProviderId[] {
  return PROVIDER_IDS.filter((provider) => providerEnabled(provider, store));
}

/** Classify a tool name to its provider, or undefined for local tools. */
export function providerForTool(name: string): ProviderId | undefined {
  const override = TOOL_PROVIDER_OVERRIDES[name];
  if (override) return override;
  return PROVIDER_IDS.find((provider) => name.includes(provider));
}

/** Governance set registers only when both DashClaw credentials are set. */
export function governanceEnabled(): boolean {
  return envPresent("DASHCLAW_URL") && envPresent("DASHCLAW_API_KEY");
}
