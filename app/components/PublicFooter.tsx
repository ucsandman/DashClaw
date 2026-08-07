'use client';

import Link from 'next/link';
import { BookOpen, ExternalLink, Download } from 'lucide-react';
import DashClawLogo from './DashClawLogo';
import GithubIcon from './GithubIcon';

export default function PublicFooter() {
  return (
    <footer className="border-t border-border py-12 px-6">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <DashClawLogo size={16} />
            <span className="text-sm text-text-secondary font-medium">DashClaw</span>
          </div>
          <div className="text-xs text-text-tertiary">
            Built by <Link href="/practical-systems" className="hover:text-brand transition-colors">Practical Systems</Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center sm:justify-end gap-x-6 gap-y-3 text-sm text-text-tertiary">
          <a href="https://github.com/ucsandman/DashClaw" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-text-primary transition-colors">
            <GithubIcon size={14} />
            GitHub
          </a>
          <a href="/explain" className="hover:text-text-primary transition-colors">
            How it works
          </a>
          <Link href="/proof" className="hover:text-text-primary transition-colors">
            Proof
          </Link>
          <Link href="/docs" className="flex items-center gap-1.5 hover:text-text-primary transition-colors">
            <BookOpen size={14} />
            Docs
          </Link>
          <Link href="/guides/platform" className="hover:text-text-primary transition-colors">
            Platform Guide
          </Link>
          <Link href="/downloads" className="flex items-center gap-1.5 hover:text-text-primary transition-colors">
            <Download size={14} />
            Downloads
          </Link>
          <Link href="/demo?sandbox=1" className="flex items-center gap-1.5 hover:text-text-primary transition-colors">
            <ExternalLink size={14} />
            Live Demo
          </Link>
          <Link href="/self-host" className="hover:text-text-primary transition-colors">
            Get Started
          </Link>
          <Link href="/agents" className="hover:text-text-primary transition-colors">
            For AI agents
          </Link>
          <Link href="/privacy" className="hover:text-text-primary transition-colors">
            Privacy
          </Link>
        </div>
      </div>
    </footer>
  );
}
