'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isDemoMode } from '../lib/isDemoMode';
import {
  LayoutDashboard, Radar, Zap, CircleDot, ShieldAlert, Shield, MessageSquare,
  FileText, Users, UsersRound, BookOpen, Target, Plug, KeyRound,
  GitBranch, Settings, Bug, Calendar, BarChart3, Coins,
  Clock, Webhook, Bell, FolderKanban, Network, Scale, FileCode,
  PanelLeftClose, PanelLeft, Menu, X, MessageCircle, Activity,
} from 'lucide-react';

const navGroups = [
  {
    label: 'Overview',
    items: [
      { href: '/mission-control', icon: Radar, label: 'Mission Control' },
      { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/swarm', icon: Users, label: 'Swarm Intelligence' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/actions', icon: Zap, label: 'Decisions' },
      { href: '/approvals', icon: Clock, label: 'Approval Queue' },
      { href: '/security', icon: ShieldAlert, label: 'Security' },
      { href: '/policies', icon: Shield, label: 'Policies' },
      { href: '/messages', icon: MessageSquare, label: 'Messages' },
      { href: '/workspace', icon: FolderKanban, label: 'Workspace' },
      { href: '/routing', icon: Network, label: 'Task Routing' },
      { href: '/compliance', icon: Scale, label: 'Compliance' },
      { href: '/evaluations', icon: BarChart3, label: 'Evaluations' },
      { href: '/prompts', icon: FileCode, label: 'Prompts' },
      { href: '/feedback', icon: MessageCircle, label: 'Feedback' },
      { href: '/drift', icon: Activity, label: 'Drift Detection' },
    ],
  },
  {
    label: 'Data',
    items: [
      { href: '/content', icon: FileText, label: 'Content' },
      { href: '/relationships', icon: Users, label: 'Relationships' },
      { href: '/learning', icon: BookOpen, label: 'Learning' },
      { href: '/goals', icon: Target, label: 'Goals' },
      { href: '/tokens', icon: Coins, label: 'Token Budget' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/integrations', icon: Plug, label: 'Integrations' },
      { href: '/pairings', icon: CircleDot, label: 'Pairings' },
      { href: '/api-keys', icon: KeyRound, label: 'API Keys' },
      { href: '/team', icon: UsersRound, label: 'Team' },
      { href: '/usage', icon: BarChart3, label: 'Usage' },
      { href: '/activity', icon: Clock, label: 'Activity' },
      { href: '/webhooks', icon: Webhook, label: 'Webhooks' },
      { href: '/notifications', icon: Bell, label: 'Notifications' },
      { href: '/workflows', icon: GitBranch, label: 'Workflows' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { href: '/bug-hunter', icon: Bug, label: 'Bug Hunter' },
      { href: '/calendar', icon: Calendar, label: 'Calendar' },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const demo = isDemoMode();
  const navRef = useRef(null);

  useEffect(() => {
    const nav = navRef.current;
    if (nav) {
      const saved = sessionStorage.getItem('sidebar-scroll');
      if (saved) nav.scrollTop = parseInt(saved, 10);
    }
  }, []);

  const handleNavScroll = useCallback((e) => {
    sessionStorage.setItem('sidebar-scroll', String(e.target.scrollTop));
  }, []);

  const isActive = (href) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-5 border-b border-[rgba(255,255,255,0.06)]">
        {demo ? (
          <a
            href="https://www.dashclaw.io/"
            className="flex items-center gap-2.5 hover:opacity-90 transition-opacity"
            title="Back to dashclaw.io"
          >
            <Shield size={20} className="text-brand flex-shrink-0" />
            {!collapsed && <span className="text-lg font-semibold text-white">DashClaw</span>}
          </a>
        ) : (
          <Link href="/dashboard" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
            <Shield size={20} className="text-brand flex-shrink-0" />
            {!collapsed && <span className="text-lg font-semibold text-white">DashClaw</span>}
          </Link>
        )}
      </div>

      {/* Nav Groups */}
      <nav ref={navRef} onScroll={handleNavScroll} className="flex-1 overflow-y-auto py-3 px-2">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed && (
              <div className="px-3 mb-1.5 text-[10px] font-medium text-zinc-500 uppercase tracking-widest">
                {group.label}
              </div>
            )}
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors duration-150 mb-0.5 relative ${
                    active
                      ? 'bg-white/5 text-white'
                      : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {active && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-brand rounded-r" />
                  )}
                  <Icon size={16} className="flex-shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div className="border-t border-[rgba(255,255,255,0.06)] px-4 py-3">
        {!collapsed && (
          <div className="space-y-2">
            <div className="text-[10px] text-zinc-600">DashClaw v1.0</div>
            <div className="text-[10px] text-zinc-600">
              Powered by <Link href="/practical-systems" className="hover:text-brand transition-colors">Practical Systems</Link>
            </div>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden md:flex items-center gap-2 text-zinc-500 hover:text-zinc-300 transition-colors duration-150 mt-1 text-xs"
        >
          {collapsed ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-surface-secondary border border-[rgba(255,255,255,0.06)]"
      >
        <Menu size={18} className="text-zinc-400" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-56 bg-surface-secondary border-r border-[rgba(255,255,255,0.06)] flex flex-col">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-3 right-3 p-1.5 text-zinc-500 hover:text-white"
            >
              <X size={16} />
            </button>
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <div
        className={`hidden md:flex flex-col flex-shrink-0 bg-surface-secondary border-r border-[rgba(255,255,255,0.06)] h-screen sticky top-0 z-20 transition-all duration-200 ${
          collapsed ? 'w-14' : 'w-56'
        }`}
      >
        {sidebarContent}
      </div>
    </>
  );
}
