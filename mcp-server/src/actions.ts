import type { Store } from "./storage.js";
import { evaluatePolicy } from "./policy.js";
import { recordDashclawOutcome } from "./dashclaw/evidence.js";
import { guardWithDashclaw, isRiskyAction, sanitizeDashclawText } from "./dashclaw/guard.js";
import type { DashclawGuardDecision } from "./dashclaw/types.js";
import type { ActionContext, AuditResult, PendingApproval, PolicyEffect, ProviderId } from "./types.js";
import { newId, nowIso } from "./util.js";

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

export type GuardedResponse =
  | ApprovalRequiredResponse
  | BlockedResponse
  | OkResponse
  | ErrorResponse
  | PreExecutionErrorResponse;

export async function runGuarded(
  store: Store,
  ctx: ActionContext,
  exec: () => Promise<unknown>,
): Promise<GuardedResponse> {
  const decision = evaluatePolicy(store.data.policyRules, ctx);
  const base = {
    project: ctx.project.slug,
    environment: ctx.environment.name,
    provider: ctx.provider,
    action: ctx.tool,
  };

  const mode = ctx.provider === "stripe" ? ctx.resourceLabel : undefined;
  const risky = isRiskyAction(ctx);
  const auditCorrelationId = newId("audit");

  try {
    return await store.withAuditLock(async (appendAudit) => {
      let dashclawDecision: DashclawGuardDecision | undefined;

      const dashclawMeta = (): DashclawResponseMetadata | undefined =>
        dashclawDecision
          ? {
              decision: dashclawDecision.decision,
              decision_id: dashclawDecision.decisionId,
              action_id: dashclawDecision.actionId,
              verification_status: dashclawDecision.verificationStatus,
            }
          : undefined;

      function audit(result: AuditResult, errorMessage?: string): void {
        auditWithDecision(result, decision.effect, errorMessage);
      }

      function auditWithDecision(
        result: AuditResult,
        policyDecision: PolicyEffect,
        errorMessage?: string,
      ): void {
        appendAudit({
          timestamp: new Date().toISOString(),
          projectSlug: ctx.project.slug,
          environment: ctx.environment.name,
          provider: ctx.provider,
          tool: ctx.tool,
          actionSummary: ctx.summary,
          policyDecision,
          result,
          errorMessage,
          providerResource: ctx.resourceLabel,
          dashclawDecisionId: dashclawDecision?.decisionId,
          dashclawActionId: dashclawDecision?.actionId,
          auditCorrelationId,
        });
      }

      async function recordOutcome(
        status: "success" | "error" | "not_executed",
        startedAt: number,
        errorMessage?: string,
      ): Promise<boolean> {
        if (!dashclawDecision?.actionId) return false;
        return recordDashclawOutcome({
          actionId: dashclawDecision.actionId,
          status,
          durationMs: Date.now() - startedAt,
          summary: sanitizeDashclawText(ctx.summary),
          errorMessage: errorMessage ? sanitizeDashclawText(errorMessage) : undefined,
          metadata: {
            provider: ctx.provider,
            capability: ctx.capability,
            tool: ctx.tool,
            project: ctx.project.slug,
            environment: ctx.environment.name,
            resource_label: ctx.resourceLabel ? sanitizeDashclawText(ctx.resourceLabel) : undefined,
            audit_correlation_id: auditCorrelationId,
          },
        });
      }

      async function recordOutcomeSafely(
        status: "success" | "error" | "not_executed",
        startedAt: number,
        errorMessage?: string,
      ): Promise<{ outcomeRecorded?: boolean; outcomeError?: string }> {
        if (!dashclawDecision) return {};
        try {
          return { outcomeRecorded: await recordOutcome(status, startedAt, errorMessage) };
        } catch (err) {
          return { outcomeRecorded: false, outcomeError: err instanceof Error ? err.message : String(err) };
        }
      }

      const approvalMatches = (approval: PendingApproval): boolean =>
        approval.projectId === ctx.project.id &&
        approval.environmentId === ctx.environment.id &&
        approval.provider === ctx.provider &&
        approval.capability === ctx.capability &&
        approval.tool === ctx.tool &&
        approval.providerResource === ctx.resourceLabel;

      // Post-execution audit writes must never rewrite execution truth: once
      // exec() has run, a failing appendAudit (full disk, stale lock) that
      // escaped this function used to bubble to the outer catch and report
      // executed:false — inviting the caller to retry a provider action that
      // already happened. Capture the failure and surface it as audit_error
      // on an otherwise-truthful response instead.
      function auditSafely(
        result: AuditResult,
        errorMessage?: string,
      ): string | undefined {
        try {
          auditWithDecision(result, "allow", errorMessage);
          return undefined;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[dashclaw] audit write failed after execution (result=${result}): ${message}`);
          return `Audit log write failed after execution: ${message}. The execution result above is truthful, but this attempt is missing from the local audit trail.`;
        }
      }

      async function executeAllowed(reason: string): Promise<OkResponse | ErrorResponse> {
        const startedAt = Date.now();
        let data: unknown;
        try {
          data = await exec();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const auditError = auditSafely("error", message);
          const { outcomeRecorded, outcomeError } = await recordOutcomeSafely("error", startedAt, message);
          return {
            ...base,
            status: "error",
            policy_decision: "allow",
            executed: true,
            error: message,
            dashclaw: dashclawDecision ? { ...dashclawMeta(), outcome_recorded: outcomeRecorded, error: outcomeError } : undefined,
            ...(auditError ? { audit_error: auditError } : {}),
          };
        }
        // exec() succeeded — nothing past this point may claim executed:false.
        const auditError = auditSafely("success");
        const { outcomeRecorded, outcomeError } = await recordOutcomeSafely("success", startedAt);
        return {
          ...base,
          status: "ok",
          policy_decision: "allow",
          executed: true,
          mode,
          reason,
          data,
          dashclaw: dashclawDecision ? { ...dashclawMeta(), outcome_recorded: outcomeRecorded, error: outcomeError } : undefined,
          ...(auditError ? { audit_error: auditError } : {}),
        };
      }

      if (risky) {
        const startedAt = Date.now();
        try {
          dashclawDecision = await guardWithDashclaw(store, ctx, auditCorrelationId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          appendAudit({
            timestamp: new Date().toISOString(),
            projectSlug: ctx.project.slug,
            environment: ctx.environment.name,
            provider: ctx.provider,
            tool: ctx.tool,
            actionSummary: ctx.summary,
            policyDecision: decision.effect,
            result: "not_executed",
            errorMessage: `DashClaw unavailable; refusing risky action. ${message}`,
            providerResource: ctx.resourceLabel,
            dashclawError: message,
            auditCorrelationId,
          });
          return {
            ...base,
            status: "error",
            policy_decision: decision.effect,
            executed: false,
            error: `DashClaw unavailable; refusing risky action. ${message}`,
            dashclaw: { error: message },
          };
        }

        if (dashclawDecision.decision === "block") {
          auditWithDecision("not_executed", "block");
          const { outcomeRecorded, outcomeError } = await recordOutcomeSafely("not_executed", startedAt, dashclawDecision.reason);
          return {
            ...base,
            status: "blocked",
            policy_decision: "block",
            executed: false,
            reason: dashclawDecision.reason,
            suggested_next_step: "DashClaw blocked this action. Review DashClaw guard decisions before retrying.",
            dashclaw: { ...dashclawMeta(), outcome_recorded: outcomeRecorded, error: outcomeError },
          };
        }

        if (dashclawDecision.decision === "require_approval") {
          auditWithDecision("not_executed", "approval_required");
          const { outcomeRecorded, outcomeError } = await recordOutcomeSafely("not_executed", startedAt, dashclawDecision.reason);
          return {
            ...base,
            status: "approval_required",
            policy_decision: "approval_required",
            executed: false,
            approval_id: dashclawDecision.actionId ?? dashclawDecision.decisionId ?? "dashclaw",
            reason: dashclawDecision.reason,
            suggested_next_step: "DashClaw requires approval. Use DashClaw approval tooling, then rerun the original action.",
            dashclaw: { ...dashclawMeta(), outcome_recorded: outcomeRecorded, error: outcomeError },
          };
        }

        return executeAllowed(dashclawDecision.reason);
      }

      if (decision.effect === "block") {
        audit("not_executed");
        return {
          ...base,
          status: "blocked",
          policy_decision: "block",
          executed: false,
          reason: decision.reason,
          suggested_next_step:
            "This action is blocked by policy. If it is genuinely safe, add an explicit " +
            "allow rule with set_policy_rule, then retry.",
        };
      }

      if (decision.effect === "approval_required") {
        const approved = store.data.pendingApprovals.find((p) => p.status === "approved" && approvalMatches(p));
        if (approved) {
          store.update((s) => {
            const current = s.pendingApprovals.find((p) => p.id === approved.id);
            if (!current || current.status !== "approved") {
              throw new Error(`Approval request "${approved.id}" is no longer approved.`);
            }
            current.status = "used";
            current.usedAt = nowIso();
          });
          return executeAllowed(`Approved by approval request ${approved.id}.`);
        }

        let approval: PendingApproval | undefined;
        store.update((s) => {
          approval = s.pendingApprovals.find((p) => p.status === "pending" && approvalMatches(p));
          if (!approval) {
            approval = {
              id: newId("approval"),
              projectId: ctx.project.id,
              environmentId: ctx.environment.id,
              provider: ctx.provider,
              capability: ctx.capability,
              tool: ctx.tool,
              actionSummary: ctx.summary,
              reason: decision.reason,
              providerResource: ctx.resourceLabel,
              status: "pending",
              createdAt: nowIso(),
            };
            s.pendingApprovals.push(approval);
          }
        });
        audit("not_executed");
        return {
          ...base,
          status: "approval_required",
          policy_decision: "approval_required",
          executed: false,
          approval_id: approval!.id,
          reason: decision.reason,
          suggested_next_step:
            `Review this request, then call approve_action with approval_id "${approval!.id}" ` +
            "or reject_action. Approved actions must be rerun; approval never executes a provider call by itself.",
        };
      }

      return executeAllowed(decision.reason);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      status: "error",
      policy_decision: decision.effect,
      executed: false,
      error: `Audit log unavailable; refusing to execute provider action. ${message}`,
    };
  }
}
