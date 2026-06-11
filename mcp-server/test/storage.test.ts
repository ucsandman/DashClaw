import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage.js";
import { offlocalPaths } from "../src/paths.js";

function tempPaths() {
  const home = mkdtempSync(join(tmpdir(), "offlocal-storage-test-"));
  mkdirSync(home, { recursive: true });
  return offlocalPaths(home);
}

afterEach(() => {
  delete process.env.OFFLOCAL_LOCK_STALE_MS;
  delete process.env.OFFLOCAL_MEMORY_MAX_ENTRIES;
  delete process.env.OFFLOCAL_AUDIT_MAX_ENTRIES;
});

describe("Store persistence hardening", () => {
  it("fails loudly when state.json is corrupt instead of starting from empty state", () => {
    const paths = tempPaths();
    writeFileSync(paths.state, "{ not json");

    expect(() => new Store(paths)).toThrow(/state\.json is not valid JSON/i);
  });

  it("fails loudly when state.json has the wrong shape", () => {
    const paths = tempPaths();
    writeFileSync(paths.state, "[]");

    expect(() => new Store(paths)).toThrow(/state\.json.*object/i);
  });

  it("migrates older partial state files to the current version", () => {
    const paths = tempPaths();
    writeFileSync(paths.state, JSON.stringify({ version: 0, projects: [] }));

    const store = new Store(paths);

    expect(store.data.version).toBe(1);
    expect(store.data.workspaces).toEqual([]);
    expect(JSON.parse(readFileSync(paths.state, "utf8")).version).toBe(1);
  });

  it("fails loudly for unsupported future state versions", () => {
    const paths = tempPaths();
    writeFileSync(paths.state, JSON.stringify({ version: 99, projects: [] }));

    expect(() => new Store(paths)).toThrow(/unsupported state version/i);
  });

  it("fails loudly when memory.json is corrupt instead of dropping project memory", () => {
    const paths = tempPaths();
    writeFileSync(paths.memory, "{ not json");

    expect(() => new Store(paths)).toThrow(/memory\.json is not valid JSON/i);
  });

  it("fails loudly when memory.json has the wrong shape", () => {
    const paths = tempPaths();
    writeFileSync(paths.memory, "{}");

    expect(() => new Store(paths)).toThrow(/memory\.json.*array/i);
  });

  it("fails loudly when audit.log contains a corrupt JSON line", () => {
    const paths = tempPaths();
    writeFileSync(paths.audit, "{\"tool\":\"ok\"}\n{ not json }\n");
    const store = new Store(paths);

    expect(() => store.readAudit()).toThrow(/audit\.log.*line 2/i);
  });

  it("rolls back in-memory state when state persistence fails", () => {
    const paths = tempPaths();
    const store = new Store(paths);
    mkdirSync(paths.state);

    expect(() =>
      store.update((state) => {
        state.projects.push({
          id: "proj_test",
          workspaceId: "ws_test",
          name: "Test",
          slug: "test",
          createdAt: "2026-06-09T00:00:00.000Z",
        });
      }),
    ).toThrow();

    expect(store.data.projects).toHaveLength(0);
    expect(readdirSync(paths.home).filter((name) => name.includes(".tmp"))).toHaveLength(0);
  });

  it("rolls back in-memory memory entries when memory persistence fails", () => {
    const paths = tempPaths();
    const store = new Store(paths);
    mkdirSync(paths.memory);

    expect(() =>
      store.addMemory({
        id: "mem_test",
        projectId: "proj_test",
        note: "remember this",
        createdAt: "2026-06-09T00:00:00.000Z",
      }),
    ).toThrow();

    expect(store.listMemory()).toHaveLength(0);
    expect(readdirSync(paths.home).filter((name) => name.includes(".tmp"))).toHaveLength(0);
  });

  it("applies memory retention after appending a memory entry", () => {
    const paths = tempPaths();
    const store = new Store(paths);
    process.env.OFFLOCAL_MEMORY_MAX_ENTRIES = "2";

    for (const id of ["mem_1", "mem_2", "mem_3"]) {
      store.addMemory({
        id,
        projectId: "proj_test",
        note: id,
        createdAt: "2026-06-09T00:00:00.000Z",
      });
    }

    expect(store.listMemory().map((entry) => entry.id)).toEqual(["mem_2", "mem_3"]);
  });

  it("reloads state under lock so stale Store instances do not overwrite each other", () => {
    const paths = tempPaths();
    const first = new Store(paths);
    const second = new Store(paths);

    first.update((state) => {
      state.projects.push({
        id: "proj_first",
        workspaceId: "ws_test",
        name: "First",
        slug: "first",
        createdAt: "2026-06-09T00:00:00.000Z",
      });
    });
    second.update((state) => {
      state.projects.push({
        id: "proj_second",
        workspaceId: "ws_test",
        name: "Second",
        slug: "second",
        createdAt: "2026-06-09T00:00:00.000Z",
      });
    });

    expect(new Store(paths).data.projects.map((p) => p.id)).toEqual(["proj_first", "proj_second"]);
  });

  it("fails loudly when another process holds the state lock", () => {
    const paths = tempPaths();
    const store = new Store(paths);
    mkdirSync(`${paths.state}.lock`);

    expect(() =>
      store.update((state) => {
        state.projects.push({
          id: "proj_test",
          workspaceId: "ws_test",
          name: "Test",
          slug: "test",
          createdAt: "2026-06-09T00:00:00.000Z",
        });
      }),
    ).toThrow(/locked/i);

    expect(store.data.projects).toHaveLength(0);
  });

  it("serializes audit writes through a file lock", () => {
    const paths = tempPaths();
    const first = new Store(paths);
    const second = new Store(paths);

    first.appendAudit({
      timestamp: "2026-06-09T00:00:00.000Z",
      tool: "first",
      actionSummary: "first audit",
      policyDecision: "n/a",
      result: "success",
    });
    second.appendAudit({
      timestamp: "2026-06-09T00:00:01.000Z",
      tool: "second",
      actionSummary: "second audit",
      policyDecision: "n/a",
      result: "success",
    });

    expect(new Store(paths).readAudit().map((entry) => entry.tool)).toEqual(["second", "first"]);
  });

  it("applies audit retention after appending an audit entry", () => {
    const paths = tempPaths();
    const store = new Store(paths);
    process.env.OFFLOCAL_AUDIT_MAX_ENTRIES = "2";

    for (const tool of ["first", "second", "third"]) {
      store.appendAudit({
        timestamp: `2026-06-09T00:00:0${tool.length}.000Z`,
        tool,
        actionSummary: tool,
        policyDecision: "n/a",
        result: "success",
      });
    }

    expect(store.readAudit().map((entry) => entry.tool)).toEqual(["third", "second"]);
  });

  it("fails loudly when another process holds the audit lock", () => {
    const paths = tempPaths();
    const store = new Store(paths);
    mkdirSync(`${paths.audit}.lock`);

    expect(() =>
      store.appendAudit({
        timestamp: "2026-06-09T00:00:00.000Z",
        tool: "locked",
        actionSummary: "locked audit",
        policyDecision: "n/a",
        result: "success",
      }),
    ).toThrow(/locked/i);
  });

  it("fails loudly when OFFLOCAL_LOCK_STALE_MS is invalid", () => {
    const paths = tempPaths();
    const store = new Store(paths);
    mkdirSync(`${paths.audit}.lock`);
    process.env.OFFLOCAL_LOCK_STALE_MS = "0";

    expect(() =>
      store.appendAudit({
        timestamp: "2026-06-09T00:00:00.000Z",
        tool: "bad-lock-config",
        actionSummary: "bad lock config",
        policyDecision: "n/a",
        result: "success",
      }),
    ).toThrow(/OFFLOCAL_LOCK_STALE_MS.*positive integer/i);
  });
});
