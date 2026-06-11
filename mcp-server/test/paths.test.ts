import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { offlocalHome, offlocalPaths } from "../src/paths.js";

describe("path resolution", () => {
  afterEach(() => {
    delete process.env.OFFLOCAL_HOME;
  });

  it("resolves OFFLOCAL_HOME paths with spaces and preserves native absolute paths", () => {
    const home = mkdtempSync(join(tmpdir(), "Offlocal Path Test "));
    process.env.OFFLOCAL_HOME = home;

    expect(offlocalHome()).toBe(resolve(home));
    expect(offlocalPaths().state).toBe(resolve(home, "state.json"));
    expect(offlocalPaths().memory).toBe(resolve(home, "memory.json"));
  });
});
