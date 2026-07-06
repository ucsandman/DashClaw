/**
 * marketingSeo.ts — SEO source of truth for the public marketing surface
 * (roadmap v6.3, spec: docs/superpowers/specs/2026-07-05-seo-truth-pass-v63.md).
 *
 * One module owns the canonical origin, the marketing route list (consumed by
 * the sitemap handler and tests), and the per-page metadata builder so
 * canonical/OG/twitter stay consistent across all marketing pages.
 *
 * Host-awareness (which host gets indexed at all) lives in the robots/sitemap
 * route handlers via isMarketingHost from guideContent.ts — this module only
 * describes the marketing site itself.
 */

import type { Metadata } from 'next';

/** Canonical origin: the apex 307s to www, so www is the indexable host. */
export const MARKETING_ORIGIN = 'https://www.dashclaw.io';

/**
 * Every public marketing route, in sitemap order. Routes added or removed
 * from the marketing surface must be updated here in the same change.
 */
export const MARKETING_ROUTES = [
  '/',
  '/proof',
  '/guides/claude-code',
  '/guides/codex',
  '/guides/hermes',
  '/guides/openclaw',
  '/guides/openai-agents-sdk',
  '/guides/crewai',
  '/guides/langgraph',
  '/guides/discord-approvals',
  '/blog/claude-code-beachhead',
  '/blog/codex-parity',
  '/blog/hermes-plugin',
  '/docs',
  '/self-host',
  '/privacy',
  '/connect',
  '/downloads',
  '/practical-systems',
] as const;

interface MarketingPageMeta {
  title: string;
  description: string;
  /** Route path starting with '/', e.g. '/guides/crewai'. */
  path: string;
  /** OpenGraph type; blog posts pass 'article'. */
  ogType?: 'website' | 'article';
}

/**
 * Builds the full Metadata object for a marketing page from its existing
 * title/description, adding canonical + page-specific OpenGraph/twitter tags
 * (Next's metadata merge is shallow per field, so pages that don't set
 * openGraph would otherwise inherit the site-default OG title).
 */
export function marketingPageMetadata({
  title,
  description,
  path,
  ogType = 'website',
}: MarketingPageMeta): Metadata {
  const url = `${MARKETING_ORIGIN}${path === '/' ? '' : path}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: 'DashClaw',
      type: ogType,
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
      title,
      description,
      images: ['/social/twitter-card.png'],
    },
  };
}
