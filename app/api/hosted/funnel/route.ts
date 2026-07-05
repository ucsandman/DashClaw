export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { isHostedMode } from '../../../lib/hosted/flag';
import { getTrialFunnel } from '../../../lib/repositories/hosted-workspace.repository';
import { getSql } from '../../../lib/db';

// v4.6 funnel truth: the trial activation funnel, aggregate-only (no org
// ids, slugs, or key prefixes ever leave the repository). Same exposure
// class and gate as /api/hosted/capacity — see the spec's design decisions.
export async function GET() {
  if (!isHostedMode()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const funnel = await getTrialFunnel(getSql());
  return NextResponse.json({ hosted: true, ...funnel });
}
