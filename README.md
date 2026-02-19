# [DashClaw](https://dashclaw.io): AI Agent Decision Infrastructure

DashClaw is the control plane that proves what your AI agents decided and why. It combines a public site, an operator dashboard, and an API surface so you can enforce policies before agents act, track assumptions, and maintain full decision accountability (approvals, compliance mapping, rate limits, webhooks).

Screenshots live in `public/images/screenshots/`.

## How It Works

DashClaw is a single codebase that serves two roles:

| | **dashclaw.io** (marketing) | **Your deployment** (self-hosted) |
|---|---|---|
| **Landing page** | Marketing site with demo | Same landing page, "Dashboard" goes to your real dashboard |
| **Dashboard button** | Opens demo (fixture data, no login) | Opens real dashboard (GitHub OAuth login) |
| **Data** | Hardcoded fixtures | Your Postgres database |
| **DASHCLAW_MODE** | `demo` | `self_host` (default) |

Both modes use the same "Dashboard" button linking to `/dashboard`. The middleware decides what happens based on `DASHCLAW_MODE`: demo mode skips auth and serves fixtures, self_host mode requires login and hits your database.

Users fork the repo, deploy to Vercel free tier, and get a fully functional dashboard at `your-app.vercel.app`. The "Dashboard" button takes them straight to their authenticated dashboard.

## Product Surfaces

- `/` - landing page (marketing on dashclaw.io, homepage on self-hosted)
- `/practical-systems` - about the team behind DashClaw (public)
- `/demo` - demo sandbox (fake data, read-only, no login)
- `/dashboard` - operations dashboard (real data, requires auth)
- `/swarm` - real-time swarm intelligence & neural web (visual fleet overview)
- `/scoring` - multi-dimensional quality scoring & risk templates (Phase 7)
- `/drift` - statistical behavioral drift analysis (Phase 5)
- `/learning/analytics` - agent learning velocity & maturity tracking (Phase 6)
- `/feedback` - user feedback loop & quality analytics (Phase 3)
- `/compliance/exports` - bundled audit-ready reports & schedules (Phase 4)
- `/prompts` - prompt template registry & versioning (immutable prompts)
- `/docs` - SDK + platform docs (public)
- `/self-host` - get started guide (Vercel + Neon setup)

## Repo Layout

- `app/`: Next.js App Router pages, dashboard UI, API routes, shared libraries
- `sdk/`: Node.js SDK (`dashclaw`)
- `sdk-python/`: Python SDK (`dashclaw`)
- `agent-tools/`: local Python CLI tool suite (optional dashboard sync)
- `scripts/`: migrations, CI guardrails, OpenAPI + inventory generators
- `docs/`: RFCs, runbooks, parity matrix, governance docs
- `PROJECT_DETAILS.md`: deep architecture and behavior reference (canonical)

## Deployment Options

DashClaw runs anywhere Node.js runs. Pick the setup that fits your needs:

| | **Local (Docker)** | **Cloud (Vercel + Neon)** |
|---|---|---|
| **Best for** | Development, privacy, maximum speed | Remote access from anywhere (phone, laptop) |
| **Database** | Docker Postgres (direct TCP, fastest) | Neon free tier (serverless, no infra to manage) |
| **Hosting** | Your machine (`localhost:3000`) | Vercel free tier (`your-app.vercel.app`) |
| **Cost** | Free | Free |

You can also mix and match: run Vercel with a self-hosted Postgres, or run locally with a Neon database. DashClaw auto-detects your database type and uses the optimal driver.

---

## Quick Start

Prereqs: **Node.js 20+** ([nodejs.org](https://nodejs.org/))

```bash
git clone https://github.com/ucsandman/DashClaw.git
cd DashClaw
node scripts/setup.mjs
```

That's it. The setup script handles everything interactively:

1. **Database**: choose Docker (local), Neon (cloud), or paste any Postgres URL
2. **Deployment**: local only or cloud (Vercel/Railway/etc.)
3. **Secrets**: auto-generates API key, auth secrets, encryption key
4. **Dependencies**: runs `npm install`
5. **Migrations**: creates all database tables (with progress spinners)
6. **Build**: builds the Next.js app

When it finishes, it prints your agent connection snippet and (for cloud deployments) the exact Vercel env vars to copy-paste.

**Note:** You also need at least one OAuth provider (GitHub or Google) for dashboard login. See [OAuth Setup](#oauth-setup) below.

### Platform-specific installers

These just check for Node.js and call `setup.mjs`:

```bash
# Windows
./install-windows.bat

# Mac / Linux
bash ./install-mac.sh
```

### Or: `npm run setup`

If you already have dependencies installed:

```bash
npm run setup
```

---

## OAuth Setup

The dashboard requires GitHub and/or Google OAuth for login.

### GitHub OAuth

1. Go to [github.com/settings/developers](https://github.com/settings/developers) → **New OAuth App**
2. Set the callback URL:
   - Local: `http://localhost:3000/api/auth/callback/github`
   - Cloud: `https://your-app.vercel.app/api/auth/callback/github`
3. Add `GITHUB_ID` and `GITHUB_SECRET` to your `.env.local` (local) or Vercel env vars (cloud)

### Google OAuth (optional)

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Set the callback URL:
   - Local: `http://localhost:3000/api/auth/callback/google`
   - Cloud: `https://your-app.vercel.app/api/auth/callback/google`
3. Add `GOOGLE_ID` and `GOOGLE_SECRET`

### OIDC Provider (Authentik, Keycloak, etc.)

1.  Set the callback URL in your provider to: `https://your-app.vercel.app/api/auth/callback/oidc`
2.  Add `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` to your environment variables.
3.  (Optional) Add `OIDC_DISPLAY_NAME` to customize the login button text.

See [OIDC Setup Guide](docs/OIDC_SETUP.md) for detailed instructions.

If you see "redirect_uri is not associated with this application", your OAuth app is missing the callback URL.

---

## Deploy to Cloud (Vercel + Neon): Recommended

The fastest path: Vercel free tier + Neon free tier. Accessible from any device, auto-HTTPS.

1. Create a free database at [neon.tech](https://neon.tech) and copy the connection string
2. Fork this repo to your GitHub account
3. Go to [vercel.com/new](https://vercel.com/new) and import your fork
4. Generate your secrets (run once in any terminal, copy the output):
   ```bash
   node -e "const c=require('crypto');console.log('NEXTAUTH_SECRET='+c.randomBytes(32).toString('base64url'));console.log('DASHCLAW_API_KEY=oc_live_'+c.randomBytes(24).toString('hex'));console.log('ENCRYPTION_KEY='+c.randomBytes(32).toString('base64url').slice(0,32));console.log('CRON_SECRET='+c.randomBytes(32).toString('hex'))"
   ```
5. Add environment variables in Vercel:
   - `DATABASE_URL`: your Neon connection string
   - `NEXTAUTH_URL`: `https://your-app.vercel.app`
   - `NEXTAUTH_SECRET`: from step 4 (encrypts login sessions)
   - `DASHCLAW_API_KEY`: from step 4 (authenticates your agents; `oc_live_` prefix is required). This is the initial bootstrap admin key — you can manage additional keys from the dashboard at `/api-keys` after you sign in
   - `ENCRYPTION_KEY`: from step 4 (encrypts sensitive settings in DB)
   - `CRON_SECRET`: from step 4 (authenticates scheduled jobs)
   - `REALTIME_BACKEND`: `redis` (for live updates on Vercel)
   - `REDIS_URL`: your Upstash Redis connection string
   - `REALTIME_ENFORCE_REDIS`: `true`
   - `GITHUB_ID` + `GITHUB_SECRET`: from GitHub OAuth setup (see above)
6. Deploy. Tables are created automatically on first request
7. Visit `your-app.vercel.app` → click **Dashboard** → sign in with GitHub

**Do not** set `DASHCLAW_MODE=demo` on your deployment. That is only for dashclaw.io. The default (`self_host`) is what you want.

Other cloud hosts (Railway, Fly.io, Render, your own VPS) also work. DashClaw is a standard Next.js app.

---

## Bootstrap An Existing Agent

Import an agent's entire workspace (goals, memory, decisions, skills, tools, relationships) into the dashboard:

```bash
# Preview what will be imported (no writes)
node scripts/bootstrap-agent.mjs --dir "/path/to/agent" --agent-id "my-agent" --dry-run

# Push to local dashboard
node scripts/bootstrap-agent.mjs --dir "/path/to/agent" --agent-id "my-agent" --local

# Push to cloud dashboard
node scripts/bootstrap-agent.mjs --dir "/path/to/agent" --agent-id "my-agent" --base-url "https://your-app.vercel.app" --api-key "oc_live_..."
```

The adaptive scanner auto-discovers and classifies files: identity, skills, tools, relationships, config, creative works, and more. No hardcoded paths needed.

More details: `docs/agent-bootstrap.md`.

---

## CI/Quality Gates

```bash
npm run lint
npm run docs:check
npm run openapi:check
npm run api:inventory:check
npm run route-sql:check
npm run test -- --run
npm run sdk:integration
npm run sdk:integration:python
```

## Security Notes (Self-Host)

- In production, if `DASHCLAW_API_KEY` is not set, the `/api/*` surface fails closed with `503` in `middleware.js`.
- Rate limiting is enforced in middleware for `/api/*` (including unauthenticated public API routes).
  - Tuning: `DASHCLAW_RATE_LIMIT_WINDOW_MS`, `DASHCLAW_RATE_LIMIT_MAX`
  - Dev only: `DASHCLAW_DISABLE_RATE_LIMIT=true`

More: `docs/SECURITY.md`.

## Scheduled Jobs (Optional)

DashClaw exposes cron endpoints under `/api/cron/*` for maintenance and automation, but the OSS repo does not ship Vercel cron schedules (paid feature). You can still run scheduled behavior by using any scheduler (GitHub Actions, system cron, Cloudflare, etc.) to call these endpoints with:

- Header: `Authorization: Bearer $CRON_SECRET`

Endpoints:

- `GET /api/cron/signals` (compute new signals, fire webhooks, send alert emails)
- `GET /api/cron/memory-maintenance` (memory health maintenance)
- `GET /api/cron/learning-recommendations` (rebuild learning recommendations)
- `GET /api/cron/learning-episodes-backfill` (backfill learning episodes)
- `POST /api/drift/alerts` (with `{"action": "detect"}` to run periodic drift analysis)

Example (bash):

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" "https://YOUR_HOST/api/cron/signals"
```

Example (PowerShell):

```powershell
Invoke-RestMethod -Headers @{ Authorization = "Bearer $env:CRON_SECRET" } -Method GET "http://localhost:3000/api/cron/signals"
```

## Analytics (Optional)

DashClaw includes Vercel Web Analytics (`@vercel/analytics`):

- Enabled automatically on Vercel deployments (`VERCEL=1`)
- Opt-in on non-Vercel hosts: `NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS=true`

## Documentation Map

- Canonical architecture and behavior: `PROJECT_DETAILS.md`
- Non-coding setup: `QUICK-START.md`
- SDK/operator reference: `docs/client-setup-guide.md`
- Agent import/bootstrap: `docs/agent-bootstrap.md`
- Documentation governance: `docs/documentation-governance.md`

## Contributing

See `CONTRIBUTING.md`.

## License

MIT (`LICENSE`).
