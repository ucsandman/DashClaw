import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('migration 0069 — claim columns + seat_invites', () => {
  const sql = readFileSync(path.resolve('drizzle/0069_claim_and_invites.sql'), 'utf8');

  it('adds the claim columns to organizations', () => {
    expect(sql).toMatch(/ALTER TABLE organizations ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ/);
    expect(sql).toMatch(/ALTER TABLE organizations ADD COLUMN IF NOT EXISTS claimed_by_user_id TEXT/);
  });

  it('creates seat_invites (NOT the legacy pre-v5 `invites` shape) with an org FK that cascades on org delete', () => {
    // Legacy token-based `invites` exists on long-lived DBs; adopting it via
    // CREATE TABLE IF NOT EXISTS broke the v5.13.0 my-dashclaw deploy (42703).
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS invites \(/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS seat_invites/);
    expect(sql).toMatch(/org_id TEXT NOT NULL REFERENCES organizations\(id\) ON DELETE CASCADE/);
  });

  it('constrains invite roles to the same set users allow', () => {
    expect(sql).toMatch(/CONSTRAINT seat_invites_role_check CHECK \(role IN \('admin', 'member'\)\)/);
  });

  it('enforces one live invite per (org, address), case-insensitive', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS seat_invites_org_email_pending_idx ON seat_invites \(org_id, lower\(email\)\) WHERE accepted_at IS NULL/,
    );
  });

  it('indexes pending invites by address for the sign-in lookup', () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS seat_invites_email_pending_idx ON seat_invites \(lower\(email\)\) WHERE accepted_at IS NULL/,
    );
  });

  it('separates statements with --> statement-breakpoint so auto-migrate logs per-statement', () => {
    const breakpoints = sql.match(/-->\s*statement-breakpoint/g) || [];
    expect(breakpoints.length).toBeGreaterThanOrEqual(4);
  });
});
