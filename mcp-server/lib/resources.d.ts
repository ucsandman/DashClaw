/**
 * DashClaw MCP resource definitions and handlers.
 * Resources provide read-only governance context.
 */
import type { DashClawClient } from "./client.js";
export interface ResourceDefinition {
    uri: string;
    name: string;
    description: string;
    mimeType: string;
    isTemplate?: boolean;
}
export type ResourceHandler = (variables?: any) => Promise<string>;
export declare const RESOURCE_DEFINITIONS: ResourceDefinition[];
/**
 * Create resource handler functions bound to a DashClawClient instance.
 * Each handler returns a JSON string of the resource content.
 */
export declare function createResourceHandlers(client: DashClawClient): Record<string, ResourceHandler>;
