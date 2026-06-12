import { randomUUID } from "node:crypto";
/** Short, readable, collision-resistant id with a type prefix, e.g. "proj_a1b2c3d4". */
export function newId(prefix) {
    return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
export function nowIso() {
    return new Date().toISOString();
}
/**
 * Strip all trailing "/" characters from a URL/host string. Uses a linear scan
 * instead of a regex to avoid super-linear backtracking on adversarial input.
 */
export function stripTrailingSlashes(value) {
    let end = value.length;
    while (end > 0 && value.charCodeAt(end - 1) === 47 /* "/" */)
        end--;
    return value.slice(0, end);
}
/** Turn a display name into a URL/identifier-safe slug. */
export function slugify(name) {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);
}
/** A small typed error so tool handlers can return clean messages. */
export class DashclawError extends Error {
    constructor(message) {
        super(message);
        this.name = "DashclawError";
    }
}
//# sourceMappingURL=util.js.map