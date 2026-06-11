import type { GuardedResponse } from "../src/actions.js";
import type { ProviderReads } from "../src/launch/checks.js";

/** A guarded read that executed and returned data. */
export function okRead(data: unknown): GuardedResponse {
  return {
    status: "ok",
    policy_decision: "allow",
    executed: true,
    project: "acme-crm",
    environment: "production",
    provider: "vercel",
    action: "read",
    reason: "test",
    data,
  };
}

/** A guarded read that executed and failed (bad token, provider error, …). */
export function errRead(error: string): GuardedResponse {
  return {
    status: "error",
    policy_decision: "allow",
    executed: true,
    project: "acme-crm",
    environment: "production",
    provider: "vercel",
    action: "read",
    error,
  };
}

/**
 * Fake ProviderReads where everything succeeds with empty results (so every
 * reality check evaluates to "not yet"); override per test.
 */
export function fakeReads(overrides: Partial<ProviderReads> = {}): ProviderReads {
  const empty = async () => okRead([]);
  return {
    namecheapDomains: empty,
    dnsRecords: async () => okRead([]),
    vercelDeployments: empty,
    vercelEnvVarNames: empty,
    stripeProducts: empty,
    stripePrices: empty,
    stripeWebhooks: empty,
    resendDomains: empty,
    neonProjects: empty,
    upstashRedisDatabases: empty,
    r2Buckets: empty,
    sentryProjects: empty,
    posthogProjects: empty,
    clerkDomains: empty,
    probeUrl: async (url: string) => ({ reachable: true, detail: `${url} answered HTTP 200.` }),
    ...overrides,
  };
}
