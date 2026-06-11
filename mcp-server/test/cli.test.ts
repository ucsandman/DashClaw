import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function tempHome() {
  return mkdtempSync(join(tmpdir(), "offlocal-cli-test-"));
}

function runCli(args: string[], offlocalHome = tempHome()) {
  const env = { ...process.env, OFFLOCAL_HOME: offlocalHome };
  delete env.DASHCLAW_BASE_URL;
  delete env.DASHCLAW_API_KEY;
  delete env.DASHCLAW_TIMEOUT_MS;
  delete env.OFFLOCAL_DASHCLAW_MODE;
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
  return { ...result, offlocalHome };
}

function createMappedProjectHome() {
  const offlocalHome = tempHome();
  expect(runCli(["project", "create", "Acme CRM"], offlocalHome).status).toBe(0);
  expect(runCli(["env", "add", "staging", "--kind", "staging"], offlocalHome).status).toBe(0);
  return offlocalHome;
}

describe("CLI failure behavior", () => {
  it("exits non-zero for invalid project create usage", () => {
    const res = runCli(["project", "create"]);

    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout)).toMatchObject({
      status: "error",
      error: expect.stringMatching(/usage: offlocal project create/i),
    });
  });

  it("exits non-zero when map receives invalid resource JSON", () => {
    const res = runCli(["map", "github", "staging", "--resource", "{ nope"]);

    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout)).toMatchObject({
      status: "error",
      error: expect.stringMatching(/resource must be valid JSON/i),
    });
  });

  it("exits non-zero when map receives an unknown provider", () => {
    const res = runCli(["map", "unknown", "staging", "--resource", "{}"]);

    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout)).toMatchObject({
      status: "error",
      error: expect.stringMatching(/unknown provider/i),
    });
  });

  it("exits non-zero when map receives a missing explicit connection", () => {
    const offlocalHome = createMappedProjectHome();
    const res = runCli(
      ["map", "github", "staging", "--connection", "conn_missing", "--resource", "{\"owner\":\"acme\",\"repo\":\"app\"}"],
      offlocalHome,
    );

    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout)).toMatchObject({
      status: "error",
      error: expect.stringMatching(/connection.*not found/i),
    });
  });

  it("persists an explicit mapping connection id", () => {
    const offlocalHome = createMappedProjectHome();
    const statePath = join(offlocalHome, "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.connections.push({
      id: "conn_custom_github",
      workspaceId: state.defaultWorkspaceId,
      provider: "github",
      label: "custom-github",
      auth: { kind: "env", envVar: "CUSTOM_GITHUB_TOKEN" },
      createdAt: "2026-06-09T00:00:00.000Z",
    });
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const res = runCli(
      ["map", "github", "staging", "--connection", "conn_custom_github", "--resource", "{\"owner\":\"acme\",\"repo\":\"app\"}"],
      offlocalHome,
    );

    expect(res.status).toBe(0);
    const updated = JSON.parse(readFileSync(statePath, "utf8"));
    expect(updated.mappings[0]).toMatchObject({
      provider: "github",
      connectionId: "conn_custom_github",
      resource: { provider: "github", owner: "acme", repo: "app" },
    });
  });

  it("prints doctor output as JSON", () => {
    const offlocalHome = createMappedProjectHome();
    const res = runCli(["doctor", "--project", "acme-crm", "--env", "staging", "--json"], offlocalHome);

    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({
      status: "ok",
      report: expect.objectContaining({
        summary: expect.objectContaining({ total: expect.any(Number) }),
        checks: expect.any(Array),
      }),
    });
  });

  it("creates and lists connections from the CLI", () => {
    const offlocalHome = tempHome();
    const created = runCli(
      ["connection", "create", "github", "--label", "main", "--env-var", "CUSTOM_GITHUB_TOKEN"],
      offlocalHome,
    );
    expect(created.status).toBe(0);

    const listed = runCli(["connection", "list"], offlocalHome);
    expect(listed.status).toBe(0);
    expect(JSON.parse(listed.stdout)).toMatchObject({
      status: "ok",
      connections: [expect.objectContaining({ provider: "github", label: "main" })],
    });
    expect(listed.stdout).not.toContain("CUSTOM_GITHUB_TOKEN_VALUE");
  });

  it("exports audit from the CLI", () => {
    const offlocalHome = createMappedProjectHome();
    const statePath = join(offlocalHome, "audit.log");
    writeFileSync(
      statePath,
      JSON.stringify({
        timestamp: "2026-06-09T00:00:00.000Z",
        projectSlug: "acme-crm",
        environment: "staging",
        provider: "core",
        tool: "doctor",
        actionSummary: "doctor",
        policyDecision: "n/a",
        result: "success",
      }) + "\n",
    );

    const res = runCli(["audit", "export", "--project", "acme-crm", "--format", "csv"], offlocalHome);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("timestamp,project,environment,provider,tool");
    expect(res.stdout).toContain("doctor");
  });

  it("exports context snapshots from the CLI", () => {
    const offlocalHome = createMappedProjectHome();
    const res = runCli(["snapshot", "--project", "acme-crm", "--env", "staging", "--format", "json"], offlocalHome);

    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({
      schema: "offlocal.context.snapshot.v1",
      context: {
        project: { slug: "acme-crm" },
        focusedEnvironment: "staging",
      },
    });
  });

  it("prints DashClaw status from the CLI", () => {
    const res = runCli(["dashclaw", "status"]);

    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({
      status: "ok",
      dashclaw: expect.objectContaining({ configured: false, reachable: false }),
    });
  });

  it("exports DashClaw evidence from the CLI", () => {
    const offlocalHome = createMappedProjectHome();
    writeFileSync(
      join(offlocalHome, "audit.log"),
      JSON.stringify({
        timestamp: "2026-06-09T00:00:00.000Z",
        projectSlug: "acme-crm",
        environment: "staging",
        provider: "vercel",
        tool: "create_vercel_deployment",
        actionSummary: "deploy",
        policyDecision: "approval_required",
        result: "not_executed",
        dashclawDecisionId: "gd_1",
      }) + "\n",
    );

    const res = runCli(["dashclaw", "evidence", "--project", "acme-crm"], offlocalHome);

    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({
      schema: "offlocal.dashclaw.evidence.v1",
      entries: [expect.objectContaining({ dashclawDecisionId: "gd_1" })],
    });
  });

  it("exits non-zero when env add receives an invalid kind", () => {
    const res = runCli(["env", "add", "qa", "--kind", "prod-like"]);

    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout)).toMatchObject({
      status: "error",
      error: expect.stringMatching(/environment kind/i),
    });
  });

  it("does not write state for invalid commands", () => {
    const res = runCli(["env", "add", "qa", "--kind", "prod-like"]);

    expect(res.status).toBe(1);
    expect(existsSync(join(res.offlocalHome, "state.json"))).toBe(false);
  });
});
