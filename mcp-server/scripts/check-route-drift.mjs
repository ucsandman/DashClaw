#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(__dirname, "..");

const SOURCE_FILES = [
  "src/tools.ts",
  "src/tools/index.ts",
  "src/resources.ts",
  "src/dashclaw/evidence.ts",
];

export function findRouteDrift(root = defaultRoot) {
  const inventoryPath = path.join(root, "lib/routes-inventory.generated.json");
  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));

  const activeRoutes = new Set();
  collectActiveRoutes(inventory, activeRoutes);

  const references = [];
  for (const relative of SOURCE_FILES) {
    const file = path.join(root, relative);
    const text = readFileSync(file, "utf8");
    for (const route of extractRouteReferences(text)) {
      references.push({ file: relative, route, normalized: normalizeRoute(route) });
    }
  }

  return {
    references,
    missing: references.filter((ref) => !activeRoutes.has(ref.normalized)),
  };
}

export function main() {
  const { references, missing } = findRouteDrift();
  if (missing.length > 0) {
    console.error("[dashclaw-mcp] Route drift detected. Referenced MCP routes missing from lib/routes-inventory.generated.json:");
    for (const ref of missing) {
      console.error(`- ${ref.file}: ${ref.route}`);
    }
    process.exit(1);
  }
  console.log(`[dashclaw-mcp] Route drift check passed (${new Set(references.map((r) => r.normalized)).size} referenced routes).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

function collectActiveRoutes(value, routes) {
  if (Array.isArray(value)) {
    for (const item of value) collectActiveRoutes(item, routes);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.path === "string" && value.path.startsWith("/api/") && value.archived !== true) {
    routes.add(normalizeInventoryRoute(value.path));
  }
  for (const child of Object.values(value)) collectActiveRoutes(child, routes);
}

function extractRouteReferences(text) {
  const routes = new Set();
  const stringOrTemplate = /'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g;
  let match;
  while ((match = stringOrTemplate.exec(text))) {
    const literal = match[1] ?? match[2] ?? match[3] ?? "";
    for (const route of literal.match(/\/api\/[A-Za-z0-9_./\[\]${}()?-]+/g) ?? []) {
      routes.add(cleanRoute(route));
    }
  }
  return [...routes].sort();
}

function cleanRoute(route) {
  return route
    .split("?")[0]
    .replace(/[.,;:)]+$/g, "")
    .replace(/\/+$/g, "");
}

function normalizeRoute(route) {
  return cleanRoute(route).replace(/\$\{[^}]+\}/g, "[param]");
}

function normalizeInventoryRoute(route) {
  return cleanRoute(route).replace(/\[[^\]/]+\]/g, "[param]");
}
