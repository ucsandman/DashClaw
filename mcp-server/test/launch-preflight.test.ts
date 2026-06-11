import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLaunchPlan, preflightLaunch } from "../src/launch/index.js";
import { credentialEnvCandidates } from "../src/registration.js";
import { PROVIDER_IDS } from "../src/types.js";
import { errRead, fakeReads, okRead } from "./launch-helpers.js";
import { freshStore, seedAcme } from "./helpers.js";

const SET_VARS: string[] = [];

function setToken(name: string, value: string) {
  process.env[name] = value;
  SET_VARS.push(name);
}

describe("preflight_launch", () => {
  beforeEach(() => {
    // The machine exports real provider tokens; strip every candidate so each
    // test starts from a clean credential slate.
    for (const provider of PROVIDER_IDS) {
      for (const envVar of credentialEnvCandidates(provider)) delete process.env[envVar];
    }
  });

  afterEach(() => {
    for (const name of SET_VARS.splice(0)) delete process.env[name];
  });

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

  it("fails token presence for each declared provider whose env var is missing", async () => {
    const { store, plan } = planFor(["vercel", "stripe", "neon"]);

    const result = await preflightLaunch(store, { plan_id: plan.id }, fakeReads());

    expect(result.status).toBe("fail");
    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));
    expect(byId["token:vercel"]).toMatchObject({ status: "fail" });
    expect(byId["token:vercel"]!.remediation).toContain("VERCEL_TOKEN");
    expect(byId["token:stripe"]).toMatchObject({ status: "fail" });
    expect(byId["token:neon"]).toMatchObject({ status: "fail" });
    // Validity is skipped (not failed) when the credential is absent.
    expect(byId["token-validity:vercel"]).toMatchObject({ status: "skipped" });
  });

  it("fails token validity when the provider rejects the cheap authenticated read", async () => {
    const { store, plan } = planFor(["vercel"]);
    setToken("VERCEL_TOKEN", "vc_dummy");

    const result = await preflightLaunch(
      store,
      { plan_id: plan.id },
      fakeReads({ vercelDeployments: async () => errRead("Vercel API 401: invalid token") }),
    );

    const validity = result.checks.find((c) => c.id === "token-validity:vercel")!;
    expect(validity.status).toBe("fail");
    expect(validity.message).toContain("401");
    expect(result.status).toBe("fail");
  });

  it("fails mapping completeness for declared providers without a mapping", async () => {
    const { store, plan } = planFor(["vercel", "neon"]);
    setToken("VERCEL_TOKEN", "vc_dummy");
    setToken("NEON_API_KEY", "neon_dummy");

    const result = await preflightLaunch(store, { plan_id: plan.id }, fakeReads());

    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));
    // seedAcme maps vercel for production, but not neon.
    expect(byId["mapping:vercel"]).toMatchObject({ status: "pass" });
    expect(byId["mapping:neon"]).toMatchObject({ status: "fail" });
    expect(byId["mapping:neon"]!.remediation).toContain("map_provider_resource");
    expect(byId["token-validity:neon"]).toMatchObject({ status: "skipped" });
  });

  it("fails Stripe mode sanity when a production launch lacks the live key", async () => {
    const { store, plan } = planFor(["stripe"]);
    setToken("STRIPE_TEST_SECRET_KEY", "sk_test_dummy");

    const result = await preflightLaunch(store, { plan_id: plan.id }, fakeReads());

    const mode = result.checks.find((c) => c.id === "stripe-mode")!;
    expect(mode.status).toBe("fail");
    expect(mode.message).toContain("STRIPE_LIVE_SECRET_KEY");

    // A staging launch with the test key passes the same check.
    const staging = createLaunchPlan(store, {
      project: "acme-crm",
      environment: "staging",
      declared_stack: ["stripe"],
    });
    const stagingResult = await preflightLaunch(store, { plan_id: staging.id }, fakeReads());
    expect(stagingResult.checks.find((c) => c.id === "stripe-mode")).toMatchObject({ status: "pass" });
  });

  it("fails the Namecheap IP whitelist check on error 1011102 with re-whitelist remediation", async () => {
    const { store, plan } = planFor(["domain"], "acme.com");
    setToken("NAMECHEAP_API_KEY", "nc_dummy");

    const result = await preflightLaunch(
      store,
      { plan_id: plan.id },
      fakeReads({ namecheapDomains: async () => errRead("Namecheap error 1011102: IP not in whitelist") }),
    );

    const whitelist = result.checks.find((c) => c.id === "namecheap-ip-whitelist")!;
    expect(whitelist.status).toBe("fail");
    expect(whitelist.remediation).toContain("ifconfig.me");
    expect(whitelist.remediation).toContain("NAMECHEAP_CLIENT_IP");
  });

  it("passes everything for a fully credentialed, mapped stack", async () => {
    const { store, plan } = planFor(["vercel", "stripe"]);
    setToken("VERCEL_TOKEN", "vc_dummy");
    setToken("STRIPE_LIVE_SECRET_KEY", "sk_live_dummy");

    const result = await preflightLaunch(
      store,
      { plan_id: plan.id },
      fakeReads({
        vercelDeployments: async () => okRead([{ uid: "dep_1", readyState: "READY" }]),
        stripeProducts: async () => okRead([]),
      }),
    );

    expect(result.status).toBe("pass");
    expect(result.checks.every((c) => c.status !== "fail")).toBe(true);
  });
});
