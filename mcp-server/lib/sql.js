/**
 * Classify a SQL statement into a capability for the policy engine.
 *
 * This is a *defense-in-depth UX layer*, NOT a security boundary — the real
 * enforcement for reads is Supabase's backend `read_only` flag. We classify
 * conservatively: anything that looks destructive is treated as such, and
 * anything ambiguous is treated as a write (never silently as a read).
 */
const DESTRUCTIVE = [
    "drop",
    "truncate",
    "delete",
    "alter",
    "grant",
    "revoke",
    "create", // schema changes
    "replace",
];
const WRITE = ["insert", "update", "merge", "upsert", "call", "do"];
const READ = ["select", "with", "show", "explain", "values", "table"];
function stripComments(sql) {
    return sql
        .replace(/--[^\n]*/g, " ") // line comments
        .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
        .trim();
}
export function classifySql(rawSql) {
    const sql = stripComments(rawSql).toLowerCase();
    const firstWord = (sql.match(/^[a-z]+/) ?? [""])[0];
    // Scan the whole statement for destructive verbs — catches multi-statement
    // payloads like "select 1; drop table users".
    const hasDestructive = DESTRUCTIVE.some((kw) => new RegExp(`(^|[^a-z])${kw}([^a-z]|$)`).test(sql));
    if (hasDestructive) {
        const kw = DESTRUCTIVE.find((k) => new RegExp(`(^|[^a-z])${k}([^a-z]|$)`).test(sql));
        return { capability: "destructive_sql", keyword: kw, readOnly: false };
    }
    const hasWrite = WRITE.some((kw) => new RegExp(`(^|[^a-z])${kw}([^a-z]|$)`).test(sql));
    if (hasWrite) {
        const kw = WRITE.find((k) => new RegExp(`(^|[^a-z])${k}([^a-z]|$)`).test(sql));
        return { capability: "write", keyword: kw, readOnly: false };
    }
    if (READ.includes(firstWord)) {
        return { capability: "read", keyword: firstWord, readOnly: true };
    }
    // Unknown / ambiguous → treat as a write (never as a safe read).
    return { capability: "write", keyword: firstWord || "unknown", readOnly: false };
}
//# sourceMappingURL=sql.js.map