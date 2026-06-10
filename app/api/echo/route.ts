export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';

// Public echo target so every deployment has a working end-to-end test
// destination for the agent registry demo seed and webhook test-fires —
// without depending on an external service. Deliberately constant-response:
// the request body is NEVER read or reflected (no abuse value, no storage).
// Public + rate-limited via middleware PUBLIC_ROUTES.
//
// Note: outbound SSRF guards (capability invoke, webhook delivery) block
// private/loopback hosts, so this only works as a target on a publicly
// reachable deployment — not against localhost dev.
export async function POST(request: Request) {
  const event = (request.headers.get('x-dashclaw-event') || '').slice(0, 64) || null;
  return NextResponse.json({ received: true, event, at: new Date().toISOString() });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: 'POST anything here — returns {received: true}. DashClaw echo target for demo capabilities and webhook tests.',
  });
}
