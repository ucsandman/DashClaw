import { randomUUID } from "node:crypto";

/** Short, readable, collision-resistant id with a type prefix, e.g. "proj_a1b2c3d4". */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Turn a display name into a URL/identifier-safe slug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** A small typed error so tool handlers can return clean messages. */
export class DashclawError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashclawError";
  }
}
