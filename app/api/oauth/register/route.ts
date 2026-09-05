// app/api/oauth/register/route.js
import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { registerClient } from '../../../lib/repositories/oauth.repository';
import { newId } from '../../../lib/oauth/crypto';
import { normalizeOAuthScope } from '../scopes';
export const dynamic = 'force-dynamic';

// Only register redirect URIs we'd be willing to send a freshly-minted auth code
// to: absolute https (loopback http allowed outside production for local testing),
// no fragment. Without this, DCR is an open-redirect primitive — an attacker
// registers https://evil/cb and harvests codes from a crafted /authorize link.
function isValidRedirectUri(uri: string): boolean {
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash) return false;
  if (u.protocol === 'https:') return true;
  return process.env.NODE_ENV !== 'production'
    && u.protocol === 'http:'
    && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const redirectUris = (Array.isArray(body.redirect_uris) ? body.redirect_uris : [])
    .filter((u: unknown) => typeof u === 'string' && isValidRedirectUri(u));
  if (redirectUris.length === 0) {
    return NextResponse.json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must be one or more absolute https URIs' }, { status: 400 });
  }
  const requestedScope = body.scope === undefined ? null : normalizeOAuthScope(body.scope);
  if (body.scope !== undefined && !requestedScope) {
    return NextResponse.json({
      error: 'invalid_client_metadata',
      error_description: 'scope contains an unsupported value',
    }, { status: 400 });
  }
  const clientId = newId('ocl');
  await registerClient(getSql(), {
    clientId,
    clientName: typeof body.client_name === 'string' ? body.client_name : null,
    redirectUris,
    scope: requestedScope,
  });
  return NextResponse.json({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_method: 'none',
  }, { status: 201 });
}
