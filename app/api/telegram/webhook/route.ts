export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getSql } from '../../../lib/db';
import {
  getActionSummary,
  recordApproval,
} from '../../../lib/repositories/actions.repository';
import { clearApprovalNotifications } from '../../../lib/approvalNotifications';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const FETCH_TIMEOUT_MS = 1500;
const CALLBACK_DATA_RE = /^(ap|dn):(act_[a-z0-9_-]{1,57})$/;

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
function ok() {
  return NextResponse.json({ ok: true });
}

async function answerCallback(callback_query_id: string, text?: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  try {
    await fetch(`${TELEGRAM_API_BASE}/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id, ...(text ? { text } : {}) }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn('[TelegramWebhook] answerCallback failed:', (err as Error).message);
  }
}

async function editMessage(chat_id: string | undefined, message_id: number | undefined, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  try {
    await fetch(`${TELEGRAM_API_BASE}/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id, message_id, text,
        reply_markup: { inline_keyboard: [] },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn('[TelegramWebhook] editMessage failed:', (err as Error).message);
  }
}

function buildResolvedText(action: any, decisionLabel: string, action_id: string) {
  const ts = new Date().toTimeString().slice(0, 8);
  const goal = (action.declared_goal || '—').slice(0, 200);
  return [
    `${decisionLabel} — ${ts}`,
    '',
    `Agent:   ${action.agent_id || 'unknown'}`,
    `Action:  ${action.action_type || 'unknown'}`,
    `Goal: ${goal}`,
    '',
    action_id,
  ].join('\n');
}

function secretsMatch(presented: string, expected: string) {
  if (!expected) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  // Timing-safe secret compare (Fix M1)
  const presented = request.headers.get('x-telegram-bot-api-secret-token') || '';
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  if (!secretsMatch(presented, expected)) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const cq = body?.callback_query;
  if (!cq) return ok(); // non-callback update, ignore

  // chat_id allowlist — 401 (not 403) to avoid revealing that the secret was
  // correct while the sender identity was not (Fix M2).
  const senderId = String(cq.from?.id ?? '');
  if (senderId !== process.env.TELEGRAM_ADMIN_CHAT_ID) return unauthorized();

  const match = (cq.data ?? '').match(CALLBACK_DATA_RE);
  if (!match) {
    await answerCallback(cq.id, 'Unknown button');
    return ok();
  }
  const verb = match[1] as string;
  const action_id = match[2] as string;

  // Ack the callback immediately so Telegram doesn't retry on slow DB work
  // (Fix I1). Downstream failures are surfaced via editMessage.
  await answerCallback(cq.id);

  // Admin chat is the only legitimate edit target — never trust body-provided
  // chat_id (Fix M3). message_id still comes from the callback body.
  const chat_id = process.env.TELEGRAM_ADMIN_CHAT_ID;
  const message_id = cq.message?.message_id;

  // Loud misconfig (Fix I4) — fail visibly on the admin's phone.
  const orgId = process.env.TELEGRAM_APPROVER_ORG_ID;
  if (!orgId) {
    await editMessage(chat_id, message_id,
      '⚠️ Server misconfigured: TELEGRAM_APPROVER_ORG_ID is not set');
    return ok();
  }

  const sql = getSql();
  const action = await getActionSummary(sql, orgId, action_id);

  if (!action) {
    await editMessage(chat_id, message_id, '⚠️ Action not found');
    return ok();
  }

  if (action.status !== 'pending_approval') {
    await editMessage(chat_id, message_id,
      `⚠️ Already resolved — status: ${action.status}`);
    return ok();
  }

  const userId = `telegram:${senderId}`;

  if (verb === 'ap') {
    let updated;
    try {
      updated = await recordApproval(sql, orgId, action_id, {
        newStatus: 'running',
        errorMessage: null,
        decision: 'allow',
        userId,
        safeReasoning: null as unknown as string | undefined,
      });
    } catch (err) {
      console.warn('[TelegramWebhook] recordApproval (approve) failed:', (err as Error).message);
      await editMessage(chat_id, message_id, '⚠️ Approval failed');
      return ok();
    }
    if (!updated) {
      // Zero-row return — another caller resolved the action between the
      // getActionSummary read and our UPDATE (Fix C1 caller).
      await editMessage(chat_id, message_id,
        '⚠️ Already resolved — resolved by another channel');
      return ok();
    }
    await editMessage(chat_id, message_id,
      buildResolvedText(action, '✅ Approved by Telegram admin', action_id));
    await clearApprovalNotifications(sql, {
      orgId, actionId: action_id, decision: 'allow', resolvedBy: userId, resolvedVia: 'telegram',
    });
    return ok();
  }

  // verb === 'dn'
  let updated;
  try {
    updated = await recordApproval(sql, orgId, action_id, {
      newStatus: 'failed',
      errorMessage: 'Denied via Telegram',
      decision: 'deny',
      userId,
      safeReasoning: 'Denied via Telegram',
    });
  } catch (err) {
    console.warn('[TelegramWebhook] recordApproval (deny) failed:', (err as Error).message);
    await editMessage(chat_id, message_id, '⚠️ Approval failed');
    return ok();
  }
  if (!updated) {
    await editMessage(chat_id, message_id,
      '⚠️ Already resolved — resolved by another channel');
    return ok();
  }
  await editMessage(chat_id, message_id,
    buildResolvedText(action, '❌ Denied by Telegram admin', action_id));
  await clearApprovalNotifications(sql, {
    orgId, actionId: action_id, decision: 'deny', resolvedBy: userId, resolvedVia: 'telegram',
  });
  return ok();
}
