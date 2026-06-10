/**
 * Pure builder for the static security header rules that Next.js applies via
 * next.config.js `headers()`. Lives as a CommonJS module so it can be both
 * `require`d by next.config.js (CJS) and imported by Vitest tests (ESM).
 *
 * The TLS-conditional pieces (HSTS + upgrade-insecure-requests) hinge on
 * NEXTAUTH_URL: if it begins with https the deployment is TLS-terminated and
 * we can safely send HSTS; LAN self-host on plain HTTP must NOT receive HSTS
 * because it would lock the operator out of their own dashboard.
 */

function buildSecurityHeaderRules({ nextauthUrl = process.env.NEXTAUTH_URL || '', nodeEnv = process.env.NODE_ENV } = {}) {
  const isTLS = nextauthUrl.startsWith('https');
  const isDev = nodeEnv === 'development';

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com ${isDev ? "'unsafe-eval'" : ''}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://avatars.githubusercontent.com https://lh3.googleusercontent.com https://api.dicebear.com",
    "font-src 'self' data:",
    "connect-src 'self' https://*.neon.tech https://github.com https://accounts.google.com https://checkout.stripe.com https://billing.stripe.com",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src 'self' https://www.loom.com https://www.youtube-nocookie.com https://challenges.cloudflare.com",
    "form-action 'self'",
    ...(isTLS ? ['upgrade-insecure-requests', 'block-all-mixed-content'] : []),
  ].join('; ');

  const headers = [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-XSS-Protection', value: '1; mode=block' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    { key: 'Content-Security-Policy', value: csp },
  ];

  if (isTLS) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload',
    });
  }

  return [{ source: '/:path*', headers }];
}

module.exports = { buildSecurityHeaderRules };
