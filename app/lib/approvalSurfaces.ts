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
  after(() => fireTelegramApproval(createdAction, sql, orgId));
  after(() => fireDiscordApproval(createdAction, sql, orgId));
  after(() => fireWebhooksForApproval(orgId, 'approval_pending', {
    ...createdAction,
    matched_policies: guardDecision?.matched_policies as unknown[] | undefined,
    reason: guardDecision?.reason as string | null | undefined,
  }, sql).catch(() => {}));
}
