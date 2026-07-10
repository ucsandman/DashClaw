# Deploy DashClaw in Under 10 Minutes — No OAuth Required

This is the full path from zero to a live governance dashboard with a real agent
reporting decisions. No GitHub OAuth app. No Google Cloud Console. Just a password
and a deploy button.

---

## What You Need

- A free [Neon](https://neon.tech) account (Postgres database)
- A free [Vercel](https://vercel.com) account
- A GitHub account (to fork the repo — you will not use it for OAuth)
- 10 minutes

---

## Step 1 — Fork the Repo

Go to [github.com/ucsandman/DashClaw](https://github.com/ucsandman/DashClaw) and
click **Fork**. Accept all defaults. This gives you your own copy to deploy from.

---

## Step 2 — Create a Free Database

1. Sign up at [neon.tech](https://neon.tech)
2. Create a new project — name it anything, e.g. `dashclaw`
3. Copy the connection string. It looks like:
   ```
   postgresql://user:pass@ep-xyz.neon.tech/neondb
   ```
   You will paste this in the next step.

---

## Step 3 — Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your forked DashClaw repository
3. Before clicking Deploy, open the **Environment Variables** panel and add these:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Your Neon connection string from Step 2 |
   | `NEXTAUTH_URL` | `https://your-app.vercel.app` (use your actual Vercel URL) |
   | `NEXTAUTH_SECRET` | Run the command below and paste the output |
   | `DASHCLAW_API_KEY` | Run the command below and paste the output |
   | `ENCRYPTION_KEY` | Run the command below and paste the output |
   | `CRON_SECRET` | Run the command below and paste the output |
   | `DASHCLAW_LOCAL_ADMIN_PASSWORD` | A strong password of your choice |

   Optional: `DASHCLAW_MODE` and `NEXT_PUBLIC_DASHCLAW_MODE` both default to `self_host` — set them only if you need a different mode.

   Generate the four secrets in one command:
   ```bash
   node -e "const c=require('crypto');console.log('NEXTAUTH_SECRET='+c.randomBytes(32).toString('base64url'));console.log('DASHCLAW_API_KEY=oc_live_'+c.randomBytes(24).toString('hex'));console.log('ENCRYPTION_KEY='+c.randomBytes(32).toString('base64url').slice(0,32));console.log('CRON_SECRET='+c.randomBytes(32).toString('hex'))"
   ```

4. Click **Deploy**

Vercel will build and deploy. Tables are created automatically on the first request.
No migrations to run manually.

Before signing in, open `https://your-app.vercel.app/setup`. That page verifies:
- the app is up
- the database is reachable and all required tables exist
- required vs advisory environment variables
- local password / OAuth auth readiness
- copy-ready SDK validation commands

`/setup` is intentionally safe to open before login. It shows verification state, recovery guidance, and a sanitized JSON proof download without exposing secret values.

After the instance looks healthy, open `/connect` for the canonical first-agent path. That page keeps the activation flow short: choose Node or Python, copy the env vars, run the minimal starter snippet, optionally enable verified pairing, then run the validator.

After core checks pass, you can strengthen that view with live SDK proof:
- Node: use the `/setup` "Run test" button to capture live proof
- Python: after a successful ping, run the helper snippet shown on `/setup` or in `docs/client-setup-guide.md` to POST the sanitized success payload to `/api/setup/live-proof`

### Operational checks for self-host

Before calling a Vercel or Docker self-host ready, verify these paths:

- Migrations: the build runs `node scripts/auto-migrate.mjs && next build`; `/setup` reports missing tables and the migration action when a schema check fails.
- Env requirements: keep the variables in Step 3 in the deployment environment and keep secret values out of logs; `npm run doctor` reports missing required settings with `NEXT:` guidance.
- Health checks: poll `/api/health` for machine-readable runtime state and use `/api/doctor` or `npm run doctor` for diagnosis when health is degraded.
- Logs: start with Vercel deployment/function logs, or Docker/stdout logs for self-host, then correlate the failing route with `/setup`, `/api/health`, and `/api/doctor`.
- Rate limits: middleware applies API rate limiting; for high-traffic or multi-instance self-hosts, configure a shared store when the doctor reports that in-memory limits are not enough.
- Rollback/recovery: on Vercel, promote the last known-good deployment; on Docker, restart the previous image. If only env changed, revert the env var and redeploy/restart. If a migration broke data, restore the database from the latest backup or Neon branch before retrying.

| Symptom | Inspect first | Correlate with | Next action |
|---|---|---|---|
| `/dashboard` redirects or login fails | Auth env vars and Vercel/Docker logs | `/api/doctor` Auth and Deployment sections | Confirm `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, and `DASHCLAW_LOCAL_ADMIN_PASSWORD`, then redeploy or restart. |
| `/setup` reports missing tables | `/setup` Database section | `/api/health`, `/api/doctor` Database section | Run the setup migration action or rebuild with the same `DATABASE_URL`. |
| Agent API calls return 401/403 | Route/function logs for the called API | `/connect` validator output and `/api/health` with the API key | Regenerate or copy the workspace API key, then rerun the validator. |
| Health is degraded after deploy | `/api/health` response | `/api/doctor` and deployment logs for the same timestamp | Follow the doctor `NEXT:` line before changing code; most failures are env or DB reachability. |

---

## Step 4 — Sign In With Your Password

1. Visit `https://your-app.vercel.app/dashboard`
2. You will be redirected to the login page
3. You will see a password field below any OAuth buttons — enter the password you
   set as `DASHCLAW_LOCAL_ADMIN_PASSWORD`
4. You are in

No GitHub OAuth app. No redirect URIs. No client secrets. Just your password.

---

## Step 5 — Complete Onboarding

The dashboard walks you through four steps automatically:

1. **Create a workspace** — give your org a name, e.g. "My Agent Fleet"
2. **Generate an API key** — this is what your agents use to authenticate
3. **Install the SDK** — one npm or pip install
4. **Record your first action** — open `/connect`, paste the starter snippet into your agent, and run it

The onboarding checklist tracks your progress and shows you exactly what to do next.

---

## Step 6 — Connect Your First Agent

Install the SDK on any machine where your agent runs:

```bash
npm install dashclaw
```

Create a file called `agent.js`:

```javascript
import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: 'https://your-app.vercel.app',
  apiKey: 'oc_live_...', // the key from Step 5
  agentId: 'my-first-agent'
});

const action = await claw.createAction({
  action_type: 'api_call',
  declared_goal: 'Fetch user data from CRM',
  risk_score: 20,
});

await claw.updateOutcome(action.action_id, { status: 'completed' });

console.log('Action recorded. Check your dashboard.');
```

Run it:

```bash
node agent.js
```

Go back to your dashboard. The action appears in real time.

---

## Step 7 — Verify Sign-Out Works

Click your avatar or the sign-out button in the dashboard header. You should be
redirected to the login page. Visiting `/dashboard` again should require your
password. If it does, the session is clearing correctly.

---

## What You Just Proved

- DashClaw deploys to Vercel on the free tier with no OAuth setup
- A password is sufficient to protect a self-hosted instance
- An agent can report decisions to your dashboard in under a minute
- The entire thing — database, hosting, auth, and first agent — costs $0

---

## When to Add OAuth

Add GitHub or Google OAuth when you want to invite teammates. Go to
**Settings** in your dashboard, add your OAuth credentials, and both login methods
will be available on the login page. Your password login continues to work alongside
OAuth — you do not have to remove it.

---

## Troubleshooting

**Password field does not appear on login page**
`DASHCLAW_LOCAL_ADMIN_PASSWORD` is not set, or the deployment did not pick up the
new env var. Go to Vercel → your project → Settings → Environment Variables, confirm
the variable is there, then trigger a redeploy.

**"Incorrect password" error**
Double-check for leading or trailing spaces in the env var. Vercel sometimes adds
whitespace if you paste with line breaks. Copy the value, paste it into a text editor,
confirm it looks right, then save it again in Vercel and redeploy.

**Dashboard loads but shows no data**
This is normal on a fresh instance. Complete the onboarding checklist and connect
an agent. Data appears as soon as an agent sends its first action.

**Tables were not created automatically**
Visit `/setup` first. If the Database section shows missing core tables, the page will
tell you exactly which tables are absent and which migration commands to run. Use the
proof download on that page if you need a shareable verification snapshot, or check
`/api/health` for a machine-readable status response.
