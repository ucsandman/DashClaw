import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, } from "node:fs";
import { localPaths } from "./paths.js";
import { DashclawError } from "./util.js";
function emptyState() {
    return {
        version: 1,
        workspaces: [],
        projects: [],
        environments: [],
        connections: [],
        mappings: [],
        policyRules: [],
        pendingApprovals: [],
    };
}
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requireArray(value, path) {
    if (!Array.isArray(value)) {
        throw new DashclawError(`${path} must be an array.`);
    }
}
function validateStateShape(value, path) {
    if (!isObject(value)) {
        throw new DashclawError(`${path} must be a JSON object.`);
    }
    const version = value.version ?? 0;
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) {
        throw new DashclawError(`${path}.version must be a non-negative integer.`);
    }
    if (version > emptyState().version) {
        throw new DashclawError(`Unsupported state version ${version}; this @dashclaw/mcp-server build supports version ${emptyState().version}.`);
    }
    for (const key of ["workspaces", "projects", "environments", "connections", "mappings", "policyRules", "pendingApprovals"]) {
        if (value[key] !== undefined)
            requireArray(value[key], `${path}.${key}`);
    }
    return { ...emptyState(), ...value, version: emptyState().version };
}
function validateMemoryShape(value, path) {
    if (!Array.isArray(value)) {
        throw new DashclawError(`${path} must be a JSON array.`);
    }
    return value;
}
function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}
function writeJsonAtomic(path, value) {
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        writeFileSync(tmp, JSON.stringify(value, null, 2));
        renameSync(tmp, path);
    }
    catch (err) {
        try {
            if (existsSync(tmp))
                rmSync(tmp, { force: true });
        }
        catch {
            // Preserve the original persistence failure.
        }
        throw err;
    }
}
function optionalPositiveEnvInt(name) {
    const raw = process.env[name];
    if (!raw)
        return undefined;
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new DashclawError(`${name} must be a positive integer.`);
    }
    return parsed;
}
const DEFAULT_LOCK_STALE_MS = 30_000;
function lockStaleMs() {
    const raw = process.env.DASHCLAW_LOCK_STALE_MS;
    if (!raw)
        return DEFAULT_LOCK_STALE_MS;
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new DashclawError("DASHCLAW_LOCK_STALE_MS must be a positive integer number of milliseconds.");
    }
    return parsed;
}
function acquireFileLock(path) {
    const lock = `${path}.lock`;
    try {
        mkdirSync(lock);
    }
    catch (err) {
        if (err && typeof err === "object" && "code" in err && err.code === "EEXIST") {
            try {
                const age = Date.now() - statSync(lock).mtimeMs;
                if (age > lockStaleMs()) {
                    rmSync(lock, { recursive: true, force: true });
                    mkdirSync(lock);
                }
                else {
                    throw new DashclawError(`${path} is locked by another dashclaw-mcp process. Retry after that process exits.`);
                }
            }
            catch (retryErr) {
                if (retryErr instanceof DashclawError)
                    throw retryErr;
                throw new DashclawError(`${path} is locked by another dashclaw-mcp process. Retry after that process exits.`);
            }
        }
        else {
            throw err;
        }
    }
    return () => {
        rmSync(lock, { recursive: true, force: true });
    };
}
export function withFileLock(path, fn) {
    const release = acquireFileLock(path);
    try {
        return fn();
    }
    finally {
        release();
    }
}
async function withFileLockAsync(path, fn) {
    const release = acquireFileLock(path);
    try {
        return await fn();
    }
    finally {
        release();
    }
}
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
export class Store {
    paths;
    state;
    memory;
    constructor(paths = localPaths()) {
        this.paths = paths;
        this.ensureHome();
        this.state = this.loadState();
        this.memory = this.loadMemory();
    }
    ensureHome() {
        if (!existsSync(this.paths.home)) {
            mkdirSync(this.paths.home, { recursive: true });
        }
    }
    loadState() {
        if (!existsSync(this.paths.state))
            return emptyState();
        try {
            const raw = readFileSync(this.paths.state, "utf8");
            const parsed = JSON.parse(raw);
            // Tolerate older/partial files by merging onto an empty shell.
            const state = validateStateShape(parsed, this.paths.state);
            if (isObject(parsed) && parsed.version !== state.version) {
                this.persistState(state);
            }
            return state;
        }
        catch (err) {
            throw new DashclawError(`${this.paths.state} is not valid JSON; refusing to start with empty state. ` +
                `Fix or move the file and retry. ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    loadMemory() {
        if (!existsSync(this.paths.memory))
            return [];
        try {
            return validateMemoryShape(JSON.parse(readFileSync(this.paths.memory, "utf8")), this.paths.memory);
        }
        catch (err) {
            throw new DashclawError(`${this.paths.memory} is not valid JSON; refusing to drop project memory. ` +
                `Fix or move the file and retry. ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    // --- state access --------------------------------------------------------
    /** Direct read access. Callers must NOT mutate the returned object in place. */
    get data() {
        return this.state;
    }
    /** Apply a mutation to state and persist. */
    update(mutator) {
        this.ensureHome();
        withFileLock(this.paths.state, () => {
            const current = this.loadState();
            const next = cloneJson(current);
            mutator(next);
            this.persistState(next);
            this.state = next;
        });
    }
    persistState(state) {
        this.ensureHome();
        writeJsonAtomic(this.paths.state, state);
    }
    // --- memory --------------------------------------------------------------
    listMemory(filter) {
        return this.memory.filter((m) => {
            if (filter?.projectId && m.projectId !== filter.projectId)
                return false;
            if (filter?.environmentId && m.environmentId !== filter.environmentId)
                return false;
            return true;
        });
    }
    addMemory(entry) {
        this.ensureHome();
        withFileLock(this.paths.memory, () => {
            const current = this.loadMemory();
            const maxEntries = optionalPositiveEnvInt("DASHCLAW_MEMORY_MAX_ENTRIES");
            const next = [...current, entry].slice(-(maxEntries ?? Number.MAX_SAFE_INTEGER));
            this.persistMemory(next);
            this.memory = next;
        });
    }
    persistMemory(memory) {
        this.ensureHome();
        writeJsonAtomic(this.paths.memory, memory);
    }
    // --- audit ---------------------------------------------------------------
    appendAuditUnlocked(entry) {
        appendFileSync(this.paths.audit, JSON.stringify(entry) + "\n");
        this.applyAuditRetentionUnlocked();
    }
    applyAuditRetentionUnlocked() {
        const maxEntries = optionalPositiveEnvInt("DASHCLAW_AUDIT_MAX_ENTRIES");
        if (maxEntries === undefined || !existsSync(this.paths.audit))
            return;
        const entries = parseAuditFile(this.paths.audit);
        if (entries.length <= maxEntries)
            return;
        const kept = entries.slice(-maxEntries);
        writeFileSync(this.paths.audit, kept.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    }
    /** Append one audit entry as a JSON line. Audit writes are append-only. */
    appendAudit(entry) {
        this.ensureHome();
        withFileLock(this.paths.audit, () => {
            this.appendAuditUnlocked(entry);
        });
    }
    async withAuditLock(fn) {
        this.ensureHome();
        return withFileLockAsync(this.paths.audit, async () => fn((entry) => this.appendAuditUnlocked(entry)));
    }
    readAudit(limit = 50, filter) {
        if (!existsSync(this.paths.audit))
            return [];
        const entries = parseAuditFile(this.paths.audit);
        const filtered = entries.filter((e) => {
            if (filter?.projectSlug && e.projectSlug !== filter.projectSlug)
                return false;
            if (filter?.environment && e.environment !== filter.environment)
                return false;
            if (filter?.provider && e.provider !== filter.provider)
                return false;
            return true;
        });
        // Most recent last in the file; return the newest `limit`, newest first.
        return filtered.slice(-limit).reverse();
    }
}
function parseAuditFile(path) {
    const lines = readFileSync(path, "utf8").split("\n");
    const entries = [];
    for (const [idx, line] of lines.entries()) {
        if (line.trim().length === 0)
            continue;
        try {
            entries.push(JSON.parse(line));
        }
        catch (err) {
            throw new DashclawError(`${path} is not valid JSONL at line ${idx + 1}; refusing to hide audit entries. ` +
                `Fix or move the file and retry. ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return entries;
}
//# sourceMappingURL=storage.js.map