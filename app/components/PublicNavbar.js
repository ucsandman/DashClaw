'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Github, ChevronDown, X, ChevronLeft, ChevronRight } from 'lucide-react';
import DashClawLogo from './DashClawLogo';

const galleryPreview = [
  { title: 'Mission Control', file: 'Mission Control.png' },
  { title: 'Dashboard', file: 'Dashboard.png' },
  { title: 'Swarm Intelligence', file: 'Swarm Intelligence.png' },
  { title: 'Workspace', file: 'workspace.png' },
  { title: 'Task Routing', file: 'Task Routing.png' },
  { title: 'Security', file: 'security.png' },
  { title: 'Compliance', file: 'Compliance.png' },
  { title: 'Token Budget', file: 'Token Budget.png' },
];

export default function PublicNavbar() {
  const router = useRouter();
  const [galleryOpen, setGalleryOpen] = useState(false);
  const dropdownRef = useRef(null);
  const timeoutRef = useRef(null);

  const openGallery = useCallback(() => {
    clearTimeout(timeoutRef.current);
    setGalleryOpen(true);
  }, []);

  const closeGallery = useCallback(() => {
    timeoutRef.current = setTimeout(() => setGalleryOpen(false), 200);
  }, []);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  return (
    <nav className="fixed top-0 w-full z-50 border-b border-[rgba(255,255,255,0.06)] bg-[#0a0a0a]/80 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
          <DashClawLogo size={20} />
          <span className="text-lg font-semibold text-white">DashClaw</span>
        </Link>
        <div className="hidden sm:flex items-center gap-6 text-sm text-zinc-400">
          <Link href="/#features" className="hover:text-white transition-colors">Features</Link>
          <div
            ref={dropdownRef}
            className="relative"
            onMouseEnter={openGallery}
            onMouseLeave={closeGallery}
          >
            <button
              className="hover:text-white transition-colors inline-flex items-center gap-1"
              onClick={() => setGalleryOpen((v) => !v)}
            >
              Gallery <ChevronDown size={13} className={`transition-transform duration-200 ${galleryOpen ? 'rotate-180' : ''}`} />
            </button>
            {galleryOpen && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 pt-3">
                <div className="w-[540px] rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#111]/95 backdrop-blur-md shadow-2xl shadow-black/60 p-4">
                  <div className="grid grid-cols-4 gap-3">
                    {galleryPreview.map((s, i) => (
                      <button
                        key={s.file}
                        onClick={(e) => {
                          e.stopPropagation();
                          setGalleryOpen(false);
                          router.push(`/gallery?v=${encodeURIComponent(s.file)}`);
                        }}
                        className="group flex flex-col gap-1.5 text-left cursor-pointer"
                      >
                        <div className="relative aspect-[16/10] rounded-lg overflow-hidden border border-[rgba(255,255,255,0.06)] bg-[#0a0a0a]">
                          <Image
                            src={`/images/screenshots/${encodeURIComponent(s.file)}`}
                            alt={s.title}
                            fill
                            sizes="130px"
                            className="object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </div>
                        <span className="text-[11px] text-zinc-500 group-hover:text-zinc-300 transition-colors truncate">{s.title}</span>
                      </button>
                    ))}
                  </div>
                  <Link
                    href="/gallery"
                    className="mt-3 flex items-center justify-center gap-1 text-xs text-brand hover:text-brand-hover transition-colors py-1.5"
                  >
                    View all screenshots →
                  </Link>
                </div>
              </div>
            )}
          </div>
          <Link href="/docs" className="hover:text-white transition-colors">Docs</Link>
          <Link href="/practical-systems" className="hover:text-white transition-colors">Practical Systems</Link>
          <a
            href="https://github.com/ucsandman/DashClaw"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white transition-colors inline-flex items-center gap-1.5"
          >
            <Github size={14} /> GitHub
          </a>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="px-4 py-1.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors">
            Dashboard
          </Link>
          <Link href="/self-host" className="hidden sm:inline-flex px-4 py-1.5 rounded-lg bg-[#1a1a1a] border border-[rgba(255,255,255,0.1)] text-zinc-300 text-sm font-medium hover:bg-[#222] hover:text-white transition-colors">
            Get Started
          </Link>
        </div>
      </div>
    </nav>
  );
}
