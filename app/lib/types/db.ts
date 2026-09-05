// §9.6 Database contract helpers shared by repositories (refined in Phase 7).
//
// Repositories must treat rows as untrusted until mapped: model nullable
// columns accurately, coerce Postgres `numeric` (string) aggregates with
// Number() before arithmetic, and preserve org_id scoping + parameterized SQL.

/** Minimal shape of the Neon/postgres tagged-template executor used by repositories. */
export interface SqlTag {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  // The Neon/postgres client always exposes `.query`; required so a SqlTag is
  // assignable to repository-local query-client types.
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
}
