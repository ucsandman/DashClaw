/**
 * Telegram approval bridge — fires an interactive approval message to a
 * configured Telegram admin chat when an action enters pending_approval.
 * Mirrors actionAlerts.js — always fire-and-forget, never throws.
 */

import { recordSentApprovalNotification } from './approvalNotifications';
import { describeAction, plainNotificationLines } from './plain-language';
import type { SqlTag } from './types/db';

interface ApprovalAction {
  action_id?: string | null;
  agent_id?: string | null;
  action_type?: string | null;
  declared_goal?: string | null;
  risk_score?: number | null;
  reversible?: boolean | null;
  status?: string | null;
}

interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

interface TelegramReplyMarkup {
  inline_keyboard: TelegramInlineButton[][];
}

interface TelegramMessage {
  text: string;
  reply_markup: TelegramReplyMarkup;
}

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const FETCH_TIMEOUT_MS = 1500;

/**
 * Telegram's hard limit on `text`. Exceeding it is a 400, and sendMessage
 * only warns and returns — so the operator gets NO approval message and the
 * sent-message id is never recorded, which also breaks cross-channel
 * clearing. Every other length in this file is derived from this one by
 * subtraction rather than guessed, because a guessed reserve is what let a
 * 6843-character message reach the API (2026-08-11 pre-merge review).
 */
const TELEGRAM_TEXT_LIMIT = 4096;

/**
 * Fit the goal into `budget` characters, saying so honestly when it cuts —
 * an invisible truncation once made a real command unjudgeable (field report
 * 2026-08-07). Room for the note is reserved using the FULL length's digit
 * count, which is never shorter than the remainder's, so the result always
 * fits the budget it was given.
 */
function fitGoal(goal: string, budget: number): string {
  if (goal.length <= budget) return goal;
  const note = (n: number) => `\n… (+${n} more chars — open the action link for the rest)`;
  const keep = Math.max(0, budget - note(goal.length).length);
  return `${goal.slice(0, keep)}${note(goal.length - keep)}`;
}

function isEnabled(): boolean {
  if (!process.env.TELEGRAM_BOT_TOKEN) return false;
  if (!process.env.TELEGRAM_ADMIN_CHAT_ID) return false;
  if (process.env.DASHCLAW_ALERTS_TELEGRAM === 'false') return false;
  return true;
}

/** Exported for unit testing (plain-language-review-regressions.test.js). */
export function buildTelegramMessage(action: ApprovalAction): TelegramMessage {
  const risk = action.risk_score ?? 0;
  const reversible = action.reversible === false ? 'irreversible' : 'reversible';
  const fullGoal = action.declared_goal || '—';

  // Same describeAction() the /approvals card and the decision detail page
  // read — one sentence, everywhere. No guard-decision intel is available at
  // this call site, so the translator degrades honestly (see
  // plain-language/index.ts). Built from the untruncated declared_goal and
  // rendered as its own lines, so the goal budget below — which only ever
  // applies to `goal` — can never cut the sentence off (field report
  // 2026-08-07 was exactly this kind of invisible truncation).
  const plain = describeAction({
    action_type: action.action_type,
    declared_goal: action.declared_goal,
    risk_score: action.risk_score,
  });
  // The warnings travel with the sentence. Telegram is where the operator
  // usually is, and it used to show "Overwrites the shared code history on
  // GitHub" with no mention that other people's work can be lost.
  const plainLines = plainNotificationLines(plain);

  // Plain sentence first, exact command second — same order as the
  // /approvals card and the detail page. Silent when the translator has no
  // confident read, so the message is byte-identical to today's.
  const head = [
    '⏳ DashClaw approval needed',
    '',
    `Agent:   ${action.agent_id || 'unknown'}`,
    `Action:  ${action.action_type || 'unknown'}`,
    `Risk:    ${risk} • ${reversible}`,
    '',
    ...(plainLines.length > 0 ? [...plainLines, ''] : []),
  ];
  const tail = ['', action.action_id || ''];

  // Show the operator as much of the goal as the message can carry: compose
  // everything else first, then hand the remainder to the goal. Measuring
  // beats reserving — a fixed 3500-char goal cap was safe only while the
  // sentence above it was short, and a 120-stage chain (headline 5034 chars)
  // pushed a 1562-char goal to a 6843-char message that Telegram rejected
  // outright. plainNotificationLines bounds `head`, so the budget is always
  // positive.
  const overhead = [...head, 'Goal: ', ...tail].join('\n').length;
  const goal = fitGoal(fullGoal, Math.max(0, TELEGRAM_TEXT_LIMIT - overhead));

  const text = [...head, `Goal: ${goal}`, ...tail].join('\n');

  const reply_markup: TelegramReplyMarkup = {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `ap:${action.action_id}` },
      { text: '❌ Reject',  callback_data: `dn:${action.action_id}` },
    ]],
  };

  return { text, reply_markup };
}

async function sendApprovalMessage(action: ApprovalAction, sql?: SqlTag, orgId?: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat_id = process.env.TELEGRAM_ADMIN_CHAT_ID;
  const payload = buildTelegramMessage(action);

  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, ...payload }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    console.warn(`[TelegramApprovals] sendMessage returned ${res.status}`);
    return;
  }

  // Capture the sent message id so a resolution in ANOTHER channel/surface can
  // edit this message to a resolved state ("clears everywhere"). Best-effort.
  if (sql && orgId && action.action_id && chat_id) {
    try {
      const data = await res.json();
      const messageId = data?.result?.message_id;
      if (messageId != null) {
        await recordSentApprovalNotification(sql, {
          orgId,
          actionId: action.action_id,
          channel: 'telegram',
          messageId: String(messageId),
          channelRef: chat_id,
        });
      }
    } catch {
      // response parse / record is best-effort
    }
  }
}

/**
 * Fire a Telegram approval message for a pending_approval action.
 * Returns a promise so callers can hand it to after() or await it — never
 * rejects (errors are logged and swallowed).
 * @param action - the action record
 * @param sql - db handle; when provided, the sent message id is recorded for cross-channel clearing
 * @param orgId - org id for the recorded notification
 */
export async function fireTelegramApproval(
  action: ApprovalAction,
  sql?: SqlTag,
  orgId?: string
): Promise<void> {
  if (!isEnabled()) return;
  if (action?.status !== 'pending_approval') return;

  try {
    await sendApprovalMessage(action, sql, orgId);
  } catch (err) {
    console.warn('[TelegramApprovals] Failed to send approval:', (err as Error)?.message);
  }
}
