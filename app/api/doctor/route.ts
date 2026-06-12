// app/api/doctor/route.ts
import { NextResponse } from 'next/server';
import { runDoctor } from '../../lib/doctor/engine.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = (request as { nextUrl?: URL }).nextUrl || new URL(request.url);
    const categoryParam = url.searchParams.get('category');
    const includeFixes = url.searchParams.get('include_fixes') !== 'false';
    // Only the Host header is trusted here — never `?host=` query input —
    // because this value flows to deployment checks that compare it against
    // NEXTAUTH_URL. Accepting user-controlled query input would let an
    // attacker trigger misleading diagnostics and, historically, expand the
    // surface for SSRF flows from doctor checks (CodeQL #53/#54).
    const host = request.headers.get('host') || '';

    const categories = categoryParam
      ? categoryParam.split(',').map((c) => c.trim()).filter(Boolean)
      : null;

    // Tenant scope for data probes — set server-side by middleware; hosted
    // deployments share one DB, so API callers never probe cross-org.
    const orgId = request.headers.get('x-org-id') || null;

    const result = await runDoctor({ categories: categories ?? undefined, includeFixes, host, orgId });

    return NextResponse.json(result, {
      status: result.status === 'unhealthy' ? 503 : 200,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
