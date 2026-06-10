import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { findActiveKeyByHash } from '../../../lib/repositories/apiKeys.repository';
import { createLiveVerificationProofToken } from '../../../lib/liveVerificationProof.mjs';
import { timingSafeCompare } from '../../../lib/timing-safe';

export const dynamic = 'force-dynamic';

async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function buildSuccessResponse(start: number, request: Request) {
  const latencyMs = Date.now() - start;
  const url = new URL(request.url);

  // Mint a live verification proof so the setup page upgrades to "verified"
  let proofToken: string | null = null;
  try {
    const { token } = await createLiveVerificationProofToken(
      {
        validator: 'setup-ping',
        tool: 'node',
        mode: 'read_only',
        summary: { passed: 1, failed: 0, skipped: 0, score: 100 },
        checks: [{ name: 'Authenticated ping', status: 'pass' }],
      },
      { env: process.env, host: url.host }
    );
    proofToken = token;
  } catch {
    // Proof minting is best-effort (needs NEXTAUTH_SECRET)
  }

  return NextResponse.json({
    ok: true,
    latencyMs,
    message: 'Instance is accepting authenticated requests.',
    proof_token: proofToken,
  });
}

export async function POST(request: Request) {
  const start = Date.now();

  if (process.env.DASHCLAW_MODE === 'demo') {
    return NextResponse.json(
      { ok: false, message: 'Live ping is not available in demo mode.' },
      { status: 403 }
    );
  }

  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, message: 'API key did not match.' },
      { status: 401 }
    );
  }

  // Fast path: check against environment variable
  const expectedKey = process.env.DASHCLAW_API_KEY;
  if (expectedKey && timingSafeCompare(apiKey, expectedKey)) {
    return buildSuccessResponse(start, request);
  }

  // Slow path: check against workspace API keys in database
  try {
    const sql = getSql();
    const keyHash = await hashKey(apiKey);
    const rows = await findActiveKeyByHash(sql, keyHash);
    if (rows.length > 0) {
      return buildSuccessResponse(start, request);
    }
  } catch {
    // DB unavailable — fall through to rejection
  }

  return NextResponse.json(
    { ok: false, message: 'API key did not match.' },
    { status: 401 }
  );
}
