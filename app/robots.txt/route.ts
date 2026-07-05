/**
 * /robots.txt — host-aware (roadmap v6.3).
 *
 * Only the marketing site (dashclaw.io / www.dashclaw.io) is indexable.
 * Every other host serving this codebase — the hosted trial, self-host
 * instances, Vercel previews — answers Disallow: / so private governance
 * dashboards never end up in a search index.
 *
 * Implemented as a plain route handler (not app/robots.ts) because the
 * metadata-file convention has no documented access to the request Host
 * header, which this behavior depends on.
 */

import { isMarketingHost } from '../lib/guideContent';
import { MARKETING_ORIGIN } from '../lib/marketingSeo';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const host = request.headers.get('host');

  const body = isMarketingHost(host)
    ? [
        'User-agent: *',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /approve',
        '',
        `Sitemap: ${MARKETING_ORIGIN}/sitemap.xml`,
        '',
      ].join('\n')
    : ['User-agent: *', 'Disallow: /', ''].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
