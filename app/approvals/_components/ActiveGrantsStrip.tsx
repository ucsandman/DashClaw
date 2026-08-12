'use client';

import { useState, useEffect } from 'react';
import { BellOff, ChevronDown, ChevronRight } from 'lucide-react';
import { grantExpiresAt } from '../../lib/policy-shapes';

/**
 * "Things you told me to stop asking about", above the pending queue.
 *
 * Creating a mute in one click while revoking it required a trip to /policies
 * would fail the human-operability contract in HUMAN-EXPERIENCE.md. Revoke is
 * a button here, on the same page the grant was created from.
 *
 * Renders nothing when there are no live grants, so the hero surface stays
 * clean for the common case.
 *
 * Grants accumulate one click at a time and never self-trim, so past a handful
 * the full list buries the pending queue this page exists for. Above
 * COMPACT_AT the strip collapses to its one-line count and the list opens on
 * demand, inside a bounded scroll box.
 */

const COMPACT_AT = 3;

export interface GrantRow {
  id: string;
  name: string;
  rules: string;
  created_at?: string;
}

function remaining(expires: Date | null, now: number): string {
  if (!expires) return 'no expiry';
  const ms = expires.getTime() - now;
  if (ms <= 0) return 'expired';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h left`;
  return `${Math.floor(hours / 24)}d left`;
}

function parseRules(raw: string): { action_type?: string; target_prefix?: string; expires_at?: string } {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export default function ActiveGrantsStrip({
  grants,
  onRevokedAction,
}: {
  grants: GrantRow[];
  onRevokedAction: () => void;
}) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Clock in state, not Date.now() during render: render stays pure (the
  // react-hooks/purity rule), and the countdowns tick on their own instead of
  // freezing until something else re-renders the page.
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const live = grants.filter((g) => {
    const exp = grantExpiresAt(parseRules(g.rules), g.created_at);
    // now === 0 is the pre-mount frame: show everything rather than blank the
    // strip, and let the first tick drop anything already expired.
    return exp == null || now === 0 || exp.getTime() > now;
  });

  if (live.length === 0) return null;

  const revoke = async (id: string) => {
    try {
      setRevoking(id);
      const res = await fetch('/api/policies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, active: false }),
      });
      if (!res.ok) throw new Error('Revoke failed');
      onRevokedAction();
    } catch {
      alert('Could not revoke that grant. Try again, or turn it off on /policies.');
    } finally {
      setRevoking(null);
    }
  };

  const collapsible = live.length > COMPACT_AT;
  const showList = !collapsible || open;
  const label = `${live.length} ${live.length === 1 ? 'thing' : 'things'} you told me to stop asking about`;

  return (
    <div className="mb-6 rounded-lg border border-border bg-surface-secondary p-4">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`flex w-full items-center gap-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary transition-colors hover:text-secondary ${open ? 'mb-3' : ''}`}
        >
          <BellOff size={11} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      ) : (
        <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
          <BellOff size={11} />
          {label}
        </div>
      )}
      {showList && (
        <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {live.map((g) => {
            const rules = parseRules(g.rules);
            const exp = grantExpiresAt(rules, g.created_at);
            return (
              <li key={g.id} className="flex items-center gap-3 text-xs">
                <code className="min-w-0 flex-1 truncate font-mono text-secondary" title={`${rules.action_type} → ${rules.target_prefix}`}>
                  {rules.action_type} → {rules.target_prefix}
                </code>
                <span className="shrink-0 tabular-nums text-tertiary">{remaining(exp, now)}</span>
                <button
                  onClick={() => revoke(g.id)}
                  disabled={revoking === g.id}
                  className="shrink-0 rounded border border-border px-2 py-1 font-medium text-secondary transition-colors hover:border-error/40 hover:text-error focus:outline-none disabled:opacity-50"
                >
                  {revoking === g.id ? 'Revoking…' : 'Revoke'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
