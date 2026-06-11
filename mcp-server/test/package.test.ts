import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

interface PackedFile {
  path: string;
}

interface PackResult {
  files: PackedFile[];
}

function packedPaths(): string[] {
  const out = execSync("npm pack --dry-run --json", {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const result = JSON.parse(out) as PackResult[];
  return result[0]!.files.map((f) => f.path);
}

describe("npm package contents", () => {
  it("builds before running tests in the shared verify gate", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts.verify).toBe("npm run typecheck && npm run build && npm test && npm audit");
  });

  it("includes README-linked docs and example config", () => {
    expect(packedPaths()).toEqual(
      expect.arrayContaining([
        "docs/provider-research.md",
        ".offlocal/config.example.yaml",
        ".env.example",
      ]),
    );
  });

  it("keeps README smoke-test commands and runtime env docs present", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("npx -p @offlocal/mcp offlocal init");
    expect(readme).toContain("offlocal-mcp");
    expect(readme).toContain("OFFLOCAL_HTTP_RETRIES");
    expect(readme).toContain("OFFLOCAL_AUDIT_MAX_ENTRIES");
    expect(readme).toContain("Governed Infrastructure Actions");
    expect(readme).toContain("DASHCLAW_BASE_URL");
    expect(readme).toContain("DASHCLAW_API_KEY");
    expect(readme).toContain("dashclaw_status");
    expect(readme).toContain("set_app_env_vars");
    expect(readme).toContain("TWILIO_AUTH_TOKEN");
    expect(readme).toContain("send_twilio_sms");
    expect(readme).toContain("RESEND_API_KEY");
    expect(readme).toContain("send_resend_email");
    expect(readme).toContain("SENTRY_AUTH_TOKEN");
    expect(readme).toContain("create_sentry_client_key");
    expect(readme).toContain("create_sentry_release");
    expect(readme).toContain("create_sentry_deploy");
    expect(readme).toContain("POSTHOG_PERSONAL_API_KEY");
    expect(readme).toContain("get_posthog_project_env");
    expect(readme).toContain("create_posthog_feature_flag");
    expect(readme).toContain("UPSTASH_API_KEY");
    expect(readme).toContain("get_upstash_redis_env");
    expect(readme).toContain("create_upstash_redis_database");
    expect(readme).toContain("QSTASH_TOKEN");
    expect(readme).toContain("get_upstash_qstash_env");
    expect(readme).toContain("create_upstash_qstash_schedule");
    expect(readme).toContain("CLERK_SECRET_KEY");
    expect(readme).toContain("get_clerk_app_env");
    expect(readme).toContain("create_clerk_redirect_url");
    expect(readme).toContain("CLOUDFLARE_API_TOKEN");
    expect(readme).toContain("get_cloudflare_r2_env");
    expect(readme).toContain("create_cloudflare_r2_bucket");
    expect(readme).toContain("list_github_workflow_runs");
    expect(readme).toContain("rerun_github_workflow_run");
  });

  it("keeps the Windows token setup script in sync with provider credentials", () => {
    const script = readFileSync("scripts/setup-tokens.ps1", "utf8");
    const expectedVars = [
      "GITHUB_TOKEN",
      "VERCEL_TOKEN",
      "VERCEL_TEAM_ID",
      "SUPABASE_ACCESS_TOKEN",
      "STRIPE_TEST_SECRET_KEY",
      "STRIPE_LIVE_SECRET_KEY",
      "RAILWAY_TOKEN",
      "NEON_API_KEY",
      "UPSTASH_EMAIL",
      "UPSTASH_API_KEY",
      "QSTASH_TOKEN",
      "QSTASH_CURRENT_SIGNING_KEY",
      "QSTASH_NEXT_SIGNING_KEY",
      "CLOUDFLARE_API_TOKEN",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "SENTRY_AUTH_TOKEN",
      "POSTHOG_PERSONAL_API_KEY",
      "CLERK_SECRET_KEY",
      "RESEND_API_KEY",
      "TWILIO_AUTH_TOKEN",
      "NAMECHEAP_API_USER",
      "NAMECHEAP_API_KEY",
      "NAMECHEAP_CLIENT_IP",
      "NAMECHEAP_SANDBOX",
      "DASHCLAW_BASE_URL",
      "DASHCLAW_API_KEY",
    ];

    for (const name of expectedVars) {
      expect(script).toContain(`${name} `);
    }
  });
});
