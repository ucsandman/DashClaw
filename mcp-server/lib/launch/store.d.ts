/**
 * Launch-plan persistence: one JSON file per plan under
 * `<localHome>/launches/<id>.json`, using the same lock + atomic-rename
 * conventions as the main Store (storage.ts). Local only — launch state is
 * never sent to the DashClaw dashboard.
 */
import type { LaunchPlan } from "./types.js";
export declare function newLaunchId(): string;
export declare function launchesDir(home: string): string;
export declare function saveLaunchPlan(home: string, plan: LaunchPlan): void;
export declare function loadLaunchPlan(home: string, id: string): LaunchPlan;
export declare function listLaunchPlans(home: string): Array<Pick<LaunchPlan, "id" | "project" | "environment" | "declaredStack" | "createdAt" | "updatedAt">>;
