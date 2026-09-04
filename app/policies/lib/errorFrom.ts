// app/policies/lib/errorFrom.ts
// Shared error-body parsing for the policies browser clients.

export async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => ({}));
  return new Error(body.error || fallback);
}
