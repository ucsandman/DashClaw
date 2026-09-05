// Shared branded-primitive helpers for DashClaw domain types.
//
// Branding prevents cross-wiring distinct string ids (e.g. OrganizationId vs
// AgentId) at compile time while remaining a plain string at runtime — zero
// runtime cost, types only.

declare const __brand: unique symbol;

/** Nominal brand over a base type `T` tagged with literal `B`. */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

/** A column/value that may be SQL NULL → `T | null`. */
export type Nullable<T> = T | null;
