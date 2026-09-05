import type { Store } from "./storage.js";
import type { Project } from "./types.js";
import { DashclawError } from "./util.js";

/** Find a project by id or slug. Falls back to the selected project. */
export function resolveProject(store: Store, projectRef?: string): Project {
  const { projects, selectedProjectId } = store.data;
  if (projectRef) {
    const found = projects.find((p) => p.id === projectRef || p.slug === projectRef);
    if (!found) {
      throw new DashclawError(
        `No project matches "${projectRef}". Use list_projects to see available projects.`,
      );
    }
    return found;
  }
  if (selectedProjectId) {
    const sel = projects.find((p) => p.id === selectedProjectId);
    if (sel) return sel;
  }
  if (projects.length === 1) return projects[0]!;
  throw new DashclawError(
    "No project specified and none selected. Pass `project` or call select_project first.",
  );
}
