// app/lib/doctor/fixes/create-default-policy.mjs
import { getSql } from '../../db';

export async function apply() {
  try {
    const sql = getSql();
    const id = `pol_doctor_${Date.now()}`;
    const now = new Date().toISOString();
    const rules = JSON.stringify({ threshold: 100, action: 'warn' });
    await sql`
      INSERT INTO guard_policies (id, org_id, name, policy_type, rules, active, created_at, updated_at)
      VALUES (
        ${id},
        'org_default',
        'Doctor: Log All Actions',
        'risk_threshold',
        ${rules},
        1,
        ${now},
        ${now}
      )
      ON CONFLICT (id) DO NOTHING
    `;
    return {
      applied: true,
      description: 'Created default governance policy (warn at risk 100)',
    };
  } catch (err) {
    return { applied: false, description: `Failed to create policy: ${err.message}` };
  }
}
