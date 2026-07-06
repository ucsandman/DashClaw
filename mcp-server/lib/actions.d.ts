import type { Store } from "./storage.js";
import type { ActionContext, PolicyEffect, ProviderId } from "./types.js";
/**
 * The single choke point through which every provider action must pass.
 *
 * Guarantees (from the V0 spec):
 *   - project + environment + policy are resolved BEFORE any provider call;
 *   - blocked / approval_required actions never execute;
 *   - every attempt is written to the audit log exactly once.
 *
 * Tools build an ActionContext, then call `runGuarded` with an `exec` thunk
 * that performs the real provider API call. If policy doesn't allow it, `exec`
 * is never invoked.
 */
export interface DashclawResponseMetadata {
    decision?: "allow" | "block" | "require_approval";
    decision_id?: string;
    action_id?: string;
    verification_status?: string;
    outcome_recorded?: boolean;
    error?: string;
}
export interface ApprovalRequiredResponse {
    status: "approval_required";
    policy_decision: "approval_required";
    executed: false;
    reason: string;
    project: string;
    environment: string;
    provider: ProviderId;
    action: string;
    approval_id: string;
    suggested_next_step: string;
    dashclaw?: DashclawResponseMetadata;
}
export interface BlockedResponse {
    status: "blocked";
    policy_decision: "block";
    executed: false;
    reason: string;
    project: string;
    environment: string;
    provider: ProviderId;
    action: string;
    suggested_next_step: string;
    dashclaw?: DashclawResponseMetadata;
}
export interface OkResponse {
    status: "ok";
    policy_decision: "allow";
    executed: true;
    project: string;
    environment: string;
    provider: ProviderId;
    action: string;
    mode?: string;
    reason: string;
    data: unknown;
    dashclaw?: DashclawResponseMetadata;
    /** Set when the action RAN but its audit-log write failed — the execution
     * result is truthful, the local trail is incomplete. Never silent. */
    audit_error?: string;
}
export interface ErrorResponse {
    status: "error";
    policy_decision: "allow";
    executed: true;
    project: string;
    environment: string;
    provider: ProviderId;
    action: string;
    error: string;
    dashclaw?: DashclawResponseMetadata;
    /** See OkResponse.audit_error. */
    audit_error?: string;
}
export interface PreExecutionErrorResponse {
    status: "error";
    policy_decision: PolicyEffect;
    executed: false;
    project: string;
    environment: string;
    provider: ProviderId;
    action: string;
    error: string;
    dashclaw?: DashclawResponseMetadata;
}
export type GuardedResponse = ApprovalRequiredResponse | BlockedResponse | OkResponse | ErrorResponse | PreExecutionErrorResponse;
export declare function runGuarded(store: Store, ctx: ActionContext, exec: () => Promise<unknown>): Promise<GuardedResponse>;
