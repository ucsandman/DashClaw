import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

interface PackedFile {
  path: string;
}

interface PackResult {
  files: PackedFile[];
}

function packedPaths(): string[] {
  const out = execSync("npm pack --dry-run --json", {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const result = JSON.parse(out) as PackResult[];
  return result[0]!.files.map((f) => f.path);
}

describe("npm package contents", () => {
  it("carries the @dashclaw/mcp-server v2 identity", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      name: string;
      license: string;
      bin: Record<string, string>;
    };

    expect(pkg.name).toBe("@dashclaw/mcp-server");
    expect(pkg.license).toBe("Apache-2.0");
    expect(pkg.bin).toEqual({ "dashclaw-mcp": "bin/dashclaw-mcp.js" });
  });

  it("checks route drift and builds before running tests in the shared verify gate", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts.verify).toBe("npm run test -- test/route-drift.test.ts && npm run typecheck && npm run build && npm test && npm audit");
  });

  it("includes NOTICE, LICENSE, the entry bin, and the compiled server", () => {
    expect(packedPaths()).toEqual(
      expect.arrayContaining([
        "NOTICE",
        "LICENSE",
        "README.md",
        "bin/dashclaw-mcp.js",
        "lib/server.js",
      ]),
    );
  });

  it("keeps README install and runtime env docs present", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("@dashclaw/mcp-server");
    expect(readme).toContain("DASHCLAW_URL");
    expect(readme).toContain("DASHCLAW_API_KEY");
  });
});
