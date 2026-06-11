/** Short, readable, collision-resistant id with a type prefix, e.g. "proj_a1b2c3d4". */
export declare function newId(prefix: string): string;
export declare function nowIso(): string;
/** Turn a display name into a URL/identifier-safe slug. */
export declare function slugify(name: string): string;
/** A small typed error so tool handlers can return clean messages. */
export declare class DashclawError extends Error {
    constructor(message: string);
}
