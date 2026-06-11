import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync } from "node:fs";
import { freshStore, seedAcme } from "./helpers.js";
import {
  addEnvironment,
  createProject,
  getProjectContext,
  listEnvironments,
  listProviderMappings,
  getProviderMapping,
  ensureConnection,
  mapProviderResource,
  readProjectMemory,
  writeProjectMemory,
  listAuditLog,
} from "../src/service.js";

let fetchMock: ReturnType<typeof vi.fn>;

function mockOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock = vi.fn(async () => mockOk({ deployments: [] }));
  vi.stubGlobal("fetch", fetchMock);
  process.env.VERCEL_TOKEN = "vc_dummy";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.VERCEL_TOKEN;
});

describe("project + environment lifecycle", () => {
  it("creates a project and selects it by default", () => {
    const store = freshStore();
    const p = createProject(store, { name: "Acme CRM" });
    expect(p.slug).toBe("acme-crm");
    expect(store.data.selectedProjectId).toBe(p.id);
  });

  it("rejects duplicate project slugs", () => {
    const store = freshStore();
    createProject(store, { name: "Acme CRM" });
    expect(() => createProject(store, { name: "Acme CRM" })).toThrow(/already exists/);
  });

  it("rejects empty project display names even when a slug is supplied", () => {
    const store = freshStore();
    expect(() => createProject(store, { name: "   ", slug: "acme-crm" })).toThrow(/project name/i);
    expect(store.data.projects).toHaveLength(0);
  });

  it("adds environments and infers kind from name", () => {
    const store = freshStore();
    createProject(store, { name: "Acme CRM" });
    const staging = addEnvironment(store, { name: "staging" });
    const prod = addEnvironment(store, { name: "production" });
    expect(staging.kind).toBe("staging");
    expect(staging.isProduction).toBe(false);
    expect(prod.kind).toBe("production");
    expect(prod.isProduction).toBe(true);
    expect(listEnvironments(store)).toHaveLength(2);
  });

  it("rejects empty environment names", () => {
    const store = freshStore();
    createProject(store, { name: "Acme CRM" });

    expect(() => addEnvironment(store, { name: "   " })).toThrow(/environment name/i);
    expect(listEnvironments(store)).toHaveLength(0);
  });

  it("rejects invalid environment kinds at runtime", () => {
    const store = freshStore();
    createProject(store, { name: "Acme CRM" });

    expect(() => addEnvironment(store, { name: "qa", kind: "prod-like" as any })).toThrow(/environment kind/i);
    expect(listEnvironments(store)).toHaveLength(0);
  });
});

describe("provider mappings", () => {
  it("maps and retrieves a provider resource", () => {
    const store = freshStore();
    createProject(store, { name: "Acme CRM" });
    addEnvironment(store, { name: "staging" });
    mapProviderResource(store, {
      environment: "staging",
      provider: "github",
      resource: { provider: "github", owner: "acme", repo: "acme-crm" },
    });
    const m = getProviderMapping(store, { environment: "staging", provider: "github" });
    expect(m.resource).toMatchObject({ owner: "acme", repo: "acme-crm" });
    expect(listProviderMappings(store)).toHaveLength(1);
  });

  it("replaces an existing mapping for the same env+provider", () => {
    const store = freshStore();
    createProject(store, { name: "Acme CRM" });
    addEnvironment(store, { name: "staging" });
    mapProviderResource(store, {
      environment: "staging",
      provider: "stripe",
      resource: { provider: "stripe", mode: "test" },
    });
    mapProviderResource(store, {
      environment: "staging",
      provider: "stripe",
      resource: { provider: "stripe", mode: "live" },
    });
    expect(listProviderMappings(store)).toHaveLength(1);
    const m = getProviderMapping(store, { environment: "staging", provider: "stripe" });
    expect(m.resource).toMatchObject({ mode: "live" });
  });

  it("rejects unknown providers at runtime", () => {
    const store = freshStore();
    createProject(store, { name: "Acme CRM" });
    addEnvironment(store, { name: "staging" });

    expect(() =>
      mapProviderResource(store, {
        environment: "staging",
        provider: "not-a-provider" as any,
        resource: { provider: "not-a-provider" } as any,
      }),
    ).toThrow(/unknown provider/i);
  });

  it("rejects malformed provider resources before persisting mappings", () => {
    const store = freshStore();
    createProject(store, { name: "Acme CRM" });
    addEnvironment(store, { name: "staging" });

    expect(() =>
      mapProviderResource(store, {
        environment: "staging",
        provider: "github",
        resource: { provider: "github", owner: "acme" } as any,
      }),
    ).toThrow(/github.*repo/i);
    expect(listProviderMappings(store)).toHaveLength(0);
  });

  it("rejects missing explicit provider connections before persisting mappings", () => {
    const store = freshStore();
    createProject(store, { name: "Acme CRM" });
    addEnvironment(store, { name: "staging" });

    expect(() =>
      mapProviderResource(store, {
        environment: "staging",
        provider: "vercel",
        connectionId: "conn_missing",
        resource: { provider: "vercel", projectId: "acme-preview" },
      }),
    ).toThrow(/connection.*not found/i);
    expect(listProviderMappings(store)).toHaveLength(0);
  });

  it("rejects provider mappings that reference a connection for another provider", () => {
    const store = freshStore();
    createProject(store, { name: "Acme CRM" });
    addEnvironment(store, { name: "staging" });
    const githubConnectionId = ensureConnection(store, "github");

    expect(() =>
      mapProviderResource(store, {
        environment: "staging",
        provider: "vercel",
        connectionId: githubConnectionId,
        resource: { provider: "vercel", projectId: "acme-preview" },
      }),
    ).toThrow(/github.*not vercel/i);
    expect(listProviderMappings(store)).toHaveLength(0);
  });
});

describe("get_project_context (killer tool)", () => {
  it("returns rich per-environment context, action buckets, memory, and a summary", async () => {
    const store = freshStore();
    seedAcme(store);
    const ctx = await getProjectContext(store, "acme-crm");
    expect(ctx.environments.map((e) => e.environment).sort()).toEqual(["production", "staging"]);

    const prod = ctx.environments.find((e) => e.environment === "production")!;
    expect(prod.isProduction).toBe(true);
    // Mappings surfaced as source/deployment/database/payments.
    expect(prod.source.githubRepo).toBe("acme/acme-crm");
    expect(prod.deployment.vercelProject).toBe("acme-crm-prod");
    expect(prod.database.supabaseProjectRef).toBe("sb_prod_ref");
    expect(prod.payments.stripeMode).toBe("live");

    // Action buckets reflect policy.
    expect(prod.allowed.some((a) => /inspect GitHub repo/.test(a))).toBe(true);
    expect(prod.approvalRequired.some((a) => /deploy to Vercel/.test(a))).toBe(true);
    expect(prod.blocked.some((a) => /destructive SQL/.test(a))).toBe(true);

    const staging = ctx.environments.find((e) => e.environment === "staging")!;
    expect(staging.payments.stripeMode).toBe("test");
    // Staging deploy is allowed (not approval-required).
    expect(staging.allowed.some((a) => /deploy to Vercel/.test(a))).toBe(true);
    // Incident memory surfaces as the last known issue.
    expect(staging.deployment.lastKnownIssue).toMatch(/DATABASE_URL/);

    // Human-readable summary present.
    expect(ctx.summary).toMatch(/Project: acme-crm/);
    expect(ctx.summary).toMatch(/Approval required:/);
  });

  it("focuses on a single environment when one is given", async () => {
    const store = freshStore();
    seedAcme(store);
    const ctx = await getProjectContext(store, "acme-crm", "staging");
    expect(ctx.focusedEnvironment).toBe("staging");
    expect(ctx.environments).toHaveLength(1);
  });

  it("audits the embedded live Vercel snapshot read", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock.mockResolvedValueOnce(mockOk({
      deployments: [{ uid: "dpl_123", url: "acme.vercel.app", readyState: "READY", createdAt: 1700000000000 }],
    }));

    const ctx = await getProjectContext(store, "acme-crm", "staging");

    expect(ctx.environments[0]!.deployment.latest?.state).toBe("READY");
    expect(listAuditLog(store, { project: "acme-crm" })[0]).toMatchObject({
      provider: "vercel",
      tool: "get_project_context",
      policyDecision: "allow",
      result: "success",
    });
  });

  it("does not call Vercel for live context when the audit log cannot be reserved", async () => {
    const store = freshStore();
    seedAcme(store);
    mkdirSync(`${store.paths.audit}.lock`);

    const ctx = await getProjectContext(store, "acme-crm", "staging");

    expect(ctx.environments[0]!.deployment.liveDataError).toMatch(/audit/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("project memory", () => {
  it("writes and reads memory scoped by environment", () => {
    const store = freshStore();
    seedAcme(store);
    writeProjectMemory(store, {
      project: "acme-crm",
      environment: "staging",
      note: "Use Supabase staging for tests.",
      tags: ["supabase"],
    });
    const stagingMem = readProjectMemory(store, { project: "acme-crm", environment: "staging" });
    expect(stagingMem.some((m) => /Supabase staging/.test(m.note))).toBe(true);
    // Project-wide read includes the production-scoped seed note too.
    const all = readProjectMemory(store, { project: "acme-crm" });
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects empty memory notes before persisting", () => {
    const store = freshStore();
    seedAcme(store);
    const before = readProjectMemory(store, { project: "acme-crm" }).length;

    expect(() => writeProjectMemory(store, { project: "acme-crm", note: "   " })).toThrow(/memory note/i);
    expect(readProjectMemory(store, { project: "acme-crm" })).toHaveLength(before);
  });

  it("rejects empty memory tags before persisting", () => {
    const store = freshStore();
    seedAcme(store);
    const before = readProjectMemory(store, { project: "acme-crm" }).length;

    expect(() =>
      writeProjectMemory(store, { project: "acme-crm", note: "Useful note.", tags: ["incident", " "] }),
    ).toThrow(/memory tag/i);
    expect(readProjectMemory(store, { project: "acme-crm" })).toHaveLength(before);
  });
});

describe("audit log", () => {
  it("starts empty and is filterable by project", () => {
    const store = freshStore();
    seedAcme(store);
    expect(listAuditLog(store, { project: "acme-crm" })).toHaveLength(0);
  });

  it("rejects invalid audit log limits", () => {
    const store = freshStore();
    seedAcme(store);
    expect(() => listAuditLog(store, { project: "acme-crm", limit: -1 })).toThrow(/limit/i);
  });

  it("rejects invalid audit provider filters", () => {
    const store = freshStore();
    seedAcme(store);
    expect(() => listAuditLog(store, { project: "acme-crm", provider: "unknown" as any })).toThrow(/provider/i);
  });
});
