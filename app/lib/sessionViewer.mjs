import { getToken } from 'next-auth/jwt';
import { jwtVerify } from 'jose';

export const LOCAL_SESSION_COOKIE = 'dashclaw-local-session';
export const TRIAL_SESSION_COOKIE = 'dashclaw-trial-session';

function getCookieValue(cookieHeader, key) {
  const parts = String(cookieHeader || '').split(/;\s*/);
  for (const part of parts) {
    const [name, ...rest] = part.split('=');
    if (name === key) {
      return rest.join('=');
    }
  }
  return '';
}

function parseCookieHeader(cookieHeader) {
  const cookies = {};
  for (const part of String(cookieHeader || '').split(/;\s*/)) {
    if (!part) continue;
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const name = part.slice(0, eqIdx).trim();
    if (name) cookies[name] = part.slice(eqIdx + 1);
  }
  return cookies;
}

async function getNextAuthViewer(cookieHeader, env) {
  if (!env.NEXTAUTH_SECRET) return null;

  // next-auth v4 SessionStore reads cookies from `req.cookies` only — it does
  // not parse `req.headers.cookie` as a fallback (see node_modules/next-auth/
  // core/lib/cookie.js). A shim with headers-only leaves req.cookies undefined
  // and getToken silently returns null even when the secret matches and the
  // cookie is present. Parse the header into a plain object so SessionStore's
  // `for (const name in _cookies)` branch picks up `__Secure-next-auth.session-
  // token` (HTTPS) or `next-auth.session-token` (http dev). secureCookie is
  // still passed explicitly because getToken can't infer it without req.url.
  const cookies = parseCookieHeader(cookieHeader);
  const req = { cookies, headers: { cookie: cookieHeader || '' } };
  for (const secureCookie of [true, false]) {
    try {
      const token = await getToken({
        req,
        secret: env.NEXTAUTH_SECRET,
        secureCookie,
      });
      if (token) {
        return {
          isAuthenticated: true,
          authType: 'nextauth',
          session: token,
        };
      }
    } catch {
      // try the other name
    }
  }
  return null;
}

async function getLocalViewer(cookieHeader, env) {
  const token = getCookieValue(cookieHeader, LOCAL_SESSION_COOKIE);
  if (!token || !env.NEXTAUTH_SECRET) return null;

  try {
    const secret = new TextEncoder().encode(env.NEXTAUTH_SECRET);
    const { payload } = await jwtVerify(token, secret);
    if (payload.provider !== 'local') return null;

    return {
      isAuthenticated: true,
      authType: 'local',
      session: payload,
    };
  } catch {
    return null;
  }
}

// Hosted-trial session (v5.1 "a way back in"): minted by POST /api/hosted/
// workspaces alongside the trial API key so a closed tab no longer orphans
// the workspace. Only evaluated when the instance itself runs hosted mode —
// on every other deployment a presented trial cookie is mechanically inert
// (fail-closed; the branch never runs, so there is nothing to weaken).
// The JWT expiry is set to the trial's trial_ends_at at mint time, so the
// session can never outlive the trial; jwtVerify enforces exp.
async function getTrialViewer(cookieHeader, env) {
  if (env.DASHCLAW_HOSTED !== 'true') return null;
  const token = getCookieValue(cookieHeader, TRIAL_SESSION_COOKIE);
  if (!token || !env.NEXTAUTH_SECRET) return null;

  try {
    const secret = new TextEncoder().encode(env.NEXTAUTH_SECRET);
    const { payload } = await jwtVerify(token, secret);
    if (payload.provider !== 'trial' || !payload.orgId) return null;

    return {
      isAuthenticated: true,
      authType: 'trial',
      session: {
        ...payload,
        // Admin of exactly the trial's own org — the same scoping every
        // OAuth personal-org user gets. Write limits still come from
        // enforceHostedTrial (action cap + expiry), not from the role.
        role: 'admin',
        userId: `trial:${payload.orgId}`,
      },
    };
  } catch {
    return null;
  }
}

export async function getViewerContextFromCookieHeader(cookieHeader, env = process.env) {
  const nextAuthViewer = await getNextAuthViewer(cookieHeader, env);
  if (nextAuthViewer) return nextAuthViewer;

  const localViewer = await getLocalViewer(cookieHeader, env);
  if (localViewer) return localViewer;

  const trialViewer = await getTrialViewer(cookieHeader, env);
  if (trialViewer) return trialViewer;

  return {
    isAuthenticated: false,
    authType: null,
    session: null,
  };
}

// Cheap presence probe (no verification) — lets the middleware distinguish
// "no trial cookie at all" (→ normal /login redirect) from "trial cookie
// present but invalid/expired/orphaned" (→ honest /connect?trial=expired).
export function hasTrialSessionCookie(cookieHeader) {
  return Boolean(getCookieValue(cookieHeader, TRIAL_SESSION_COOKIE));
}

// Trial-only session resolution — verifies just the trial cookie and skips
// the NextAuth + local-session chain. The middleware reaches for this only
// after getToken and the local-admin lookup have both returned null, so
// re-running that whole chain (as getViewerContextFromCookieHeader would)
// is wasted crypto on the edge hot path for the funnel's most important
// users. Returns the trial session object or null.
export async function resolveTrialSession(cookieHeader, env = process.env) {
  const viewer = await getTrialViewer(cookieHeader, env);
  return viewer ? viewer.session : null;
}
