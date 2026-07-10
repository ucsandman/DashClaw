export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgRole, getUserId } from '../../../lib/org';
import { denyTrialPrincipal } from '../../../lib/hosted/trial-principal';

/**
 * GET /api/keys/reveal
 *
 * Returns the bootstrap API key (`process.env.DASHCLAW_API_KEY`) so the
 * signed-in admin does not have to hunt for it in `.env.local` or the
 * Vercel deploy output. Used by the Approvals QuickStart (to pre-fill
 * the starter `.env` snippet) and the /settings Environment panel (to
 * power a reveal/copy button on the masked key display).
 *
 * Why this does not query the `api_keys` table: workspace keys stored
 * there are SHA-256 hashed (see `app/api/keys/route.js` POST handler),
 * so the raw value is only known at creation time and intentionally
 * cannot be recovered. Users who need a rotated or additional key must
 * generate one at `/api-keys` and save the raw value from the creation
 * response.
 *
 * Auth:
 *   - `x-user-id` must be set by middleware. That header is only set
 *     for NextAuth / local-admin cookie sessions, never for API-key
 *     authenticated agent traffic or the dev-mode fallback path.
 *   - `x-org-role` must be `admin`. Members and readonly roles cannot
 *     reveal the bootstrap key.
 *
 * Response shape:
 *   200 { key: "oc_live_...", source: "env" }
 *   401 { error: "Authentication required" }
 *   403 { error: "Admin access required" }
 *   404 { error, hint }
 */
export async function GET(request: Request) {
  const userId = getUserId(request);
  if (!userId) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  if (getOrgRole(request) !== 'admin') {
    return NextResponse.json(
      { error: 'Admin access required' },
      { status: 403 }
    );
  }

  // SECURITY (v5.1): the bootstrap key belongs to the instance OPERATOR.
  // "admin" here only means admin of the requester's own org — a hosted
  // trial user is admin of their trial org and must never read the
  // operator's env key. On self-host this is a no-op (no trial principals),
  // so the operator's QuickStart/settings reveal keeps working.
  const trialDenied = await denyTrialPrincipal(request);
  if (trialDenied) return trialDenied;

  const bootstrapKey = process.env.DASHCLAW_API_KEY;
  if (!bootstrapKey) {
    return NextResponse.json(
      {
        error: 'No bootstrap API key configured',
        hint: 'Generate a workspace key at /api-keys — the raw value is shown once on creation.',
      },
      { status: 404 }
    );
  }

  return NextResponse.json({ key: bootstrapKey, source: 'env' });
}
