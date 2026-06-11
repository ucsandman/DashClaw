import { evaluatePolicy } from "./policy.js";
import { recordDashclawOutcome } from "./dashclaw/evidence.js";
import { guardWithDashclaw, isRiskyAction, sanitizeDashclawText } from "./dashclaw/guard.js";
import { newId, nowIso } from "./util.js";
export async function runGuarded(store, ctx, exec) {
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
            let dashclawDecision;
            const dashclawMeta = () => dashclawDecision
                ? {
                    decision: dashclawDecision.decision,
                    decision_id: dashclawDecision.decisionId,
                    action_id: dashclawDecision.actionId,
                    verification_status: dashclawDecision.verificationStatus,
                }
                : undefined;
            function audit(result, errorMessage) {
                auditWithDecision(result, decision.effect, errorMessage);
            }
            function auditWithDecision(result, policyDecision, errorMessage) {
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
            async function recordOutcome(status, startedAt, errorMessage) {
                if (!dashclawDecision?.actionId)
                    return false;
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
            async function recordOutcomeSafely(status, startedAt, errorMessage) {
                if (!dashclawDecision)
                    return {};
                try {
                    return { outcomeRecorded: await recordOutcome(status, startedAt, errorMessage) };
                }
                catch (err) {
                    return { outcomeRecorded: false, outcomeError: err instanceof Error ? err.message : String(err) };
                }
            }
            const approvalMatches = (approval) => approval.projectId === ctx.project.id &&
                approval.environmentId === ctx.environment.id &&
                approval.provider === ctx.provider &&
                approval.capability === ctx.capability &&
                approval.tool === ctx.tool &&
                approval.providerResource === ctx.resourceLabel;
            async function executeAllowed(reason) {
                const startedAt = Date.now();
                try {
                    const data = await exec();
                    auditWithDecision("success", "allow");
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
                    };
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    auditWithDecision("error", "allow", message);
                    const { outcomeRecorded, outcomeError } = await recordOutcomeSafely("error", startedAt, message);
                    return {
                        ...base,
                        status: "error",
                        policy_decision: "allow",
                        executed: true,
                        error: message,
                        dashclaw: dashclawDecision ? { ...dashclawMeta(), outcome_recorded: outcomeRecorded, error: outcomeError } : undefined,
                    };
                }
            }
            if (risky) {
                const startedAt = Date.now();
                try {
                    dashclawDecision = await guardWithDashclaw(store, ctx, auditCorrelationId);
                }
                catch (err) {
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
                    suggested_next_step: "This action is blocked by policy. If it is genuinely safe, add an explicit " +
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
                let approval;
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
                    approval_id: approval.id,
                    reason: decision.reason,
                    suggested_next_step: `Review this request, then call approve_action with approval_id "${approval.id}" ` +
                        "or reject_action. Approved actions must be rerun; approval never executes a provider call by itself.",
                };
            }
            return executeAllowed(decision.reason);
        });
    }
    catch (err) {
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
//# sourceMappingURL=actions.js.map