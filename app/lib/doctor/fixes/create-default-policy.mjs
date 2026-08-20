// app/lib/doctor/fixes/create-default-policy.mjs
import { getSql } from '../../db';
import { seedCatastrophePack } from '../../setup/catastrophe-pack.mjs';

export async function apply() {
  try {
    const sql = getSql();
    const existing = await sql`
      SELECT id FROM guard_policies WHERE org_id = 'org_default' LIMIT 1
    `;
    if (existing.length > 0) {
      return { applied: false, description: 'org_default already has governance policies' };
    }
    const { imported } = await seedCatastrophePack(sql, 'org_default');
    return {
      applied: true,
      description: `Seeded the Short List (${imported} catastrophe-only polic${imported === 1 ? 'y' : 'ies'})`,
    };
  } catch (err) {
    return { applied: false, description: `Failed to create policy: ${err.message}` };
  }
}
