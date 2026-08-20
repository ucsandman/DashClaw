// app/lib/doctor/fixes/create-default-policy.mjs
import { getSql } from '../../db';
import { seedCatastrophePack } from '../../setup/catastrophe-pack.mjs';

export async function apply() {
  try {
    const sql = getSql();
    // No extra existence guard — seedCatastrophePack is idempotent per policy
    // name (skips rows that already exist), the same protection
    // scripts/auto-migrate.mjs relies on at org birth. A coarser
    // any-row-exists guard would falsely refuse a partially-seeded org or one
    // whose only policies are inactive.
    const { imported, skipped } = await seedCatastrophePack(sql, 'org_default');
    return {
      applied: imported > 0,
      description:
        imported > 0
          ? `Seeded the Short List (${imported} catastrophe-only polic${imported === 1 ? 'y' : 'ies'}${skipped > 0 ? `, ${skipped} already present` : ''})`
          : 'org_default already has the full Short List',
    };
  } catch (err) {
    return { applied: false, description: `Failed to create policy: ${err.message}` };
  }
}
