export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { buildEvidenceBundle, createArtifact } from '../../../lib/repositories/artifacts.repository';

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    if (!body.action_id) {
      return NextResponse.json({ error: 'action_id is required' }, { status: 400 });
    }

    const bundle = await buildEvidenceBundle(sql, orgId, body.action_id);
    if (!bundle) {
      return NextResponse.json({ error: 'action_not_found' }, { status: 404 });
    }

    // Optionally persist the bundle as an artifact
    if (body.persist !== false) {
      await createArtifact(sql, orgId, {
        artifact_type: 'evidence_bundle',
        name: `Evidence bundle: ${(bundle.action as Record<string, any>).declared_goal || (bundle.action as Record<string, any>).action_id}`,
        content_json: bundle,
        source_action_id: body.action_id,
        source_agent_id: (bundle.action as Record<string, any>).agent_id,
        tags: ['evidence-bundle', 'auto-generated'],
      });
    }

    return NextResponse.json(bundle);
  } catch (error) {
    return apiErrorResponse(error, 'EVIDENCE_BUNDLE');
  }
}
