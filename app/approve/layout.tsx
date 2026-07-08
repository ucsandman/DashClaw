// Standalone mobile approval surface. Root layout (app/layout.js) already wraps
// the tree in SessionWrapper, so nested components can call useSession()
// directly. Intentionally no PageLayout/Sidebar/breadcrumbs — this is an
// installable PWA start surface for on-the-go approvals.

import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'DashClaw Approvals',
  description: 'Approve agent actions from your phone',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0e1014',
};

export default function ApproveLayout({ children }: { children?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-primary text-white">
      {children}
    </div>
  );
}
