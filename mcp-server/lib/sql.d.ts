import type { Capability } from "./types.js";
export interface SqlClassification {
    capability: Extract<Capability, "read" | "write" | "destructive_sql">;
    /** The leading keyword we matched on. */
    keyword: string;
    /** True when the SQL is purely read-only (safe to send with read_only:true). */
    readOnly: boolean;
}
export declare function classifySql(rawSql: string): SqlClassification;
