/**
 * Core domain types for DashClaw V0.
 *
 * These types are intentionally explicit about project + environment + provider
 * scoping. The whole point of DashClaw is that an AI agent must always know
 * *which* project and environment and provider account it is operating against
 * before it touches a real provider API.
 *
 * Provider credentials are read from environment variables at call time and are
 * never persisted to disk (see ProviderConnection.auth).
 */
export const PROVIDER_IDS = [
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
];
//# sourceMappingURL=types.js.map