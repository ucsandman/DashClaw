import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { composeServer } from "../src/server.js";
import { TOOL_DEFINITIONS } from "../src/tools.js";
import { freshStore } from "./helpers.js";

/**
 * The other suites register tools on a recording fake, so nothing proved that
 * the Zod shapes built from TOOL_DEFINITIONS survive the real MCP SDK: they
 * must convert to JSON Schema for tools/list and validate arguments on
 * tools/call. This drives a real McpServer over an in-memory transport, so it
 * holds across a Zod major upgrade.
 */
async function connected() {
  const server = new McpServer({ name: "contract-test", version: "0.0.0" });
  composeServer(server, freshStore());
  const client = new Client({ name: "contract-test-client", version: "0.0.0" });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { server, client };
}

/** A call the SDK rejects comes back as an error result or a thrown McpError. */
async function rejected(client: Client, name: string, args: Record<string, unknown>): Promise<string | null> {
  try {
    const result = await client.callTool({ name, arguments: args });
    if (!result.isError) return null;
    return JSON.stringify(result.content);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

describe("tool schemas through the real MCP SDK", () => {
  beforeEach(() => {
    process.env.DASHCLAW_URL = "https://governed.example.com";
    process.env.DASHCLAW_API_KEY = "oc_live_test_dummy";
  });

  afterEach(() => {
    delete process.env.DASHCLAW_URL;
    delete process.env.DASHCLAW_API_KEY;
  });

  it("lists every governance tool with the property names and required set its definition declares", async () => {
    const { client, server } = await connected();
    const { tools } = await client.listTools();
    const listed = new Map(tools.map((tool) => [tool.name, tool]));

    expect(TOOL_DEFINITIONS.length).toBeGreaterThan(0);
    for (const def of TOOL_DEFINITIONS) {
      const tool = listed.get(def.name);
      expect(tool, def.name).toBeDefined();
      const schema = tool!.inputSchema as { type?: string; properties?: Record<string, unknown>; required?: string[] };
      expect(schema.type, def.name).toBe("object");
      expect(Object.keys(schema.properties ?? {}).sort(), def.name).toEqual(Object.keys(def.inputSchema.properties ?? {}).sort());
      expect([...(schema.required ?? [])].sort(), def.name).toEqual([...(def.inputSchema.required ?? [])].sort());
    }
    await server.close();
  });

  it("keeps each property's JSON type and enum values in the listed schema", async () => {
    const { client, server } = await connected();
    const { tools } = await client.listTools();
    const listed = new Map(tools.map((tool) => [tool.name, tool]));

    let checked = 0;
    for (const def of TOOL_DEFINITIONS) {
      const properties = (listed.get(def.name)!.inputSchema as { properties?: Record<string, { type?: string; enum?: string[]; items?: { type?: string } }> }).properties ?? {};
      for (const [key, prop] of Object.entries(def.inputSchema.properties ?? {})) {
        const out = properties[key]!;
        const label = `${def.name}.${key}`;
        if (prop.enum && prop.enum.length > 0) {
          expect([...(out.enum ?? [])].sort(), label).toEqual([...prop.enum].sort());
        } else if (prop.type === "integer" || prop.type === "number" || prop.type === "boolean" || prop.type === "array" || prop.type === "object") {
          expect(out.type, label).toBe(prop.type);
          if (prop.type === "array") {
            expect(out.items?.type, label).toBe(prop.items?.type === "string" ? "string" : "object");
          }
        } else {
          expect(out.type, label).toBe("string");
        }
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
    await server.close();
  });

  it("rejects a call whose required argument is missing before the handler runs", async () => {
    const { client, server } = await connected();
    const def = TOOL_DEFINITIONS.find((tool) => (tool.inputSchema.required ?? []).length > 0);
    expect(def, "a tool with a required argument").toBeDefined();

    const message = await rejected(client, def!.name, {});
    expect(message, def!.name).not.toBeNull();
    expect(message!).toMatch(/invalid|required|expected/i);
    await server.close();
  });

  it("rejects a wrong-typed argument and an out-of-enum value", async () => {
    const { client, server } = await connected();
    let typed = 0;
    let enums = 0;
    for (const def of TOOL_DEFINITIONS) {
      for (const [key, prop] of Object.entries(def.inputSchema.properties ?? {})) {
        if (prop.enum && prop.enum.length > 0 && enums < 3) {
          expect(await rejected(client, def.name, { [key]: "__not_a_member__" }), `${def.name}.${key}`).not.toBeNull();
          enums += 1;
        } else if ((prop.type === "integer" || prop.type === "number") && typed < 3) {
          expect(await rejected(client, def.name, { [key]: "not-a-number" }), `${def.name}.${key}`).not.toBeNull();
          typed += 1;
        }
      }
    }
    expect(typed + enums).toBeGreaterThan(0);
    await server.close();
  });

  it("accepts a nested object for an object argument and rejects a string there", async () => {
    // Freeform object arguments are z.record schemas, the one construct whose
    // signature changed between Zod 3 and Zod 4.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network disabled in tests"); }));
    const { client, server } = await connected();
    let checked = 0;
    for (const def of TOOL_DEFINITIONS) {
      for (const [key, prop] of Object.entries(def.inputSchema.properties ?? {})) {
        if (prop.type !== "object" || checked >= 4) continue;
        const bad = await rejected(client, def.name, { [key]: "not-an-object" });
        expect(bad, `${def.name}.${key} string`).not.toBeNull();
        expect(bad!, `${def.name}.${key} string`).toContain(key);

        const good = await rejected(client, def.name, { [key]: { nested: { a: 1 }, list: [1, "two"] } });
        // Other required arguments may still be missing, but the object
        // argument itself must not be what the validator complains about.
        if (good !== null) expect(good, `${def.name}.${key} object`).not.toContain(`"${key}"`);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
    vi.unstubAllGlobals();
    await server.close();
  });
});
