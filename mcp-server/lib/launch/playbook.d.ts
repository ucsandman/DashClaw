/**
 * The launch-playbook golden path (docs/launch-playbook.md) codified as data.
 * The .md stays the human reference — keep the two consistent. Some adjacent
 * playbook steps are folded into one checklist step when they share a single
 * observable end state (e.g. add_vercel_domain + set_dns_records both land as
 * "DNS points at the app").
 */
import { type LaunchStackItem, type LaunchStep } from "./types.js";
export declare function validateStack(declared: string[]): LaunchStackItem[];
/** Derive the ordered step checklist for a declared stack. */
export declare function generateSteps(stack: LaunchStackItem[], opts: {
    domain?: string;
}): LaunchStep[];
