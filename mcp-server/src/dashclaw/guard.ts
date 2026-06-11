import { createHash } from "node:crypto";
import { evaluatePolicy } from "../policy.js";
import type { Store } from "../storage.js";
import type { ActionContext, PolicyDecision } from "../types.js";
import { newId, DashclawError } from "../util.js";
import { dashclawFetch } from "./client.js";
import type { DashclawDecision, DashclawGuardDecision, DashclawGuardPayload } from "./types.js";

export function normalizeDashclawDecision(value: unknown): DashclawDecision {
  if (value === "allow") return "allow";
  if (value === "block") return "block";
  if (value === "require_approval" || value === "approval_required") return "require_approval";
  throw new DashclawError(`Unknown DashClaw decision "${String(value)}".`);
}

export function isRiskyAction(ctx: ActionContext): boolean {
  return ctx.live === true || ctx.capability !== "read";
}

export function sqlFingerprint(sql: string): string {
  return createHash("sha256").update(sql).digest("hex").slice(0, 16);
}

function actionType(ctx: ActionContext): string {
  if (ctx.capability === "purchase") return "provider_purchase";
  if (ctx.provider === "stripe" && ctx.live && ctx.capability === "write") return "stripe_live_write";
  if (ctx.provider === "supabase" && ctx.capability === "destructive_sql") return "database_destructive_sql";
  if (ctx.provider === "supabase" && ctx.capability === "write") return "database_write";
  if (ctx.capability === "deploy") return "provider_deploy";
  if (ctx.capability === "env_change") return "provider_env_change";
  if (ctx.capability === "delete") return "provider_delete";
  if (ctx.capability === "write") return "provider_write";
  return "provider_read";
}

function riskScore(ctx: ActionContext): number {
  if (ctx.capability === "purchase") return 95;
  if (ctx.capability === "destructive_sql" || ctx.capability === "delete") return 95;
  if (ctx.live === true) return 90;
  if (ctx.capability === "deploy" && ctx.environment.isProduction) return 85;
  if (ctx.capability === "env_change" && ctx.environment.isProduction) return 85;
  if (ctx.capability === "write" && ctx.environment.isProduction) return 80;
  if (ctx.capability === "deploy" || ctx.capability === "env_change") return 65;
  if (ctx.capability === "write") return 60;
  return 20;
}

function isReversible(ctx: ActionContext): boolean {
  if (ctx.capability === "purchase") return false;
  if (ctx.capability === "destructive_sql" || ctx.capability === "delete") return false;
  if (ctx.live === true) return false;
  if (ctx.environment.isProduction && (ctx.capability === "deploy" || ctx.capability === "env_change")) return false;
  return true;
}

export function sanitizeDashclawText(value: string): string {
  return value
    .replace(
      /\b(?=[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY|ACCESS_TOKEN|DATABASE_URL))[A-Z0-9_]+\s*=\s*[^\s,;}]+/gi,
      "[redacted]",
    )
    .replace(/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/\bwhsec_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/\b(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s,;}]+/gi, "[redacted]")
    .replace(
      /\b(?=[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY|ACCESS_TOKEN|DATABASE_URL))[A-Z0-9_]+\b/gi,
      "[redacted]",
    );
}

function safeOptionalString(value: string | undefined): string | undefined {
  return value === undefined ? undefined : sanitizeDashclawText(value);
}

function systemsTouched(ctx: ActionContext): string[] {
  const resource = ctx.resourceLabel ? `${ctx.provider}:${safeOptionalString(ctx.resourceLabel)}` : ctx.provider;
  return [resource, `project:${ctx.project.slug}`, `environment:${ctx.environment.name}`];
}

export function buildDashclawGuardPayload(
  ctx: ActionContext,
  localPreview: PolicyDecision,
  auditCorrelationId: string,
): DashclawGuardPayload {
  return {
    action_type: actionType(ctx),
    declared_goal: sanitizeDashclawText(ctx.summary),
    systems_touched: systemsTouched(ctx),
    reversible: isReversible(ctx),
    risk_score: riskScore(ctx),
    metadata: {
      local_project_id: ctx.project.id,
      local_project_slug: ctx.project.slug,
      local_project_name: ctx.project.name,
      environment_id: ctx.environment.id,
      environment_name: ctx.environment.name,
      environment_kind: ctx.environment.kind,
      environment_is_production: ctx.environment.isProduction,
      provider: ctx.provider,
      capability: ctx.capability,
      tool: ctx.tool,
      resource_label: safeOptionalString(ctx.resourceLabel),
      local_policy_effect: localPreview.effect,
      local_policy_reason: sanitizeDashclawText(localPreview.reason),
      local_policy_source: localPreview.source,
      live: ctx.live === true,
      audit_correlation_id: auditCorrelationId,
    },
  };
}

export function localPolicyPreview(store: Store, ctx: ActionContext): PolicyDecision {
  return evaluatePolicy(store.data.policyRules, ctx);
}

function objectValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export async function guardWithDashclaw(
  store: Store,
  ctx: ActionContext,
  auditCorrelationId = newId("audit"),
): Promise<DashclawGuardDecision> {
  const payload = buildDashclawGuardPayload(ctx, localPolicyPreview(store, ctx), auditCorrelationId);
  const raw = await dashclawFetch<Record<string, unknown>>("/api/guard", { method: "POST", body: payload });
  const result = objectValue(raw, "result");
  const reasons = objectValue(raw, "reasons");
  const decision = normalizeDashclawDecision(objectValue(raw, "decision") ?? objectValue(raw, "status") ?? objectValue(result, "decision"));
  const firstReason = Array.isArray(reasons) ? reasons[0] : undefined;
  return {
    decision,
    reason: String(objectValue(raw, "reason") ?? firstReason ?? `DashClaw decision: ${decision}`),
    decisionId: stringValue(objectValue(raw, "decision_id")) ?? stringValue(objectValue(raw, "decisionId")),
    actionId: stringValue(objectValue(raw, "action_id")) ?? stringValue(objectValue(raw, "actionId")),
    verificationStatus: stringValue(objectValue(raw, "verification_status")) ?? stringValue(objectValue(raw, "verificationStatus")),
    signals: objectValue(raw, "signals"),
    raw,
  };
}
