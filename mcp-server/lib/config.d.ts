import type { Store } from "./storage.js";
import type { EnvironmentKind } from "./types.js";
import type { RegistrantContact } from "./providers/namecheap.js";
/**
 * Declarative config (`.dashclaw-local/config.yaml`) — the file that sells the mental
 * model. It maps projects → environments → provider resources, and declares
 * policy as `require_approval` / `block` lists. `dashclaw-mcp init` seeds the
 * runtime state (state.json) from it; state.json remains the source of truth.
 * Seeding skips projects whose slug already exists, so re-running is safe.
 *
 * Format:
 *   projects:
 *     your-project:
 *       environments:
 *         staging:
 *           github:   { repo: your-org/your-repo }
 *           vercel:   { project: your-staging-vercel-project }
 *           supabase: { project_ref: your_staging_project_ref }
 *           stripe:   { mode: test }
 *   policy:
 *     require_approval: [ vercel.deploy, vercel.env.write, supabase.write, stripe.write ]
 *     block:            [ supabase.destructive_sql, provider.delete ]
 */
interface ConfigEnvironment {
    kind?: EnvironmentKind;
    github?: {
        repo: string;
        connection_id?: string;
    };
    vercel?: {
        project: string;
        team_id?: string;
        connection_id?: string;
    };
    supabase?: {
        project_ref: string;
        connection_id?: string;
    };
    stripe?: {
        mode: "test" | "live";
        connection_id?: string;
    };
    railway?: {
        project_id: string;
        environment_id?: string;
        service_id?: string;
        connection_id?: string;
    };
    upstash?: {
        database_id: string;
        api_host?: string;
        qstash_url?: string;
        qstash_token_env_var?: string;
        qstash_current_signing_key_env_var?: string;
        qstash_next_signing_key_env_var?: string;
        connection_id?: string;
    };
    cloudflare_r2?: {
        account_id: string;
        bucket_name?: string;
        api_host?: string;
        jurisdiction?: "default" | "eu" | "fedramp";
        access_key_id_env_var?: string;
        secret_access_key_env_var?: string;
        public_url?: string;
        connection_id?: string;
    };
    sentry?: {
        organization_slug: string;
        project_slug?: string;
        team_slug?: string;
        connection_id?: string;
    };
    posthog?: {
        organization_id: string;
        project_id?: string;
        api_host?: string;
        ingest_host?: string;
        connection_id?: string;
    };
    resend?: {
        domain: string;
        default_from?: string;
        connection_id?: string;
    };
    twilio?: {
        account_sid: string;
        from_number?: string;
        messaging_service_sid?: string;
        connection_id?: string;
    };
    clerk?: {
        publishable_key: string;
        api_host?: string;
        frontend_api_url?: string;
        sign_in_url?: string;
        sign_up_url?: string;
        sign_in_fallback_redirect_url?: string;
        sign_up_fallback_redirect_url?: string;
        connection_id?: string;
    };
}
interface ConfigMemory {
    environment?: string;
    note: string;
    tags?: string[];
}
interface ConfigProject {
    name?: string;
    description?: string;
    environments?: Record<string, ConfigEnvironment>;
    memory?: ConfigMemory[];
}
interface ConfigRegistrant {
    first_name: string;
    last_name: string;
    address1: string;
    address2?: string;
    city: string;
    state_province: string;
    postal_code: string;
    country: string;
    /** Format +NNN.NNNNNNNNNN, e.g. "+1.5551234567". */
    phone: string;
    email_address: string;
    organization?: string;
}
interface LocalConfig {
    projects?: Record<string, ConfigProject>;
    policy?: {
        require_approval?: string[];
        block?: string[];
    };
    /** Account-level Namecheap settings; registrant contact used for domain purchases. */
    namecheap?: {
        registrant?: ConfigRegistrant;
    };
}
export declare function loadConfig(path: string): LocalConfig | undefined;
export interface SeedResult {
    createdProjects: string[];
    skippedProjects: string[];
    createdRules: number;
}
export declare function applyConfig(store: Store, config: LocalConfig): SeedResult;
export declare function seedFromConfigFile(store: Store, path: string): SeedResult | undefined;
/**
 * Read the registrant contact for domain purchases from the config file at
 * call time (it is account data, not runtime state, so it never enters
 * state.json). Returns undefined when the file or block is absent.
 */
export declare function loadRegistrantContact(path: string): RegistrantContact | undefined;
export {};
