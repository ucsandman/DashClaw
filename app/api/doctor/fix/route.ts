// app/api/doctor/fix/route.ts
import { NextResponse } from 'next/server';
import { applyFix, runDoctor } from '../../../lib/doctor/engine.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    // Remote fixes mutate instance/tenant state — admin keys only. The
    // x-org-role / x-org-id headers are set server-side by middleware (client
    // copies are stripped), so they are trustworthy here.
    const role = request.headers.get('x-org-role');
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const orgId = request.headers.get('x-org-id');
    if (!orgId) {
      return NextResponse.json({ error: 'Organization context required' }, { status: 403 });
    }

    const body = await request.json();
    const { action, ...params } = body;

    if (!action) {
      return NextResponse.json(
        { error: 'Missing required field: action' },
        { status: 400 },
      );
    }

    // API endpoint never allows local-only fixes (env file writes); orgId from
    // the verified header overrides any client-supplied value so tenant-scoped
    // fixes (normalize_timestamps) can never reach across orgs.
    const result = await applyFix(action, { ...params, orgId }, { allowLocal: false });
    const recheck = await runDoctor({ includeFixes: true, orgId });

    return NextResponse.json({ ...result, recheck });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
