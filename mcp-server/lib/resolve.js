import { DashclawError } from "./util.js";
/** Find a project by id or slug. Falls back to the selected project. */
export function resolveProject(store, projectRef) {
    const { projects, selectedProjectId } = store.data;
    if (projectRef) {
        const found = projects.find((p) => p.id === projectRef || p.slug === projectRef);
        if (!found) {
            throw new DashclawError(`No project matches "${projectRef}". Use list_projects to see available projects.`);
        }
        return found;
    }
    if (selectedProjectId) {
        const sel = projects.find((p) => p.id === selectedProjectId);
        if (sel)
            return sel;
    }
    if (projects.length === 1)
        return projects[0];
    throw new DashclawError("No project specified and none selected. Pass `project` or call select_project first.");
}
export function resolveEnvironment(store, project, envRef) {
    const envs = store.data.environments.filter((e) => e.projectId === project.id);
    if (envRef) {
        const found = envs.find((e) => e.id === envRef || e.name === envRef);
        if (!found) {
            throw new DashclawError(`Project "${project.slug}" has no environment "${envRef}". ` +
                `Known: ${envs.map((e) => e.name).join(", ") || "(none)"}.`);
        }
        return found;
    }
    if (envs.length === 1)
        return envs[0];
    throw new DashclawError(`Project "${project.slug}" has multiple environments — specify which: ${envs
        .map((e) => e.name)
        .join(", ")}.`);
}
export function findMapping(store, environment, provider) {
    return store.data.mappings.find((m) => m.environmentId === environment.id && m.provider === provider);
}
export function requireMapping(store, project, environment, provider) {
    const m = findMapping(store, environment, provider);
    if (!m) {
        throw new DashclawError(`No ${provider} mapping for ${project.slug}/${environment.name}. ` +
            `Add one with map_provider_resource.`);
    }
    return m;
}
export function findConnection(store, provider, connectionId) {
    if (connectionId) {
        return store.data.connections.find((c) => c.id === connectionId && c.provider === provider);
    }
    return store.data.connections.find((c) => c.provider === provider);
}
//# sourceMappingURL=resolve.js.map