export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { isHostedMode } from '../../../lib/hosted/flag';
import { trialActivationSteps } from '../../../lib/hosted/trial-activation';
import { getTrialActivationFacts } from '../../../lib/repositories/hosted-workspace.repository';
import { getSql } from '../../../lib/db';

/**
 * GET /api/hosted/activation — the caller's own trial checklist for /connect
 * ("key used", "first call received", "approval landed on your phone").
 *
 * Not public: middleware authenticates it like any /api route (trial session
 * cookie, API key, or session) and sets x-org-id from the verified principal,
 * stripping any client-sent copy. The org always comes from that header,
 * never from the query. The optional workspace_id lets the page that just
 * minted a workspace confirm the browser session is for that workspace: a
 * mismatch is refused rather than answered with another org's progress.
 */
export async function GET(request: Request) {
  if (!isHostedMode()) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Read the raw header: getOrgId() falls back to org_default, which would
  // turn an unauthenticated call into a read of the operator org.
  const orgId = request.headers.get('x-org-id');
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const asked = new URL(request.url).searchParams.get('workspace_id');
  if (asked && asked !== orgId) {
    return NextResponse.json({ error: 'Not your workspace' }, { status: 403 });
  }

  try {
    const facts = await getTrialActivationFacts(getSql(), orgId);
    if (!facts) return NextResponse.json({ error: 'Not a trial workspace' }, { status: 404 });
    return NextResponse.json(
      { workspace_id: orgId, ...trialActivationSteps(facts) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    console.error('[HOSTED/ACTIVATION] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
