/**
 * Reality checks, preflight checks, and verify checks for launch plans.
 *
 * Everything here is a READ. The default ProviderReads implementation goes
 * through the guarded provider-action layer (policy applies, every read is
 * audited); tests inject fakes. Launch tooling never mutates providers.
 */
import type { GuardedResponse } from "../actions.js";
import type { Store } from "../storage.js";
import type { LaunchPlan, LaunchStep } from "./types.js";
export interface ProbeResult {
    reachable: boolean;
    detail: string;
}
/** The read surface reality/preflight/verify checks evaluate against. */
export interface ProviderReads {
    namecheapDomains(): Promise<GuardedResponse>;
    dnsRecords(domain: string): Promise<GuardedResponse>;
    vercelDeployments(): Promise<GuardedResponse>;
    vercelEnvVarNames(): Promise<GuardedResponse>;
    stripeProducts(): Promise<GuardedResponse>;
    stripePrices(): Promise<GuardedResponse>;
    stripeWebhooks(): Promise<GuardedResponse>;
    resendDomains(): Promise<GuardedResponse>;
    neonProjects(): Promise<GuardedResponse>;
    upstashRedisDatabases(): Promise<GuardedResponse>;
    r2Buckets(): Promise<GuardedResponse>;
    sentryProjects(): Promise<GuardedResponse>;
    posthogProjects(): Promise<GuardedResponse>;
    clerkDomains(): Promise<GuardedResponse>;
    /** HTTP(S) reachability probe — any HTTP response counts as reachable. */
    probeUrl(url: string): Promise<ProbeResult>;
}
/**
 * Guarded reads bound to one plan's project + environment. Each distinct read
 * runs at most once per ProviderReads instance (a status evaluation touches
 * several steps that share the same provider read).
 */
export declare function defaultProviderReads(store: Store, plan: Pick<LaunchPlan, "project" | "environment">): ProviderReads;
export interface RealityEvaluation {
    satisfied: boolean;
    /** True when the read itself failed (token/mapping/provider error). */
    error: boolean;
    detail: string;
}
/** Evaluate one step's reality check against provider/local state. */
export declare function evaluateRealityCheck(store: Store, plan: LaunchPlan, step: LaunchStep, reads: ProviderReads): Promise<RealityEvaluation>;
