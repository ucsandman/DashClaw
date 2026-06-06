// Standalone desktop status widget surface. The root layout (app/layout.tsx)
// only provides <html><body><SessionWrapper> — no Sidebar/PageLayout — so this
// nested layout just sets the dark canvas and a compact viewport. Intended to
// be opened in a small always-on-top window (browser app-mode or a native
// shell); see docs/widget.md. Mirrors app/approve/layout.tsx.

import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'DashClaw Status',
  description: 'At-a-glance agent posture and recent governed actions',
};

// theme-color is inherited from the root layout (app/layout.tsx); not repeated
// here so the surface stays token-driven with zero hardcoded color values.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function WidgetLayout({ children }: { children?: React.ReactNode }) {
  return <div className="min-h-screen bg-surface-primary text-white">{children}</div>;
}
