'use client';

// /claim — bind an anonymous hosted-trial workspace to a real account.
// The browser holds both credentials: the trial cookie says WHICH org, the
// NextAuth session says WHO. The page walks the only three states that
// matter: not signed in → sign in with Google; signed in + claimable →
// one confirm button; done → session refresh and into the workspace.
// Off-hosted the API 404s and the page says so plainly.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import DashClawLogo from '../components/DashClawLogo';

type Preview = {
  claimable: boolean;
  reason?: string;
  already_yours?: boolean;
  signed_in: boolean;
  current_workspace_movable: boolean | null;
  workspace?: { org_id: string; name: string; actions_used: number };
};

const REASON_COPY: Record<string, string> = {
  no_trial_session: 'This browser holds no trial workspace. Start one from the connect page first.',
  not_found: 'This trial workspace no longer exists. Expired trials are removed on a daily sweep.',
  expired: 'This trial has expired. Its data is removed on the next daily sweep, so it can no longer be claimed.',
  not_trial: 'This workspace is not a trial, so there is nothing to claim.',
  already_claimed: 'This workspace has already been claimed by another account.',
};

export default function ClaimPage() {
  const router = useRouter();
  const { update } = useSession();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'claiming' | 'done'>('loading');
  const [error, setError] = useState<string | null>(null);

  const fetchPreview = useCallback(async () => {
    try {
      const res = await fetch('/api/hosted/claim', { cache: 'no-store' });
      if (res.status === 404) {
        setError('Claiming only exists on the hosted instance.');
        setStatus('error');
        return;
      }
      const body = await res.json();
      if (!res.ok) {
        setError(REASON_COPY[body.error] || 'This workspace cannot be claimed.');
        setStatus('error');
        return;
      }
      setPreview(body);
      setStatus('ready');
    } catch {
      setError('Could not reach the claim service. Retry in a moment.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const claim = useCallback(async () => {
    setStatus('claiming');
    try {
      const res = await fetch('/api/hosted/claim', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        setError(
          body.error === 'current_workspace_not_empty'
            ? 'Your account already owns a workspace with history, so it cannot absorb this trial. Claiming moves your account — it never merges or discards existing work.'
            : REASON_COPY[body.error] || 'The claim did not go through.',
        );
        setStatus('error');
        return;
      }
      // Refresh the JWT so the session points at the claimed org immediately.
      await update();
      setStatus('done');
      setTimeout(() => router.push('/decisions'), 900);
    } catch {
      setError('Could not reach the claim service. Retry in a moment.');
      setStatus('error');
    }
  }, [router, update]);

  const notYetClaimable =
    preview && !preview.claimable && preview.reason === 'already_claimed' && preview.already_yours;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-primary px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <DashClawLogo />
        </div>
        <div className="rounded-xl border border-border bg-surface-secondary p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-brand" aria-hidden="true" />
            <h1 className="text-lg font-semibold text-white">Claim this workspace</h1>
          </div>

          {status === 'loading' && (
            <p className="mt-3 text-sm text-secondary">Checking this browser&apos;s trial workspace…</p>
          )}

          {status === 'error' && (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-secondary">{error}</p>
              <a href="/connect" className="inline-flex items-center gap-1 text-sm text-brand hover:text-brand-hover">
                Go to connect <ArrowRight size={14} aria-hidden="true" />
              </a>
            </div>
          )}

          {status === 'done' && (
            <p className="mt-3 text-sm text-secondary">
              Claimed. This workspace now belongs to your account — taking you to it.
            </p>
          )}

          {(status === 'ready' || status === 'claiming') && preview && (
            <div className="mt-3 space-y-4">
              {preview.claimable && preview.workspace && (
                <div className="rounded-lg border border-border bg-surface-primary px-4 py-3 text-sm">
                  <div className="text-secondary">
                    Trial workspace with{' '}
                    <span className="tabular-nums text-primary">{preview.workspace.actions_used}</span> governed{' '}
                    {preview.workspace.actions_used === 1 ? 'action' : 'actions'} recorded.
                  </div>
                  <div className="mt-1 text-[12px] text-tertiary">
                    Claiming keeps every decision, policy, and key. The workspace stops expiring and is renamed
                    after you. Anonymous browser access to it ends.
                  </div>
                </div>
              )}

              {notYetClaimable && (
                <p className="text-sm text-secondary">
                  You already claimed this workspace. Continuing will finish attaching it to your account.
                </p>
              )}

              {!preview.signed_in ? (
                <button
                  onClick={() => signIn('google', { callbackUrl: '/claim' })}
                  className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-brand-hover"
                >
                  Sign in with Google to claim
                </button>
              ) : (
                <button
                  onClick={claim}
                  disabled={status === 'claiming'}
                  className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-brand-hover disabled:opacity-60"
                >
                  {status === 'claiming' ? 'Claiming…' : 'Claim this workspace'}
                </button>
              )}

              {preview.signed_in && preview.current_workspace_movable === false && (
                <p className="text-[12px] text-warning">
                  Your account already owns a workspace with history. Claiming is blocked so nothing is lost.
                </p>
              )}
            </div>
          )}
        </div>
        <p className="mt-4 text-center text-[12px] text-tertiary">
          Free while claimed. Trials that are never claimed expire and are removed.
        </p>
      </div>
    </div>
  );
}
