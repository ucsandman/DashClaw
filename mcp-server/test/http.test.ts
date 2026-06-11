import { afterEach, describe, expect, it, vi } from "vitest";
import { httpJson } from "../src/providers/http.js";

describe("HTTP client hardening", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.DASHCLAW_HTTP_TIMEOUT_MS;
    delete process.env.DASHCLAW_HTTP_RETRIES;
    delete process.env.DASHCLAW_HTTP_RETRY_BASE_MS;
  });

  it("passes an abort signal and honors explicit timeout overrides", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(httpJson("https://api.example.test/resource", { timeoutMs: 1234 })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/resource",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("fails loudly when DASHCLAW_HTTP_TIMEOUT_MS is invalid", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.DASHCLAW_HTTP_TIMEOUT_MS = "0";

    await expect(httpJson("https://api.example.test/resource")).rejects.toThrow(/DASHCLAW_HTTP_TIMEOUT_MS.*positive integer/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts slow provider calls and redacts secrets in timeout errors", async () => {
    vi.useFakeTimers();
    process.env.DASHCLAW_HTTP_RETRIES = "0";
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      ),
    );

    let timeoutError: unknown;
    const pending = httpJson("https://api.example.test/resource", {
      query: { access_token: "secret-token-123" },
      timeoutMs: 25,
    }).catch((err) => {
      timeoutError = err;
    });

    await vi.advanceTimersByTimeAsync(25);
    await pending;

    expect(timeoutError).toBeInstanceOf(Error);
    expect((timeoutError as Error).message).toMatch(/Timed out after 25ms.*access_token=\*\*\*REDACTED\*\*\*/);
    expect((timeoutError as Error).message).not.toMatch(/secret-token-123/);
  });

  it("fails loudly when DASHCLAW_HTTP_RETRIES is invalid", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.DASHCLAW_HTTP_RETRIES = "-1";

    await expect(httpJson("https://api.example.test/resource")).rejects.toThrow(/DASHCLAW_HTTP_RETRIES.*non-negative integer/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redacts secret-looking query values from network errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connection refused");
    }));

    await expect(
      httpJson("https://api.example.test/resource", {
        query: { access_token: "secret-token-123" },
      }),
    ).rejects.toThrow(/access_token=\*\*\*REDACTED\*\*\*/);
    await expect(
      httpJson("https://api.example.test/resource", {
        query: { access_token: "secret-token-123" },
      }),
    ).rejects.not.toThrow(/secret-token-123/);
  });

  it("redacts secret-looking fields from non-2xx response details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "bad", token: "secret-token-123" }), {
        status: 401,
        statusText: "Unauthorized",
        headers: { "content-type": "application/json" },
      }),
    ));

    await expect(httpJson("https://api.example.test/resource")).rejects.toThrow(/token.*REDACTED/i);
    await expect(httpJson("https://api.example.test/resource")).rejects.not.toThrow(/secret-token-123/);
  });
});
