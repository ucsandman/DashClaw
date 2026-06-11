import type {
  ActionContext,
  Capability,
  PolicyDecision,
  PolicyEffect,
  PolicyRule,
} from "./types.js";

/**
 * The policy engine is the safety core. It reasons about
 *   capability × environment kind × provider × live-flag
 * rather than about individual tool names, so any new tool inherits safe
 * defaults automatically.
 *
 * Evaluation order:
 *   1. Explicit user rules — the highest-priority matching rule wins. This is
 *      how a user opts INTO something the defaults forbid (e.g. "allow live
 *      Stripe writes for this project"), or tightens something further.
 *   2. Built-in defaults (see `defaultDecision`).
 *
 * Defaults (from the V0 spec):
 *   - reads: allowed everywhere
 *   - dev/staging writes: allowed (unless destructive/delete)
 *   - production reads: allowed
 *   - production writes / deploys / env-var changes: approval_required
 *   - live Stripe (or any `live` action) writes: approval_required
 *   - destructive SQL: blocked everywhere
 *   - deleting resources: blocked everywhere
 */

export function defaultDecision(ctx: ActionContext): PolicyDecision {
  const { capability, environment, live, provider } = ctx;
  const isProd = environment.isProduction;

  // Hard blocks first — these are never allowed without an explicit override.
  if (capability === "destructive_sql") {
    return {
      effect: "block",
      reason:
        "Destructive SQL (DROP/TRUNCATE/DELETE/ALTER and similar) is blocked everywhere by default.",
      source: "default:destructive_sql",
    };
  }
  if (capability === "delete") {
    return {
      effect: "block",
      reason: "Deleting resources is blocked everywhere by default.",
      source: "default:delete",
    };
  }

  // Purchases spend real money and require a human in every environment kind.
  if (capability === "purchase") {
    return {
      effect: "approval_required",
      reason: "Purchases spend real money and always require approval.",
      source: "default:purchase",
    };
  }

  // Reads are always safe.
  if (capability === "read") {
    return { effect: "allow", reason: "Read-only action.", source: "default:read" };
  }

  // A "live" write (e.g. Stripe live mode) requires approval regardless of env.
  // (read/delete/destructive_sql already returned above, so this is a mutation.)
  if (live) {
    return {
      effect: "approval_required",
      reason: `Live/irreversible ${provider} write requires approval by default.`,
      source: "default:live_write",
    };
  }

  // Mutations in production require approval.
  if (isProd) {
    const what =
      capability === "deploy"
        ? "Production deploys"
        : capability === "env_change"
          ? "Production environment-variable changes"
          : "Production writes";
    return {
      effect: "approval_required",
      reason: `${what} require approval by default.`,
      source: "default:production_write",
    };
  }

  // Non-production writes/deploys/env-changes are allowed.
  return {
    effect: "allow",
    reason: `Non-production ${capability} is allowed by default.`,
    source: "default:nonprod_write",
  };
}

function ruleMatches(rule: PolicyRule, ctx: ActionContext): boolean {
  const m = rule.match;
  if (m.projectId && m.projectId !== ctx.project.id) return false;
  if (m.environmentId && m.environmentId !== ctx.environment.id) return false;
  if (m.environmentKind && m.environmentKind !== ctx.environment.kind) return false;
  if (m.provider && m.provider !== ctx.provider) return false;
  if (m.capability && m.capability !== ctx.capability) return false;
  return true;
}

export function evaluatePolicy(rules: readonly PolicyRule[], ctx: ActionContext): PolicyDecision {
  const matching = rules
    .filter((r) => ruleMatches(r, ctx))
    .sort((a, b) => b.priority - a.priority);

  const resolved: PolicyDecision =
    matching.length > 0
      ? {
          effect: matching[0]!.effect,
          reason:
            matching[0]!.description ??
            `Matched explicit policy rule ${matching[0]!.id} (effect=${matching[0]!.effect}).`,
          source: `rule:${matching[0]!.id}`,
        }
      : defaultDecision(ctx);

  // Invariant: purchase can never resolve below approval_required, even when an
  // explicit allow rule matches. (Block rules still block — stricter is fine.)
  if (ctx.capability === "purchase" && resolved.effect === "allow") {
    return {
      effect: "approval_required",
      reason: "Purchases always require approval; the matching allow rule was clamped.",
      source: "clamp:purchase",
    };
  }

  return resolved;
}

/** Human-readable capability label for messages. */
export function capabilityLabel(c: Capability): string {
  switch (c) {
    case "read":
      return "read";
    case "write":
      return "write";
    case "deploy":
      return "deploy";
    case "env_change":
      return "environment-variable change";
    case "delete":
      return "delete";
    case "destructive_sql":
      return "destructive SQL";
    case "purchase":
      return "purchase";
  }
}

export function effectIsExecutable(effect: PolicyEffect): boolean {
  return effect === "allow";
}
