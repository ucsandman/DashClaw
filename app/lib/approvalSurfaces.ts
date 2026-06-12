import { after } from 'next/server';
import { fireTelegramApproval } from './telegramApprovals';
import { fireDiscordApproval } from './discordApprovals';
import { fireWebhooksForApproval } from './webhooks';
import type { SqlTag } from './types/db';

/** The minimal shape this module reads off a created action record. */
interface CreatedAction {
  status?: string;
  [key: string]: unknown;
}

/** Guard decision fields surfaced to operators. Loosely typed at this boundary. */
interface GuardDecisionLike {
  matched_policies?: unknown;
  reason?: unknown;
  [key: string]: unknown;
}

/**
 * Fire the operator approval surfaces (Telegram, Discord, outbound webhook) for a
 * newly-created `pending_approval` action. Mirrors the inline firing in
 * POST /api/actions so every path that creates a pending_approval record notifies
 * operators the same way.
 *
 * Fire-and-forget via `after()` so the HTTP response is never blocked (Vercel
 * freezes the lambda once the response returns unless `after()` is used); each
 * surface no-ops when its channel is unconfigured.
 *
 * Human-facing prompts (Telegram, Discord) go through the interruption budget —
 * suppressed when a matched policy or the fleet has tripped its flood threshold.
 * Machine-facing webhooks are never suppressed.
 *
 * @param createdAction  the action record returned by createActionRecord
 * @param sql            the Neon sql tag
 * @param orgId
 * @param guardDecision  the guard decision (for matched_policies/reason)
 */
export function fireApprovalSurfaces(
  createdAction: CreatedAction | null | undefined,
  sql: SqlTag,
  orgId: string,
  guardDecision: GuardDecisionLike | null = null,
): void {
  if (!createdAction || createdAction.status !== 'pending_approval') return;

  // Human-facing prompts go through the interruption budget. Fail-open: any
  // flood-check error falls back to today's per-action behavior.
  after(async () => {
    let suppress = false;
    try {
      const { evaluateApprovalFlood, notifyNewFloods, matchedPolicyIds, getInterruptBudget } = await import('./approval-flood');
      const flood = await evaluateApprovalFlood(sql, orgId);
      if (flood.newlyTripped.length) {
        const budget = await getInterruptBudget(sql, orgId);
        await notifyNewFloods(sql, orgId, flood.newlyTripped, budget.windowMin);
      }
      const matched = matchedPolicyIds(guardDecision);
      suppress = flood.fleetTripped || matched.some((id) => flood.suppressed.has(id));
    } catch (err) {
      console.warn('[approval-flood] check failed — keeping per-action prompts:', (err as Error)?.message);
    }
    if (!suppress) {
      await Promise.allSettled([
        fireTelegramApproval(createdAction, sql, orgId),
        fireDiscordApproval(createdAction, sql, orgId),
      ]);
    }
  });

  after(() => fireWebhooksForApproval(orgId, 'approval_pending', {
    ...createdAction,
    matched_policies: guardDecision?.matched_policies as unknown[] | undefined,
    reason: guardDecision?.reason as string | null | undefined,
  }, sql).catch(() => {}));
}
