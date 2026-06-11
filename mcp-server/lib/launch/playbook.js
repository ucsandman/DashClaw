/**
 * The launch-playbook golden path (docs/launch-playbook.md) codified as data.
 * The .md stays the human reference — keep the two consistent. Some adjacent
 * playbook steps are folded into one checklist step when they share a single
 * observable end state (e.g. add_vercel_domain + set_dns_records both land as
 * "DNS points at the app").
 */
import { DashclawError } from "../util.js";
import { LAUNCH_STACK_ITEMS, STACK_ITEM_PROVIDER, } from "./types.js";
/**
 * Reality-check helper: stack items that wire app env vars verify via the
 * mapped Vercel app's env names when vercel is declared, otherwise via the
 * local provider mapping.
 */
function envOrMapping(stack, item, keys) {
    if (stack.includes("vercel"))
        return { kind: "env-var-present", params: { keys } };
    return { kind: "provider-mapped", params: { provider: STACK_ITEM_PROVIDER[item] } };
}
/** Ordered per the golden path in docs/launch-playbook.md. */
const TEMPLATES = [
    {
        id: "domain.purchase",
        title: ({ domain }) => `Purchase the domain ${domain ?? ""} (APPROVAL — always)`.trim(),
        toolHint: "purchase_domain",
        requires: ["domain"],
        dependsOn: [],
        reality: ({ domain }) => ({ kind: "domain-owned", params: { domain } }),
    },
    {
        id: "vercel.project",
        title: () => "Create the Vercel project and map it (create_vercel_project → map_provider_resource)",
        toolHint: "create_vercel_project",
        requires: ["vercel"],
        dependsOn: [],
        reality: () => ({ kind: "provider-mapped", params: { provider: "vercel" } }),
    },
    {
        id: "domain.dns",
        title: ({ domain }) => `Point ${domain ?? "the domain"} at the app (add_vercel_domain for the dnsTarget, then set_dns_records)`,
        toolHint: "set_dns_records",
        requires: ["domain", "vercel"],
        dependsOn: ["domain.purchase", "vercel.project"],
        reality: ({ domain }) => ({ kind: "dns-points-at-app", params: { domain } }),
    },
    {
        id: "neon.provision",
        title: () => "Provision the Neon Postgres database and map it",
        toolHint: "create_neon_project",
        requires: ["neon"],
        dependsOn: [],
        reality: () => ({ kind: "provider-mapped", params: { provider: "neon" } }),
    },
    {
        id: "upstash.provision",
        title: () => "Provision Upstash Redis and store its env bundle (set_app_env_vars)",
        toolHint: "create_upstash_redis_database",
        requires: ["upstash"],
        dependsOn: [],
        reality: ({ stack }) => envOrMapping(stack, "upstash", ["UPSTASH_REDIS_REST_URL"]),
    },
    {
        id: "r2.provision",
        title: () => "Create the Cloudflare R2 bucket and store its env bundle (set_app_env_vars)",
        toolHint: "create_cloudflare_r2_bucket",
        requires: ["r2"],
        dependsOn: [],
        reality: ({ stack }) => envOrMapping(stack, "r2", ["R2_BUCKET_NAME"]),
    },
    {
        id: "vercel.env",
        title: () => "Set DATABASE_URL on the app (set_app_env_vars)",
        toolHint: "set_app_env_vars",
        requires: ["vercel", "neon"],
        dependsOn: ["vercel.project", "neon.provision"],
        reality: () => ({ kind: "env-var-present", params: { keys: ["DATABASE_URL"] } }),
    },
    {
        id: "vercel.deploy",
        title: () => "Deploy the app (APPROVAL in production)",
        toolHint: "create_vercel_deployment",
        requires: ["vercel"],
        dependsOn: ["vercel.project", "vercel.env"],
        reality: () => ({ kind: "deployment-ready" }),
    },
    {
        id: "stripe.product",
        title: () => "Create the Stripe product (live mode requires approval)",
        toolHint: "create_stripe_product",
        requires: ["stripe"],
        dependsOn: [],
        reality: () => ({ kind: "stripe-product-exists" }),
    },
    {
        id: "stripe.price",
        title: () => "Create the Stripe price",
        toolHint: "create_stripe_price",
        requires: ["stripe"],
        dependsOn: ["stripe.product"],
        reality: () => ({ kind: "stripe-price-exists" }),
    },
    {
        id: "stripe.webhook",
        title: () => "Create the Stripe webhook endpoint (store the whsec_ secret immediately)",
        toolHint: "create_stripe_webhook",
        requires: ["stripe"],
        dependsOn: ["stripe.price", "vercel.deploy"],
        reality: () => ({ kind: "stripe-webhook-enabled" }),
    },
    {
        id: "stripe.webhook-secret",
        title: () => "Store STRIPE_WEBHOOK_SECRET on the app (set_app_env_vars)",
        toolHint: "set_app_env_vars",
        requires: ["stripe", "vercel"],
        dependsOn: ["stripe.webhook"],
        reality: () => ({ kind: "env-var-present", params: { keys: ["STRIPE_WEBHOOK_SECRET"] } }),
    },
    {
        id: "sentry.wire",
        title: () => "Create the Sentry project + client key and set SENTRY_DSN",
        toolHint: "create_sentry_client_key",
        requires: ["sentry"],
        dependsOn: ["vercel.project"],
        reality: ({ stack }) => envOrMapping(stack, "sentry", ["SENTRY_DSN"]),
    },
    {
        id: "posthog.wire",
        title: () => "Wire the PostHog project env (get_posthog_project_env → set_app_env_vars)",
        toolHint: "get_posthog_project_env",
        requires: ["posthog"],
        dependsOn: ["vercel.project"],
        reality: ({ stack }) => envOrMapping(stack, "posthog", ["NEXT_PUBLIC_POSTHOG_KEY"]),
    },
    {
        id: "clerk.wire",
        title: () => "Wire the Clerk app env (get_clerk_app_env → set_app_env_vars)",
        toolHint: "get_clerk_app_env",
        requires: ["clerk"],
        dependsOn: ["vercel.project"],
        reality: ({ stack }) => envOrMapping(stack, "clerk", ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"]),
    },
    {
        id: "resend.domain",
        title: ({ domain }) => `Create the Resend sending domain${domain ? ` for ${domain}` : ""} (APPROVAL in production)`,
        toolHint: "create_resend_domain",
        requires: ["resend"],
        dependsOn: ["domain.purchase"],
        reality: ({ domain }) => ({ kind: "email-domain-exists", params: { domain } }),
    },
    {
        id: "resend.verify",
        title: () => "Verify the sending domain (verify_resend_domain after its DNS records are set)",
        toolHint: "verify_resend_domain",
        requires: ["resend"],
        dependsOn: ["resend.domain", "domain.dns"],
        reality: ({ domain }) => ({ kind: "email-domain-verified", params: { domain } }),
    },
];
export function validateStack(declared) {
    if (!Array.isArray(declared) || declared.length === 0) {
        throw new DashclawError(`declared_stack must be a non-empty subset of: ${LAUNCH_STACK_ITEMS.join(", ")}.`);
    }
    const seen = new Set();
    for (const item of declared) {
        if (!LAUNCH_STACK_ITEMS.includes(item)) {
            throw new DashclawError(`Unknown stack item "${item}". Expected a subset of: ${LAUNCH_STACK_ITEMS.join(", ")}.`);
        }
        if (seen.has(item))
            throw new DashclawError(`Duplicate stack item "${item}".`);
        seen.add(item);
    }
    return declared;
}
/** Derive the ordered step checklist for a declared stack. */
export function generateSteps(stack, opts) {
    const steps = [];
    const included = new Set();
    for (const template of TEMPLATES) {
        if (!template.requires.every((item) => stack.includes(item)))
            continue;
        steps.push({
            id: template.id,
            title: template.title(opts),
            toolHint: template.toolHint,
            provider: STACK_ITEM_PROVIDER[template.requires[0]],
            dependsOn: [],
            status: "pending",
            realityCheck: template.reality({ domain: opts.domain, stack }),
        });
        included.add(template.id);
    }
    // Resolve dependencies against the steps that actually made the plan.
    for (const step of steps) {
        const template = TEMPLATES.find((t) => t.id === step.id);
        step.dependsOn = template.dependsOn.filter((dep) => included.has(dep));
    }
    return steps;
}
//# sourceMappingURL=playbook.js.map