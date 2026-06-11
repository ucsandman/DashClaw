/**
 * Launch plans — first-class local objects tracking the launch tail
 * (domain → DNS → deploy → DB → Stripe → email → env wiring) through the
 * EXISTING guarded tools. Plans track; they never execute provider mutations
 * and never bypass guard/policy/approvals.
 */
export const LAUNCH_STACK_ITEMS = [
    "domain",
    "vercel",
    "neon",
    "stripe",
    "resend",
    "clerk",
    "upstash",
    "r2",
    "sentry",
    "posthog",
];
/** Which provider credentials/mappings a declared stack item rides on. */
export const STACK_ITEM_PROVIDER = {
    domain: "namecheap",
    vercel: "vercel",
    neon: "neon",
    stripe: "stripe",
    resend: "resend",
    clerk: "clerk",
    upstash: "upstash",
    r2: "cloudflare_r2",
    sentry: "sentry",
    posthog: "posthog",
};
//# sourceMappingURL=types.js.map