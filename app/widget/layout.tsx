// DashClaw Pulse — standalone ambient surface. The root layout (app/layout.tsx)
// only provides <html><body><SessionWrapper> — no Sidebar/PageLayout — so this
// nested layout sets the dark canvas and pulls in the surface-scoped motion CSS.
// Intended to live in a small always-on-top browser window (open from
// /approvals, or browser app-mode). Deliberately NOT a PWA — the status-widget
// PWA named in the THESIS kill list stays dead; this is a different instrument
// (docs/decisions/2026-08-09-widget-pulse.md).

import type { Metadata, Viewport } from 'next';
import './pulse.css';

export const metadata: Metadata = {
  title: 'DashClaw Pulse',
  description: 'Is any of this mine? Ambient governance posture for unattended agent runs.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function WidgetLayout({ children }: { children?: React.ReactNode }) {
  return <div className="min-h-screen bg-surface-primary text-primary">{children}</div>;
}
