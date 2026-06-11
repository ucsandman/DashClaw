import type { ProviderConnection } from "../types.js";
/**
 * Resolve a provider secret at call time. Tokens are read from the environment
 * and NEVER persisted to `.dashclaw-local/`.
 */
export declare function resolveToken(connection: ProviderConnection): string;
/** Read a Stripe secret key for the given mode directly from env. */
export declare function resolveStripeKey(mode: "test" | "live"): string;
/** Default env var name for a provider's V0 token. */
export declare function defaultEnvVar(provider: string): string;
