'use client';

import { useEffect, useState } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Github, Key } from 'lucide-react';
import DashClawLogo from '../components/DashClawLogo';

export default function LoginPage() {
  const { data: session, status } = useSession();
  const [providers, setProviders] = useState([]);
  const [isProd, setIsProd] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/dashboard');
    }
  }, [status, router]);

  useEffect(() => {
    async function fetchProviders() {
      try {
        const res = await fetch('/api/auth/config');
        if (res.ok) {
          const data = await res.json();
          setProviders(data.providers || []);
          setIsProd(data.isProd);
        }
      } catch (err) {
        console.error('Failed to fetch auth providers:', err);
      }
    }
    fetchProviders();
  }, []);

  if (status === 'loading' || status === 'authenticated') {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <DashClawLogo size={32} />
          </div>
          <h1 className="text-2xl font-bold text-white">Sign in to DashClaw</h1>
          <p className="text-sm text-zinc-400 mt-2">Agent governance starts here.</p>
        </div>

        <div className="space-y-3">
          {providers.map((provider) => (
            <button
              key={provider.id}
              onClick={() => signIn(provider.id, { callbackUrl: '/dashboard' })}
              className={`w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                provider.id === 'github'
                  ? 'bg-white text-black hover:bg-zinc-200'
                  : 'bg-[#1a1a1a] border border-[rgba(255,255,255,0.1)] text-white hover:bg-[#222]'
              }`}
            >
              {provider.id === 'github' && <Github size={18} />}
              {provider.id === 'google' && <GoogleIcon />}
              {provider.id === 'oidc' && <Key size={18} />}
              Continue with {provider.name}
            </button>
          ))}

          {providers.length === 0 && (
            <p className="text-xs text-red-400 text-center py-4">
              No authentication providers configured. Check your environment variables.
            </p>
          )}
        </div>

        {!isProd && !providers.some(p => p.id === 'oidc') && (
          <div className="mt-6 p-3 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-500 text-center">
            <p className="font-semibold text-zinc-400 mb-1">Want to use Authentik/OIDC?</p>
            Add <code className="bg-black px-1 py-0.5 rounded text-zinc-300">OIDC_CLIENT_ID</code>, <code className="bg-black px-1 py-0.5 rounded text-zinc-300">OIDC_CLIENT_SECRET</code>, and <code className="bg-black px-1 py-0.5 rounded text-zinc-300">OIDC_ISSUER_URL</code> to your .env file.
          </div>
        )}

        <p className="text-xs text-zinc-600 text-center mt-6">
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
