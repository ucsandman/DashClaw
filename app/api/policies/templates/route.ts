export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { getActivePolicies } from '../../../lib/repositories/guardrails.repository';
import {
  PACK_PREVIEWS, AVAILABLE_PACKS, PACK_AUDIENCES, PACK_STRICTNESS,
  inferPolicyType, summarizeRules, bucketForPackPolicy,
} from '../../../lib/policyPackPreviews';
import type { PackPreview } from '../../../lib/policyPackPreviews';

// Active policy names for the caller's org, used to mark packs as installed.
// Best-effort: any failure (no DB in tests, schema drift) degrades to an empty
// set — the catalog itself must never 500 because the installed check couldn't run.
async function loadInstalledPolicyNames(request: Request): Promise<Set<string>> {
  // Demo passthrough (middleware strips org identity and sets this marker):
  // skip the org-scoped read entirely — the demo catalog shows no install state.
  if (request.headers.get('x-dashclaw-demo') === '1') return new Set();
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const rows = await getActivePolicies(sql, orgId);
    return new Set(rows.map((r) => String(r.name)));
  } catch {
    return new Set();
  }
}

export async function GET(request: Request) {
  try {
    const installedNames = await loadInstalledPolicyNames(request);
    const templates = [];

    for (const packId of AVAILABLE_PACKS) {
      const preview = (PACK_PREVIEWS as Record<string, PackPreview>)[packId];
      if (!preview) continue;

      try {
        const packPath = join(process.cwd(), 'app', 'lib', 'guardrails', 'packs', packId, 'policies.yml');
        const yamlContent = await readFile(packPath, 'utf-8');
        const jsYaml = await import('js-yaml');
        const doc = jsYaml.load(yamlContent) as { policies?: Array<Record<string, unknown>> };
        const policies = (doc.policies || []).map(p => ({
          name: p.description || p.id,
          policy_type: inferPolicyType(p),
          rules_summary: summarizeRules(p),
          bucket: bucketForPackPolicy(p),
        }));

        templates.push({
          id: packId,
          name: preview.name,
          description: preview.description,
          recommended_for: preview.recommended_for,
          audience: preview.audience,
          audience_label: PACK_AUDIENCES[preview.audience] ?? preview.audience,
          strictness: preview.strictness,
          strictness_label: PACK_STRICTNESS[preview.strictness] ?? preview.strictness,
          stack_after: preview.stack_after ?? null,
          installed: policies.length > 0 && policies.every((p) => installedNames.has(String(p.name))),
          policy_count: policies.length,
          policies,
        });
      } catch (err) {
        console.warn(`[POLICIES/TEMPLATES] skipping pack with unreadable YAML: ${packId}`, err instanceof Error ? err.message : String(err));
      }
    }

    return NextResponse.json({ templates });
  } catch (error) {
    console.error('[POLICIES/TEMPLATES] GET error:', error);
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 });
  }
}
