/**
 * Launch-plan operations: create_launch_plan, get_launch_status,
 * preflight_launch, verify_launch.
 *
 * Plans TRACK the launch tail through the existing guarded tools — they never
 * execute provider mutations and never bypass guard/policy/approvals. Status
 * is verified, not self-reported: every step's reality check is re-evaluated
 * against provider/local state on each get_launch_status call.
 */
import type { Store } from "../storage.js";
import type { ProviderId } from "../types.js";
import { type ProviderReads } from "./checks.js";
import { type LaunchCheckResult, type LaunchPlan, type LaunchStackItem, type LaunchStepStatus } from "./types.js";
export { listLaunchPlans } from "./store.js";
export interface CreateLaunchPlanInput {
    project?: string;
    environment?: string;
    declared_stack: string[];
    domain?: string;
}
export declare function createLaunchPlan(store: Store, input: CreateLaunchPlanInput): LaunchPlan;
export interface LaunchStatusStep {
    id: string;
    title: string;
    toolHint: string;
    provider: ProviderId;
    dependsOn: string[];
    status: LaunchStepStatus;
    detail: string;
}
export interface LaunchStatus {
    plan_id: string;
    project: string;
    environment: string;
    declared_stack: LaunchStackItem[];
    domain?: string;
    steps: LaunchStatusStep[];
    counts: Record<LaunchStepStatus, number>;
    complete: boolean;
    next_action: {
        step_id: string;
        title: string;
        tool_hint: string;
        note?: string;
    } | null;
}
/**
 * Load the plan, evaluate every step's reality check against provider/local
 * state, reconcile stored statuses to evaluated truth (a crashed session
 * cannot leave phantom "done" marks), persist, and report the single next
 * action.
 */
export declare function getLaunchStatus(store: Store, input: {
    plan_id: string;
}, readsOverride?: ProviderReads): Promise<LaunchStatus>;
export interface PreflightResult {
    plan_id: string;
    status: "pass" | "fail";
    checks: LaunchCheckResult[];
}
/**
 * Before step 1: required tokens present AND valid for the declared stack
 * (cheap authenticated read per provider), mappings complete, Stripe mode
 * sanity, Namecheap client IP whitelisted. Run before any money is spent.
 */
export declare function preflightLaunch(store: Store, input: {
    plan_id: string;
}, readsOverride?: ProviderReads): Promise<PreflightResult>;
export interface VerifyResult {
    plan_id: string;
    status: "pass" | "fail";
    checks: LaunchCheckResult[];
}
/**
 * After the last step: domain resolves, latest deployment READY, required env
 * vars present on the app, Stripe webhook enabled, email domain verified.
 * Reads only, audited like every other guarded read.
 */
export declare function verifyLaunch(store: Store, input: {
    plan_id: string;
}, readsOverride?: ProviderReads): Promise<VerifyResult>;
