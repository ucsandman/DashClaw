'use client';

import Sidebar from './Sidebar';
import NotificationCenter from './NotificationCenter';
import AgentFilterDropdown from './AgentFilterDropdown';
import UserMenu from './UserMenu';
import RealtimeIndicator from './RealtimeIndicator';
import DemoBanner from './DemoBanner';
import SystemStatusBar from './SystemStatusBar';

const MATURITY_BADGE: Record<string, { label: string; color: string }> = {
  stable: { label: 'Stable', color: 'bg-success-subtle text-success border-success/20' },
  beta: { label: 'Beta', color: 'bg-warning-subtle text-warning border-warning/20' },
  experimental: { label: 'Experimental', color: 'bg-surface-tertiary text-secondary border-border-hover' },
};

interface PageLayoutProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  breadcrumbs?: any;
  actions?: React.ReactNode;
  maturity?: any;
  /**
   * Set false on pages whose content is org/config-level and ignores the
   * global agent picker — the dropdown then carries a subdued "Org-wide page"
   * hint instead of silently implying filtering that never happens.
   */
  agentFilter?: boolean;
  children?: React.ReactNode;
}

export default function PageLayout({ title, subtitle, breadcrumbs, actions, maturity, agentFilter = true, children }: PageLayoutProps) {
  return (
    <div className="fixed inset-0 flex overflow-hidden bg-surface-primary">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <DemoBanner />
        {/* Page header */}
        <header className="sticky top-0 z-10 bg-surface-primary/80 backdrop-blur-sm border-b border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4">
            <div className="min-w-0">
              {breadcrumbs && (
                <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                  {breadcrumbs.map((crumb: React.ReactNode, i: number) => (
                    <span key={i} className="flex items-center gap-1.5">
                      {i > 0 && <span aria-hidden="true" className="text-zinc-700">/</span>}
                      <span className={i === breadcrumbs.length - 1 ? 'text-secondary' : ''}>
                        {crumb}
                      </span>
                    </span>
                  ))}
                </nav>
              )}
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white truncate">{title}</h1>
                {maturity && MATURITY_BADGE[maturity] && (
                  <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold uppercase tracking-[0.08em] border shrink-0 ${MATURITY_BADGE[maturity].color}`}>
                    {MATURITY_BADGE[maturity].label}
                  </span>
                )}
              </div>
              {subtitle && <p className="mt-1 hidden text-sm text-secondary sm:block">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <span className="hidden md:flex"><RealtimeIndicator /></span>
              <span className="hidden sm:flex"><AgentFilterDropdown pageScoped={agentFilter} /></span>
              {actions}
              <NotificationCenter />
              <UserMenu />
            </div>
          </div>
        </header>
        <SystemStatusBar />
        <div className="p-4 sm:p-6">{children}</div>
      </main>
    </div>
  );
}
