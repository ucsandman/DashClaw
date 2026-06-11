import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage.js";
import { localPaths } from "../src/paths.js";
import { applyConfig } from "../src/config.js";
import { ensureDefaultWorkspace } from "../src/service.js";

/** A Store backed by a fresh temp directory, isolated per test. */
export function freshStore(): Store {
  const home = mkdtempSync(join(tmpdir(), "dashclaw-local-test-"));
  const store = new Store(localPaths(home));
  ensureDefaultWorkspace(store);
  return store;
}

/**
 * A two-environment fixture (staging=test, production=live) used across the test
 * suite. This is a TEST FIXTURE only — there is no built-in demo in the shipped
 * product; real projects come from the user's .dashclaw-local/config.yaml.
 */
export function acmeConfig() {
  return {
    projects: {
      "acme-crm": {
        name: "Acme CRM",
        environments: {
          staging: {
            kind: "staging",
            github: { repo: "acme/acme-crm" },
            vercel: { project: "acme-crm-preview" },
            supabase: { project_ref: "sb_staging_ref" },
            stripe: { mode: "test" },
          },
          production: {
            kind: "production",
            github: { repo: "acme/acme-crm" },
            vercel: { project: "acme-crm-prod" },
            supabase: { project_ref: "sb_prod_ref" },
            stripe: { mode: "live" },
          },
        },
        memory: [
          { environment: "staging", note: "Last Vercel deploy failed because DATABASE_URL was missing.", tags: ["incident", "vercel"] },
          { environment: "staging", note: "Use Supabase staging for tests.", tags: ["supabase"] },
          { environment: "production", note: "Production DB writes are blocked by default.", tags: ["supabase", "safety"] },
          { environment: "production", note: "Stripe live mode requires approval.", tags: ["stripe", "safety"] },
        ],
      },
    },
    policy: {
      require_approval: ["vercel.deploy", "vercel.env.write", "supabase.write", "stripe.write"],
      block: ["supabase.destructive_sql", "provider.delete"],
    },
  };
}

export function seedAcme(store: Store): void {
  applyConfig(store, acmeConfig());
}
