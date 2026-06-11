/**
 * Reality checks, preflight checks, and verify checks for launch plans.
 *
 * Everything here is a READ. The default ProviderReads implementation goes
 * through the guarded provider-action layer (policy applies, every read is
 * audited); tests inject fakes. Launch tooling never mutates providers.
 */

import type { GuardedResponse } from "../actions.js";
import * as pa from "../provider-actions.js";
import { listProviderMappings } from "../service.js";
import type { Store } from "../storage.js";
import type { ProviderId } from "../types.js";
import type { LaunchPlan, LaunchStep } from "./types.js";

export interface ProbeResult {
  reachable: boolean;
  detail: string;
}

/** The read surface reality/preflight/verify checks evaluate against. */
export interface ProviderReads {
  namecheapDomains(): Promise<GuardedResponse>;
  dnsRecords(domain: string): Promise<GuardedResponse>;
  vercelDeployments(): Promise<GuardedResponse>;
  vercelEnvVarNames(): Promise<GuardedResponse>;
  stripeProducts(): Promise<GuardedResponse>;
  stripePrices(): Promise<GuardedResponse>;
  stripeWebhooks(): Promise<GuardedResponse>;
  resendDomains(): Promise<GuardedResponse>;
  neonProjects(): Promise<GuardedResponse>;
  upstashRedisDatabases(): Promise<GuardedResponse>;
  r2Buckets(): Promise<GuardedResponse>;
  sentryProjects(): Promise<GuardedResponse>;
  posthogProjects(): Promise<GuardedResponse>;
  clerkDomains(): Promise<GuardedResponse>;
  /** HTTP(S) reachability probe — any HTTP response counts as reachable. */
  probeUrl(url: string): Promise<ProbeResult>;
}

function memo<T>(fn: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;
  return () => (cached ??= fn());
}

/**
 * Guarded reads bound to one plan's project + environment. Each distinct read
 * runs at most once per ProviderReads instance (a status evaluation touches
 * several steps that share the same provider read).
 */
export function defaultProviderReads(store: Store, plan: Pick<LaunchPlan, "project" | "environment">): ProviderReads {
  const base = { project: plan.project, environment: plan.environment };
  return {
    namecheapDomains: memo(() => pa.namecheapListDomains(store, { ...base, pageSize: 100 })),
    dnsRecords: (domain: string) => pa.getDnsRecords(store, { ...base, domain }),
    vercelDeployments: memo(() => pa.vercelDeployments(store, { ...base, limit: 5 })),
    vercelEnvVarNames: memo(() => pa.vercelListEnvVars(store, base)),
    stripeProducts: memo(() => pa.stripeListProducts(store, { ...base, limit: 50 })),
    stripePrices: memo(() => pa.stripeListPrices(store, { ...base, limit: 50 })),
    stripeWebhooks: memo(() => pa.stripeListWebhooks(store, { ...base, limit: 50 })),
    resendDomains: memo(() => pa.resendListDomains(store, { ...base, limit: 50 })),
    neonProjects: memo(() => pa.neonListProjects(store, base)),
    upstashRedisDatabases: memo(() => pa.upstashListRedisDatabases(store, base)),
    r2Buckets: memo(() => pa.cloudflareR2ListBuckets(store, base)),
    sentryProjects: memo(() => pa.sentryListProjects(store, base)),
    posthogProjects: memo(() => pa.posthogListProjects(store, base)),
    clerkDomains: memo(() => pa.clerkListDomains(store, base)),
    async probeUrl(url: string): Promise<ProbeResult> {
      try {
        const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
        return { reachable: true, detail: `${url} answered HTTP ${res.status}.` };
      } catch (err) {
        return {
          reachable: false,
          detail: `${url} did not answer: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

export interface RealityEvaluation {
  satisfied: boolean;
  /** True when the read itself failed (token/mapping/provider error). */
  error: boolean;
  detail: string;
}

function evalError(detail: string): RealityEvaluation {
  return { satisfied: false, error: true, detail };
}

function evalResult(satisfied: boolean, detail: string): RealityEvaluation {
  return { satisfied, error: false, detail };
}

/** Unwrap a guarded read: ok → data; anything else → evaluation error. */
function unwrap(response: GuardedResponse): { data?: unknown; error?: string } {
  if (response.status === "ok") return { data: response.data };
  if (response.status === "error") return { error: response.error };
  return { error: `${response.status}: ${"reason" in response ? response.reason : "read did not execute"}` };
}

function asArray(data: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of keys) {
      const value = (data as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

/** Evaluate one step's reality check against provider/local state. */
export async function evaluateRealityCheck(
  store: Store,
  plan: LaunchPlan,
  step: LaunchStep,
  reads: ProviderReads,
): Promise<RealityEvaluation> {
  const check = step.realityCheck;
  const params = check.params ?? {};

  switch (check.kind) {
    case "provider-mapped": {
      const provider = params.provider as ProviderId;
      const mappings = listProviderMappings(store, plan.project);
      const mapped = mappings.some((m) => m.provider === provider && m.environment === plan.environment);
      return evalResult(
        mapped,
        mapped
          ? `${provider} mapping present for ${plan.environment}.`
          : `No ${provider} mapping for ${plan.environment} — run map_provider_resource.`,
      );
    }

    case "domain-owned": {
      const domain = String(params.domain ?? plan.domain ?? "");
      const { data, error } = unwrap(await reads.namecheapDomains());
      if (error) return evalError(error);
      const domains = asArray(data, "domains");
      const owned = domains.some((d) => String((d as Record<string, unknown>)?.name ?? "").toLowerCase() === domain.toLowerCase());
      return evalResult(owned, owned ? `${domain} is registered in this Namecheap account.` : `${domain} is not in the Namecheap domain list.`);
    }

    case "dns-points-at-app": {
      const domain = String(params.domain ?? plan.domain ?? "");
      const { data, error } = unwrap(await reads.dnsRecords(domain));
      if (error) return evalError(error);
      const records = asArray(data, "records", "hosts");
      const points = records.some((r) => {
        const record = r as Record<string, unknown>;
        const address = String(record.address ?? "").toLowerCase();
        // Dot-bounded suffix so look-alike hosts (e.g. "evilvercel-dns.com") are
        // rejected — a bare endsWith("vercel-dns.com") matches them (CodeQL
        // js/incomplete-url-substring-sanitization).
        return (
          address === "76.76.21.21" ||
          address === "vercel-dns.com" ||
          address.endsWith(".vercel-dns.com")
        );
      });
      return evalResult(
        points,
        points
          ? `DNS for ${domain} points at Vercel.`
          : `DNS for ${domain} has no Vercel record (A 76.76.21.21 or CNAME cname.vercel-dns.com).`,
      );
    }

    case "stripe-product-exists": {
      const { data, error } = unwrap(await reads.stripeProducts());
      if (error) return evalError(error);
      const exists = asArray(data, "data").length > 0;
      return evalResult(exists, exists ? "Stripe product exists." : "No Stripe products found.");
    }

    case "stripe-price-exists": {
      const { data, error } = unwrap(await reads.stripePrices());
      if (error) return evalError(error);
      const exists = asArray(data, "data").length > 0;
      return evalResult(exists, exists ? "Stripe price exists." : "No Stripe prices found.");
    }

    case "stripe-webhook-enabled": {
      const { data, error } = unwrap(await reads.stripeWebhooks());
      if (error) return evalError(error);
      const enabled = asArray(data, "data").some((w) => String((w as Record<string, unknown>)?.status ?? "") === "enabled");
      return evalResult(enabled, enabled ? "An enabled Stripe webhook endpoint exists." : "No enabled Stripe webhook endpoint.");
    }

    case "env-var-present": {
      const keys = (params.keys as string[] | undefined) ?? [];
      const { data, error } = unwrap(await reads.vercelEnvVarNames());
      if (error) return evalError(error);
      const names = asArray(data).map((n) => String(n));
      const missing = keys.filter((key) => !names.includes(key));
      return evalResult(
        missing.length === 0,
        missing.length === 0 ? `App env has ${keys.join(", ")}.` : `App env is missing: ${missing.join(", ")}.`,
      );
    }

    case "deployment-ready": {
      const { data, error } = unwrap(await reads.vercelDeployments());
      if (error) return evalError(error);
      const deployments = asArray(data, "deployments");
      const latest = deployments[0] as Record<string, unknown> | undefined;
      const state = String(latest?.readyState ?? latest?.state ?? "");
      const ready = state.toUpperCase() === "READY";
      return evalResult(ready, latest ? `Latest deployment is ${state || "unknown"}.` : "No deployments found.");
    }

    case "email-domain-exists":
    case "email-domain-verified": {
      const domain = params.domain ? String(params.domain) : plan.domain;
      const { data, error } = unwrap(await reads.resendDomains());
      if (error) return evalError(error);
      const domains = asArray(data, "data", "domains").map((d) => d as Record<string, unknown>);
      const match = domain ? domains.find((d) => String(d?.name ?? "").toLowerCase() === domain.toLowerCase()) : domains[0];
      if (!match) return evalResult(false, `Sending domain ${domain ?? ""} not found in Resend.`.trim());
      if (check.kind === "email-domain-exists") return evalResult(true, `Sending domain ${match.name} exists.`);
      const verified = String(match.status ?? "") === "verified";
      return evalResult(verified, verified ? `Sending domain ${match.name} is verified.` : `Sending domain ${match.name} status: ${match.status ?? "unknown"}.`);
    }

    default:
      return evalError(`Unknown reality check kind "${(check as { kind: string }).kind}".`);
  }
}
