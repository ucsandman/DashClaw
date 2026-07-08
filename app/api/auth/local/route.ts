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

async function timingSafeMatch(submitted: string, actual: string) {
  const encoder = new TextEncoder();
  const submittedBuf = encoder.encode(submitted);
  const actualBuf = encoder.encode(actual);
  if (submittedBuf.length !== actualBuf.length) return false;
  const nodeCrypto = await import('node:crypto');
  return nodeCrypto.timingSafeEqual(submittedBuf, actualBuf);
}

// `npx dashclaw up` mints DASHCLAW_LOGIN_OTT (<token>.<expiryEpochMs>) into
// .env.local before starting the server, then opens /login?ott=<token> so the
// browser lands signed in without the operator hunting for the admin password.
// Single-use is enforced per server process (the env entry is deleted on first
// success); the 15-minute expiry bounds replay across restarts.
async function consumeLoginOtt(submitted: string): Promise<boolean> {
  const raw = process.env.DASHCLAW_LOGIN_OTT || '';
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return false;
  const expiresAt = Number(raw.slice(dot + 1));
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const match = await timingSafeMatch(submitted, raw.slice(0, dot));
  if (match) delete process.env.DASHCLAW_LOGIN_OTT;
  return match;
}

export async function POST(request: Request) {
  const password = process.env.DASHCLAW_LOCAL_ADMIN_PASSWORD;
  if (!password) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const { password: submittedPassword, ott } = await request.json();

    if (!submittedPassword && !ott) {
      return NextResponse.json({ error: 'Password is required.' }, { status: 401 });
    }

    const lock = await lockStateSafe();
    if (lock.locked) {
      return NextResponse.json(
        { error: 'Too many failed attempts. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(lock.retryAfterSeconds ?? 60) } }
      );
    }

    const authorized = ott
      ? await consumeLoginOtt(String(ott))
      : await timingSafeMatch(String(submittedPassword), password);

    if (!authorized) {
      await noteFailureSafe();
      await new Promise((r) => setTimeout(r, 500));
      const error = ott ? 'Sign-in link is invalid or expired.' : 'Incorrect password.';
      return NextResponse.json({ error }, { status: 401 });
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
