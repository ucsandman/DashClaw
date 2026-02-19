'use client';

import Link from 'next/link';
import { Github, BookOpen, Eye, Terminal, ExternalLink } from 'lucide-react';
import DashClawLogo from './DashClawLogo';

export default function PublicFooter() {
  return (
    <footer className="border-t border-[rgba(255,255,255,0.06)] py-12 px-6">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <DashClawLogo size={16} />
            <span className="text-sm text-zinc-400 font-medium">DashClaw</span>
          </div>
          <div className="text-xs text-zinc-600">
            Built by <Link href="/practical-systems" className="hover:text-brand transition-colors">Practical Systems</Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center sm:justify-end gap-x-6 gap-y-3 text-sm text-zinc-500">
          <a href="https://github.com/ucsandman/DashClaw" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-zinc-300 transition-colors">
            <Github size={14} />
            GitHub
          </a>
          <Link href="/docs" className="flex items-center gap-1.5 hover:text-zinc-300 transition-colors">
            <BookOpen size={14} />
            Docs
          </Link>
          <Link href="/gallery" className="flex items-center gap-1.5 hover:text-zinc-300 transition-colors">
            <Eye size={14} />
            Gallery
          </Link>
          <Link href="/toolkit" className="flex items-center gap-1.5 hover:text-zinc-300 transition-colors">
            <Terminal size={14} />
            Toolkit
          </Link>
          <Link href="/dashboard" className="flex items-center gap-1.5 hover:text-zinc-300 transition-colors">
            <ExternalLink size={14} />
            Dashboard
          </Link>
          <Link href="/self-host" className="hover:text-zinc-300 transition-colors">
            Get Started
          </Link>
        </div>
      </div>
    </footer>
  );
}
