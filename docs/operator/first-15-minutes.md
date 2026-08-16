# DashClaw: First 15 Minutes (Operator Quickstart)

Goal: from zero to seeing a live event in the dashboard.

## 1) What you are starting

DashClaw is an AI agent decision infrastructure platform. It provides a website, an operator dashboard, an API control plane, realtime streaming with replay, SDKs (Node and Python), and local agent tooling.

## 2) Key surfaces

- Site: `/`
- Dashboard: `/dashboard`
- Docs: `/docs`
- Toolkit overview: `/toolkit`

## 3) Run locally

### Prereqs

- Node.js 20+
- npm 10+
- Postgres database (local Docker or hosted Neon)

### Install

```bash
git clone https://github.com/ucsandman/DashClaw.git
cd DashClaw
npm install
```

### Configure

```bash
cp .env.example .env.local
```

Minimum variables:

- `DATABASE_URL`
- `NEXTAUTH_URL=http://localhost:3000`
- `NEXTAUTH_SECRET`
- `DASHCLAW_API_KEY` (recommended locally; required in production or `/api/*` will fail-closed with `503`)
- `ENCRYPTION_KEY` (32 characters; required to securely store integration credentials at rest)

### Database

Start a local Postgres (if not using a hosted provider):

```bash
docker compose up -d db
```

### Migrate

```bash
node scripts/_run-with-env.mjs scripts/migrate-multi-tenant.mjs
node scripts/_run-with-env.mjs scripts/migrate-cost-analytics.mjs
node scripts/_run-with-env.mjs scripts/migrate-identity-binding.mjs
```

### Start

```bash
npm run dev
```

## 4) Understand access quickly

DashClaw supports two primary access patterns:

- Browser operator flow via auth cookie (dashboard)
- External and SDK calls via `x-api-key`

In production you will usually use API keys for agent instrumentation.

## 5) Confirm it works (see an event)

1. Open `http://localhost:3000/dashboard`
2. Open the realtime stream UI (if you do not know where yet, search docs for "stream" or visit `/api/stream` docs)
3. Trigger a sample event with an SDK or a local tool.

If you do not have a sample event script yet, your fastest path is to add one minimal call in Node or Python that posts an event to the actions/events endpoint, then watch it appear in the stream.

## 6) Common issues

- Env file not loaded (confirm `.env.local` is present and used)
- DB connection fails (bad `DATABASE_URL`)
- No events showing (check API key, org scoping, and stream route)

## Next step

After you have one event flowing, switch to:

- `/docs` to understand the event model
- `sdk/` or `sdk-python/` to instrument a real agent
- `mcp-server/` for the governance MCP tools surface (handoffs, secret rotation, skill safety, open loops, learning, audit retrospection)

