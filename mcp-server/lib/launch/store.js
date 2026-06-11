/**
 * Launch-plan persistence: one JSON file per plan under
 * `<localHome>/launches/<id>.json`, using the same lock + atomic-rename
 * conventions as the main Store (storage.ts). Local only — launch state is
 * never sent to the DashClaw dashboard.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { withFileLock } from "../storage.js";
import { DashclawError } from "../util.js";
const PLAN_ID_RE = /^launch_[A-Za-z0-9-]+$/;
export function newLaunchId() {
    return `launch_${randomUUID()}`;
}
export function launchesDir(home) {
    return join(home, "launches");
}
function planPath(home, id) {
    if (!PLAN_ID_RE.test(id)) {
        throw new DashclawError(`Invalid launch plan id "${id}" (expected launch_<uuid>).`);
    }
    return join(launchesDir(home), `${id}.json`);
}
export function saveLaunchPlan(home, plan) {
    const path = planPath(home, plan.id);
    mkdirSync(launchesDir(home), { recursive: true });
    withFileLock(path, () => {
        const tmp = `${path}.tmp`;
        writeFileSync(tmp, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
        renameSync(tmp, path);
    });
}
export function loadLaunchPlan(home, id) {
    const path = planPath(home, id);
    if (!existsSync(path)) {
        throw new DashclawError(`Launch plan "${id}" not found under ${launchesDir(home)}.`);
    }
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (!raw || raw.id !== id || !Array.isArray(raw.steps)) {
        throw new DashclawError(`Launch plan file for "${id}" is malformed.`);
    }
    return raw;
}
export function listLaunchPlans(home) {
    const dir = launchesDir(home);
    if (!existsSync(dir))
        return [];
    return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
        const plan = loadLaunchPlan(home, f.slice(0, -".json".length));
        return {
            id: plan.id,
            project: plan.project,
            environment: plan.environment,
            declaredStack: plan.declaredStack,
            createdAt: plan.createdAt,
            updatedAt: plan.updatedAt,
        };
    })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
//# sourceMappingURL=store.js.map