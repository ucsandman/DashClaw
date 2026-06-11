import { describe, expect, it } from "vitest";
import { registerTools } from "../src/tools/index.js";
import { freshStore } from "./helpers.js";

type RegisteredTool = {
  config: {
    description?: string;
    inputSchema: Record<string, { safeParse: (value: unknown) => { success: boolean } }>;
  };
};

function registeredTools(): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(name: string, config: RegisteredTool["config"]) {
      tools.set(name, { config });
    },
  };

  registerTools(server as never, freshStore());
  return tools;
}

function inputSchema(tool: string): RegisteredTool["config"]["inputSchema"] {
  const registered = registeredTools().get(tool);
  if (!registered) {
    throw new Error(`Tool ${tool} was not registered`);
  }
  return registered.config.inputSchema;
}

describe("MCP tool schemas", () => {
  it("rejects blank required mutation strings before handlers run", () => {
    expect(inputSchema("create_project").name.safeParse("   ").success).toBe(false);
    expect(inputSchema("set_vercel_env_var").key.safeParse("").success).toBe(false);
    expect(inputSchema("set_railway_env_var").key.safeParse(" ").success).toBe(false);
    expect(inputSchema("query_supabase").sql.safeParse("\t").success).toBe(false);
    expect(inputSchema("create_stripe_product").name.safeParse(" ").success).toBe(false);
    expect(inputSchema("create_stripe_price").product.safeParse("").success).toBe(false);
    expect(inputSchema("create_sentry_project").name.safeParse(" ").success).toBe(false);
    expect(inputSchema("create_sentry_project").slug.safeParse("").success).toBe(false);
    expect(inputSchema("list_sentry_client_keys").projectSlug.safeParse(" ").success).toBe(false);
    expect(inputSchema("create_sentry_client_key").name.safeParse("").success).toBe(false);
    expect(inputSchema("create_sentry_release").version.safeParse(" ").success).toBe(false);
    expect(inputSchema("create_sentry_release").projects.safeParse([]).success).toBe(false);
    expect(inputSchema("create_sentry_deploy").version.safeParse("").success).toBe(false);
    expect(inputSchema("create_sentry_deploy").deployEnvironment.safeParse(" ").success).toBe(false);
    expect(inputSchema("list_sentry_deploys").version.safeParse("").success).toBe(false);
    expect(inputSchema("create_posthog_project").name.safeParse(" ").success).toBe(false);
    expect(inputSchema("create_posthog_project").appUrls.safeParse([""]).success).toBe(false);
    expect(inputSchema("create_posthog_feature_flag").key.safeParse("").success).toBe(false);
    expect(inputSchema("create_posthog_feature_flag").tags.safeParse([" "]).success).toBe(false);
    expect(inputSchema("create_upstash_redis_database").databaseName.safeParse(" ").success).toBe(false);
    expect(inputSchema("create_upstash_redis_database").primaryRegion.safeParse("").success).toBe(false);
    expect(inputSchema("create_upstash_redis_database").readRegions.safeParse([" "]).success).toBe(false);
    expect(inputSchema("get_upstash_redis_env").databaseId.safeParse("").success).toBe(false);
    expect(inputSchema("create_upstash_qstash_schedule").destination.safeParse(" ").success).toBe(false);
    expect(inputSchema("create_upstash_qstash_schedule").cron.safeParse("").success).toBe(false);
    expect(inputSchema("create_upstash_qstash_schedule").scheduleId.safeParse(" ").success).toBe(false);
    expect(inputSchema("create_upstash_qstash_schedule").contentType.safeParse("").success).toBe(false);
    expect(inputSchema("create_cloudflare_r2_bucket").bucketName.safeParse("UpperCase").success).toBe(false);
    expect(inputSchema("get_cloudflare_r2_env").bucketName.safeParse(" ").success).toBe(false);
    expect(inputSchema("list_cloudflare_r2_objects").prefix.safeParse("").success).toBe(false);
    expect(inputSchema("list_clerk_users").query.safeParse(" ").success).toBe(false);
    expect(inputSchema("create_clerk_redirect_url").url.safeParse("").success).toBe(false);
    expect(inputSchema("create_resend_domain").name.safeParse(" ").success).toBe(false);
    expect(inputSchema("verify_resend_domain").domainId.safeParse("").success).toBe(false);
    expect(inputSchema("send_resend_email").subject.safeParse(" ").success).toBe(false);
    expect(inputSchema("send_resend_email").to.safeParse([]).success).toBe(false);
    expect(inputSchema("send_twilio_sms").to.safeParse("").success).toBe(false);
    expect(inputSchema("send_twilio_sms").body.safeParse(" ").success).toBe(false);
    expect(inputSchema("create_twilio_call").url.safeParse("").success).toBe(false);
    expect(inputSchema("update_twilio_phone_number_webhooks").phoneNumberSid.safeParse(" ").success).toBe(false);
    expect(inputSchema("approve_action").approvalId.safeParse(" ").success).toBe(false);
    expect(inputSchema("reject_action").approvalId.safeParse("").success).toBe(false);
    expect(inputSchema("map_provider_resource").connectionId.safeParse(" ").success).toBe(false);
    expect(inputSchema("create_connection").label.safeParse("").success).toBe(false);
    expect(inputSchema("create_connection").envVar.safeParse(" ").success).toBe(false);
    expect(inputSchema("set_app_env_vars").vars.safeParse([]).success).toBe(false);
    expect(inputSchema("set_app_env_vars").vars.safeParse([{ key: "bad-key", value: "x" }]).success).toBe(false);
  });

  it("rejects invalid numeric options before handlers run", () => {
    expect(inputSchema("list_audit_log").limit.safeParse(0).success).toBe(false);
    expect(inputSchema("get_vercel_deployments").limit.safeParse(-1).success).toBe(false);
    expect(inputSchema("get_app_logs").limit.safeParse(1.5).success).toBe(false);
    expect(inputSchema("set_policy_rule").priority.safeParse(-1).success).toBe(false);
    expect(inputSchema("create_stripe_price").unitAmount.safeParse(0).success).toBe(false);
    expect(inputSchema("list_sentry_projects").limit.safeParse(0).success).toBe(false);
    expect(inputSchema("create_sentry_client_key").rateLimitCount.safeParse(-1).success).toBe(false);
    expect(inputSchema("list_posthog_projects").limit.safeParse(0).success).toBe(false);
    expect(inputSchema("list_posthog_feature_flags").limit.safeParse(1.5).success).toBe(false);
    expect(inputSchema("create_upstash_redis_database").budget.safeParse(-1).success).toBe(false);
    expect(inputSchema("list_github_workflow_runs").limit.safeParse(0).success).toBe(false);
    expect(inputSchema("list_github_workflow_jobs").runId.safeParse(0).success).toBe(false);
    expect(inputSchema("rerun_github_workflow_run").runId.safeParse(-1).success).toBe(false);
    expect(inputSchema("cancel_github_workflow_run").runId.safeParse(1.5).success).toBe(false);
  });

  it("rejects invalid approval status filters before handlers run", () => {
    expect(inputSchema("list_pending_approvals").status.safeParse("used").success).toBe(true);
    expect(inputSchema("list_pending_approvals").status.safeParse("waiting").success).toBe(false);
  });

  it("registers operational readiness tools", () => {
    const tools = registeredTools();
    expect(tools.has("doctor")).toBe(true);
    expect(tools.has("export_context")).toBe(true);
    expect(tools.has("list_connections")).toBe(true);
    expect(tools.has("create_connection")).toBe(true);
    expect(tools.has("simulate_action")).toBe(true);
    expect(inputSchema("map_provider_resource").provider.safeParse("sentry").success).toBe(true);
    expect(inputSchema("map_provider_resource").provider.safeParse("posthog").success).toBe(true);
    expect(inputSchema("map_provider_resource").provider.safeParse("upstash").success).toBe(true);
    expect(inputSchema("map_provider_resource").provider.safeParse("clerk").success).toBe(true);
    expect(inputSchema("map_provider_resource").provider.safeParse("cloudflare_r2").success).toBe(true);
    expect(inputSchema("create_connection").provider.safeParse("posthog").success).toBe(true);
    expect(inputSchema("create_connection").provider.safeParse("upstash").success).toBe(true);
    expect(inputSchema("create_connection").provider.safeParse("clerk").success).toBe(true);
    expect(inputSchema("create_connection").provider.safeParse("cloudflare_r2").success).toBe(true);
    expect(tools.has("export_audit_log")).toBe(true);
    expect(tools.has("set_app_env_vars")).toBe(true);
    expect(tools.get("set_app_env_vars")!.config.description).toMatch(/approval/i);
    expect(inputSchema("set_app_env_vars").targetProvider.safeParse("fly")).toMatchObject({ success: false });
    expect(inputSchema("set_app_env_vars").vars.safeParse([{ key: "DATABASE_URL", value: "" }]).success).toBe(true);
    expect(tools.has("dashclaw_status")).toBe(true);
    expect(tools.has("dashclaw_recent_decisions")).toBe(true);
    expect(tools.has("export_dashclaw_evidence")).toBe(true);
    expect(tools.has("explain_action_risk")).toBe(true);
    expect(tools.has("governed_action_summary")).toBe(true);
    expect(inputSchema("export_audit_log").format.safeParse("markdown").success).toBe(true);
    expect(inputSchema("export_audit_log").format.safeParse("xml").success).toBe(false);
    expect(inputSchema("export_context").format.safeParse("json").success).toBe(true);
    expect(inputSchema("export_context").format.safeParse("xml").success).toBe(false);
    expect(inputSchema("dashclaw_recent_decisions").limit.safeParse(0).success).toBe(false);
    expect(inputSchema("explain_action_risk").capability.safeParse("deploy").success).toBe(true);
    expect(tools.has("list_github_pull_requests")).toBe(true);
    expect(tools.has("list_github_branches")).toBe(true);
    expect(tools.has("get_github_status_checks")).toBe(true);
    expect(tools.has("list_github_workflow_runs")).toBe(true);
    expect(tools.has("list_github_workflow_jobs")).toBe(true);
    expect(tools.has("rerun_github_workflow_run")).toBe(true);
    expect(tools.has("cancel_github_workflow_run")).toBe(true);
    expect(tools.get("rerun_github_workflow_run")!.config.description).toMatch(/approval/i);
    expect(tools.get("cancel_github_workflow_run")!.config.description).toMatch(/approval/i);
    expect(tools.has("discover_railway_resources")).toBe(true);
    expect(tools.has("list_neon_projects")).toBe(true);
    expect(tools.has("create_neon_project")).toBe(true);
    expect(tools.has("get_neon_connection_uri")).toBe(true);
    expect(tools.has("check_domain_availability")).toBe(true);
    expect(tools.has("list_namecheap_domains")).toBe(true);
    expect(tools.has("purchase_domain")).toBe(true);
    expect(tools.has("get_dns_records")).toBe(true);
    expect(tools.has("set_dns_records")).toBe(true);
    expect(tools.get("set_dns_records")!.config.description).toMatch(/replaces all/i);
    expect(inputSchema("purchase_domain").domain.safeParse(" ").success).toBe(false);
    expect(tools.has("create_vercel_project")).toBe(true);
    expect(tools.has("add_vercel_domain")).toBe(true);
    expect(tools.has("create_stripe_webhook")).toBe(true);
    expect(tools.has("list_stripe_webhooks")).toBe(true);
    expect(tools.get("create_stripe_webhook")!.config.description).toMatch(/env var/i);
    expect(inputSchema("create_stripe_webhook").url.safeParse(" ").success).toBe(false);
    expect(inputSchema("add_vercel_domain").domain.safeParse("").success).toBe(false);
    expect(inputSchema("get_neon_connection_uri").neon_project_id.safeParse(" ").success).toBe(false);
    expect(inputSchema("get_neon_connection_uri").database_name.safeParse("").success).toBe(false);
    expect(tools.has("get_supabase_logs")).toBe(true);
    expect(tools.has("apply_supabase_migration")).toBe(true);
    expect(tools.has("list_stripe_customers")).toBe(true);
    expect(tools.has("list_stripe_subscriptions")).toBe(true);
    expect(tools.has("list_stripe_invoices")).toBe(true);
    expect(tools.has("list_sentry_projects")).toBe(true);
    expect(tools.has("create_sentry_project")).toBe(true);
    expect(tools.has("list_sentry_client_keys")).toBe(true);
    expect(tools.has("create_sentry_client_key")).toBe(true);
    expect(tools.has("list_sentry_releases")).toBe(true);
    expect(tools.has("create_sentry_release")).toBe(true);
    expect(tools.has("list_sentry_deploys")).toBe(true);
    expect(tools.has("create_sentry_deploy")).toBe(true);
    expect(tools.get("create_sentry_client_key")!.config.description).toMatch(/SENTRY_DSN/i);
    expect(tools.get("create_sentry_project")!.config.description).toMatch(/approval/i);
    expect(tools.get("create_sentry_deploy")!.config.description).toMatch(/approval/i);
    expect(tools.has("list_posthog_projects")).toBe(true);
    expect(tools.has("create_posthog_project")).toBe(true);
    expect(tools.has("get_posthog_project_env")).toBe(true);
    expect(tools.has("list_posthog_feature_flags")).toBe(true);
    expect(tools.has("create_posthog_feature_flag")).toBe(true);
    expect(tools.get("get_posthog_project_env")!.config.description).toMatch(/NEXT_PUBLIC_POSTHOG_KEY/i);
    expect(tools.get("create_posthog_project")!.config.description).toMatch(/approval/i);
    expect(tools.get("create_posthog_feature_flag")!.config.description).toMatch(/approval/i);
    expect(tools.has("list_upstash_redis_databases")).toBe(true);
    expect(tools.has("create_upstash_redis_database")).toBe(true);
    expect(tools.has("get_upstash_redis_env")).toBe(true);
    expect(tools.get("get_upstash_redis_env")!.config.description).toMatch(/UPSTASH_REDIS_REST_TOKEN/i);
    expect(tools.get("create_upstash_redis_database")!.config.description).toMatch(/approval/i);
    expect(tools.has("get_upstash_qstash_env")).toBe(true);
    expect(tools.has("list_upstash_qstash_schedules")).toBe(true);
    expect(tools.has("create_upstash_qstash_schedule")).toBe(true);
    expect(tools.get("get_upstash_qstash_env")!.config.description).toMatch(/QSTASH_CURRENT_SIGNING_KEY/i);
    expect(tools.get("create_upstash_qstash_schedule")!.config.description).toMatch(/approval/i);
    expect(tools.has("list_cloudflare_r2_buckets")).toBe(true);
    expect(tools.has("create_cloudflare_r2_bucket")).toBe(true);
    expect(tools.has("get_cloudflare_r2_env")).toBe(true);
    expect(tools.has("list_cloudflare_r2_objects")).toBe(true);
    expect(tools.get("get_cloudflare_r2_env")!.config.description).toMatch(/R2_SECRET_ACCESS_KEY/i);
    expect(tools.get("create_cloudflare_r2_bucket")!.config.description).toMatch(/approval/i);
    expect(tools.has("get_clerk_app_env")).toBe(true);
    expect(tools.has("list_clerk_users")).toBe(true);
    expect(tools.has("list_clerk_domains")).toBe(true);
    expect(tools.has("list_clerk_redirect_urls")).toBe(true);
    expect(tools.has("create_clerk_redirect_url")).toBe(true);
    expect(tools.get("get_clerk_app_env")!.config.description).toMatch(/NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/i);
    expect(tools.get("create_clerk_redirect_url")!.config.description).toMatch(/approval/i);
    expect(tools.has("list_resend_domains")).toBe(true);
    expect(tools.has("create_resend_domain")).toBe(true);
    expect(tools.has("verify_resend_domain")).toBe(true);
    expect(tools.has("send_resend_email")).toBe(true);
    expect(tools.get("send_resend_email")!.config.description).toMatch(/approval/i);
    expect(tools.has("list_twilio_phone_numbers")).toBe(true);
    expect(tools.has("update_twilio_phone_number_webhooks")).toBe(true);
    expect(tools.has("send_twilio_sms")).toBe(true);
    expect(tools.has("create_twilio_call")).toBe(true);
    expect(tools.get("send_twilio_sms")!.config.description).toMatch(/approval/i);
    expect(tools.get("create_twilio_call")!.config.description).toMatch(/approval/i);
    expect(inputSchema("get_github_status_checks").ref.safeParse("").success).toBe(false);
    expect(inputSchema("list_github_workflow_runs").branch.safeParse("").success).toBe(false);
    expect(inputSchema("list_github_workflow_jobs").filter.safeParse("old").success).toBe(false);
    expect(inputSchema("create_vercel_deployment").gitSource.safeParse({ type: "github", repoId: "123" }).success).toBe(true);
  });
});
