-- Approval notification registry: tracks the provider message sent to each
-- external channel (Discord, Telegram) for a pending_approval action, so that
-- when the action is resolved through ANY channel we can edit/clear the message
-- in every OTHER channel ("approve once → clears everywhere").
-- Additive only (CREATE TABLE / INDEX IF NOT EXISTS) — idempotent re-runs no-op.
CREATE TABLE IF NOT EXISTS "approval_notifications" (
  "id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "action_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,            -- 'discord' | 'telegram'
  "message_id" TEXT NOT NULL,         -- provider message id (Discord message id / Telegram message_id)
  "channel_ref" TEXT,                 -- Discord DM channel id / Telegram chat id (needed to edit)
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "cleared_at" TIMESTAMPTZ
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_approval_notifications_action" ON "approval_notifications" ("org_id", "action_id");
