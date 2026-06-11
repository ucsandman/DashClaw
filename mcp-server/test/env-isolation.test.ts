import { describe, expect, it } from "vitest";
import { dashclawConfigFromEnv } from "../src/dashclaw/client.js";

describe("test env isolation", () => {
  it("strips machine DASHCLAW_* env so tests cannot reach a live server", () => {
    // The setup file deletes every DASHCLAW_-prefixed key inherited from the
    // machine before this file runs. If a real DASHCLAW_URL/DASHCLAW_API_KEY
    // leaked through, dashclawConfigFromEnv() would resolve a live config.
    expect(Object.keys(process.env).filter((k) => k.startsWith("DASHCLAW_"))).toEqual([]);
    expect(() => dashclawConfigFromEnv()).toThrowError(/DASHCLAW_URL is required/);
  });
});
