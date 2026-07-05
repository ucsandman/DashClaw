import { SignJWT } from 'jose';
import { TRIAL_SESSION_COOKIE } from '../sessionViewer.mjs';

export { TRIAL_SESSION_COOKIE };

/**
 * Trial session mint (v5.1 "a way back in").
 *
 * Signed at provisioning time by POST /api/hosted/workspaces so the browser
 * that minted a trial workspace can always get back to it. The token expiry
 * is pinned to the trial's own trial_ends_at — no refresh, no sliding
 * window; the session dies with the trial. Verification lives in
 * app/lib/sessionViewer.mjs (getTrialViewer) and is only ever evaluated on
 * hosted-mode instances.
 */
export async function mintTrialSessionToken(
  { orgId, expiresAt }: { orgId: string; expiresAt: string | Date },
  secret: string,
): Promise<string> {
  const exp = Math.floor(new Date(expiresAt).getTime() / 1000);
  return new SignJWT({ provider: 'trial', orgId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret));
}

export function trialSessionCookieOptions(expiresAt: string | Date): {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  expires: Date;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(expiresAt),
  };
}
