'use client';

// /team — seats: who is in this workspace, and who is invited.
// Invites are email-matched: record the address a teammate signs in with
// (Google/GitHub/OIDC) and their first sign-in lands them here instead of
// minting a personal workspace. No invite emails are sent, no links exist —
// tell the teammate yourself. Admin-only (the API refuses everyone else).
import { useCallback, useEffect, useState } from 'react';
import PageLayout from '../components/PageLayout';
import { Skeleton } from '../components/ui/Skeleton';
import { UserPlus, X } from 'lucide-react';

type Member = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: string | null;
  last_login_at: string | null;
};
type Invite = { id: string; email: string; role: string; createdAt: string; expiresAt: string; expired: boolean };
type TeamData = { org: { id: string; name: string } | null; members: Member[]; invites: Invite[] };

const ERROR_COPY: Record<string, string> = {
  invalid_email: 'That does not look like an email address.',
  invalid_role: 'Role must be admin or member.',
  already_member: 'That address already belongs to a member of this workspace.',
  already_invited: 'That address already has a live invite.',
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span className="rounded border border-border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-secondary">
      {role}
    </span>
  );
}

export default function TeamPage() {
  const [data, setData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchTeam = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/team/invites', { cache: 'no-store' });
      if (res.status === 403) {
        setLoadError('Seat management requires a signed-in workspace admin.');
        setData(null);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch {
      setLoadError('Failed to load the team.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  const invite = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      setFormError(null);
      try {
        const res = await fetch('/api/team/invites', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, role }),
        });
        const body = await res.json();
        if (!res.ok) {
          setFormError(ERROR_COPY[body.error] || 'The invite was not recorded.');
          return;
        }
        setEmail('');
        await fetchTeam();
      } catch {
        setFormError('Could not reach the server.');
      } finally {
        setSubmitting(false);
      }
    },
    [email, role, fetchTeam],
  );

  const revoke = useCallback(
    async (inviteId: string) => {
      try {
        const res = await fetch('/api/team/invites', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ invite_id: inviteId }),
        });
        if (!res.ok) setFormError('The invite could not be revoked.');
      } catch {
        setFormError('Could not reach the server.');
      }
      await fetchTeam();
    },
    [fetchTeam],
  );

  return (
    <PageLayout
      title="Team"
      subtitle="Seats in this workspace, and the addresses invited to join it."
      agentFilter={false}
    >
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-border bg-surface-secondary px-4 py-6 text-sm text-secondary">
          {loadError}
        </div>
      ) : data ? (
        <div className="max-w-3xl space-y-4">
          <div className="rounded-xl border border-border bg-surface-secondary">
            <div className="border-b border-border px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
              Members ({data.members.length})
            </div>
            <ul>
              {data.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between border-t border-border px-4 py-2.5 first:border-t-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-primary">{m.name || m.email}</div>
                    {m.name && <div className="truncate text-[12px] text-tertiary">{m.email}</div>}
                  </div>
                  <RoleBadge role={m.role} />
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-surface-secondary">
            <div className="border-b border-border px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
              Pending invites ({data.invites.length})
            </div>
            {data.invites.length > 0 ? (
              <ul>
                {data.invites.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 first:border-t-0">
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="truncate text-sm text-primary">{inv.email}</span>
                      <RoleBadge role={inv.role} />
                      {inv.expired && (
                        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-warning">expired</span>
                      )}
                    </div>
                    <button
                      onClick={() => revoke(inv.id)}
                      aria-label={`Revoke invite for ${inv.email}`}
                      className="rounded p-1 text-tertiary transition-colors hover:bg-surface-tertiary hover:text-primary"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-5 text-sm text-tertiary">No pending invites.</div>
            )}

            <form onSubmit={invite} className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
                aria-label="Email address to invite"
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-brand focus:outline-none"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                aria-label="Role for the invited teammate"
                className="rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-primary focus:border-brand focus:outline-none"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-black transition-colors hover:bg-brand-hover disabled:opacity-60"
              >
                <UserPlus size={14} aria-hidden="true" />
                {submitting ? 'Inviting…' : 'Invite'}
              </button>
            </form>
            {formError && <div className="px-4 pb-3 text-[12px] text-warning">{formError}</div>}
            <div className="border-t border-border px-4 py-3 text-[12px] text-tertiary">
              No email is sent. When this address signs in for the first time, they join this workspace with the
              chosen role — tell them yourself.
            </div>
          </div>
        </div>
      ) : null}
    </PageLayout>
  );
}
