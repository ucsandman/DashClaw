-- Claim-your-workspace (G2 product half) + email-matched invites (seats).
-- docs/decisions/2026-08-09-hosted-paid-tier.md: "Accounts before billing" —
-- an anonymous trial org must bind to an authenticated owner without losing
-- its history. claimed_at doubles as the trial-session revocation signal
-- (middleware resolveTrialOrg stops honoring trial cookies for a claimed org
-- within its 60s cache TTL) and the durable-org marker; trial_ends_at is
-- cleared at claim time so the expiry sweep can never collect a claimed org.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS claimed_by_user_id TEXT;
--> statement-breakpoint
-- Email-matched invites live in seat_invites, NOT the legacy pre-v5 `invites`
-- table (token-based, TEXT timestamps, NOT NULL token/invited_by) that still
-- exists on long-lived databases - CREATE TABLE IF NOT EXISTS would silently
-- adopt that incompatible shape and the partial index below would fail
-- (42703, the v5.13.0 my-dashclaw deploy failure). The legacy table stays
-- retired-in-place per the cull's no-destructive-migration rule.
-- Email-matched invites: an admin records a teammate's address; the teammate
-- joins the org at first sign-in (auth.ts signIn callback) instead of minting
-- a personal workspace. No invite emails are sent and no join links exist —
-- the address match against the verified OAuth email is the whole mechanism.
CREATE TABLE IF NOT EXISTS seat_invites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by_user_id TEXT,
  CONSTRAINT seat_invites_role_check CHECK (role IN ('admin', 'member'))
);
--> statement-breakpoint
-- One live invite per (org, address); accepted rows stay as audit history.
CREATE UNIQUE INDEX IF NOT EXISTS seat_invites_org_email_pending_idx ON seat_invites (org_id, lower(email)) WHERE accepted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS seat_invites_email_pending_idx ON seat_invites (lower(email)) WHERE accepted_at IS NULL;
