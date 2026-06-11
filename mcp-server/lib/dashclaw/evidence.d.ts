import type { DashclawOutcomeInput, DashclawStatusReport } from "./types.js";
export declare function dashclawStatusReport(): Promise<DashclawStatusReport>;
export declare function dashclawRecentDecisionsFetch(query: {
    project?: string;
    environment?: string;
    limit?: number;
}): Promise<unknown>;
export declare function recordDashclawOutcome(input: DashclawOutcomeInput): Promise<boolean>;
