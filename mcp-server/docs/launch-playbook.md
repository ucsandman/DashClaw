# Launch playbook — domain to production, governed end-to-end

The golden path for shipping a product with the governed provider tools: buy the
domain, deploy on Vercel, provision the database on Neon, wire Stripe, verify.
Every step names the **exact tool** and says what to expect. Steps marked
**(APPROVAL)** pause until a human approves — in the DashClaw UI when DashClaw
is configured, otherwise via `approve_action`.

Prerequisites: env vars from [.env.example](../.env.example) set in your MCP
client's `env` block; a project + environment created (`create_project`,
`add_environment`); Namecheap enablement done (see the last section).

## The golden path

1. **`check_domain_availability`** — pass `domains: ["yourname.com"]`.
   Returns availability, premium status, and pricing. Free; run as often as
   you like.

2. **`purchase_domain` (APPROVAL — always)** — registers the domain and
   spends real money. The `purchase` capability cannot be policy-allowed; a
   human approves every purchase. Needs the `namecheap.registrant` config
   block (below) — the tool tells you exactly what's missing otherwise.
   Start with `NAMECHEAP_SANDBOX=true` to rehearse without charges.

3. **`create_vercel_project`** — pass `name` (and optionally `framework`,
   e.g. `nextjs`). Then map it so later steps target it:
   `map_provider_resource` with the returned project id.

4. **`add_vercel_domain`** — attaches the domain to the Vercel project. The
   result includes `dnsTarget` — the exact record to create at Namecheap
   (apex: `A @ 76.76.21.21`; subdomain: `CNAME www cname.vercel-dns.com`) —
   plus any TXT `verification` challenges.

5. **`set_dns_records` (APPROVAL in production)** — create the records from
   step 4. **WARNING: this REPLACES ALL host records for the domain.** Run
   `get_dns_records` first and resend every record you want to keep.

6. **`create_neon_project`** — provisions a Postgres database. The result
   includes the **connection URI (DATABASE_URL) with credentials — shown here
   only, never in the audit log**. Need it again later (or for another
   branch/role)? `get_neon_connection_uri`.

7. **Optional cache/session/rate-limit storage** — run
   `create_upstash_redis_database` for a new Upstash Redis database, or map an
   existing one with `map_provider_resource` using
   `{ "provider": "upstash", "databaseId": "your-upstash-db-id", "apiHost": "https://api.upstash.com" }`.
   `get_upstash_redis_env` returns `UPSTASH_REDIS_REST_URL`,
   `UPSTASH_REDIS_REST_TOKEN`, and `UPSTASH_REDIS_READ_ONLY_REST_TOKEN`.
   Store the returned bundle with `set_app_env_vars`. REST tokens are kept out
   of audit and DashClaw context.
   For background jobs or cron, `get_upstash_qstash_env` returns `QSTASH_URL`,
   `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, and
   `QSTASH_NEXT_SIGNING_KEY`; `create_upstash_qstash_schedule` wires a public
   endpoint to a cron expression with QStash-side redaction of request bodies
   and forwarded headers.

8. **Optional object/file storage** — run `create_cloudflare_r2_bucket` for a
   new Cloudflare R2 bucket, or map an existing one with `map_provider_resource`
   using `{ "provider": "cloudflare_r2", "accountId": "your-cloudflare-account-id", "bucketName": "assets" }`.
   `get_cloudflare_r2_env` returns `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`,
   `R2_ENDPOINT`, `R2_REGION`, and the configured S3-compatible credential envs.
   Store the app env bundle with `set_app_env_vars`. Cloudflare API tokens and
   R2 secret access keys are kept out of audit and DashClaw context.

9. **`set_app_env_vars`** — set `DATABASE_URL` from step 6, plus any provider
   env bundles from steps 7-8, on the mapped Vercel or Railway app
   (APPROVAL in production by default). Use `set_vercel_env_var` or
   `set_railway_env_var` only for a one-off single-key change.

10. **`create_vercel_deployment` (APPROVAL in production)** — deploy the app.

11. **`create_stripe_product`** then **`create_stripe_price`** — test mode is
   allowed by default; **live mode requires approval**.

12. **`create_stripe_webhook`** — pass your endpoint URL (e.g.
    `https://yourname.com/api/stripe/webhook`) and `enabled_events`. The
    result contains the **`whsec_` signing secret exactly once — Stripe never
    shows it again.** Store it immediately:

13. **`set_app_env_vars`** — add `STRIPE_WEBHOOK_SECRET` from step 12 to the
    same app env bundle. Redeploy if your framework inlines env vars at build
    time.

14. **Verify** — `get_vercel_deployment_status` until `READY`, then
    `get_app_logs` for runtime errors and `list_stripe_webhooks` to confirm
    the endpoint is `enabled`. `get_project_context` summarizes the whole
    environment in one call.

15. **Optional observability wiring** — map Sentry with `map_provider_resource`
    using `{ "provider": "sentry", "organizationSlug": "your-sentry-org", "projectSlug": "yourname-web", "teamSlug": "platform" }`.
    `SENTRY_AUTH_TOKEN` stays in the MCP env block.

16. **`create_sentry_project` / `create_sentry_client_key` (APPROVAL in
    production)** — create the Sentry project if it does not exist, then create
    a client key. The result includes the public `SENTRY_DSN`; set it with
    `set_app_env_vars` and redeploy. Secret DSNs returned by Sentry are
    stripped from the tool result and never written to audit/DashClaw context.

17. **`create_sentry_release` / `create_sentry_deploy`** — after a deployment,
    record the version and deploy marker in Sentry so regressions and issues can
    be traced back to the shipped commit/environment. Production deploy markers
    require approval by default.

18. **Optional analytics / feature-flag wiring** — map PostHog with
    `map_provider_resource` using
    `{ "provider": "posthog", "organizationId": "your-posthog-org-id", "projectId": "12345", "apiHost": "https://us.posthog.com", "ingestHost": "https://us.i.posthog.com" }`.
    `POSTHOG_PERSONAL_API_KEY` stays in the MCP env block.

19. **`create_posthog_project` / `get_posthog_project_env` (APPROVAL in
    production)** — create the PostHog project if it does not exist, or fetch
    wiring for an existing one. The result includes
    `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, and
    `POSTHOG_PROJECT_ID`; set them with `set_app_env_vars` and redeploy.
    Private PostHog project secrets are stripped from tool results.

20. **`list_posthog_feature_flags` / `create_posthog_feature_flag`** — inspect
    or create launch flags for the mapped project. New flags are inactive by
    default; production flag writes require approval by default.

21. **Optional auth wiring** — map Clerk with `map_provider_resource` using
    `{ "provider": "clerk", "publishableKey": "pk_live_...", "signInUrl": "/sign-in", "signUpUrl": "/sign-up" }`.
    `CLERK_SECRET_KEY` stays in the MCP env block.

22. **`get_clerk_app_env` / `list_clerk_domains`** — fetch
    `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, optional sign-in/sign-up route envs,
    and the primary domain/Frontend API URL. Set the public env vars with
    `set_app_env_vars` and redeploy if your framework inlines env at build
    time.

23. **`create_clerk_redirect_url` (APPROVAL in production)** — whitelist
    OAuth/native callback URLs for the mapped Clerk instance. Clerk Secret Keys
    and user metadata are kept out of audit and DashClaw context.

24. **Optional email wiring** — map Resend with `map_provider_resource` using
    `{ "provider": "resend", "domain": "yourname.com", "defaultFrom": "Your App <onboarding@yourname.com>" }`.
    `RESEND_API_KEY` stays in the MCP env block.

25. **`create_resend_domain` (APPROVAL in production)** — create the sending
    domain and copy the returned DNS records into `set_dns_records` alongside
    any existing Namecheap records you need to preserve. Then run
    `verify_resend_domain`.

26. **`send_resend_email` (APPROVAL by default)** — send only reviewed test
    or operator-owned messages from the MCP. Outbound email is treated as live
    external communication even outside production; recipients, subjects, and
    message bodies are kept out of audit and DashClaw context.

27. **Optional SMS/voice wiring** — map Twilio with `map_provider_resource`
    using `{ "provider": "twilio", "accountSid": "AC...", "fromNumber": "+15551230000" }`.
    `TWILIO_AUTH_TOKEN` stays in the MCP env block.

28. **`update_twilio_phone_number_webhooks` (APPROVAL in production)** — wire
    your inbound SMS and voice routes, e.g. `https://yourname.com/api/twilio/sms`
    and `https://yourname.com/api/twilio/voice`.

29. **`send_twilio_sms` / `create_twilio_call` (APPROVAL by default)** — use
    only for reviewed test/operator-owned numbers. These are treated as live
    external communications even outside production, and message contents /
    recipient numbers are kept out of audit and DashClaw context.

## Namecheap enablement (one-time)

API access is **not on by default**, and accounts must meet one of
Namecheap's eligibility bars: 20+ domains, **or** $50+ account balance,
**or** $50+ spent in the last two years.

1. Enable: namecheap.com → **Profile → Tools → API Access** → toggle on →
   copy the API key.
2. **Whitelist your public IP** on the same page. Find it with
   `curl ifconfig.me`. Residential IPs rotate — when calls suddenly fail with
   **error 1011102**, your IP changed: re-whitelist the new one and update
   `NAMECHEAP_CLIENT_IP`. (The tools tell you exactly this when it happens.)
3. **Sandbox** (recommended until you're ready to spend): separate account at
   **sandbox.namecheap.com**, with its own API key and its own IP whitelist.
   Set `NAMECHEAP_SANDBOX=true` to target it — purchases are free rehearsals.
4. Env vars: `NAMECHEAP_API_USER` (account username), `NAMECHEAP_API_KEY`,
   `NAMECHEAP_CLIENT_IP`, `NAMECHEAP_SANDBOX`.
5. Registrant contact for purchases — add to `.dashclaw-local/config.yaml`
   (placeholders, obviously):

```yaml
namecheap:
  registrant:
    first_name: Ada
    last_name: Lovelace
    address1: 123 Main St
    city: Anytown
    state_province: CA
    postal_code: "12345"
    country: US
    phone: "+1.5551234567"      # Namecheap format: +NNN.NNNNNNNNNN
    email_address: you@example.com
```

## When something pauses

A paused step returns `status: "approval_required"` with a reason. Approve in
the DashClaw UI (or `approve_action` with the returned id when running
without DashClaw), then **re-run the same tool** — approval never executes
anything by itself. If a risky step errors with "DashClaw unavailable", that
is fail-closed working as intended: bring DashClaw back (or set
`DASHCLAW_URL`) and retry.
