// app/api/oauth/authorize/route.js
import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getSql } from '../../../lib/db';
import { getClient, insertAuthCode } from '../../../lib/repositories/oauth.repository';
import { newOpaqueToken, hashToken } from '../../../lib/oauth/crypto';
import {
  normalizeOAuthScope,
  oauthScopeIsSubset,
  SUPPORTED_OAUTH_SCOPES,
} from '../scopes';
export const dynamic = 'force-dynamic';

const CODE_TTL_MS = 5 * 60 * 1000;

// HTML-escape untrusted values (e.g. a DCR-registered client_name) before
// interpolating into the consent page.
function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// CSRF defense for the consent POST: require the request to be same-origin
// (Origin, else Referer, host must match this instance). A cross-site
// auto-submit from an attacker page carries a foreign Origin and is rejected.
// OWASP-recommended standalone defense for state-changing form posts.
function isSameOrigin(request: Request): boolean {
  const host = request.headers.get('host');
  const src = request.headers.get('origin') || request.headers.get('referer');
  if (!host || !src) return false;
  try {
    return new URL(src).host === host;
  } catch {
    return false;
  }
}

function readParams(request: Request) {
  const url = new URL(request.url);
  const p = url.searchParams;
  return {
    responseType: p.get('response_type'),
    clientId: p.get('client_id'),
    redirectUri: p.get('redirect_uri'),
    codeChallenge: p.get('code_challenge'),
    // No 'plain' default: validate() rejects anything that isn't an explicit S256.
    codeChallengeMethod: p.get('code_challenge_method') || '',
    state: p.get('state') || '',
    scope: p.get('scope') ?? 'governance:write',
  };
}

// Returns { ok, error, client } after validating the request + session.
async function validate(request: Request) {
  const q = readParams(request);
  if (q.responseType !== 'code') return { ok: false, error: 'unsupported_response_type' };
  if (q.codeChallengeMethod !== 'S256' || !q.codeChallenge) return { ok: false, error: 'invalid_request: PKCE S256 required' };
  if (!q.clientId || !q.redirectUri) return { ok: false, error: 'invalid_request' };
  const client = await getClient(getSql(), q.clientId);
  if (!client) return { ok: false, error: 'invalid_client' };
  if (!(client.redirectUris as string[]).includes(q.redirectUri)) return { ok: false, error: 'invalid_redirect_uri' };
  const requestedScope = normalizeOAuthScope(q.scope);
  if (!requestedScope) return { ok: false, error: 'invalid_scope' };
  const allowedScope = client.scope == null
    ? SUPPORTED_OAUTH_SCOPES.join(' ')
    : normalizeOAuthScope(client.scope);
  if (!allowedScope || !oauthScopeIsSubset(requestedScope, allowedScope)) {
    return { ok: false, error: 'invalid_scope' };
  }
  q.scope = requestedScope;
  return { ok: true, q, client };
}

export async function GET(request: Request) {
  const session = await getToken({ req: request as unknown as Parameters<typeof getToken>[0]['req'], secret: process.env.NEXTAUTH_SECRET });
  if (!session) {
    const here = new URL(request.url);
    const login = new URL('/login', here);
    login.searchParams.set('callbackUrl', here.pathname + here.search);
    return NextResponse.redirect(login);
  }
  if (!session.orgId) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }
  const v = await validate(request);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  // form-action must permit BOTH this endpoint (the POST target) AND the client's
  // (already-validated) callback origin. Chromium/Brave enforce form-action against
  // the redirect that the POST returns, so a bare 'self' silently blocks the
  // post-consent redirect to claude.ai and the Authorize button does nothing.
  let callbackOrigin = '';
  try { callbackOrigin = new URL(v.q!.redirectUri!).origin; } catch { /* best-effort: redirectUri already validated above */ }
  const formAction = callbackOrigin ? `'self' ${callbackOrigin}` : "'self'";

  // Minimal consent page. POSTs back to this same URL (query preserved).
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize DashClaw</title></head>
<body>
<main>
  <h1>Authorize ${v.client!.clientName ? esc(v.client!.clientName) : 'this app'}</h1>
  <p>Grant this connector the requested DashClaw scope: <code>${esc(v.q!.scope)}</code>.</p>
  <form method="post">
    <button type="submit">Authorize</button>
  </form>
</main>
</body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}; base-uri 'none'`,
      'X-Frame-Options': 'DENY',
    },
  });
}

export async function POST(request: Request) {
  // CSRF: reject cross-origin consent submissions before doing anything else.
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'cross-origin request rejected' }, { status: 403 });
  }
  const session = await getToken({ req: request as unknown as Parameters<typeof getToken>[0]['req'], secret: process.env.NEXTAUTH_SECRET });
  if (!session) return NextResponse.json({ error: 'login_required' }, { status: 401 });
  if (!session.orgId) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }
  const v = await validate(request);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const code = newOpaqueToken('oac');
  await insertAuthCode(getSql(), {
    codeHash: hashToken(code),
    clientId: v.q!.clientId as string,
    orgId: session.orgId as string,
    userId: (session.userId as string) || null,
    redirectUri: v.q!.redirectUri as string,
    codeChallenge: v.q!.codeChallenge as string,
    codeChallengeMethod: 'S256',
    scope: v.q!.scope,
    agentId: 'claude-desktop',
    expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });

  const redirect = new URL(v.q!.redirectUri!);
  redirect.searchParams.set('code', code);
  if (v.q!.state) redirect.searchParams.set('state', v.q!.state);
  // 303 See Other: the consent submit was a POST, but the callback must be
  // fetched with GET (a 307 would re-POST the form body to claude.ai).
  return NextResponse.redirect(redirect, 303);
}
