import type { DashclawOutcomeInput, DashclawStatusReport } from "./types.js";
export declare function dashclawStatusReport(): Promise<DashclawStatusReport>;
export declare function recordDashclawOutcome(input: DashclawOutcomeInput): Promise<boolean>;
