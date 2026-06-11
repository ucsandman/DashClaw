import { describe, expect, it } from "vitest";
import { createLaunchPlan, getLaunchStatus } from "../src/launch/index.js";
import { loadLaunchPlan, saveLaunchPlan } from "../src/launch/store.js";
import { mapProviderResource } from "../src/service.js";
import type { Store } from "../src/storage.js";
import { errRead, fakeReads, okRead } from "./launch-helpers.js";
import { freshStore, seedAcme } from "./helpers.js";

function storeWithPlan(stack: string[], domain?: string) {
  const store = freshStore();
  seedAcme(store);
  const plan = createLaunchPlan(store, {
    project: "acme-crm",
    environment: "production",
    declared_stack: stack,
    domain,
  });
  return { store, plan };
}

describe("get_launch_status reality evaluation", () => {
  it("reports done when every reality check is satisfied", async () => {
    const { store, plan } = storeWithPlan(["vercel", "neon", "stripe"]);
    // seedAcme maps vercel + stripe for production; map neon too.
    mapProviderResource(store, {
      provider: "neon",
      environment: "production",
      project: "acme-crm",
      resource: { provider: "neon", projectId: "neon_123" },
    });

    const reads = fakeReads({
      vercelDeployments: async () => okRead([{ uid: "dep_1", readyState: "READY" }]),
      vercelEnvVarNames: async () => okRead(["DATABASE_URL", "STRIPE_WEBHOOK_SECRET"]),
      stripeProducts: async () => okRead([{ id: "prod_1" }]),
      stripePrices: async () => okRead([{ id: "price_1" }]),
      stripeWebhooks: async () => okRead([{ id: "we_1", status: "enabled" }]),
    });

    const status = await getLaunchStatus(store, { plan_id: plan.id }, reads);

    expect(status.counts).toEqual({ done: 8, pending: 0, "blocked-on-approval": 0, failed: 0 });
    expect(status.complete).toBe(true);
    expect(status.next_action).toBeNull();
  });

  it("reconciles phantom done marks back to evaluated truth and persists it", async () => {
    const { store, plan } = storeWithPlan(["stripe"]);
    // Simulate a crashed session that left "done" marks the world disagrees with.
    for (const step of plan.steps) step.status = "done";
    saveLaunchPlan(store.paths.home, plan);

    const status = await getLaunchStatus(store, { plan_id: plan.id }, fakeReads());

    expect(status.steps.every((s) => s.status === "pending")).toBe(true);
    // The reconciliation is durable, not just reported.
    const persisted = loadLaunchPlan(store.paths.home, plan.id);
    expect(persisted.steps.every((s) => s.status === "pending")).toBe(true);
  });

  it("surfaces a pending approval on the matching step as blocked-on-approval", async () => {
    const { store, plan } = storeWithPlan(["stripe"]);
    pushPendingApproval(store, "create_stripe_product", "act_apr_1");

    const status = await getLaunchStatus(store, { plan_id: plan.id }, fakeReads());

    const product = status.steps.find((s) => s.id === "stripe.product")!;
    const price = status.steps.find((s) => s.id === "stripe.price")!;
    expect(product.status).toBe("blocked-on-approval");
    expect(product.detail).toContain("act_apr_1");
    // Tool-exact matching: the product approval must not block the price step.
    expect(price.status).toBe("pending");
    expect(status.next_action).toMatchObject({ step_id: "stripe.product" });
    expect(status.next_action!.note).toContain("approval");
  });

  it("marks a step failed when its reality read errors, with the error detail", async () => {
    const { store, plan } = storeWithPlan(["stripe"]);
    const status = await getLaunchStatus(
      store,
      { plan_id: plan.id },
      fakeReads({ stripeProducts: async () => errRead("Environment variable STRIPE_LIVE_SECRET_KEY is not set (Stripe live mode).") }),
    );

    const product = status.steps.find((s) => s.id === "stripe.product")!;
    expect(product.status).toBe("failed");
    expect(product.detail).toContain("STRIPE_LIVE_SECRET_KEY");
  });

  it("reports the single next action as the first dependency-satisfied incomplete step", async () => {
    const { store, plan } = storeWithPlan(["vercel", "neon", "stripe"]);
    mapProviderResource(store, {
      provider: "neon",
      environment: "production",
      project: "acme-crm",
      resource: { provider: "neon", projectId: "neon_123" },
    });

    // vercel mapped (seed) + neon mapped -> the first incomplete step with all
    // deps done is vercel.env (set DATABASE_URL).
    const status = await getLaunchStatus(store, { plan_id: plan.id }, fakeReads());

    expect(status.next_action).toMatchObject({ step_id: "vercel.env", tool_hint: "set_app_env_vars" });
  });

  it("is resumable: a second evaluation from disk picks up the reconciled state", async () => {
    const { store, plan } = storeWithPlan(["stripe"]);

    await getLaunchStatus(store, { plan_id: plan.id }, fakeReads({
      stripeProducts: async () => okRead([{ id: "prod_1" }]),
    }));

    // "New session": reload from disk; the product step survived as done and
    // evaluation continues from there.
    const reloaded = loadLaunchPlan(store.paths.home, plan.id);
    expect(reloaded.steps.find((s) => s.id === "stripe.product")!.status).toBe("done");

    const second = await getLaunchStatus(store, { plan_id: plan.id }, fakeReads({
      stripeProducts: async () => okRead([{ id: "prod_1" }]),
      stripePrices: async () => okRead([{ id: "price_1" }]),
    }));
    expect(second.steps.find((s) => s.id === "stripe.price")!.status).toBe("done");
    expect(second.next_action).toMatchObject({ step_id: "stripe.webhook" });
  });
});

function pushPendingApproval(store: Store, tool: string, id: string): void {
  const project = store.data.projects.find((p) => p.slug === "acme-crm")!;
  const environment = store.data.environments.find((e) => e.projectId === project.id && e.name === "production")!;
  store.data.pendingApprovals.push({
    id,
    projectId: project.id,
    environmentId: environment.id,
    provider: "stripe",
    capability: "write",
    tool,
    actionSummary: `${tool} awaiting approval`,
    reason: "live mode requires approval",
    status: "pending",
    createdAt: new Date().toISOString(),
  });
}
