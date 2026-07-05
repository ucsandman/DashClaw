/**
 * /sitemap.xml — host-aware (roadmap v6.3).
 *
 * The marketing host serves the marketing route list from marketingSeo.ts;
 * any other host (hosted trial, self-host instances, previews) serves an
 * empty urlset — those hosts are Disallow: / in robots.txt and have nothing
 * truthful to advertise. No lastmod values: we don't fabricate dates.
 */

import { isMarketingHost } from '../lib/guideContent';
import { MARKETING_ORIGIN, MARKETING_ROUTES } from '../lib/marketingSeo';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const host = request.headers.get('host');

  const urls = isMarketingHost(host)
    ? MARKETING_ROUTES.map(
        (route) =>
          `  <url><loc>${MARKETING_ORIGIN}${route === '/' ? '' : route}</loc></url>`,
      )
    : [];

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
