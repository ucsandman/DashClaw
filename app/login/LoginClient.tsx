'use client';

import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Key } from 'lucide-react';
import DashClawLogo from '../components/DashClawLogo';
import GithubIcon from '../components/GithubIcon';
import LocalPasswordForm from './LocalPasswordForm';
import { useEffectiveRole } from '../hooks/useEffectiveRole';

interface LoginClientProps {
  localAuthEnabled?: boolean;
}

export default function LoginClient({ localAuthEnabled }: LoginClientProps) {
  // BUG-03b: the previous `useSession().status === 'authenticated'` redirect
  // missed local-password admins (NextAuth doesn't see the local-session
  // cookie), so visiting /login while already signed in via the local path
  // left them staring at the sign-in form. useEffectiveRole sees both paths.
  const { authenticated, settled: sessionSettled } = useEffectiveRole();
  const [providers, setProviders] = useState<any[]>([]);
  const [isProd, setIsProd] = useState(true);
  const [authMessage, setAuthMessage] = useState('');
  const [localPasswordEnabled, setLocalPasswordEnabled] = useState(localAuthEnabled);
  // 'idle' | 'exchanging' | 'failed' — `npx dashclaw up` opens /login?ott=<one-time
  // token>; we exchange it for a session here so the browser lands signed in.
  const [ottStatus, setOttStatus] = useState<'idle' | 'exchanging' | 'failed'>('idle');
  const router = useRouter();

  useEffect(() => {
    if (sessionSettled && authenticated) {
      router.replace('/approvals');
    }
  }, [sessionSettled, authenticated, router]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ott = params.get('ott');
    if (!ott) return;
    // Only same-origin paths — never a protocol-relative or absolute URL — so
    // the link can't be abused as an open redirect. Resolved through the URL
    // constructor because browsers normalize `\` to `/` (a bare leading-slash
    // regex passes `/\evil.com`, which navigates cross-origin).
    const next = params.get('next');
    let dest = '/approvals';
    if (next) {
      try {
        const resolved = new URL(next, window.location.origin);
        if (resolved.origin === window.location.origin && next.startsWith('/')) {
          dest = resolved.pathname + resolved.search + resolved.hash;
        }
      } catch { /* best-effort: unparseable next param — keep the default */ }
    }
    // Strip the token from the address bar (and history) before exchanging.
    window.history.replaceState(null, '', '/login');
    setOttStatus('exchanging');
    (async () => {
      try {
        const res = await fetch('/api/auth/local', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ott }),
        });
        if (res.ok) {
          // Hard redirect so the fresh session cookie rides the next request.
          window.location.replace(dest);
        } else {
          setOttStatus('failed');
        }
      } catch {
        setOttStatus('failed');
      }
    })();
  }, []);

  useEffect(() => {
    async function fetchProviders() {
      try {
        const res = await fetch('/api/auth/config');
        if (res.ok) {
          const data = await res.json();
          setProviders(data.providers || []);
          setIsProd(Boolean(data.isProd));
          setAuthMessage(data.message || '');
          setLocalPasswordEnabled(Boolean(data.localAuthEnabled ?? localAuthEnabled));
        }
      } catch (err) {
        console.error('Failed to fetch auth providers:', err);
      }
    }
    fetchProviders();
  }, [localAuthEnabled]);

  if (!sessionSettled || authenticated || ottStatus === 'exchanging') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-primary">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-primary px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <DashClawLogo size={32} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-primary">Sign in to DashClaw</h1>
          <p className="mt-2 text-sm text-secondary">
            {localPasswordEnabled
              ? 'Use the admin password you set during setup, or choose an identity provider.'
              : 'Agent governance starts here.'}
          </p>
        </div>

        <div className="space-y-3">
          {ottStatus === 'failed' && (
            <p role="alert" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-center text-xs text-warning">
              That sign-in link has expired. Use the admin password from your setup output
              (also saved in the app&apos;s .env.local), or re-run <code className="font-mono">npx dashclaw up</code> for a fresh link.
            </p>
          )}
          {providers.map((provider) => (
            <button
              key={provider.id}
              onClick={() => signIn(provider.id, { callbackUrl: '/approvals' })}
              className={`flex w-full items-center justify-center gap-2.5 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                provider.id === 'github'
                  ? 'bg-white text-black hover:bg-zinc-200'
                  : 'border border-border bg-surface-tertiary text-secondary hover:border-border-hover hover:text-white'
              }`}
            >
              {provider.id === 'github' && <GithubIcon size={18} aria-hidden="true" />}
              {provider.id === 'google' && <GoogleIcon />}
              {provider.id === 'oidc' && <Key size={18} aria-hidden="true" />}
              Continue with {provider.name}
            </button>
          ))}

          {providers.length === 0 && !localPasswordEnabled && (
            <p className="py-4 text-center text-xs text-warning">
              {authMessage || 'No dashboard sign-in method is configured yet.'}
            </p>
          )}

          {localPasswordEnabled && <LocalPasswordForm />}
        </div>

        {!isProd && !providers.some(p => p.id === 'oidc') && (
          <div className="mt-6 rounded-lg border border-border bg-surface-secondary p-3 text-center text-xs text-secondary">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
              Want to use Authentik / OIDC?
            </p>
            Add{' '}
            <code className="rounded border border-border bg-surface-tertiary px-1 py-0.5 font-mono text-secondary">OIDC_CLIENT_ID</code>,{' '}
            <code className="rounded border border-border bg-surface-tertiary px-1 py-0.5 font-mono text-secondary">OIDC_CLIENT_SECRET</code>, and{' '}
            <code className="rounded border border-border bg-surface-tertiary px-1 py-0.5 font-mono text-secondary">OIDC_ISSUER_URL</code>{' '}
            to your .env file.
          </div>
        )}

        <p className="mt-6 text-center text-xs text-tertiary">
          By signing in, you agree to our terms of service.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}
