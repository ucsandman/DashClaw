import crypto from 'node:crypto';
import type { SqlTag } from '../types/db';

/**
 * Email-matched invites (seats, v5.13). No invite emails and no join links:
 * an org admin records a teammate's address, and the teammate joins at
 * first sign-in when their verified OAuth email matches a live invite
 * (auth.ts signIn callback). Addresses normalize to lowercase; the 0069
 * partial unique index (on seat_invites - the legacy token-based `invites`
 * table is a retired-in-place fossil on long-lived databases) enforces one live invite per (org, address);
 * accepted rows stay behind as audit history.
 */

const INVITE_TTL_DAYS = 14;
const VALID_ROLES = new Set(['admin', 'member']);
// Deliberately loose: one @, no whitespace, something on both sides. The
// real verification is the OAuth provider's — this only catches typos.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeInviteEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase();
}

export type CreateInviteResult =
  | { created: true; invite: { id: string; email: string; role: string; expiresAt: string } }
  | { created: false; reason: 'invalid_email' | 'invalid_role' | 'already_member' | 'already_invited' };

export async function createInvite(
  sql: SqlTag,
  { orgId, email, role, createdByUserId }: { orgId: string; email: string; role: string; createdByUserId: string },
): Promise<CreateInviteResult> {
  const normalized = normalizeInviteEmail(email);
  if (!EMAIL_SHAPE.test(normalized)) return { created: false, reason: 'invalid_email' };
  if (!VALID_ROLES.has(role)) return { created: false, reason: 'invalid_role' };

  const members = await sql`
    SELECT id FROM users WHERE org_id = ${orgId} AND LOWER(email) = ${normalized} LIMIT 1
  `;
  if (members.length > 0) return { created: false, reason: 'already_member' };

  const id = `inv_${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();
  try {
    const rows = await sql`
      INSERT INTO seat_invites (id, org_id, email, role, created_by_user_id, expires_at)
      VALUES (${id}, ${orgId}, ${normalized}, ${role}, ${createdByUserId}, ${expiresAt})
      RETURNING id
    `;
    return {
      created: true,
      invite: { id: String(rows[0]?.id ?? id), email: normalized, role, expiresAt },
    };
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return { created: false, reason: 'already_invited' };
    }
    throw err;
  }
}

export type PendingInvite = {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
};

export async function listPendingInvites(sql: SqlTag, orgId: string): Promise<PendingInvite[]> {
  const rows = await sql`
    SELECT id, email, role, created_at, expires_at
    FROM seat_invites
    WHERE org_id = ${orgId} AND accepted_at IS NULL
    ORDER BY created_at DESC
  `;
  const now = Date.now();
  return rows.map((r) => ({
    id: String(r.id),
    email: String(r.email),
    role: String(r.role),
    createdAt: String(r.created_at),
    expiresAt: String(r.expires_at),
    expired: new Date(String(r.expires_at)).getTime() < now,
  }));
}

export async function revokeInvite(
  sql: SqlTag,
  { orgId, inviteId }: { orgId: string; inviteId: string },
): Promise<{ revoked: boolean }> {
  const rows = await sql`
    DELETE FROM seat_invites
    WHERE id = ${inviteId} AND org_id = ${orgId} AND accepted_at IS NULL
    RETURNING id
  `;
  return { revoked: rows.length > 0 };
}

/** Newest live invite for a verified address, or null. Sign-in hot path. */
export async function findPendingInviteByEmail(
  sql: SqlTag,
  email: string,
): Promise<{ id: string; orgId: string; role: string } | null> {
  const normalized = normalizeInviteEmail(email);
  if (!normalized) return null;
  const nowIso = new Date().toISOString();
  const rows = await sql`
    SELECT id, org_id, role
    FROM seat_invites
    WHERE LOWER(email) = ${normalized}
      AND accepted_at IS NULL
      AND expires_at > ${nowIso}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { id: String(row.id), orgId: String(row.org_id), role: String(row.role) };
}

export type AcceptInviteResult =
  | { accepted: true; orgId: string; role: string }
  | { accepted: false };

export async function acceptInvite(
  sql: SqlTag,
  { inviteId, userId }: { inviteId: string; userId: string },
): Promise<AcceptInviteResult> {
  const rows = await sql`
    UPDATE seat_invites
    SET accepted_at = NOW(), accepted_by_user_id = ${userId}
    WHERE id = ${inviteId} AND accepted_at IS NULL
    RETURNING org_id, role
  `;
  const row = rows[0];
  if (!row) return { accepted: false };
  return { accepted: true, orgId: String(row.org_id), role: String(row.role) };
}
