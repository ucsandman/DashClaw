import { redirect } from 'next/navigation';

/**
 * The former "Custom rules" sub-route folded into /policies as the ledger's
 * Table lens (One Ledger, Many Lenses). This route now redirects, preserving
 * any query (e.g. ?prefill= from a compliance-gap deep-link) so external links
 * keep working.
 */
export default async function PolicyRulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === 'string') qs.set(key, value);
    else if (Array.isArray(value) && value[0] != null) qs.set(key, value[0]);
  }
  const query = qs.toString();
  redirect(query ? `/policies?${query}` : '/policies');
}
