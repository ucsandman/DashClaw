export type Row = Record<string, unknown>;

/**
 * SQL executor used by this repository. Supports the Neon/postgres tagged
 * template form AND the `.query(text, params)` form. The optional
 * `queryCalls` array is present only on the test-contract mock and gates the
 * compatibility paths below.
 */
export type SqlClient = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]>;
  query: (text: string, params?: unknown[]) => Promise<Row[]>;
  queryCalls?: unknown[];
};

// Fleet attribution (drizzle/0049, v4.3): harness_session_id / subagent_uuid
// are free-form client-supplied ids — accept a string ≤ 200 chars, else NULL.
export function boundedIdText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
}

export function sqlFragment(
  sql: SqlClient,
  active: boolean,
  build: () => ReturnType<SqlClient>,
): ReturnType<SqlClient> {
  return active ? build() : sql``;
}
