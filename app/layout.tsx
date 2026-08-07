import localFont from 'next/font/local'
import type { Metadata, Viewport } from 'next'
import './globals.css'
import SessionWrapper from './components/SessionWrapper'
import { Analytics } from '@vercel/analytics/next'

// Vendored (app/fonts/, OFL-1.1) instead of next/font/google: a build-time
// fetch of fonts.googleapis.com hard-fails `next build` on machines that
// can't reach it, which broke fresh `dashclaw up` installs on restricted
// networks (drill:fresh-windows, 2026-08-06).
const inter = localFont({
  src: './fonts/inter-latin-var.woff2',
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://www.dashclaw.io'),
  title: {
    default: 'DashClaw, the governance runtime for AI agents',
    template: '%s - DashClaw',
  },
  description: 'DashClaw intercepts agent actions before they reach the real world. Enforce policies, require human approval, and record verifiable evidence.',
  icons: {
    icon: [
      { url: '/favicons/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicons/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/favicons/apple-touch-icon.png',
  },
  manifest: '/config/site.webmanifest',
  openGraph: {
    title: 'DashClaw, the governance runtime for AI agents',
    description: 'DashClaw intercepts agent actions before they reach the real world. Enforce policies, require human approval, and record verifiable evidence.',
    url: 'https://www.dashclaw.io',
    siteName: 'DashClaw',
    type: 'website',
    images: [
      {
        url: '/social/og-image.png',
        width: 1200,
        height: 630,
        alt: 'DashClaw, the governance runtime for AI agents',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DashClaw, the governance runtime for AI agents',
    description: 'DashClaw intercepts agent actions before they reach the real world. Enforce policies, require human approval, and record verifiable evidence.',
    images: ['/social/twitter-card.png'],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0e1014',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const enableAnalytics =
    // Vercel sets this in deployments; keeps self-host/non-Vercel installs from emitting analytics by default.
    process.env.VERCEL === '1' ||
    // Explicit opt-in for non-Vercel hosts.
    process.env.NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS === 'true'

  return (
    <html lang="en" className={inter.variable}>
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#0e1014" />
      </head>
      <body className="font-sans antialiased">
        <SessionWrapper>{children}</SessionWrapper>
        {enableAnalytics ? <Analytics /> : null}
      </body>
    </html>
  )
}
