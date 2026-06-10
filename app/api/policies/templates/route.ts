export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PACK_PREVIEWS, AVAILABLE_PACKS, inferPolicyType, summarizeRules } from '../../../lib/policyPackPreviews';

export async function GET() {
  try {
    const templates = [];

    for (const packId of AVAILABLE_PACKS) {
      const preview = (PACK_PREVIEWS as Record<string, { name: string; description: string; recommended_for: string }>)[packId];
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
        }));

        templates.push({
          id: packId,
          name: preview.name,
          description: preview.description,
          recommended_for: preview.recommended_for,
          policy_count: policies.length,
          policies,
        });
      } catch {
        // Skip packs with missing YAML files
      }
    }

    return NextResponse.json({ templates });
  } catch (error) {
    console.error('[POLICIES/TEMPLATES] GET error:', error);
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 });
  }
}
