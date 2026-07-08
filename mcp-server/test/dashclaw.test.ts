import { afterEach, describe, expect, it, vi } from "vitest";
import { DashClawClient } from "../src/client.js";
import { __resetInsecureUrlWarning, dashclawConfigFromEnv, dashclawFetch } from "../src/dashclaw/client.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DASHCLAW_URL;
  delete process.env.DASHCLAW_API_KEY;
  delete process.env.DASHCLAW_TIMEOUT_MS;
  delete process.env.DASHCLAW_MODE;
  delete process.env.DASHCLAW_HTTP_TIMEOUT_MS;
});

describe("DashClaw client", () => {
  it("reads env config without storing secrets", () => {
    process.env.DASHCLAW_URL = "https://dashclaw.example";
    process.env.DASHCLAW_API_KEY = "dc_secret";

    const config = dashclawConfigFromEnv();

    expect(config).toMatchObject({
      baseUrl: "https://dashclaw.example",
      apiKey: "dc_secret",
      timeoutMs: 30000,
      mode: "authoritative",
    });
  });

  it("fails clearly when required env vars are missing", () => {
    expect(() => dashclawConfigFromEnv()).toThrow(/DASHCLAW_URL/i);
  });

  it("accepts both DASHCLAW_TIMEOUT_MS and DASHCLAW_HTTP_TIMEOUT_MS", () => {
    process.env.DASHCLAW_URL = "https://dashclaw.example";
    process.env.DASHCLAW_API_KEY = "dc_secret";

    process.env.DASHCLAW_HTTP_TIMEOUT_MS = "1234";
    expect(dashclawConfigFromEnv().timeoutMs).toBe(1234);

    process.env.DASHCLAW_TIMEOUT_MS = "4321";
    expect(dashclawConfigFromEnv().timeoutMs).toBe(4321);
  });

  it("warns once when DASHCLAW_URL is plaintext http to a non-local host", () => {
    __resetInsecureUrlWarning();
    process.env.DASHCLAW_URL = "http://dashclaw.example";
    process.env.DASHCLAW_API_KEY = "dc_secret";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dashclawConfigFromEnv();
    dashclawConfigFromEnv();
    expect(errSpy.mock.calls.filter((c) => String(c[0]).includes("plaintext"))).toHaveLength(1);
    errSpy.mockRestore();
  });

  it("does not warn for http://localhost or https", () => {
    __resetInsecureUrlWarning();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.DASHCLAW_URL = "http://localhost:3000";
    process.env.DASHCLAW_API_KEY = "dc_secret";
    dashclawConfigFromEnv();
    __resetInsecureUrlWarning();
    process.env.DASHCLAW_URL = "https://dashclaw.example";
    dashclawConfigFromEnv();
    expect(errSpy.mock.calls.filter((c) => String(c[0]).includes("plaintext"))).toHaveLength(0);
    errSpy.mockRestore();
  });

  it("sends x-api-key and redacts secrets in HTTP errors", async () => {
    process.env.DASHCLAW_URL = "https://dashclaw.example";
    process.env.DASHCLAW_API_KEY = "dc_secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "bad key dc_secret" }), {
          status: 403,
          statusText: "Forbidden",
        }),
      ),
    );

    await expect(dashclawFetch("/api/guard", { method: "POST", body: { action_type: "provider_deploy" } })).rejects.toThrow(
      /REDACTED/,
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://dashclaw.example/api/guard",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "dc_secret" }),
      }),
    );
  });

  it("lets DashClawClient prefer an OAuth Authorization header over x-api-key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new DashClawClient({
      url: "https://dashclaw.example",
      apiKey: "dc_secret",
      authHeader: "Bearer oauth_token",
    });
    await client.get("/api/policies");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dashclaw.example/api/policies",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer oauth_token" }),
      }),
    );
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty("x-api-key");
  });
});
