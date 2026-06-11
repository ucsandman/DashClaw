import type { AuditLogEntry, LocalState, ProjectMemory } from "./types.js";
import { type LocalPaths } from "./paths.js";
export declare function withFileLock<T>(path: string, fn: () => T): T;
/**
 * Local-first JSON storage for V0.
 *
 * We deliberately use plain JSON files rather than SQLite so the project has
 * zero native dependencies (clean install on every OS, including Windows) and
 * the state is human-readable/diffable. The Store keeps an in-memory copy and
 * write-through-persists on every mutation. Mutations take a per-file lock,
 * reload from disk under that lock, then atomically rename the new JSON into
 * place so stale Store instances do not overwrite each other.
 */
export declare class Store {
    readonly paths: LocalPaths;
    private state;
    private memory;
    constructor(paths?: LocalPaths);
    private ensureHome;
    private loadState;
    private loadMemory;
    /** Direct read access. Callers must NOT mutate the returned object in place. */
    get data(): Readonly<LocalState>;
    /** Apply a mutation to state and persist. */
    update(mutator: (state: LocalState) => void): void;
    private persistState;
    listMemory(filter?: {
        projectId?: string;
        environmentId?: string;
    }): ProjectMemory[];
    addMemory(entry: ProjectMemory): void;
    private persistMemory;
    private appendAuditUnlocked;
    private applyAuditRetentionUnlocked;
    /** Append one audit entry as a JSON line. Audit writes are append-only. */
    appendAudit(entry: AuditLogEntry): void;
    withAuditLock<T>(fn: (appendAudit: (entry: AuditLogEntry) => void) => Promise<T>): Promise<T>;
    readAudit(limit?: number, filter?: {
        projectSlug?: string;
        environment?: string;
        provider?: string;
    }): AuditLogEntry[];
}
