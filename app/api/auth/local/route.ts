export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { getSql } from '../../../lib/db';
import {
  getLoginLockState,
  recordLoginFailure,
  clearLoginFailures,
} from '../../../lib/repositories/login-guard.repository';

// Brute-force lockout, fail-open: the env password is the authentication;
// if the guard store is unreachable we log loudly and let login proceed
// rather than locking the operator out of their own instance.
async function lockStateSafe() {
  try {
    const orgId = process.env.DASHCLAW_API_KEY_ORG || 'org_default';
    return await getLoginLockState(getSql(), orgId);
  } catch (err) {
    console.warn('[SECURITY] Local-login lockout store unavailable; proceeding without lockout:', (err as Error)?.message);
    return { locked: false } as const;
  }
}

async function noteFailureSafe() {
  try {
    const orgId = process.env.DASHCLAW_API_KEY_ORG || 'org_default';
    await recordLoginFailure(getSql(), orgId);
  } catch (err) {
    console.warn('[SECURITY] Failed to record local-login failure:', (err as Error)?.message);
  }
}

async function noteSuccessSafe() {
  try {
    const orgId = process.env.DASHCLAW_API_KEY_ORG || 'org_default';
    await clearLoginFailures(getSql(), orgId);
  } catch (err) {
    console.warn('[SECURITY] Failed to clear local-login failures:', (err as Error)?.message);
  }
}

// LAN self-host fix: cookie Secure flag follows scheme, not NODE_ENV. Contributed by Lief (RyanTJoy).
const isHTTPS = (process.env.NEXTAUTH_URL || '').startsWith('https');

export async function POST(request: Request) {
  const password = process.env.DASHCLAW_LOCAL_ADMIN_PASSWORD;
  if (!password) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const { password: submittedPassword } = await request.json();

    if (!submittedPassword) {
      return NextResponse.json({ error: 'Password is required.' }, { status: 401 });
    }

    const lock = await lockStateSafe();
    if (lock.locked) {
      return NextResponse.json(
        { error: 'Too many failed attempts. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(lock.retryAfterSeconds ?? 60) } }
      );
    }

    const encoder = new TextEncoder();
    const submittedBuf = encoder.encode(submittedPassword);
    const actualBuf = encoder.encode(password);

    if (submittedBuf.length !== actualBuf.length) {
      await noteFailureSafe();
      await new Promise((r) => setTimeout(r, 500));
      return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
    }

    const nodeCrypto = await import('node:crypto');
    if (!nodeCrypto.timingSafeEqual(submittedBuf, actualBuf)) {
      await noteFailureSafe();
      await new Promise((r) => setTimeout(r, 500));
      return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
    }

    await noteSuccessSafe();

    const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET);
    const token = await new SignJWT({
      sub: 'local-admin',
      userId: 'usr_local_admin',
      orgId: process.env.DASHCLAW_API_KEY_ORG || 'org_default',
      role: 'admin',
      plan: 'free',
      provider: 'local'
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret);

    const response = NextResponse.json({ ok: true });
    response.cookies.set('dashclaw-local-session', token, {
      httpOnly: true,
      secure: isHTTPS,
      sameSite: 'lax',
      maxAge: 604800,
      path: '/'
    });

    return response;
  } catch (error) {
    console.error('Local auth error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('dashclaw-local-session', '', {
    httpOnly: true,
    secure: isHTTPS,
    sameSite: 'lax',
    maxAge: 0,
    path: '/'
  });
  return response;
}
