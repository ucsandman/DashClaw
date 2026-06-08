# Onboarding Friction Audit — "Connect Your First Agent"

**Date:** 2026-04-10
**Scope:** Brand-new user, zero to first governed action visible in Mission Control
**Method:** Walkthrough of `app/connect/page.js`, `ConnectGuideClient.js`, `connectGuide.js`,
`QUICK-START.md`, `README.md`, `app/setup/page.js`, `app/settings/page.js`,
`app/mission-control/page.js`, `app/components/QuickStart.js`,
`scripts/setup.mjs`, `.env.example`, and the SDK validator path
(`public/downloads/dashclaw-platform-intelligence/scripts/validate-integration.mjs`).

---

## Upfront Findings (Broken References)

Three hard failures a new user will hit before they reach any step-by-step guidance:

| # | Finding | Location | Severity |
|---|---|---|---|
| F1 | `docs/client-setup-guide.md` does **not exist** anywhere in the repo. | (missing file) | HIGH — referenced internally as a known touchpoint but nothing on disk. |
| F2 | `examples/dashclaw-example-openai-agent/` does **not exist**. `QUICK-START.md` Step 3 tells the user to `cd` into it. Closest match is `examples/openai-governed-agent/`. | `QUICK-START.md:57-58`, `CHANGELOG.md` | HIGH — the "Aha! Moment" step in the quickstart dead-ends. |
| F3 | `/setup` is a pure redirect to `/settings` (`app/setup/page.js:7-14`). `QUICK-START.md` Step 2 and the Connect page's Step 5 tell users to "open `/setup`" and "feed proof back into /setup". The redirect works but the mental model is wrong and every doc is lying by omission. | `app/setup/page.js`, `QUICK-START.md:45`, `ConnectGuideClient.js:175-179` | MEDIUM — functional, but contradicts the stated architecture in `CLAUDE.md` ("Essential Surfaces: /setup"). |

---

## The Three Journeys

The product actually offers three distinct zero-to-first-action paths. A new user has to
pick one without being told they are mutually exclusive. The README, QUICK-START.md, and
/connect page each lead with a different one.

| Journey | Entry point | Time promised | Realistic time |
|---|---|---|---|
| **A — `npx dashclaw-demo`** | README hero | "10 seconds" | ~30s (works; no user agent, no user deploy) |
| **B — Vercel deploy button** | README "Deploy" section | implied "click and go" | 10–20 min (requires 7 env vars, manual secret generation) |
| **C — Local clone + setup.mjs** | `QUICK-START.md` Step 1 | "under 8 minutes" | 15–30 min (Postgres choice, 20+ migrations, full `npm run build`) |

Everything below walks Journey B (Vercel, cloud) and Journey C (local) in detail, since
Journey A does not actually reach Mission Control with the user's own agent.

---

## Journey B — Vercel + Neon deploy button

### Step B1 — Click "Deploy with Vercel" in README

1. **What the user does:** Clicks the Vercel button.
2. **External dependency:** Vercel account, GitHub account (to fork), Neon account
   (signed up inline through the Vercel integration picker).
3. **Where it lives:** `README.md:36`.
4. **Friction:** LOW.

### Step B2 — Fill in seven environment variables

1. **What the user does:** Vercel prompts for `DATABASE_URL`, `DASHCLAW_API_KEY`,
   `ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `CRON_SECRET`, and
   `DASHCLAW_LOCAL_ADMIN_PASSWORD`.
2. **External dependency:** The Neon integration auto-fills `DATABASE_URL`. Everything
   else the user generates themselves.
3. **Where the instructions live:** `.env.example` comments (linked from the button via
   `envLink`). No inline guidance inside the Vercel form.
4. **Friction:** **HIGH.**
   - `DASHCLAW_API_KEY` is where users get confused. The `.env.example` calls it "API key
     that protects /api/* endpoints" and the format is `oc_live_<48 hex chars>`. A new
     user has no way to know the expected shape without reading `scripts/setup.mjs:362`.
   - `ENCRYPTION_KEY` must be exactly 32 characters. Users who paste an SSH key or UUID
     will break encrypted settings at runtime with no obvious error.
   - `NEXTAUTH_URL` is the URL you do not yet know (deploy is chicken-and-egg). Vercel
     users typically set it after the first deploy, but nothing tells them that.
   - `CRON_SECRET` is listed as required but the "Vercel free tier only" rule in memory
     means cron will never run; still required for build.
5. **Suggested fix:**
   - Add a one-line hint for each env var directly in the Vercel deploy URL using
     `envDescription` + per-var descriptions (Vercel supports `env[VAR]=description`).
   - Ship a `/api/setup/bootstrap-env` script or a "Generate secrets for me" page that
     outputs copy-paste-ready values for `DASHCLAW_API_KEY`, `ENCRYPTION_KEY`,
     `NEXTAUTH_SECRET`, and `CRON_SECRET` so the user never has to run `openssl rand`.
   - Mark `NEXTAUTH_URL` as "set after first deploy" in the envDescription and provide
     a one-click "set NEXTAUTH_URL to this domain" button on the deployed `/settings`
     page the first time the app loads.

### Step B3 — Sign in

1. **What the user does:** Opens `https://your-app.vercel.app`, clicks sign in, types
   the local admin password they set in Step B2.
2. **External dependency:** `DASHCLAW_LOCAL_ADMIN_PASSWORD` env var
   (`app/login/page.js:4`).
3. **Where the instructions live:** README "After deploy" section, Step 1.
4. **Friction:** LOW — if the user remembered what they typed. If they skipped
   `DASHCLAW_LOCAL_ADMIN_PASSWORD` and did not configure GitHub/Google OAuth, the login
   page shows no sign-in method at all.
5. **Suggested fix (for the skip case):** When `localAuthEnabled === false` and no OAuth
   providers are configured, render an explicit "No sign-in method configured" state on
   `/login` with the exact env var to set.

### Step B4 — Land on Mission Control, see the Quick Start card

1. **What the user does:** Opens `/mission-control`. If `agents.length === 0`, a
   `QuickStart` component appears (`app/mission-control/page.js:296-299`).
2. **External dependency:** None — all rendered client-side.
3. **Where the instructions live:** `app/components/QuickStart.js`.
4. **Friction:** **HIGH.**
   - **Broken claim:** `README.md:43` says "Mission Control shows a ready-to-run code
     example with **your API key and base URL pre-filled**." That is not true.
     `QuickStart.js:23-37` hardcodes `<your-api-key>` as the literal string in the .env
     block. Only `baseUrl` is pre-filled (from `window.location.origin`). The user still
     has to find their key somewhere else and paste it in.
   - **Circular hint:** The helper text at `QuickStart.js:198-200` says "find it in
     Settings or the Vercel deploy output". On Settings (`app/settings/page.js:27-31`)
     the key is **masked** (`oc_live_` + 8 bullets), so it is not recoverable from the
     UI at all. "Vercel deploy output" means scrolling back through the original deploy
     form the user already closed.
5. **Suggested fix:**
   - Either make the README claim true — inject the actual
     `process.env.DASHCLAW_API_KEY` into the QuickStart snippet server-side (it is
     already a server secret, and a signed-in admin viewing Mission Control should see
     it once) — or change the README.
   - If security concerns block inline display, add a "Copy my API key" button that
     hits an authenticated endpoint, returns the full key, and copies to clipboard in
     one click.
   - On `/settings`, replace the masked key with a "Reveal" / "Copy" toggle for
     authenticated admins (the masking is security theater — the key is already sitting
     in `process.env` on the same machine rendering the page).
   - Update the QuickStart helper text to link directly to `/api-keys` (where the user
     can actually generate and view a new key once), not the vague "Settings".

### Step B5 — Copy the snippet, create `.env` and `demo.js`, install the SDK

1. **What the user does:** Leaves the browser, opens a terminal, creates two files,
   runs `npm install dashclaw`, runs `node --env-file=.env demo.js`.
2. **External dependency:** Node 20+, the `dashclaw` npm package.
3. **Where the instructions live:** `QuickStart.js` right column + `/connect` Step 3.
4. **Friction:** MEDIUM.
   - `--env-file=.env` requires Node 20+. This is noted at `QuickStart.js:236` but
     easy to miss.
   - No scaffold command. The user has to manually create `.env` and `demo.js`. A
     single `npx create-dashclaw-agent` scaffolder would cut this to one command.
5. **Suggested fix:**
   - Publish `create-dashclaw-agent` (or add it to the existing `packages/dashclaw-demo`)
     so the Mission Control snippet can be replaced with
     `npx create-dashclaw-agent --base-url … --api-key …` and the user gets a working
     project in one command.
   - If that is too heavy, at minimum make the code block in QuickStart copyable as a
     **single** snippet that includes `mkdir`, `echo >> .env`, and `cat > demo.js`
     heredoc — one paste, one run.

### Step B6 — First governed action appears in Mission Control

1. **What the user does:** Sits on Mission Control and watches the agent card advance
   from Step 2 to Step 3 via the realtime `useRealtime` subscription.
2. **External dependency:** For reliable realtime across serverless invocations:
   Upstash Redis (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`).
3. **Where the instructions live:** `README.md:48` ("Optional: Live decision stream").
4. **Friction:** MEDIUM.
   - On Vercel free tier without Upstash, `REALTIME_BACKEND` defaults to `memory`
     (`.env.example:68`), which does not cross serverless invocations. The user's first
     action *might* not light up the card at all, depending on which lambda handles the
     POST vs the SSE stream. They then assume it's broken.
5. **Suggested fix:**
   - On Mission Control, when `REALTIME_BACKEND === 'memory'` and `process.env.VERCEL`
     is set, show a one-line amber warning: "Realtime uses in-memory events on this
     instance. Add Upstash Redis for reliable live updates." Link the warning directly
     to the Upstash integration URL.
   - Alternatively, switch the default to poll-every-2s when Upstash is missing instead
     of relying on SSE that won't work.

---

## Journey C — Local clone + setup.mjs

### Step C1 — `git clone` and `cd`

1. **What the user does:** `git clone https://github.com/ucsandman/DashClaw.git && cd DashClaw`.
2. **External dependency:** Git, GitHub access.
3. **Where the instructions live:** `QUICK-START.md:22-26`.
4. **Friction:** LOW.

### Step C2 — `npm install && node scripts/setup.mjs`

1. **What the user does:** Runs two commands. `setup.mjs` is interactive.
2. **External dependency:** One of { Docker Desktop, Neon account, any Postgres URL }.
3. **Where the instructions live:** `QUICK-START.md:28-32`, `scripts/setup.mjs:303-554`.
4. **Friction:** **MEDIUM.**
   - The setup script is solid — it asks the right questions, generates secrets,
     writes `.env.local`, runs 20+ migrations, and prints a post-install summary.
   - BUT the last step is `npm run build`, which is slow and unnecessary for
     `npm run dev`. First-time users wait 60–120 seconds for a build they don't need.
   - The migration list (`scripts/setup.mjs:383-412`) has a long commented block that
     suggests earlier iterations. If any single migration fails, the script continues
     and reports it at the end, but the user has no clear "run only the failed ones"
     command — they have to re-run the whole thing.
5. **Suggested fix:**
   - Make the final build step opt-in: `node scripts/setup.mjs --build` or
     `--mode=local-dev` skips it, `--mode=cloud-deploy` keeps it.
   - On migration failure, emit a copy-paste command to retry just the failed
     scripts (the `buildSetupMigrationCommands()` helper already exists — use it with
     a filter).

### Step C3 — `npm run dev`

1. **What the user does:** Starts the dev server on port 3000.
2. **External dependency:** Local Postgres reachable at the URL from C2.
3. **Where the instructions live:** `QUICK-START.md:33-35`.
4. **Friction:** LOW.

### Step C4 — Open `http://localhost:3000/setup`

1. **What the user does:** Opens the URL in the browser.
2. **External dependency:** None.
3. **Where the instructions live:** `QUICK-START.md:44-45`.
4. **Friction:** MEDIUM — see finding F3. The page redirects to `/settings`; the user
   sees the Settings page title and tabs, not a "Setup verification" page. They
   reasonably assume they landed on the wrong page.
5. **Suggested fix:**
   - Either bring `/setup` back as a real page (the verification components still
     exist — `TopSummary`, `VerificationSection`, `WorkflowPanel`), or
   - Update `QUICK-START.md`, `ConnectGuideClient.js:175`, and `CLAUDE.md` Essential
     Surfaces to stop referring to `/setup` and point at `/settings?tab=setup` instead.
   - Whichever path is picked, the redirect should not silently swallow the URL —
     show a one-line banner: "Setup verification now lives in Settings."

### Step C5 — Sign in

1. **What the user does:** Clicks "Sign in", uses the local admin password they set
   during `setup.mjs` interactive prompts.
2. **External dependency:** `DASHCLAW_LOCAL_ADMIN_PASSWORD` in `.env.local`.
3. **Where the instructions live:** `setup.mjs:260-301` (interactive),
   `.env.example:23-25`.
4. **Friction:** LOW.

### Step C6 — Find the API key

1. **What the user does:** Needs `DASHCLAW_API_KEY` to put in the agent's `.env`.
2. **External dependency:** None — the key already exists in `.env.local`.
3. **Where the instructions live:** **Nowhere obvious.** Options that exist:
   - `.env.local` (filesystem — `setup.mjs` printed a redacted preview of it at the end
     but not the full key).
   - `/settings` shows a masked view: `oc_live_` + 8 bullets.
   - `/api-keys` lets the user create a **new** key and shows it once on creation.
   - `/connect` Step 2 renders `DASHCLAW_API_KEY=<your-workspace-api-key>` — placeholder.
4. **Friction:** **HIGH.**
   - The user logically assumes the key shown masked on `/settings` is the one they
     already have, but they cannot reveal it. They then go to `/api-keys`, create a
     second key, and end up with two keys — the env-var one and a workspace one —
     mapped to the same `org_default`. Confusion compounds.
   - `scripts/setup.mjs:370` prints `API key: ***********wxyz` — redacted even on the
     terminal that ran the setup. To see the full key the user must `cat .env.local`.
5. **Suggested fix:**
   - At the end of `setup.mjs`, print the **full** `DASHCLAW_API_KEY` once (it's a
     local terminal the user just typed a password into — hiding it from them is
     theater). Keep the redacted summary too, so re-runs stay safe.
   - On `/settings`, replace the masked API key with a "Reveal" button gated by a
     fresh re-auth prompt if anyone is nervous about shoulder-surfing.
   - On `/api-keys`, add a top banner: "The `DASHCLAW_API_KEY` from your `.env.local`
     is a valid key — you don't need to create a new one unless you want per-team
     scopes."

### Step C7 — Write `demo.js`, install `dashclaw`, run it

Same as Step B5. Same suggestions.

### Step C8 — First governed action appears

Same as Step B6, but in local dev `REALTIME_BACKEND=memory` works correctly (single
process), so the realtime card will advance reliably. Friction: LOW.

---

## Cross-Cutting Friction (applies to both journeys)

### X1 — The `/connect` page references a validator that requires a separate zip download

1. **What the user does:** Reaches `/connect` Step 5 ("Validate the connection") and
   sees a command like `node ./dashclaw-platform-intelligence/scripts/validate-integration.mjs …`.
2. **External dependency:** `dashclaw-platform-intelligence.zip` — exists at
   `public/downloads/dashclaw-platform-intelligence.zip` but **the page never tells the
   user to download it**. `connectGuide.js:44-45` has a `validatorNote` that *mentions*
   the zip in passing, but there is no download link or unzip instructions.
3. **Where the instructions live:** `app/lib/connectGuide.js:44-45`.
4. **Friction:** HIGH. The validator path is the only official way to generate
   `live-proof` that flips the Setup verification to "verified", and the user is asked
   to run a script from a file they don't have.
5. **Suggested fix:**
   - Add a first sub-step to Step 5: "Download the validator bundle" with a direct link
     to `/downloads/dashclaw-platform-intelligence.zip`, and a one-line unzip command.
   - Better: bundle `validate-integration.mjs` into the `dashclaw` npm package so the
     command becomes `npx dashclaw validate --base-url ... --api-key ...`. No zip
     required.

### X2 — `QUICK-START.md` Step 3 (`examples/dashclaw-example-openai-agent`) is a dead link

See finding F2. The user's "Aha! Moment" path crashes on `cd: no such file or directory`.

**Suggested fix:** Update `QUICK-START.md:57-58` to point at `examples/openai-governed-agent/`
or the canonical `examples/first-governed-action.js` (which does exist and is exactly
the demo the guide describes).

### X3 — Three different "first snippet" templates contradict each other

The user sees three slightly different starter snippets:

| Location | Method called | Uses `guard` or `createAction`? |
|---|---|---|
| `ConnectGuideClient.js` Step 3 (Node) via `connectGuide.js:64-76` | `claw.guard({ actionType: 'deploy', riskScore: 85 })` | `guard` only |
| `ConnectGuideClient.js` Step 3 (Python) via `connectGuide.js:94-108` | `claw.create_action(action_type='test', declared_goal=..., risk_score=10)` | `create_action` only |
| `QuickStart.js:23-35` (Mission Control) | `claw.guard({ actionType: 'deploy', riskScore: 85 })` | `guard` only |
| `README.md:287-314` Quickstart | Full 4-step loop: `guard` → `createAction` → `recordAssumption` → `updateOutcome` | full loop |
| `app/lib/readiness/sdkCheck.mjs:68-73` `getAgentStarterSnippets` | `claw.createAction(...)` | `createAction` only |

A user who reads two surfaces in a row sees contradictory advice about which method
creates a governed action. Worse, `claw.guard(...)` alone does **not** create an action
record — it just returns a policy decision. The `guard`-only snippets will log "your
first decision" but the user will then check Mission Control and see **no actions**,
because none were actually created. They will conclude the product is broken.

**Suggested fix:**
- Pick one canonical starter snippet. Make it the **full 4-step loop from `README.md`**
  because that is the only one that guarantees a row in `action_records` (which is
  what Mission Control actually queries — see `readiness.mjs:45-53`,
  `mission-control/page.js:144-164`).
- Replace the snippets in `connectGuide.js`, `QuickStart.js`, and
  `sdkCheck.mjs` with a shared constant imported from one file.

### X4 — The success criteria don't match what the user sees

`ConnectGuideClient.js:188` says "Your first action appears in the **dashboard and
recent activity**." But:
- There is no page called "dashboard" (`/dashboard` redirects or 404s depending on
  state — need to verify separately).
- "Recent activity" is `/activity` or the Live Governance Ledger on Mission Control,
  neither of which is named in any navigation the new user has seen yet.

**Suggested fix:** Replace "dashboard and recent activity" with "**Mission Control**
— the **Live Governance Ledger** (right column) will show your action within
a few seconds." Name the exact UI surface, not an abstract noun.

---

## Summary Scorecard

| Friction category | Count |
|---|---|
| Broken file/path references | 3 (HIGH: F1, F2; MEDIUM: F3) |
| HIGH-friction steps | 5 (B2 env vars, B4 Mission Control snippet lie, C6 API key discovery, X1 validator zip, X3 contradictory snippets) |
| MEDIUM-friction steps | 6 (B5 scaffold, B6 realtime, C2 build step, C4 /setup redirect, X4 wrong success copy, F3) |
| LOW-friction steps | 6 (B1, B3, C1, C3, C5, C8) |

**Top three things to fix first (ordered by leverage):**

1. **F2 + X2** — fix `QUICK-START.md` Step 3 to point at a directory that exists.
   One-line doc change; removes a guaranteed dead-end for the Journey C user.
2. **C6 + B4 — the API-key discovery problem.** Either print the full key at the end
   of `setup.mjs` and reveal it on `/settings`, or genuinely pre-fill the Mission
   Control snippet server-side. Until this is fixed, every new user has to grep
   `.env.local` by hand, which contradicts the "2 minutes to first governed action"
   promise on every page.
3. **X3 — snippet contradiction.** Consolidate to one shared starter snippet that
   actually creates an `action_record`, so the user sees their action in Mission
   Control the first time. `guard`-only snippets silently fail the core promise.

All three are doc/config fixes, not architectural work. They would convert the
onboarding from "clever but confusing" to "promise matches reality."
