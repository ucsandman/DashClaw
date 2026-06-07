export interface BulkResult {
  ok: string[];
  failed: string[];
}

/**
 * Run a per-item request for each id concurrently and report which succeeded.
 * Bulk operations fan out over the EXISTING per-item governed routes — each
 * call is still authenticated + org-scoped server-side, so this adds no SQL
 * bypass and no new IDOR surface. A thrown/failed request lands in `failed`,
 * never aborting the rest.
 */
export async function bulkAction(
  ids: string[],
  makeRequest: (id: string) => Promise<Response>,
): Promise<BulkResult> {
  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await makeRequest(id);
        return { id, ok: res.ok };
      } catch {
        return { id, ok: false };
      }
    }),
  );
  return {
    ok: results.filter((r) => r.ok).map((r) => r.id),
    failed: results.filter((r) => !r.ok).map((r) => r.id),
  };
}
