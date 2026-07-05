import { describe, expect, it } from 'vitest';

import { GET as robotsGET } from '@/robots.txt/route';
import { GET as sitemapGET } from '@/sitemap.xml/route';
import {
  MARKETING_ORIGIN,
  MARKETING_ROUTES,
  marketingPageMetadata,
} from '@/lib/marketingSeo';

function requestWithHost(path: string, host: string): Request {
  return new Request(`http://${host}${path}`, {
    method: 'GET',
    headers: { host },
  });
}

describe('/robots.txt (host-aware, v6.3)', () => {
  it('serves crawl rules + sitemap on the marketing host', async () => {
    for (const host of ['www.dashclaw.io', 'dashclaw.io']) {
      const res = await robotsGET(requestWithHost('/robots.txt', host));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/plain');
      const body = await res.text();
      expect(body).toContain('Allow: /');
      expect(body).toContain('Disallow: /api/');
      expect(body).toContain(`Sitemap: ${MARKETING_ORIGIN}/sitemap.xml`);
      expect(body).not.toMatch(/^Disallow: \/$/m);
    }
  });

  it('disallows everything on non-marketing hosts (hosted trial, self-host, previews)', async () => {
    for (const host of [
      'hosted.dashclaw.io',
      'my-dashclaw.vercel.app',
      'localhost:3000',
      'example.com',
    ]) {
      const res = await robotsGET(requestWithHost('/robots.txt', host));
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toMatch(/^Disallow: \/$/m);
      expect(body).not.toContain('Sitemap:');
      expect(body).not.toMatch(/^Allow:/m);
    }
  });

  it('disallows everything when the host header is missing', async () => {
    const res = await robotsGET(new Request('http://x/robots.txt'));
    const body = await res.text();
    expect(body).toMatch(/^Disallow: \/$/m);
  });
});

describe('/sitemap.xml (host-aware, v6.3)', () => {
  it('lists every marketing route as an absolute canonical URL on the marketing host', async () => {
    const res = await sitemapGET(requestWithHost('/sitemap.xml', 'www.dashclaw.io'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    const body = await res.text();
    expect(body).toContain('<urlset');
    for (const route of MARKETING_ROUTES) {
      const url = `${MARKETING_ORIGIN}${route === '/' ? '' : route}`;
      expect(body).toContain(`<loc>${url}</loc>`);
    }
    // No fabricated lastmod values.
    expect(body).not.toContain('<lastmod>');
  });

  it('serves an empty urlset on non-marketing hosts', async () => {
    const res = await sitemapGET(requestWithHost('/sitemap.xml', 'hosted.dashclaw.io'));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<urlset');
    expect(body).not.toContain('<loc>');
  });
});

describe('marketingPageMetadata (v6.3)', () => {
  it('builds canonical + page-specific OG/twitter from the page title', () => {
    const meta = marketingPageMetadata({
      title: 'CrewAI Integration Guide - DashClaw',
      description: 'Add governance to CrewAI agents with DashClaw in under 20 minutes.',
      path: '/guides/crewai',
    });
    expect(meta.alternates?.canonical).toBe(`${MARKETING_ORIGIN}/guides/crewai`);
    expect(meta.openGraph?.title).toBe('CrewAI Integration Guide - DashClaw');
    expect(meta.openGraph?.url).toBe(`${MARKETING_ORIGIN}/guides/crewai`);
    expect((meta.openGraph as { type?: string }).type).toBe('website');
    expect(meta.twitter?.title).toBe('CrewAI Integration Guide - DashClaw');
  });

  it('canonicalizes the landing page to the bare origin (no trailing slash mismatch)', () => {
    const meta = marketingPageMetadata({
      title: 't',
      description: 'd',
      path: '/',
    });
    expect(meta.alternates?.canonical).toBe(MARKETING_ORIGIN);
  });

  it('supports the article OG type for blog posts', () => {
    const meta = marketingPageMetadata({
      title: 't',
      description: 'd',
      path: '/blog/codex-parity',
      ogType: 'article',
    });
    expect((meta.openGraph as { type?: string }).type).toBe('article');
  });
});
