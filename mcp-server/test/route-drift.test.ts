import { describe, expect, it } from "vitest";

describe("route drift check", () => {
  it("finds every MCP-referenced API route in the active inventory", async () => {
    const { findRouteDrift } = await import("../scripts/check-route-drift.mjs");

    const result = findRouteDrift();

    expect(result.references.length).toBeGreaterThan(0);
    expect(result.missing).toEqual([]);
  });
});
