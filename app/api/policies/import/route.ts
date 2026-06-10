export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId, getOrgRole } from '../../../lib/org.js';
import { findPolicyByName } from '../../../lib/repositories/guardrails.repository.js';
import { loadPackPolicies, importPolicies } from '../../../lib/guardrails/import-pack.js';
import { inferPolicyType, AVAILABLE_PACKS } from '../../../lib/policyPackPreviews.js';

const VALID_PACKS = AVAILABLE_PACKS;

/**
 * POST /api/policies/import — Import a policy pack or raw YAML
 * Body: { pack: string } OR { yaml: string }
 */
export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const role = getOrgRole(request);

    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { pack, yaml: rawYaml } = body;

    if (!pack && !rawYaml) {
      return NextResponse.json({ error: 'Either pack or yaml is required' }, { status: 400 });
    }

    let policies;

    if (pack) {
      if (!VALID_PACKS.includes(pack)) {
        return NextResponse.json({ error: `Invalid pack. Choose from: ${VALID_PACKS.join(', ')}` }, { status: 400 });
      }

      // Load the pack's policies.yml (extracted lib — shared with trial seeding)
      try {
        policies = await loadPackPolicies(pack);
      } catch {
        return NextResponse.json({ error: `Pack file not found: ${pack}` }, { status: 404 });
      }
    } else {
      // Parse raw YAML
      const jsYaml = await import('js-yaml');
      const doc = jsYaml.load(rawYaml) as { policies?: unknown[] };
      policies = doc.policies || [];
    }

    const url = new URL(request.url);
    const preview = url.searchParams.get('preview') === 'true';

    if (preview) {
      const previewPolicies = [];
      for (const policy of policies as Array<Record<string, unknown>>) {
        const name = (policy.description || policy.id) as string;
        const policyType = inferPolicyType(policy);
        const existing = await findPolicyByName(sql, orgId, name);
        previewPolicies.push({
          name,
          policy_type: policyType,
          rules: policy.rules ? JSON.stringify(policy.rules) : JSON.stringify(policy.rule || {}),
          conflict: existing.length > 0,
          conflict_reason: existing.length > 0 ? 'Policy with this name already exists' : undefined,
        });
      }
      return NextResponse.json({
        preview: true,
        would_create: previewPolicies.filter(p => !p.conflict).length,
        would_skip: previewPolicies.filter(p => p.conflict).length,
        policies: previewPolicies,
      });
    }

    const { imported, skipped, errors } = await importPolicies(
      sql, orgId, policies as Array<Record<string, unknown>>,
    );

    return NextResponse.json({
      imported: imported.length,
      skipped: skipped.length,
      errors,
      policies: imported,
    }, { status: 201 });
  } catch (err) {
    console.error('[POLICIES/IMPORT] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
