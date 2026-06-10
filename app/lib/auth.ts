import GitHubProvider from 'next-auth/providers/github';
import GoogleProvider from 'next-auth/providers/google';
import crypto from 'crypto';
import { getSql } from './db';
import { getAuthConfig } from './authConfig.mjs';
import { isHostedMode, hostedConfig } from './hosted/flag';
import { applyHostedTrial, markTrialFull, countActiveTrials } from './repositories/hosted-workspace.repository';

// SECURITY: In production, require real OAuth credentials. Dev mode may use mocks.
const isProd = process.env.NODE_ENV === 'production';
const authConfig = getAuthConfig();

const GITHUB_ID = process.env.GITHUB_ID || process.env.GITHUB_CLIENT_ID;
const GITHUB_SECRET = process.env.GITHUB_SECRET || process.env.GITHUB_CLIENT_SECRET;
const GOOGLE_ID = process.env.GOOGLE_ID || process.env.GOOGLE_CLIENT_ID;
const GOOGLE_SECRET = process.env.GOOGLE_SECRET || process.env.GOOGLE_CLIENT_SECRET;

const providers: any[] = [];
if (authConfig.hasGitHub) {
  providers.push(GitHubProvider({
    clientId: GITHUB_ID!,
    clientSecret: GITHUB_SECRET!,
  }));
} else if (!isProd) {
  providers.push(GitHubProvider({
    clientId: 'mock_github_id',
    clientSecret: crypto.randomBytes(24).toString('hex'),
  }));
}

if (authConfig.hasGoogle) {
  providers.push(GoogleProvider({
    clientId: GOOGLE_ID!,
    clientSecret: GOOGLE_SECRET!,
  }));
} else if (!isProd) {
  providers.push(GoogleProvider({
    clientId: 'mock_google_id',
    clientSecret: crypto.randomBytes(24).toString('hex'),
  }));
}

if (authConfig.hasOIDC) {
  const oidcProvider: any = {
    id: 'oidc',
    name: process.env.OIDC_DISPLAY_NAME || 'OIDC',
    type: 'oidc',
    issuer: process.env.OIDC_ISSUER_URL,
    clientId: process.env.OIDC_CLIENT_ID,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
    authorization: { params: { scope: 'openid email profile' } },
  };

  // Authentik and some other providers use a global authorization endpoint
  // that differs from what NextAuth constructs via {issuer}/authorize/.
  // Set OIDC_AUTHORIZATION_URL, OIDC_TOKEN_URL, and OIDC_USERINFO_URL to
  // override discovery-based endpoint resolution when needed.
  if (process.env.OIDC_AUTHORIZATION_URL) {
    oidcProvider.authorization = {
      url: process.env.OIDC_AUTHORIZATION_URL,
      params: { scope: 'openid email profile' },
    };
  }
  if (process.env.OIDC_TOKEN_URL) {
    oidcProvider.token = process.env.OIDC_TOKEN_URL;
  }
  if (process.env.OIDC_USERINFO_URL) {
    oidcProvider.userinfo = process.env.OIDC_USERINFO_URL;
  }

  providers.push(oidcProvider);
}

export const authOptions: any = {
  providers,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    async signIn({ user, account }: { user: any; account: any }) {
      try {
        const sql = getSql();
        // If mock driver, skip logic
        if (!process.env.DATABASE_URL) return true;

        const now = new Date().toISOString();

        // Upsert user on every login
        const existing = await sql`
          SELECT id, org_id, role FROM users
          WHERE provider = ${account.provider}
            AND provider_account_id = ${account.providerAccountId}
          LIMIT 1
        `;

        if (existing.length > 0) {
          // Update last login + profile info
          await sql`
            UPDATE users
            SET last_login_at = ${now},
                name = ${user.name || null},
                image = ${user.image || null},
                email = ${user.email || ''}
            WHERE id = ${existing[0]?.id}
          `;
        } else {
          // First-user promotion (fixes BUG-03): the operator of a fresh DashClaw
          // instance must be admin of their own instance. Without this, every
          // self-hosted deploy creates a member-only first user who cannot approve
          // actions in the /approvals UI and has no path to override blocked agent
          // actions without running manual SQL against their own database.
          //
          // Scope the count to 'org_default' (matches the org this INSERT targets)
          // so multi-tenant deploys don't inherit another org's user rows and
          // silently skip the promotion for a legitimately-empty org_default.
          //
          // Race window: if two users sign up simultaneously for the very first
          // time, both could pass the count check and be promoted to admin. On a
          // single-operator self-hosted deploy this is vanishingly rare, and two
          // admins is a less-broken failure mode than zero admins. Accept it.
          const countResult = await sql`
            SELECT COUNT(*)::int AS count FROM users WHERE org_id = 'org_default'
          `;
          const isFirstUser = Number(countResult[0]?.count || 0) === 0;
          const userId = `usr_${crypto.randomUUID()}`;

          // Founder bootstrap (BUG-03): the first user of a fresh instance is
          // admin of org_default so the operator can govern their own deploy.
          // SECURITY: every OTHER new account gets its OWN isolated workspace
          // instead of being dropped into the shared org_default. Previously all
          // non-first OAuth users landed in org_default together, so a stray
          // login effectively joined the instance and strangers shared a tenant.
          // Membership in someone else's workspace now only ever comes from
          // accepting an email-matched invite (see acceptInvite) — login alone
          // can no longer add anyone to another team.
          let targetOrgId = 'org_default';
          if (!isFirstUser) {
            const personalOrgId = `org_${crypto.randomUUID()}`;
            const ownerLabel = user.name || (user.email ? user.email.split('@')[0] : 'My');
            const personalOrgName = `${ownerLabel}'s workspace`;
            const personalOrgSlug = `ws-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            await sql`
              INSERT INTO organizations (id, name, slug, plan)
              VALUES (${personalOrgId}, ${personalOrgName}, ${personalOrgSlug}, 'free')
            `;
            targetOrgId = personalOrgId;

            if (isHostedMode()) {
              const cfg = hostedConfig();
              const active = await countActiveTrials(sql, { now: new Date() });
              if (active < cfg.maxActiveTrials) {
                await applyHostedTrial(sql, personalOrgId, { trialDays: cfg.trialDays, trialActionCap: cfg.trialActionCap });
              } else {
                // Fail-closed: capacity full → inert org (cap 0, expired) so enforceHostedTrial
                // 403s every write. Zero cost. The landing pre-check normally prevents reaching here.
                await markTrialFull(sql, personalOrgId);
              }
            }
          }

          // New users are admin of their OWN workspace (org_default for the
          // founder, their personal org otherwise).
          const newUserRole = 'admin';
          await sql`
            INSERT INTO users (id, org_id, email, name, image, provider, provider_account_id, role, created_at, last_login_at)
            VALUES (${userId}, ${targetOrgId}, ${user.email || ''}, ${user.name || null}, ${user.image || null}, ${account.provider}, ${account.providerAccountId}, ${newUserRole}, ${now}, ${now})
          `;
        }
        return true;
      } catch (err) {
        // Fail loud: a swallowed INSERT error here would let NextAuth proceed to
        // the jwt callback, which would find no user row for a first-time signin
        // and silently issue a role='member' token — locking the founder out of
        // their own instance with no self-correct path. Rejecting the sign-in
        // surfaces the DB failure to the operator so they can fix the root cause
        // and retry, rather than getting a wrong-role session.
        console.error('[AUTH] signIn callback error — rejecting sign-in:', (err as Error).message);
        return false;
      }
    },

    async jwt({ token, account }: { token: any; account: any }) {
      // On initial sign-in, attach org info from DB
      if (account) {
        try {
          if (!process.env.DATABASE_URL) throw new Error('No DB');

          const sql = getSql();
          const rows = await sql`
            SELECT u.id, u.org_id, u.role, COALESCE(o.plan, 'free') AS plan
            FROM users u
            LEFT JOIN organizations o ON o.id = u.org_id
            WHERE u.provider = ${account.provider}
              AND u.provider_account_id = ${account.providerAccountId}
            LIMIT 1
          `;
          if (rows.length > 0) {
            token.userId = rows[0]?.id;
            token.orgId = rows[0]?.org_id;
            token.role = rows[0]?.role;
            token.plan = rows[0]?.plan;
          } else {
            token.orgId = 'org_default';
            token.role = 'member';
            token.plan = 'free';
          }
        } catch (err) {
          if ((err as Error).message !== 'No DB') console.error('[AUTH] jwt callback error:', (err as Error).message);
          token.orgId = 'org_default';
          token.role = 'member';
          token.plan = 'free';
        }
        token.orgRefreshedAt = Date.now();
      } else if (token.userId) {
        // Periodically re-query user's org so session picks up changes (e.g. after workspace creation)
        const age = Date.now() - (token.orgRefreshedAt || 0);
        if (age > 5 * 60 * 1000) {
          try {
            if (!process.env.DATABASE_URL) throw new Error('No DB');
            const sql = getSql();
            const rows = await sql`
              SELECT u.org_id, u.role, COALESCE(o.plan, 'free') AS plan
              FROM users u
              LEFT JOIN organizations o ON o.id = u.org_id
              WHERE u.id = ${token.userId} LIMIT 1
            `;
            if (rows.length > 0) {
              token.orgId = rows[0]?.org_id;
              token.role = rows[0]?.role;
              token.plan = rows[0]?.plan;
            }
          } catch (err) {
            if ((err as Error).message !== 'No DB') console.error('[AUTH] jwt refresh error:', (err as Error).message);
          }
          token.orgRefreshedAt = Date.now();
        }
      }
      return token;
    },

    async session({ session, token }: { session: any; token: any }) {
      session.user.id = token.userId || null;
      session.user.orgId = token.orgId || 'org_default';
      session.user.role = token.role || 'member';
      session.user.plan = token.plan || 'free';
      return session;
    },
  },
};
