import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { composeServer } from "../src/server.js";
import { freshStore } from "./helpers.js";

/**
 * Codex CLI v0.147+ probes `prompts/list` during its startup handshake against
 * every MCP server, regardless of advertised capabilities, and treats a
 * -32601 Method-not-found reply as a fatal startup failure for the whole
 * client. This server ships zero prompts — the probe must get an honest empty
 * list, not an error.
 */
describe("prompts/list startup probe (Codex v0.147 compat)", () => {
  it("answers prompts/list with an empty list instead of -32601", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    composeServer(server, freshStore());

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "probe", version: "0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.listPrompts();
    expect(res.prompts).toEqual([]);

    await client.close();
    await server.close();
  });
});
