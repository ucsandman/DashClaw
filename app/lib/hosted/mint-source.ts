// v6.4 reach attribution: sanitize the mint request's self-reported
// referrer/UTM strings and resolve one channel label. Spoofable by design —
// attribution is measurement, not security; the label ends up on a public
// aggregate route, so the charset/length caps here are what keep junk labels
// from spamming that surface.

const RAW_KEYS = ['referrer', 'utm_source', 'utm_medium', 'utm_campaign'] as const;
const RAW_FIELD_CAP = 300;
const LABEL_CAP = 64;

export type MintSourceRaw = Partial<Record<(typeof RAW_KEYS)[number], string>>;

export type ResolvedMintSource = {
  /** Channel label: normalized utm_source > referrer host > 'direct'. */
  source: string;
  /** The sanitized strings the label was derived from; null when none survived. */
  raw: MintSourceRaw | null;
};

function normalizeLabel(value: string): string | null {
  const label = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, LABEL_CAP);
  return label.length > 0 ? label : null;
}

function referrerHost(referrer: string, ownHost: string | null): string | null {
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\./, '');
  if (!host) return null;
  // A self-referral (internal navigation to /connect) is not a channel.
  if (ownHost && host === ownHost.replace(/^www\./, '')) return null;
  return host;
}

/**
 * Sanitize client-supplied source input (strings only, allowlisted keys,
 * per-field cap) and resolve the channel label. Never throws; a malformed
 * input resolves to 'direct' with raw:null.
 */
export function resolveMintSource(input: unknown, ownHost: string | null): ResolvedMintSource {
  const raw: MintSourceRaw = {};
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const key of RAW_KEYS) {
      const value = (input as Record<string, unknown>)[key];
      if (typeof value === 'string') {
        const trimmed = value.trim().slice(0, RAW_FIELD_CAP);
        if (trimmed.length > 0) raw[key] = trimmed;
      }
    }
  }
  const fromUtm = raw.utm_source ? normalizeLabel(raw.utm_source) : null;
  const fromReferrer = !fromUtm && raw.referrer ? referrerHost(raw.referrer, ownHost) : null;
  const source = fromUtm ?? (fromReferrer ? normalizeLabel(fromReferrer) : null) ?? 'direct';
  return { source, raw: Object.keys(raw).length > 0 ? raw : null };
}
