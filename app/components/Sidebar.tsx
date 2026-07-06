'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isDemoMode } from '../lib/isDemoMode';
import {
  Radar, Zap, ShieldAlert, Users, KeyRound,
  Settings, BarChart3, Clock, PanelLeftClose,
  PanelLeft, Menu, X, Activity, Shield, Microscope,
  Terminal, TrendingUp, GraduationCap, Plug,
  Download, Workflow, BookOpen, Wrench, Fingerprint, Bell, Inbox,
  FlaskConical, ChevronDown, Stethoscope, ClipboardCheck, Lock, ShieldCheck,
  LayoutDashboard, UserCog, Network, Award,
  DollarSign, ShoppingCart, Gauge, AppWindow, ClipboardList, Code2, Crosshair,
} from 'lucide-react';
import DashClawLogo from './DashClawLogo';

interface NavItem {
  href: string;
  icon: React.ElementType;
  label: string;
  /** Pop out into a small floating window (window.open) instead of navigating — used by the chrome-free /widget. */
  popout?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
  collapsible?: boolean;
  headerIcon?: React.ElementType;
}

const navGroups: NavGroup[] = [
  {
    label: 'Govern',
    items: [
      { href: '/mission-control', icon: Radar, label: 'Mission Control' },
      { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/decisions', icon: Zap, label: 'Decisions' },
      { href: '/approvals', icon: Clock, label: 'Approvals' },
      { href: '/work-orders', icon: ClipboardList, label: 'Work Orders' },
      { href: '/policies', icon: Shield, label: 'Policies' },
      { href: '/calibration', icon: Crosshair, label: 'Calibration' },
      { href: '/policy-coach', icon: ShieldCheck, label: 'Policy Coach' },
      { href: '/posture', icon: Gauge, label: 'Posture' },
      { href: '/agents', icon: Users, label: 'Fleet' },
      { href: '/agents/registry', icon: Network, label: 'Registry' },
      { href: '/capabilities', icon: Wrench, label: 'Capabilities' },
    ],
  },
  {
    label: 'Spend',
    items: [
      { href: '/spend', icon: DollarSign, label: 'Overview' },
      { href: '/spend/x402', icon: ShoppingCart, label: 'Purchases' },
      { href: '/spend/code', icon: Terminal, label: 'Your Claude Code' },
    ],
  },
  {
    label: 'Observe',
    items: [
      { href: '/reputation', icon: Award, label: 'Reputation' },
      { href: '/security', icon: ShieldAlert, label: 'Security' },
      { href: '/code-sessions', icon: Terminal, label: 'Code Sessions' },
      { href: '/mission-control/codebase', icon: Code2, label: 'Codebase' },
      { href: '/analytics', icon: TrendingUp, label: 'Analytics' },
      { href: '/activity', icon: Activity, label: 'Activity' },
      { href: '/widget', icon: AppWindow, label: 'Status Widget', popout: true },
      { href: '/compliance', icon: Download, label: 'Compliance' },
    ],
  },
  {
    label: 'Configure',
    items: [
      { href: '/api-keys', icon: KeyRound, label: 'API Keys' },
      { href: '/integrations', icon: Plug, label: 'Integrations' },
      { href: '/webhooks', icon: Bell, label: 'Webhooks' },
      { href: '/identities', icon: Fingerprint, label: 'Identities' },
      { href: '/team', icon: UserCog, label: 'Team' },
      { href: '/secrets', icon: Lock, label: 'Secrets' },
      { href: '/doctor', icon: Stethoscope, label: 'Doctor' },
      { href: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
  {
    label: 'Labs',
    collapsible: true,
    headerIcon: FlaskConical,
    items: [
      { href: '/assumptions', icon: Microscope, label: 'Assumptions' },
      { href: '/sessions', icon: Activity, label: 'Agent Sessions' },
      { href: '/drift', icon: TrendingUp, label: 'Drift' },
      { href: '/learning', icon: GraduationCap, label: 'Learning' },
      { href: '/scoring', icon: BarChart3, label: 'Scoring' },
      { href: '/evaluations', icon: ClipboardCheck, label: 'Evaluations' },
      { href: '/prompts', icon: Terminal, label: 'Prompts' },
      { href: '/messages', icon: Inbox, label: 'Messages' },
      { href: '/workflows', icon: Workflow, label: 'Workflows' },
      { href: '/knowledge', icon: BookOpen, label: 'Knowledge' },
      { href: '/swarm', icon: Network, label: 'Swarm' },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Labs group starts closed to keep the sidebar calm (principle 3).
  // The persisted value is applied in the effect below so SSR and the
  // first client render agree — avoids a hydration mismatch.
  const [labsOpen, setLabsOpen] = useState(false);
  const demo = isDemoMode();
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (nav) {
      const saved = sessionStorage.getItem('sidebar-scroll');
      if (saved) nav.scrollTop = parseInt(saved, 10);
    }
    try {
      const savedLabs = sessionStorage.getItem('sidebar-labs-open');
      if (savedLabs === 'true') setLabsOpen(true);
    } catch { /* sessionStorage may be unavailable */ }
  }, []);

  const handleNavScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    sessionStorage.setItem('sidebar-scroll', String((e.target as HTMLElement).scrollTop));
  }, []);

  const toggleLabs = useCallback(() => {
    setLabsOpen((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem('sidebar-labs-open', String(next));
      } catch { /* sessionStorage may be unavailable */ }
      return next;
    });
  }, []);

  const isActive = (href: string) => {
    if (href === '/mission-control') return pathname === '/mission-control' || pathname === '/';
    // Fleet (/agents) must not also light up for the sibling /agents/registry route.
    if (href === '/agents') return pathname === '/agents' || (pathname.startsWith('/agents/') && !pathname.startsWith('/agents/registry'));
    // Spend overview must not also light up for sibling /spend/* routes.
    if (href === '/spend') return pathname === '/spend';
    return pathname.startsWith(href);
  };

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        onClick={(e) => {
          if (item.popout) {
            // Float the chrome-free widget instead of navigating the dashboard
            // to it (or opening an awkward full browser tab).
            e.preventDefault();
            window.open(item.href, 'dashclaw-widget', 'popup,width=380,height=720');
          }
          setMobileOpen(false);
        }}
        title={item.popout ? `${item.label} (opens in a floating window)` : collapsed ? item.label : undefined}
        className={`relative mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-150 ${
          active
            ? 'bg-brand-subtle text-white'
            : 'text-secondary hover:bg-white/5 hover:text-white'
        }`}
      >
        {active && (
          <span aria-hidden="true" className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-brand" />
        )}
        <Icon size={16} className={`shrink-0 ${active ? 'text-brand' : ''}`} aria-hidden="true" />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    );
  };

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-5">
        {demo ? (
          <a
            href="https://www.dashclaw.io/"
            className="flex items-center gap-2.5 transition-opacity hover:opacity-90"
            title="Back to dashclaw.io"
          >
            <DashClawLogo size={20} />
            {!collapsed && <span className="text-lg font-semibold text-white">DashClaw</span>}
          </a>
        ) : (
          <Link href="/mission-control" className="flex items-center gap-2.5 transition-opacity hover:opacity-90">
            <DashClawLogo size={20} />
            {!collapsed && <span className="text-lg font-semibold text-white">DashClaw</span>}
          </Link>
        )}
      </div>

      {/* Nav Groups */}
      <nav
        ref={navRef}
        onScroll={handleNavScroll}
        aria-label="Primary"
        className="flex-1 overflow-y-auto px-2 py-3"
      >
        {navGroups.map((group) => {
          const isCollapsible = Boolean(group.collapsible);
          // Auto-expand a collapsible group when the active route lives inside it,
          // so the highlighted item is never hidden in a collapsed section.
          // (Navigating straight to a Labs route — e.g. Quality/scoring — used to
          // leave no sidebar item highlighted at all.)
          const hasActiveChild = isCollapsible && group.items.some((it) => isActive(it.href));
          const expanded = labsOpen || hasActiveChild;
          const itemsVisible = !isCollapsible || expanded;
          const HeaderIcon = group.headerIcon;
          const groupId = isCollapsible ? `nav-group-${group.label.toLowerCase()}` : undefined;
          return (
            <div key={group.label} className="mb-4">
              {isCollapsible ? (
                <button
                  type="button"
                  onClick={toggleLabs}
                  aria-expanded={expanded}
                  aria-controls={groupId}
                  title={collapsed ? group.label : undefined}
                  className={
                    collapsed
                      ? 'relative mb-1 flex w-full items-center justify-center rounded-lg px-3 py-2 text-sm text-secondary transition-colors duration-150 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40'
                      : 'mb-1.5 flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40'
                  }
                >
                  {collapsed ? (
                    HeaderIcon ? <HeaderIcon size={16} aria-hidden="true" /> : null
                  ) : (
                    <>
                      <span className="flex items-center gap-2">
                        {HeaderIcon ? <HeaderIcon size={12} aria-hidden="true" /> : null}
                        {group.label}
                      </span>
                      <ChevronDown
                        size={12}
                        aria-hidden="true"
                        className={`shrink-0 transition-transform duration-150 motion-reduce:transition-none ${
                          expanded ? 'rotate-0' : '-rotate-90'
                        }`}
                      />
                    </>
                  )}
                </button>
              ) : (
                !collapsed && (
                  <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                    {group.label}
                  </div>
                )
              )}
              <div id={groupId} hidden={!itemsVisible}>
                {group.items.map(renderNavItem)}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-border px-4 py-3">
        {!collapsed && (
          <div className="space-y-1">
            {/* Version comes from next.config.js → injected at build time
                from package.json — never hardcode here. If it ever renders
                empty, the build env injection broke. */}
            <div className="text-[11px] tabular-nums text-tertiary">DashClaw v{process.env.NEXT_PUBLIC_DASHCLAW_VERSION}</div>
            <div className="text-[11px] text-tertiary">
              Powered by{' '}
              <Link href="/practical-systems" className="text-secondary transition-colors hover:text-brand">
                Practical Systems
              </Link>
            </div>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
          className="mt-2 hidden items-center gap-2 rounded text-xs text-tertiary transition-colors hover:text-secondary md:flex"
        >
          {collapsed ? <PanelLeft size={14} aria-hidden="true" /> : <PanelLeftClose size={14} aria-hidden="true" />}
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
        aria-label="Open navigation"
        aria-expanded={mobileOpen}
        className="fixed left-3 top-3 z-50 rounded-lg border border-border bg-surface-secondary p-2 transition-colors hover:border-border-hover md:hidden"
      >
        <Menu size={18} className="text-secondary" aria-hidden="true" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute bottom-0 left-0 top-0 flex w-56 flex-col border-r border-border bg-surface-secondary">
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-3 rounded p-1.5 text-tertiary transition-colors hover:bg-white/5 hover:text-white"
            >
              <X size={16} aria-hidden="true" />
            </button>
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside
        aria-label="Primary navigation"
        className={`sticky top-0 z-20 hidden h-screen shrink-0 flex-col border-r border-border bg-surface-secondary transition-all duration-200 md:flex ${
          collapsed ? 'w-14' : 'w-56'
        }`}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
