/**
 * Launch-plan operations: create_launch_plan, get_launch_status,
 * preflight_launch, verify_launch.
 *
 * Plans TRACK the launch tail through the existing guarded tools — they never
 * execute provider mutations and never bypass guard/policy/approvals. Status
 * is verified, not self-reported: every step's reality check is re-evaluated
 * against provider/local state on each get_launch_status call.
 */
import { credentialEnvCandidates } from "../registration.js";
import { listEnvironments, listPendingApprovals, listProjects, listProviderMappings } from "../service.js";
import { DashclawError, nowIso } from "../util.js";
import { defaultProviderReads, evaluateRealityCheck } from "./checks.js";
import { generateSteps, validateStack } from "./playbook.js";
import { loadLaunchPlan, newLaunchId, saveLaunchPlan } from "./store.js";
import { STACK_ITEM_PROVIDER, } from "./types.js";
export { listLaunchPlans } from "./store.js";
/** Providers that need a map_provider_resource entry before launch steps run. */
const MAPPING_REQUIRED = new Set([
    "vercel",
    "neon",
    "stripe",
    "upstash",
    "cloudflare_r2",
    "sentry",
    "posthog",
    "clerk",
    "resend",
]);
export function createLaunchPlan(store, input) {
    const stack = validateStack(input.declared_stack);
    const domain = input.domain?.trim() || undefined;
    if (stack.includes("domain") && !domain) {
        throw new DashclawError('declared_stack includes "domain" — pass the `domain` to launch (e.g. "yourname.com").');
    }
    // Resolve project + environment through the same machinery every guarded
    // action uses, so a bad reference fails here, not mid-launch.
    const project = resolveProjectSlug(store, input.project);
    const environment = input.environment?.trim() || "production";
    const environments = listEnvironments(store, project);
    if (!environments.some((e) => e.name === environment)) {
        throw new DashclawError(`Environment "${environment}" not found for project "${project}" — create it first (add_environment).`);
    }
    const now = nowIso();
    const plan = {
        id: newLaunchId(),
        project,
        environment,
        declaredStack: stack,
        domain,
        steps: generateSteps(stack, { domain }),
        createdAt: now,
        updatedAt: now,
    };
    saveLaunchPlan(store.paths.home, plan);
    return plan;
}
function resolveProjectSlug(store, projectRef) {
    const projects = listProjects(store);
    if (projectRef) {
        const match = projects.find((p) => p.slug === projectRef || p.id === projectRef || p.name === projectRef);
        if (!match)
            throw new DashclawError(`Project "${projectRef}" not found — create it first (create_project).`);
        return match.slug;
    }
    const selected = projects.find((p) => p.selected) ?? (projects.length === 1 ? projects[0] : undefined);
    if (!selected) {
        throw new DashclawError("No project selected — pass `project` or run select_project first.");
    }
    return selected.slug;
}
/**
 * Load the plan, evaluate every step's reality check against provider/local
 * state, reconcile stored statuses to evaluated truth (a crashed session
 * cannot leave phantom "done" marks), persist, and report the single next
 * action.
 */
export async function getLaunchStatus(store, input, readsOverride) {
    const plan = loadLaunchPlan(store.paths.home, input.plan_id);
    const reads = readsOverride ?? defaultProviderReads(store, plan);
    const pending = listPendingApprovals(store, { status: "pending" });
    const steps = [];
    for (const step of plan.steps) {
        const evaluation = await evaluateRealityCheck(store, plan, step, reads);
        let status;
        let detail = evaluation.detail;
        if (evaluation.satisfied) {
            status = "done";
        }
        else {
            // Tool-exact matching only: an approval for create_stripe_product must
            // not mark every other stripe step blocked.
            const approval = pending.find((a) => a.tool === step.toolHint);
            if (approval) {
                status = "blocked-on-approval";
                detail = `Waiting on approval ${approval.id} (${approval.tool}): ${approval.actionSummary}`;
            }
            else if (evaluation.error) {
                status = "failed";
            }
            else {
                status = "pending";
            }
        }
        step.status = status;
        step.detail = detail;
        steps.push({
            id: step.id,
            title: step.title,
            toolHint: step.toolHint,
            provider: step.provider,
            dependsOn: step.dependsOn,
            status,
            detail,
        });
    }
    plan.updatedAt = nowIso();
    saveLaunchPlan(store.paths.home, plan);
    const counts = { pending: 0, done: 0, "blocked-on-approval": 0, failed: 0 };
    for (const step of steps)
        counts[step.status] += 1;
    const doneIds = new Set(steps.filter((s) => s.status === "done").map((s) => s.id));
    const next = steps.find((s) => s.status !== "done" && s.dependsOn.every((dep) => doneIds.has(dep))) ?? null;
    return {
        plan_id: plan.id,
        project: plan.project,
        environment: plan.environment,
        declared_stack: plan.declaredStack,
        domain: plan.domain,
        steps,
        counts,
        complete: counts.done === steps.length,
        next_action: next
            ? {
                step_id: next.id,
                title: next.title,
                tool_hint: next.toolHint,
                note: next.status === "blocked-on-approval"
                    ? `Blocked on approval — approve it (DashClaw UI or approve_action), then re-run ${next.toolHint}. ${next.detail}`
                    : next.status === "failed"
                        ? `Last reality check errored: ${next.detail}`
                        : undefined,
            }
            : null,
    };
}
function envPresent(name) {
    const value = process.env[name];
    return typeof value === "string" && value.trim().length > 0;
}
function tokenValidityRead(provider, reads) {
    switch (provider) {
        case "namecheap":
            return reads.namecheapDomains;
        case "vercel":
            return reads.vercelDeployments;
        case "neon":
            return reads.neonProjects;
        case "stripe":
            return reads.stripeProducts;
        case "resend":
            return reads.resendDomains;
        case "upstash":
            return reads.upstashRedisDatabases;
        case "cloudflare_r2":
            return reads.r2Buckets;
        case "sentry":
            return reads.sentryProjects;
        case "posthog":
            return reads.posthogProjects;
        case "clerk":
            return reads.clerkDomains;
        default:
            return undefined;
    }
}
/**
 * Before step 1: required tokens present AND valid for the declared stack
 * (cheap authenticated read per provider), mappings complete, Stripe mode
 * sanity, Namecheap client IP whitelisted. Run before any money is spent.
 */
export async function preflightLaunch(store, input, readsOverride) {
    const plan = loadLaunchPlan(store.paths.home, input.plan_id);
    const reads = readsOverride ?? defaultProviderReads(store, plan);
    const checks = [];
    const providers = [...new Set(plan.declaredStack.map((item) => STACK_ITEM_PROVIDER[item]))];
    const mappings = listProviderMappings(store, plan.project).filter((m) => m.environment === plan.environment);
    for (const provider of providers) {
        const candidates = credentialEnvCandidates(provider);
        const tokenPresent = candidates.some(envPresent);
        checks.push({
            id: `token:${provider}`,
            status: tokenPresent ? "pass" : "fail",
            message: tokenPresent
                ? `${provider} credential present.`
                : `${provider} credential missing — set ${candidates.join(" or ")}.`,
            remediation: tokenPresent ? undefined : `Set ${candidates.join(" or ")} in your MCP client's env block.`,
        });
        const mappingRequired = MAPPING_REQUIRED.has(provider);
        const mapped = mappings.some((m) => m.provider === provider);
        if (mappingRequired) {
            checks.push({
                id: `mapping:${provider}`,
                status: mapped ? "pass" : "fail",
                message: mapped
                    ? `${provider} mapping present for ${plan.environment}.`
                    : `${provider} has no mapping for ${plan.environment}.`,
                remediation: mapped ? undefined : `Run map_provider_resource for ${provider} in ${plan.environment}.`,
            });
        }
        // Token validity: a cheap authenticated read through the guarded path.
        // Skipped (not failed) when the token is absent or a required mapping is
        // missing — those already have their own failing checks above.
        const validityRead = tokenValidityRead(provider, reads);
        if (!tokenPresent || (mappingRequired && !mapped) || !validityRead) {
            checks.push({
                id: `token-validity:${provider}`,
                status: "skipped",
                message: `Skipped — ${!tokenPresent ? "credential missing" : mappingRequired && !mapped ? "mapping missing" : "no validity read available"}.`,
            });
        }
        else {
            const response = (await validityRead());
            const ok = response?.status === "ok";
            const error = response?.error ?? `read returned status ${response?.status ?? "unknown"}`;
            checks.push({
                id: `token-validity:${provider}`,
                status: ok ? "pass" : "fail",
                message: ok ? `${provider} credential accepted by the provider.` : `${provider} read failed: ${error}`,
                remediation: ok ? undefined : `Check the ${provider} token's validity and scopes.`,
            });
            // Namecheap's API requires the caller's public IP to be whitelisted —
            // error 1011102 is its signature failure.
            if (provider === "namecheap") {
                const whitelisted = ok || !/1011102|whitelist/i.test(error);
                checks.push({
                    id: "namecheap-ip-whitelist",
                    status: ok ? "pass" : whitelisted ? "skipped" : "fail",
                    message: ok
                        ? "Namecheap accepted the call — client IP is whitelisted."
                        : whitelisted
                            ? "Could not determine whitelist state (read failed for another reason)."
                            : "Namecheap rejected the client IP (error 1011102).",
                    remediation: ok
                        ? undefined
                        : "Whitelist your current public IP (curl ifconfig.me) at namecheap.com → Profile → Tools → API Access, and update NAMECHEAP_CLIENT_IP.",
                });
            }
        }
    }
    // Stripe mode sanity: production launches need the live key, everything
    // else the test key — before any money is spent or a test product ships.
    if (plan.declaredStack.includes("stripe")) {
        const environments = listEnvironments(store, plan.project);
        const env = environments.find((e) => e.name === plan.environment);
        const live = env?.kind === "production";
        const expected = live ? "STRIPE_LIVE_SECRET_KEY" : "STRIPE_TEST_SECRET_KEY";
        const present = envPresent(expected);
        checks.push({
            id: "stripe-mode",
            status: present ? "pass" : "fail",
            message: present
                ? `Stripe ${live ? "live" : "test"} key present for the ${plan.environment} launch.`
                : `${plan.environment} is ${live ? "a production" : "a non-production"} environment but ${expected} is not set.`,
            remediation: present ? undefined : `Set ${expected} (mode is determined by the key, and ${plan.environment} expects ${live ? "live" : "test"} mode).`,
        });
    }
    return {
        plan_id: plan.id,
        status: checks.some((c) => c.status === "fail") ? "fail" : "pass",
        checks,
    };
}
/**
 * After the last step: domain resolves, latest deployment READY, required env
 * vars present on the app, Stripe webhook enabled, email domain verified.
 * Reads only, audited like every other guarded read.
 */
export async function verifyLaunch(store, input, readsOverride) {
    const plan = loadLaunchPlan(store.paths.home, input.plan_id);
    const reads = readsOverride ?? defaultProviderReads(store, plan);
    const checks = [];
    if (plan.domain) {
        const probe = await reads.probeUrl(`https://${plan.domain}`);
        checks.push({
            id: "domain-resolves",
            status: probe.reachable ? "pass" : "fail",
            message: probe.detail,
            remediation: probe.reachable ? undefined : "Check DNS records (get_dns_records) and allow time to propagate.",
        });
    }
    if (plan.declaredStack.includes("vercel")) {
        const deployStep = mkStep("deployment-ready");
        const deployment = await evaluateRealityCheck(store, plan, deployStep, reads);
        checks.push({
            id: "deployment-ready",
            status: deployment.satisfied ? "pass" : "fail",
            message: deployment.detail,
            remediation: deployment.satisfied ? undefined : "Inspect the deployment (get_vercel_deployment_status, get_app_logs).",
        });
        const requiredKeys = plan.steps
            .filter((s) => s.realityCheck.kind === "env-var-present")
            .flatMap((s) => s.realityCheck.params?.keys ?? []);
        if (requiredKeys.length > 0) {
            const envStep = mkStep("env-var-present", { keys: [...new Set(requiredKeys)] });
            const env = await evaluateRealityCheck(store, plan, envStep, reads);
            checks.push({
                id: "env-vars-present",
                status: env.satisfied ? "pass" : "fail",
                message: env.detail,
                remediation: env.satisfied ? undefined : "Set the missing keys with set_app_env_vars and redeploy.",
            });
        }
    }
    if (plan.declaredStack.includes("stripe")) {
        const webhookStep = mkStep("stripe-webhook-enabled");
        const webhook = await evaluateRealityCheck(store, plan, webhookStep, reads);
        checks.push({
            id: "stripe-webhook-responding",
            status: webhook.satisfied ? "pass" : "fail",
            message: webhook.detail,
            remediation: webhook.satisfied ? undefined : "Create/enable the endpoint (create_stripe_webhook, list_stripe_webhooks).",
        });
    }
    if (plan.declaredStack.includes("resend")) {
        const emailStep = mkStep("email-domain-verified", plan.domain ? { domain: plan.domain } : undefined);
        const email = await evaluateRealityCheck(store, plan, emailStep, reads);
        checks.push({
            id: "email-domain-verified",
            status: email.satisfied ? "pass" : "fail",
            message: email.detail,
            remediation: email.satisfied ? undefined : "Set the Resend DNS records, then verify_resend_domain.",
        });
    }
    return {
        plan_id: plan.id,
        status: checks.some((c) => c.status === "fail") ? "fail" : "pass",
        checks,
    };
    function mkStep(kind, params) {
        return {
            id: `verify.${kind}`,
            title: kind,
            toolHint: "verify_launch",
            provider: "vercel",
            dependsOn: [],
            status: "pending",
            realityCheck: { kind, params },
        };
    }
}
//# sourceMappingURL=index.js.map