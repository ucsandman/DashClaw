/**
 * Launch plans — first-class local objects tracking the launch tail
 * (domain → DNS → deploy → DB → Stripe → email → env wiring) through the
 * EXISTING guarded tools. Plans track; they never execute provider mutations
 * and never bypass guard/policy/approvals.
 */
import type { ProviderId } from "../types.js";
export declare const LAUNCH_STACK_ITEMS: readonly ["domain", "vercel", "neon", "stripe", "resend", "clerk", "upstash", "r2", "sentry", "posthog"];
export type LaunchStackItem = (typeof LAUNCH_STACK_ITEMS)[number];
/** Which provider credentials/mappings a declared stack item rides on. */
export declare const STACK_ITEM_PROVIDER: Record<LaunchStackItem, ProviderId>;
export type LaunchStepStatus = "pending" | "done" | "blocked-on-approval" | "failed";
export type RealityCheckKind = "domain-owned" | "dns-points-at-app" | "provider-mapped" | "stripe-product-exists" | "stripe-price-exists" | "stripe-webhook-enabled" | "env-var-present" | "deployment-ready" | "email-domain-exists" | "email-domain-verified";
export interface RealityCheck {
    kind: RealityCheckKind;
    params?: Record<string, unknown>;
}
export interface LaunchStep {
    /** Stable slug, e.g. "stripe.price". */
    id: string;
    title: string;
    /** The existing guarded tool that performs this step. */
    toolHint: string;
    provider: ProviderId;
    /** Step ids that must be done before this one is actionable. */
    dependsOn: string[];
    /** Stored status — reconciled to evaluated truth by get_launch_status. */
    status: LaunchStepStatus;
    /** Machine-evaluable read proving the step actually happened. */
    realityCheck: RealityCheck;
    /** Last evaluation detail (set by get_launch_status). */
    detail?: string;
}
export interface LaunchPlan {
    /** launch_<uuid> */
    id: string;
    /** Project slug. */
    project: string;
    /** Environment name the launch targets (default "production"). */
    environment: string;
    declaredStack: LaunchStackItem[];
    /** The domain being launched (required when "domain" is declared). */
    domain?: string;
    steps: LaunchStep[];
    createdAt: string;
    updatedAt: string;
}
export interface LaunchCheckResult {
    id: string;
    status: "pass" | "fail" | "skipped";
    message: string;
    remediation?: string;
}
