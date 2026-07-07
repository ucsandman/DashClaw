export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { buildEvidenceBundle, createArtifact } from '../../../lib/repositories/artifacts.repository';
import { getServerSigningKey } from '../../../lib/integrity/server-key';
import { signBundle } from '../../../lib/integrity/bundle';

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

    // Prove layer: sign the evidence bundle so the surviving audit export is
    // tamper-evident and independently re-verifiable against the instance JWKS
    // (POST /api/integrity/verify). The signed compliance/JWKS export folds into
    // the audit layer here — the bundle content lives under `payload`, bound by
    // its digest, wrapped in an Ed25519-signed envelope.
    const key = await getServerSigningKey(sql);
    const signed = signBundle(
      bundle,
      { kid: key.kid, privateKeyJwk: key.privateKeyJwk },
      new Date().toISOString(),
    );

    // Optionally persist the signed bundle as an artifact
    if (body.persist !== false) {
      const action = bundle.action as Record<string, any>;
      await createArtifact(sql, orgId, {
        artifact_type: 'evidence_bundle',
        name: `Evidence bundle: ${action.declared_goal || action.action_id}`,
        content_json: signed,
        source_action_id: body.action_id,
        source_agent_id: action.agent_id,
        tags: ['evidence-bundle', 'auto-generated', 'signed'],
      });
    }

    return NextResponse.json(signed);
  } catch (error) {
    return apiErrorResponse(error, 'EVIDENCE_BUNDLE');
  }
}
