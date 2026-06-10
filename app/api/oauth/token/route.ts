// app/api/oauth/token/route.js
import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { consumeAuthCode, insertAccessToken, rotateRefreshToken } from '../../../lib/repositories/oauth.repository';
import { newOpaqueToken, hashToken, verifyPkceS256 } from '../../../lib/oauth/crypto';
export const dynamic = 'force-dynamic';

const ACCESS_TTL_S = 60 * 60;          // 1 hour
const ACCESS_TTL_MS = ACCESS_TTL_S * 1000;

function err(code: string, status = 400) {
  return NextResponse.json({ error: code }, { status });
}

async function issueTokenPair(sql: any, ctx: any) {
  const accessToken = newOpaqueToken('oat');
  const refreshToken = newOpaqueToken('ort');
  await insertAccessToken(sql, {
    tokenHash: hashToken(accessToken),
    refreshTokenHash: hashToken(refreshToken),
    clientId: ctx.clientId,
    orgId: ctx.orgId,
    userId: ctx.userId || null,
    scope: ctx.scope,
    agentId: ctx.agentId || 'claude-desktop',
    expiresAt: new Date(Date.now() + ACCESS_TTL_MS).toISOString(),
  });
  return NextResponse.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_S,
    refresh_token: refreshToken,
    scope: ctx.scope,
  });
}

export async function POST(request: Request) {
  const form = new URLSearchParams(await request.text());
  const grantType = form.get('grant_type');
  const sql = getSql();

  if (grantType === 'authorization_code') {
    const code = form.get('code');
    const redirectUri = form.get('redirect_uri');
    const verifier = form.get('code_verifier');
    const clientId = form.get('client_id');
    if (!code || !redirectUri || !verifier || !clientId) return err('invalid_request');

    const row = await consumeAuthCode(sql, hashToken(code));
    if (!row) return err('invalid_grant');                       // unknown/expired/replayed
    // OAuth 2.1 §4.1.3: the code is bound to the client it was issued to.
    if (row.client_id !== clientId) return err('invalid_grant');
    if (row.redirect_uri !== redirectUri) return err('invalid_grant');
    // Defense-in-depth: only S256 codes are ever issued; reject anything else.
    if (row.code_challenge_method !== 'S256') return err('invalid_grant');
    if (!verifyPkceS256(verifier, row.code_challenge)) return err('invalid_grant');

    return issueTokenPair(sql, {
      clientId: row.client_id, orgId: row.org_id, userId: row.user_id,
      scope: row.scope, agentId: row.agent_id,
    });
  }

  if (grantType === 'refresh_token') {
    const refresh = form.get('refresh_token');
    if (!refresh) return err('invalid_request');
    const ctx = await rotateRefreshToken(sql, hashToken(refresh));
    if (!ctx) return err('invalid_grant');
    return issueTokenPair(sql, ctx);
  }

  return err('unsupported_grant_type');
}
