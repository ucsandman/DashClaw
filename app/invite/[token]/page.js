'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Check, Clock, AlertTriangle, Ban, Users, Shield } from 'lucide-react';
import DashClawLogo from '../../components/DashClawLogo';

export default function InviteAcceptPage() {
  const { token } = useParams();
  const { data: session, status: sessionStatus } = useSession();

  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!token) return;
    async function fetchInvite() {
      try {
        const res = await fetch(`/api/invite/${token}`);
        const json = await res.json();
        if (!res.ok) {
          setError(json.error || 'Failed to load invite');
          setLoading(false);
          return;
        }
        setInvite(json.invite);
      } catch {
        setError('Failed to connect');
      } finally {
        setLoading(false);
      }
    }
    fetchInvite();
  }, [token]);

  const handleAccept = async () => {
    setAccepting(true);
    setError(null);
    try {
      const res = await fetch(`/api/invite/${token}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to accept invite');
        setAccepting(false);
        return;
      }
      setAccepted(true);
      // Full page reload to refresh JWT with new org_id
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 1500);
    } catch {
      setError('Failed to accept invite');
      setAccepting(false);
    }
  };

  // Not logged in
  if (sessionStatus === 'loading') {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (sessionStatus === 'unauthenticated') {
    // Middleware should redirect to login, but just in case
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <DashClawLogo size={32} className="mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Sign in Required</h1>
          <p className="text-sm text-zinc-400 mb-6">You need to sign in before accepting this invite.</p>
          <a
            href={`/login`}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand hover:bg-brand/90 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Sign In
          </a>
        </div>
      </div>
    );
  }

  // Loading invite
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Error state
  if (error && !invite) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={24} className="text-red-400" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Invalid Invite</h1>
          <p className="text-sm text-zinc-400 mb-6">{error}</p>
          <a
            href="/dashboard"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-surface-secondary border border-[rgba(255,255,255,0.06)] text-white text-sm font-medium rounded-lg hover:bg-surface-tertiary transition-colors"
          >
            Go to Dashboard
          </a>
        </div>
      </div>
    );
  }

  // Invite status handling
  const isExpired = invite?.status === 'expired';
  const isAccepted = invite?.status === 'accepted';
  const isRevoked = invite?.status === 'revoked';
  const isValid = invite?.status === 'pending';

  // Icon + title for non-valid states
  const getStatusDisplay = () => {
    if (accepted) {
      return {
        icon: <Check size={24} className="text-green-400" />,
        iconBg: 'bg-green-500/10',
        title: 'Invite Accepted!',
        desc: 'Redirecting to dashboard...',
      };
    }
    if (isExpired) {
      return {
        icon: <Clock size={24} className="text-zinc-400" />,
        iconBg: 'bg-zinc-500/10',
        title: 'Invite Expired',
        desc: 'This invite link has expired. Ask the workspace admin for a new one.',
      };
    }
    if (isAccepted) {
      return {
        icon: <Check size={24} className="text-zinc-400" />,
        iconBg: 'bg-zinc-500/10',
        title: 'Already Accepted',
        desc: 'This invite has already been used.',
      };
    }
    if (isRevoked) {
      return {
        icon: <Ban size={24} className="text-zinc-400" />,
        iconBg: 'bg-zinc-500/10',
        title: 'Invite Revoked',
        desc: 'This invite has been revoked by the workspace admin.',
      };
    }
    return null;
  };

  const statusDisplay = getStatusDisplay();

  if (statusDisplay) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className={`w-12 h-12 rounded-xl ${statusDisplay.iconBg} flex items-center justify-center mx-auto mb-4`}>
            {statusDisplay.icon}
          </div>
          <h1 className="text-xl font-bold text-white mb-2">{statusDisplay.title}</h1>
          <p className="text-sm text-zinc-400 mb-6">{statusDisplay.desc}</p>
          {!accepted && (
            <a
              href="/dashboard"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-surface-secondary border border-[rgba(255,255,255,0.06)] text-white text-sm font-medium rounded-lg hover:bg-surface-tertiary transition-colors"
            >
              Go to Dashboard
            </a>
          )}
        </div>
      </div>
    );
  }

  // Valid invite — show accept UI
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-brand-subtle flex items-center justify-center mx-auto mb-4">
            <Users size={24} className="text-brand" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">
            Join {invite.org_name}
          </h1>
          <p className="text-sm text-zinc-400">
            You&apos;ve been invited to join as {invite.role === 'admin' ? 'an' : 'a'}{' '}
            <span className={invite.role === 'admin' ? 'text-amber-400 font-medium' : 'text-zinc-200 font-medium'}>
              {invite.role}
            </span>
          </p>
        </div>

        {/* Invite details */}
        <div className="bg-surface-secondary border border-[rgba(255,255,255,0.06)] rounded-xl p-4 mb-6 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">Workspace</span>
            <span className="text-zinc-200 font-medium">{invite.org_name}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">Role</span>
            <span className={invite.role === 'admin' ? 'text-amber-400 font-medium' : 'text-zinc-200 font-medium'}>
              {invite.role}
            </span>
          </div>
          {invite.email && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Restricted to</span>
              <span className="text-zinc-200">{invite.email}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">Expires</span>
            <span className="text-zinc-400">{new Date(invite.expires_at).toLocaleDateString()}</span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Accept button */}
        <button
          onClick={handleAccept}
          disabled={accepting}
          className="w-full px-4 py-2.5 bg-brand hover:bg-brand/90 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {accepting ? 'Joining...' : 'Accept Invite'}
        </button>

        <div className="text-center mt-4">
          <a href="/dashboard" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
            Skip — go to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
