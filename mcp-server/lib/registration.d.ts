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
import { type ProviderId } from "./types.js";
import type { Store } from "./storage.js";
/**
 * Local tools that talk to the DashClaw API via env config (not the
 * governance client) — useless without DASHCLAW_URL/DASHCLAW_API_KEY, so
 * they gate on the same credentials as the governance set.
 */
export declare const DASHCLAW_GATED_TOOLS: ReadonlySet<string>;
/** Env vars that can credential a provider — ANY one present enables it. */
export declare function credentialEnvCandidates(provider: ProviderId): string[];
export declare function providerEnabled(provider: ProviderId, store?: Store): boolean;
export declare function enabledProviders(store?: Store): ProviderId[];
/** Classify a tool name to its provider, or undefined for local tools. */
export declare function providerForTool(name: string): ProviderId | undefined;
/** Governance set registers only when both DashClaw credentials are set. */
export declare function governanceEnabled(): boolean;
