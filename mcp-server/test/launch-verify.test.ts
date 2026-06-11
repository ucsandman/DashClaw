import { describe, expect, it } from "vitest";
import { createLaunchPlan, verifyLaunch } from "../src/launch/index.js";
import { errRead, fakeReads, okRead } from "./launch-helpers.js";
import { freshStore, seedAcme } from "./helpers.js";

function planFor(stack: string[], domain?: string) {
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

describe("verify_launch", () => {
  it("passes end-to-end when every post-launch check holds", async () => {
    const { store, plan } = planFor(["domain", "vercel", "neon", "stripe", "resend"], "acme.com");

    const result = await verifyLaunch(
      store,
      { plan_id: plan.id },
      fakeReads({
        vercelDeployments: async () => okRead([{ uid: "dep_1", readyState: "READY" }]),
        vercelEnvVarNames: async () => okRead(["DATABASE_URL", "STRIPE_WEBHOOK_SECRET"]),
        stripeWebhooks: async () => okRead([{ id: "we_1", status: "enabled" }]),
        resendDomains: async () => okRead([{ id: "rd_1", name: "acme.com", status: "verified" }]),
      }),
    );

    expect(result.status).toBe("pass");
    expect(result.checks.map((c) => c.id)).toEqual([
      "domain-resolves",
      "deployment-ready",
      "env-vars-present",
      "stripe-webhook-responding",
      "email-domain-verified",
    ]);
  });

  it("fails domain resolution when the domain does not answer", async () => {
    const { store, plan } = planFor(["domain", "vercel"], "acme.com");

    const result = await verifyLaunch(
      store,
      { plan_id: plan.id },
      fakeReads({
        probeUrl: async (url) => ({ reachable: false, detail: `${url} did not answer: getaddrinfo ENOTFOUND` }),
        vercelDeployments: async () => okRead([{ uid: "dep_1", readyState: "READY" }]),
      }),
    );

    const check = result.checks.find((c) => c.id === "domain-resolves")!;
    expect(check.status).toBe("fail");
    expect(check.remediation).toContain("get_dns_records");
    expect(result.status).toBe("fail");
  });

  it("fails deployment readiness when the latest deployment is not READY", async () => {
    const { store, plan } = planFor(["vercel"]);

    const result = await verifyLaunch(
      store,
      { plan_id: plan.id },
      fakeReads({ vercelDeployments: async () => okRead([{ uid: "dep_2", readyState: "ERROR" }]) }),
    );

    expect(result.checks.find((c) => c.id === "deployment-ready")).toMatchObject({ status: "fail" });
  });

  it("fails env-var presence listing exactly the missing keys", async () => {
    const { store, plan } = planFor(["vercel", "neon", "stripe"]);

    const result = await verifyLaunch(
      store,
      { plan_id: plan.id },
      fakeReads({
        vercelDeployments: async () => okRead([{ uid: "dep_1", readyState: "READY" }]),
        vercelEnvVarNames: async () => okRead(["DATABASE_URL"]),
      }),
    );

    const check = result.checks.find((c) => c.id === "env-vars-present")!;
    expect(check.status).toBe("fail");
    expect(check.message).toContain("STRIPE_WEBHOOK_SECRET");
    expect(check.message).not.toContain("DATABASE_URL,");
  });

  it("fails the Stripe webhook check when no enabled endpoint exists", async () => {
    const { store, plan } = planFor(["stripe"]);

    const result = await verifyLaunch(
      store,
      { plan_id: plan.id },
      fakeReads({ stripeWebhooks: async () => okRead([{ id: "we_1", status: "disabled" }]) }),
    );

    expect(result.checks.find((c) => c.id === "stripe-webhook-responding")).toMatchObject({ status: "fail" });
  });

  it("fails email verification while the sending domain is still pending", async () => {
    const { store, plan } = planFor(["resend"], "acme.com");

    const result = await verifyLaunch(
      store,
      { plan_id: plan.id },
      fakeReads({ resendDomains: async () => okRead([{ id: "rd_1", name: "acme.com", status: "pending" }]) }),
    );

    const check = result.checks.find((c) => c.id === "email-domain-verified")!;
    expect(check.status).toBe("fail");
    expect(check.message).toContain("pending");
  });

  it("propagates read errors as failing checks (token problems surface here too)", async () => {
    const { store, plan } = planFor(["vercel"]);

    const result = await verifyLaunch(
      store,
      { plan_id: plan.id },
      fakeReads({ vercelDeployments: async () => errRead("Vercel API 401: invalid token") }),
    );

    const check = result.checks.find((c) => c.id === "deployment-ready")!;
    expect(check.status).toBe("fail");
    expect(check.message).toContain("401");
  });
});
