import { Inter } from 'next/font/google'
import './globals.css'
import SessionWrapper from './components/SessionWrapper'
import { Analytics } from '@vercel/analytics/next'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata = {
  title: 'DashClaw — AI Agent Decision Infrastructure',
  description: 'Prove what your AI agents decided and why. Open-source decision infrastructure with policy enforcement, assumption tracking, and compliance mapping for autonomous AI agents.',
  icons: {
    icon: [
      { url: '/favicons/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicons/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/favicons/apple-touch-icon.png',
  },
  manifest: '/config/site.webmanifest',
  openGraph: {
    images: [
      {
        url: '/social/og-image.png',
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/social/twitter-card.png'],
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0a0a0a',
}

export default function RootLayout({ children }) {
  const enableAnalytics =
    // Vercel sets this in deployments; keeps self-host/non-Vercel installs from emitting analytics by default.
    process.env.VERCEL === '1' ||
    // Explicit opt-in for non-Vercel hosts.
    process.env.NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS === 'true'

  return (
    <html lang="en" className={inter.variable}>
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#0a0a0a" />
      </head>
      <body className="font-sans antialiased">
        <SessionWrapper>{children}</SessionWrapper>
        {enableAnalytics ? <Analytics /> : null}
      </body>
    </html>
  )
}
