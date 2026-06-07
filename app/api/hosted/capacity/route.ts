export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { NextResponse } from 'next/server';
import { isHostedMode, hostedConfig } from '../../../lib/hosted/flag.js';
import { countActiveTrials } from '../../../lib/repositories/hosted-workspace.repository.js';
import { getSql } from '../../../lib/db.js';
export async function GET() {
  if (!isHostedMode()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const max = hostedConfig().maxActiveTrials;
  const active = await countActiveTrials(getSql());
  return NextResponse.json({ full: active >= max, active, max });
}
