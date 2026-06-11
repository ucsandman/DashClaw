import type { Store } from "./storage.js";
import type { Environment, Project, ProviderConnection, ProviderId, ProviderMapping } from "./types.js";
/** Find a project by id or slug. Falls back to the selected project. */
export declare function resolveProject(store: Store, projectRef?: string): Project;
export declare function resolveEnvironment(store: Store, project: Project, envRef?: string): Environment;
export declare function findMapping(store: Store, environment: Environment, provider: ProviderId): ProviderMapping | undefined;
export declare function requireMapping(store: Store, project: Project, environment: Environment, provider: ProviderId): ProviderMapping;
export declare function findConnection(store: Store, provider: ProviderId, connectionId?: string): ProviderConnection | undefined;
