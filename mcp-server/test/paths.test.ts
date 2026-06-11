import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { localHome, localPaths } from "../src/paths.js";

describe("path resolution", () => {
  afterEach(() => {
    delete process.env.DASHCLAW_LOCAL_HOME;
  });

  it("resolves DASHCLAW_LOCAL_HOME paths with spaces and preserves native absolute paths", () => {
    const home = mkdtempSync(join(tmpdir(), "Dashclaw Path Test "));
    process.env.DASHCLAW_LOCAL_HOME = home;

    expect(localHome()).toBe(resolve(home));
    expect(localPaths().state).toBe(resolve(home, "state.json"));
    expect(localPaths().memory).toBe(resolve(home, "memory.json"));
  });
});
