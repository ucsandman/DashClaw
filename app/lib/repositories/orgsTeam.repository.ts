import type { SqlTag } from '../types/db';

export async function getOrgStripeCustomerId(
  sql: SqlTag,
  orgId: string
): Promise<string | null> {
  const rows = await sql`SELECT stripe_customer_id FROM organizations WHERE id = ${orgId} LIMIT 1`;
  return (rows[0]?.stripe_customer_id as string | null | undefined) ?? null;
}

export async function getTeamOrgAndMembers(
  sql: SqlTag,
  orgId: string
): Promise<{ org: Record<string, unknown> | null; members: Record<string, unknown>[] }> {
  const [orgRows, members] = await Promise.all([
    sql`SELECT id, name, slug, plan FROM organizations WHERE id = ${orgId}`,
    sql`
      SELECT id, email, name, image, role, created_at, last_login_at
      FROM users
      WHERE org_id = ${orgId}
      ORDER BY created_at ASC
    `,
  ]);

  const org = orgRows.length > 0 ? (orgRows[0] ?? null) : null;
  return {
    org,
    members,
  };
}
