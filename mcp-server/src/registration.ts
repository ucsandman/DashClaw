/**
 * Conditional tool registration: which tool sets the stdio server exposes is
 * decided at startup by credential presence.
 *
 * - Governance tools/resources (dashclaw_* from src/tools.ts) register only
 *   when DASHCLAW_URL and DASHCLAW_API_KEY are both set.
 * - The three DashClaw-gated stdio tools (src/tools/index.ts) talk to the
 *   DashClaw API via env config and gate on the same credentials.
 */

/**
 * DashClaw-gated tools: they read the DashClaw API via env config (not the
 * governance client) and are useless without DASHCLAW_URL/DASHCLAW_API_KEY, so
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

/** Governance set registers only when both DashClaw credentials are set. */
export function governanceEnabled(): boolean {
  return envPresent("DASHCLAW_URL") && envPresent("DASHCLAW_API_KEY");
}

/**
 * Half-configured governance is almost always a mistake (dropped env var,
 * typo, secret-manager hiccup) — and its failure mode is the worst kind:
 * the governance tools silently never register, so the agent proceeds with
 * zero guard/record calls and nothing in-band says so. Returns the missing
 * var name when exactly one of the pair is set, else null. Fully-unset stays
 * silent by design (someone who never opted in shouldn't see noise).
 */
export function governanceMisconfigured(): string | null {
  const hasUrl = envPresent("DASHCLAW_URL");
  const hasKey = envPresent("DASHCLAW_API_KEY");
  if (hasUrl && !hasKey) return "DASHCLAW_API_KEY";
  if (!hasUrl && hasKey) return "DASHCLAW_URL";
  return null;
}
