/**
 * guideContent.js — Shared URL helper for framework integration guide pages.
 *
 * Resolves the instance host from request headers so guide pages
 * produce correct absolute URLs without hardcoding.
 */

const DEPLOYED_BASE_URL_PLACEHOLDER = 'https://your-dashclaw-instance.example.com';

function normalizeHost(host: string | null | undefined): string {
  return (
    String(host || '')
      .trim()
      .replace(/^https?:\/\//, '')
      .split('/')[0] ?? ''
  ).toLowerCase();
}

export function isMarketingHost(host: string | null | undefined): boolean {
  const normalizedHost = normalizeHost(host);
  return normalizedHost === 'dashclaw.io' || normalizedHost === 'www.dashclaw.io';
}

/**
 * Derives the correct base URL for code examples shown in a guide page.
 *
 * - null / empty host → placeholder URL
 * - dashclaw.io or www.dashclaw.io → placeholder URL (marketing site, not an instance)
 * - localhost / 127.0.0.1 → http://
 * - any other host → https://
 *
 * @param host — value from Next.js headers().get('host')
 */
export function getGuideBaseUrl(host: string | null | undefined): string {
  if (!host) return DEPLOYED_BASE_URL_PLACEHOLDER;
  if (isMarketingHost(host)) return DEPLOYED_BASE_URL_PLACEHOLDER;
  if (host.startsWith('http://') || host.startsWith('https://')) return host;
  const protocol =
    host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${protocol}://${host}`;
}
