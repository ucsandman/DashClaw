import { describe, expect, it } from "vitest";
import { createLaunchPlan, listLaunchPlans } from "../src/launch/index.js";
import { loadLaunchPlan } from "../src/launch/store.js";
import { freshStore, seedAcme } from "./helpers.js";

describe("launch plan generation", () => {
  it("derives the full golden path for a complete stack", () => {
    const store = freshStore();
    seedAcme(store);

    const plan = createLaunchPlan(store, {
      project: "acme-crm",
      environment: "production",
      declared_stack: ["domain", "vercel", "neon", "stripe", "resend", "clerk", "upstash", "r2", "sentry", "posthog"],
      domain: "acme.com",
    });

    expect(plan.id).toMatch(/^launch_/);
    expect(plan.steps.map((s) => s.id)).toEqual([
      "domain.purchase",
      "vercel.project",
      "domain.dns",
      "neon.provision",
      "upstash.provision",
      "r2.provision",
      "vercel.env",
      "vercel.deploy",
      "stripe.product",
      "stripe.price",
      "stripe.webhook",
      "stripe.webhook-secret",
      "sentry.wire",
      "posthog.wire",
      "clerk.wire",
      "resend.domain",
      "resend.verify",
    ]);
    // Ordering + dependency spot checks against the playbook.
    const byId = Object.fromEntries(plan.steps.map((s) => [s.id, s]));
    expect(byId["domain.dns"]!.dependsOn).toEqual(["domain.purchase", "vercel.project"]);
    expect(byId["stripe.price"]!.dependsOn).toEqual(["stripe.product"]);
    expect(byId["stripe.webhook"]!.dependsOn).toEqual(["stripe.price", "vercel.deploy"]);
    expect(byId["vercel.deploy"]!.dependsOn).toEqual(["vercel.project", "vercel.env"]);
    expect(byId["resend.verify"]!.dependsOn).toEqual(["resend.domain", "domain.dns"]);
    expect(plan.steps.every((s) => s.status === "pending")).toBe(true);
  });

  it("derives a minimal plan for a vercel-only stack", () => {
    const store = freshStore();
    seedAcme(store);

    const plan = createLaunchPlan(store, {
      project: "acme-crm",
      environment: "production",
      declared_stack: ["vercel"],
    });

    expect(plan.steps.map((s) => s.id)).toEqual(["vercel.project", "vercel.deploy"]);
    // vercel.env requires neon; with it absent the deploy depends only on the project.
    expect(plan.steps[1]!.dependsOn).toEqual(["vercel.project"]);
  });

  it("derives a domainless stack without domain/DNS steps and re-roots dependencies", () => {
    const store = freshStore();
    seedAcme(store);

    const plan = createLaunchPlan(store, {
      project: "acme-crm",
      environment: "production",
      declared_stack: ["vercel", "neon", "stripe"],
    });

    expect(plan.steps.map((s) => s.id)).toEqual([
      "vercel.project",
      "neon.provision",
      "vercel.env",
      "vercel.deploy",
      "stripe.product",
      "stripe.price",
      "stripe.webhook",
      "stripe.webhook-secret",
    ]);
    expect(plan.steps.some((s) => s.id.startsWith("domain."))).toBe(false);
  });

  it("rejects unknown stack items, duplicates, and a domain stack without a domain", () => {
    const store = freshStore();
    seedAcme(store);
    const base = { project: "acme-crm", environment: "production" };

    expect(() => createLaunchPlan(store, { ...base, declared_stack: ["heroku"] })).toThrowError(/Unknown stack item/);
    expect(() => createLaunchPlan(store, { ...base, declared_stack: [] })).toThrowError(/non-empty subset/);
    expect(() => createLaunchPlan(store, { ...base, declared_stack: ["vercel", "vercel"] })).toThrowError(/Duplicate/);
    expect(() => createLaunchPlan(store, { ...base, declared_stack: ["domain"] })).toThrowError(/pass the `domain`/);
    expect(() => createLaunchPlan(store, { ...base, environment: "nope", declared_stack: ["vercel"] })).toThrowError(
      /Environment "nope" not found/,
    );
  });

  it("persists the plan to .dashclaw-local/launches and a fresh load reads identical state", () => {
    const store = freshStore();
    seedAcme(store);

    const plan = createLaunchPlan(store, {
      project: "acme-crm",
      environment: "production",
      declared_stack: ["vercel", "stripe"],
    });

    // A fresh read from disk (as a new process would do) sees the same plan.
    const reloaded = loadLaunchPlan(store.paths.home, plan.id);
    expect(reloaded).toEqual(plan);

    const listed = listLaunchPlans(store.paths.home);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: plan.id, project: "acme-crm", environment: "production" });
  });

  it("rejects malformed plan ids before touching the filesystem", () => {
    const store = freshStore();
    expect(() => loadLaunchPlan(store.paths.home, "../../etc/passwd")).toThrowError(/Invalid launch plan id/);
  });
});
