import type { Store } from "./storage.js";
import type { Project } from "./types.js";
/** Find a project by id or slug. Falls back to the selected project. */
export declare function resolveProject(store: Store, projectRef?: string): Project;
