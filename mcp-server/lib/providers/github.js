import { httpJson } from "./http.js";
import { arrayShape, booleanField, objectShape, optionalStringField, stringField } from "./shape.js";
/**
 * GitHub REST adapter (read-only surface for V0).
 * Base: https://api.github.com — auth: Bearer PAT (GITHUB_TOKEN).
 * Pinned API version per research note.
 */
const BASE = "https://api.github.com";
const API_VERSION = "2026-03-10";
function headers(token) {
    return {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "@dashclaw/mcp-server",
    };
}
export async function getRepoContext(token, owner, repo) {
    const data = await httpJson(`${BASE}/repos/${owner}/${repo}`, {
        headers: headers(token),
    });
    const repoData = objectShape(data, "GitHub repo");
    return {
        fullName: stringField(repoData, "full_name", "GitHub repo"),
        description: optionalStringField(repoData, "description") ?? null,
        defaultBranch: stringField(repoData, "default_branch", "GitHub repo"),
        private: booleanField(repoData, "private", "GitHub repo"),
        pushedAt: stringField(repoData, "pushed_at", "GitHub repo"),
        language: optionalStringField(repoData, "language") ?? null,
        openIssues: typeof repoData.open_issues_count === "number" ? repoData.open_issues_count : 0,
        topics: Array.isArray(repoData.topics) ? repoData.topics : undefined,
        htmlUrl: stringField(repoData, "html_url", "GitHub repo"),
    };
}
function optionalNumberField(value, key) {
    return typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] : undefined;
}
export async function getReadme(token, owner, repo) {
    const data = await httpJson(`${BASE}/repos/${owner}/${repo}/readme`, {
        headers: headers(token),
    });
    const readme = objectShape(data, "GitHub README");
    const decoded = readme.encoding === "base64"
        ? Buffer.from(stringField(readme, "content", "GitHub README"), "base64").toString("utf8")
        : String(readme.content ?? "");
    return { path: stringField(readme, "path", "GitHub README"), content: decoded };
}
export async function listFiles(token, owner, repo, path = "") {
    const data = await httpJson(`${BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`, { headers: headers(token) });
    const arr = Array.isArray(data) ? arrayShape(data, "GitHub contents") : [objectShape(data, "GitHub content")];
    return arr.map((entry) => {
        const e = objectShape(entry, "GitHub content");
        return {
            name: stringField(e, "name", "GitHub content"),
            path: stringField(e, "path", "GitHub content"),
            type: stringField(e, "type", "GitHub content"),
            size: typeof e.size === "number" ? e.size : 0,
        };
    });
}
export async function listPullRequests(token, owner, repo, opts = {}) {
    const data = await httpJson(`${BASE}/repos/${owner}/${repo}/pulls`, {
        headers: headers(token),
        query: { state: opts.state ?? "open", per_page: String(opts.limit ?? 10) },
    });
    return arrayShape(data, "GitHub pull requests").map((entry) => {
        const pr = objectShape(entry, "GitHub pull request");
        const head = objectShape(pr.head, "GitHub pull request head");
        const base = objectShape(pr.base, "GitHub pull request base");
        return {
            number: typeof pr.number === "number" ? pr.number : 0,
            title: stringField(pr, "title", "GitHub pull request"),
            state: stringField(pr, "state", "GitHub pull request"),
            draft: typeof pr.draft === "boolean" ? pr.draft : false,
            headRef: stringField(head, "ref", "GitHub pull request head"),
            baseRef: stringField(base, "ref", "GitHub pull request base"),
            htmlUrl: stringField(pr, "html_url", "GitHub pull request"),
            updatedAt: stringField(pr, "updated_at", "GitHub pull request"),
        };
    });
}
export async function listBranches(token, owner, repo, limit = 30) {
    const data = await httpJson(`${BASE}/repos/${owner}/${repo}/branches`, {
        headers: headers(token),
        query: { per_page: String(limit) },
    });
    return arrayShape(data, "GitHub branches").map((entry) => {
        const branch = objectShape(entry, "GitHub branch");
        const commit = typeof branch.commit === "object" && branch.commit !== null ? objectShape(branch.commit, "GitHub branch commit") : {};
        return {
            name: stringField(branch, "name", "GitHub branch"),
            protected: typeof branch.protected === "boolean" ? branch.protected : false,
            sha: optionalStringField(commit, "sha"),
        };
    });
}
export async function getCombinedStatus(token, owner, repo, ref) {
    const data = await httpJson(`${BASE}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}/status`, {
        headers: headers(token),
    });
    const status = objectShape(data, "GitHub combined status");
    return {
        state: stringField(status, "state", "GitHub combined status"),
        totalCount: typeof status.total_count === "number" ? status.total_count : 0,
        sha: optionalStringField(status, "sha"),
        statuses: Array.isArray(status.statuses)
            ? status.statuses.map((entry) => {
                const s = objectShape(entry, "GitHub status");
                return {
                    context: stringField(s, "context", "GitHub status"),
                    state: stringField(s, "state", "GitHub status"),
                    targetUrl: optionalStringField(s, "target_url"),
                    description: optionalStringField(s, "description"),
                };
            })
            : [],
    };
}
export async function listWorkflowRuns(token, owner, repo, opts = {}) {
    const data = await httpJson(`${BASE}/repos/${owner}/${repo}/actions/runs`, {
        headers: headers(token),
        query: {
            branch: opts.branch,
            event: opts.event,
            status: opts.status,
            per_page: String(opts.limit ?? 30),
        },
    });
    const runs = objectShape(data, "GitHub workflow runs");
    return {
        totalCount: optionalNumberField(runs, "total_count") ?? 0,
        workflowRuns: arrayShape(runs.workflow_runs ?? [], "GitHub workflow runs").map((entry) => {
            const run = objectShape(entry, "GitHub workflow run");
            return {
                id: optionalNumberField(run, "id") ?? 0,
                name: optionalStringField(run, "name"),
                title: optionalStringField(run, "display_title"),
                status: stringField(run, "status", "GitHub workflow run"),
                conclusion: optionalStringField(run, "conclusion"),
                event: optionalStringField(run, "event"),
                headBranch: optionalStringField(run, "head_branch"),
                headSha: optionalStringField(run, "head_sha"),
                runAttempt: optionalNumberField(run, "run_attempt"),
                createdAt: optionalStringField(run, "created_at"),
                updatedAt: optionalStringField(run, "updated_at"),
                htmlUrl: optionalStringField(run, "html_url"),
                workflowId: optionalNumberField(run, "workflow_id"),
            };
        }),
    };
}
export async function listWorkflowJobs(token, owner, repo, runId, opts = {}) {
    const data = await httpJson(`${BASE}/repos/${owner}/${repo}/actions/runs/${runId}/jobs`, {
        headers: headers(token),
        query: {
            filter: opts.filter,
            per_page: String(opts.limit ?? 30),
        },
    });
    const jobs = objectShape(data, "GitHub workflow jobs");
    return {
        totalCount: optionalNumberField(jobs, "total_count") ?? 0,
        jobs: arrayShape(jobs.jobs ?? [], "GitHub workflow jobs").map((entry) => {
            const job = objectShape(entry, "GitHub workflow job");
            return {
                id: optionalNumberField(job, "id") ?? 0,
                runId: optionalNumberField(job, "run_id"),
                name: stringField(job, "name", "GitHub workflow job"),
                status: stringField(job, "status", "GitHub workflow job"),
                conclusion: optionalStringField(job, "conclusion"),
                startedAt: optionalStringField(job, "started_at"),
                completedAt: optionalStringField(job, "completed_at"),
                htmlUrl: optionalStringField(job, "html_url"),
                steps: Array.isArray(job.steps)
                    ? job.steps.map((entry) => {
                        const step = objectShape(entry, "GitHub workflow job step");
                        return {
                            name: stringField(step, "name", "GitHub workflow job step"),
                            status: optionalStringField(step, "status"),
                            conclusion: optionalStringField(step, "conclusion"),
                            number: optionalNumberField(step, "number"),
                            startedAt: optionalStringField(step, "started_at"),
                            completedAt: optionalStringField(step, "completed_at"),
                        };
                    })
                    : undefined,
            };
        }),
    };
}
export async function rerunWorkflowRun(token, owner, repo, runId) {
    await httpJson(`${BASE}/repos/${owner}/${repo}/actions/runs/${runId}/rerun`, {
        method: "POST",
        headers: headers(token),
    });
    return { runId, rerun: true };
}
export async function cancelWorkflowRun(token, owner, repo, runId) {
    await httpJson(`${BASE}/repos/${owner}/${repo}/actions/runs/${runId}/cancel`, {
        method: "POST",
        headers: headers(token),
    });
    return { runId, canceled: true };
}
//# sourceMappingURL=github.js.map