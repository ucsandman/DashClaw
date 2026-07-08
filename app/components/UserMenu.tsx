'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Image from 'next/image';
import { LogOut, User } from 'lucide-react';
import { isDemoMode } from '../lib/isDemoMode';
import { resetAllTips } from './HelpIcon';

export default function UserMenu() {
  const isDemo = isDemoMode();
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (status === 'loading') {
    return <div className="h-8 w-8 animate-pulse rounded-full bg-surface-tertiary" />;
  }

  const { user }: any = session || { user: { name: 'Local Admin', email: 'Admin Mode' } };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        aria-label="User menu"
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full transition-all hover:ring-2 hover:ring-border-hover focus:outline-none focus:ring-2 focus:ring-brand/40"
      >
        {user.image ? (
          <Image
            src={user.image}
            alt={user.name || 'User'}
            width={32}
            height={32}
            className="rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-tertiary">
            <User size={16} className="text-secondary" aria-hidden="true" />
          </div>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-medium text-white">{user.name || 'User'}</p>
            <p className="truncate text-xs text-tertiary">{user.email}</p>
          </div>
          <div className="p-1.5">
            <button
              onClick={() => { resetAllTips(); window.location.reload(); }}
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-secondary transition-colors hover:bg-white/5 hover:text-white"
            >
              Reset tips
            </button>
          </div>
          {!isDemo && (
            <div className="border-t border-border p-1.5">
              <button
                onClick={async () => {
                  await fetch('/api/auth/local', { method: 'DELETE' });
                  signOut({ callbackUrl: '/' });
                }}
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-secondary transition-colors hover:bg-white/5 hover:text-white"
              >
                <LogOut size={14} aria-hidden="true" />
                Sign out
              </button>
            </div>
          )}
          {isDemo && (
            <div className="border-t border-border p-1.5">
              {/* Cookie-based demo: user can exit back to real mode.
                  Env-based demo (NEXT_PUBLIC_DASHCLAW_MODE=demo): no real mode exists. */}
              {process.env.NEXT_PUBLIC_DASHCLAW_MODE === 'demo' ? (
                <div className="px-3 py-2 text-xs text-tertiary">
                  Demo mode, read-only with sample data.
                </div>
              ) : (
                <button
                  onClick={() => {
                    document.cookie = 'dashclaw_demo=; path=/; max-age=0';
                    window.location.href = '/';
                  }}
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-secondary transition-colors hover:bg-white/5 hover:text-white"
                >
                  <LogOut size={14} aria-hidden="true" />
                  Exit demo
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
