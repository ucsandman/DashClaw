import { DashclawError } from "../util.js";
/**
 * Resolve a provider secret at call time. Tokens are read from the environment
 * and NEVER persisted to `.dashclaw-local/`.
 */
export function resolveToken(connection) {
    const envVar = connection.auth.envVar;
    const value = process.env[envVar];
    if (!value || value.trim().length === 0) {
        throw new DashclawError(`Environment variable ${envVar} is not set, but connection "${connection.label}" needs it.`);
    }
    return value.trim();
}
/** Read a Stripe secret key for the given mode directly from env. */
export function resolveStripeKey(mode) {
    const envVar = mode === "live" ? "STRIPE_LIVE_SECRET_KEY" : "STRIPE_TEST_SECRET_KEY";
    const value = process.env[envVar];
    if (!value || value.trim().length === 0) {
        throw new DashclawError(`Environment variable ${envVar} is not set (Stripe ${mode} mode).`);
    }
    return value.trim();
}
/** Default env var name for a provider's V0 token. */
export function defaultEnvVar(provider) {
    switch (provider) {
        case "github":
            return "GITHUB_TOKEN";
        case "vercel":
            return "VERCEL_TOKEN";
        case "supabase":
            return "SUPABASE_ACCESS_TOKEN";
        case "stripe":
            return "STRIPE_TEST_SECRET_KEY";
        case "railway":
            return "RAILWAY_TOKEN";
        case "namecheap":
            return "NAMECHEAP_API_KEY";
        case "neon":
            return "NEON_API_KEY";
        case "upstash":
            return "UPSTASH_API_KEY";
        case "cloudflare_r2":
            return "CLOUDFLARE_API_TOKEN";
        case "sentry":
            return "SENTRY_AUTH_TOKEN";
        case "posthog":
            return "POSTHOG_PERSONAL_API_KEY";
        case "resend":
            return "RESEND_API_KEY";
        case "twilio":
            return "TWILIO_AUTH_TOKEN";
        case "clerk":
            return "CLERK_SECRET_KEY";
        default:
            return `${provider.toUpperCase()}_TOKEN`;
    }
}
//# sourceMappingURL=auth.js.map