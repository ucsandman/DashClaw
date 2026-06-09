'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import DashClawLogo from './DashClawLogo';
import GithubIcon from './GithubIcon';
import { trackMarketingEvent } from '../lib/marketingTrack';

export default function PublicNavbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = () => setMobileOpen(false);

  return (
    <nav className="fixed top-0 w-full z-50 border-b border-border bg-surface-primary/80 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
          <DashClawLogo size={20} />
          <span className="text-lg font-semibold text-text-primary">DashClaw</span>
        </Link>
        <div className="hidden sm:flex items-center gap-5 text-sm text-text-secondary whitespace-nowrap">
          <Link href="/#features" className="hover:text-text-primary transition-colors">Features</Link>
          <Link href="/connect" className="hover:text-text-primary transition-colors">Connect</Link>
          <Link href="/docs" className="hover:text-text-primary transition-colors">Docs</Link>
          <Link href="/downloads" className="hover:text-text-primary transition-colors">Downloads</Link>
          <a
            href="https://github.com/ucsandman/DashClaw"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackMarketingEvent('marketing_github_clicked', { surface: 'navbar' })}
            className="hover:text-text-primary transition-colors inline-flex items-center gap-1.5"
          >
            <GithubIcon size={14} /> GitHub
          </a>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/demo" className="px-4 py-1.5 rounded-lg bg-brand text-surface-primary text-sm font-medium hover:bg-brand-hover transition-colors whitespace-nowrap">
            Mission Control
          </Link>
          <Link href="/self-host" className="hidden sm:inline-flex px-4 py-1.5 rounded-lg bg-surface-tertiary border border-border-hover text-text-secondary text-sm font-medium hover:bg-surface-elevated hover:text-text-primary transition-colors whitespace-nowrap">
            Get Started
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={mobileOpen}
            className="sm:hidden inline-flex items-center justify-center rounded-lg border border-border-hover bg-surface-tertiary p-2 text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary"
          >
            <Menu size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={closeMobile}
            aria-hidden="true"
          />
          <div className="absolute right-0 top-0 bottom-0 flex w-72 max-w-[85vw] flex-col border-l border-border bg-surface-primary">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">Menu</span>
              <button
                type="button"
                onClick={closeMobile}
                aria-label="Close navigation menu"
                className="rounded p-1.5 text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
              <Link href="/#features" onClick={closeMobile} className="rounded-lg px-3 py-2.5 text-sm text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary">
                Features
              </Link>
              <Link href="/connect" onClick={closeMobile} className="rounded-lg px-3 py-2.5 text-sm text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary">
                Connect an Agent
              </Link>
              <Link href="/docs" onClick={closeMobile} className="rounded-lg px-3 py-2.5 text-sm text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary">
                Docs
              </Link>
              <Link href="/downloads" onClick={closeMobile} className="rounded-lg px-3 py-2.5 text-sm text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary">
                Downloads
              </Link>
              <a
                href="https://github.com/ucsandman/DashClaw"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  trackMarketingEvent('marketing_github_clicked', { surface: 'mobile_menu' });
                  closeMobile();
                }}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
              >
                <GithubIcon size={14} aria-hidden="true" /> GitHub
              </a>
            </div>
            <div className="border-t border-border px-5 py-4">
              <Link
                href="/self-host"
                onClick={closeMobile}
                className="block w-full rounded-lg bg-surface-tertiary border border-border-hover px-4 py-2 text-center text-sm font-medium text-text-primary transition-colors hover:bg-surface-elevated hover:text-text-primary"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
