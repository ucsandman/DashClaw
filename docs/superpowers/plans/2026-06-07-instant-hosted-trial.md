# Instant Hosted Trial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A non-technical user signs in with Google and gets an isolated, usage-capped governed workspace on our hosting in ~30s, then connects Claude with one paste-one-URL OAuth connector — at $0 with a hard cost circuit breaker.

**Architecture:** DashClaw is already multi-tenant (tested org isolation, hosted-trial fields, `enforceHostedTrial` caps, per-user org creation on Google sign-in). This is wiring + UI: stamp the auto-created sign-in org as a trial, add a global-cap circuit breaker, expose a public capacity check, and add a stripped "Add to Claude" screen + landing CTA. Cost is bounded by free tiers (which throttle, never bill) + a hard `HOSTED_MAX_ACTIVE_TRIALS` cap + auto-cleanup, all fail-closed.

**Tech Stack:** Next.js 16 (App Router), Postgres via the `postgres` tag (`getSql()`), NextAuth v4, Vitest, the repository pattern (no SQL in route files — `route-sql:check`).

**Spec:** `docs/superpowers/specs/2026-06-07-instant-hosted-trial-design.md`

## Refinements discovered during planning (vs spec)
- **No auto-key-mint in the sign-in path** (keys are hashed/shown-once; OAuth connector needs none; SDK users mint at `/api-keys`). Sign-in stamps trial fields only.
- **Added `GET /api/hosted/capacity` + landing pre-check** so "trials full" shows before sign-in; sign-in keeps a fail-closed backstop.
- **Fail-closed "full" representation:** an over-cap org is stamped `hosted_mode=TRUE, trial_action_cap=0, trial_ends_at=now` (inert) → `enforceHostedTrial` 403s every write → zero cost. Reactivation when capacity frees is out of v1 scope.

## File structure
- Modify `app/lib/hosted/flag.ts` — add `maxActiveTrials` to `hostedConfig()`.
- Modify `app/lib/repositories/hosted-workspace.repository.ts` — extract `mintOrgApiKey`; add `applyHostedTrial`, `markTrialFull`, `countActiveTrials`.
- Modify `app/lib/auth.ts` — stamp trial / inert in the `signIn` callback's new-personal-org branch.
- Modify `app/api/hosted/workspaces/route.ts` — global-cap check before provisioning (defense-in-depth).
- Create `app/api/hosted/capacity/route.ts` — public read of `{ full, active, max }`.
- Modify `app/connect/page.tsx` — `?hosted=` stripped "Add to Claude" variant.
- Modify `app/page.js` / `app/landingData.js` — "Govern your Claude — free" CTA + capacity pre-check.
- Modify `middleware.js` — authenticated session bypasses the demo short-circuit (demo stays cookie-driven for anonymous).
- Create `.github/workflows/hosted-cleanup.yml` — free cron hitting `/api/hosted/cleanup`.
- Tests under `__tests__/unit/` and `__tests__/integration/hosted/`.

---

## Phase 1 — Backend foundation (helpers + global cap)

### Task 1: Add `maxActiveTrials` to hosted config

**Files:** Modify `app/lib/hosted/flag.ts`; Test `__tests__/unit/hosted-flag.test.js`

- [ ] **Step 1: Write the failing test**
```js
import { describe, it, expect, afterEach } from 'vitest';
import { hostedConfig } from '../../app/lib/hosted/flag.js';
afterEach(() => { delete process.env.HOSTED_MAX_ACTIVE_TRIALS; });
describe('hostedConfig.maxActiveTrials', () => {
  it('defaults to 500', () => { expect(hostedConfig().maxActiveTrials).toBe(500); });
  it('reads HOSTED_MAX_ACTIVE_TRIALS', () => {
    process.env.HOSTED_MAX_ACTIVE_TRIALS = '25';
    expect(hostedConfig().maxActiveTrials).toBe(25);
  });
});
```
- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run __tests__/unit/hosted-flag.test.js` → fails (`maxActiveTrials` undefined).
- [ ] **Step 3: Implement** — in `hostedConfig()` return object add:
```js
    maxActiveTrials: parsePositiveInt(process.env.HOSTED_MAX_ACTIVE_TRIALS, 500),
```
and add `maxActiveTrials: number;` to the return type.
- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `git add app/lib/hosted/flag.ts __tests__/unit/hosted-flag.test.js && git commit -m "feat(hosted): add HOSTED_MAX_ACTIVE_TRIALS config"`

### Task 2: Repository helpers — `applyHostedTrial`, `markTrialFull`, `countActiveTrials`, extract `mintOrgApiKey`

**Files:** Modify `app/lib/repositories/hosted-workspace.repository.ts`; Test `__tests__/unit/hosted-workspace-repo.test.js`

- [ ] **Step 1: Write the failing test** (mock `sql` tag capturing calls)
```js
import { describe, it, expect } from 'vitest';
import { applyHostedTrial, markTrialFull, countActiveTrials } from '../../app/lib/repositories/hosted-workspace.repository.ts';
function fakeSql(returns = []) {
  const calls = [];
  const tag = (strings, ...vals) => { calls.push({ text: strings.join('?'), vals }); return Promise.resolve(returns); };
  tag.calls = calls; return tag;
}
describe('hosted-workspace repo helpers', () => {
  it('applyHostedTrial sets hosted_mode + trial fields and returns expiresAt', async () => {
    const sql = fakeSql();
    const { expiresAt } = await applyHostedTrial(sql, 'org_x', { trialDays: 30, trialActionCap: 10000 });
    expect(sql.calls[0].text).toMatch(/UPDATE organizations/);
    expect(sql.calls[0].text).toMatch(/hosted_mode = TRUE/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
  it('markTrialFull sets cap 0 + already-expired (inert)', async () => {
    const sql = fakeSql();
    await markTrialFull(sql, 'org_y');
    expect(sql.calls[0].text).toMatch(/trial_action_cap = 0/);
  });
  it('countActiveTrials returns the count int', async () => {
    const sql = fakeSql([{ count: 7 }]);
    expect(await countActiveTrials(sql, { now: new Date() })).toBe(7);
  });
});
```
- [ ] **Step 2: Run it, expect FAIL** (exports missing).
- [ ] **Step 3: Implement** in `hosted-workspace.repository.ts`:
```ts
export async function mintOrgApiKey(
  sql: SqlTag, orgId: string,
  { label = 'trial', role = 'admin', scope = 'trial' }: { label?: string; role?: string; scope?: string } = {},
): Promise<{ apiKey: string; keyPrefix: string }> {
  const keyId = generateId('key');
  const key = generateApiKey();
  await sql`
    INSERT INTO api_keys (id, org_id, key_hash, key_prefix, label, role, scope)
    VALUES (${keyId}, ${orgId}, ${key.keyHash}, ${key.keyPrefix}, ${label}, ${role}, ${scope})
  `;
  return { apiKey: key.plaintext, keyPrefix: key.keyPrefix };
}

export async function applyHostedTrial(
  sql: SqlTag, orgId: string,
  { trialDays, trialActionCap }: { trialDays: number; trialActionCap: number },
): Promise<{ expiresAt: string }> {
  const expiresAt = new Date(Date.now() + trialDays * 86_400_000).toISOString();
  await sql`
    UPDATE organizations
    SET hosted_mode = TRUE, trial_ends_at = ${expiresAt}, trial_action_cap = ${trialActionCap}, trial_actions_used = 0
    WHERE id = ${orgId}
  `;
  return { expiresAt };
}

export async function markTrialFull(sql: SqlTag, orgId: string): Promise<void> {
  const past = new Date().toISOString();
  await sql`
    UPDATE organizations
    SET hosted_mode = TRUE, trial_ends_at = ${past}, trial_action_cap = 0, trial_actions_used = 0
    WHERE id = ${orgId}
  `;
}

export async function countActiveTrials(
  sql: SqlTag, { now = new Date() }: { now?: Date } = {},
): Promise<number> {
  const cutoff = now.toISOString();
  const rows = await sql`
    SELECT COUNT(*)::int AS count FROM organizations
    WHERE hosted_mode = TRUE AND trial_action_cap > 0 AND trial_ends_at > ${cutoff}
  `;
  return Number(rows[0]?.count || 0);
}
```
Then refactor `provisionHostedWorkspace` to call `mintOrgApiKey(sql, orgId, { label })` for its key INSERT (keep its best-effort org-cleanup try/catch around the call).
- [ ] **Step 4: Run it + the existing hosted tests, expect PASS** — `npx vitest run __tests__/unit/hosted-workspace-repo.test.js __tests__/integration/hosted/`
- [ ] **Step 5: Commit** — `feat(hosted): trial-stamp + global-cap repo helpers; extract mintOrgApiKey`

### Task 3: Global-cap check on the anonymous provision route (defense-in-depth)

**Files:** Modify `app/api/hosted/workspaces/route.ts`; Test `__tests__/integration/hosted/end-to-end.test.js` (extend)

- [ ] **Step 1: Write the failing test** — provisioning when `countActiveTrials >= maxActiveTrials` returns 503 `trials full` and does not create an org. (Set `HOSTED_MAX_ACTIVE_TRIALS=0` for the case.)
- [ ] **Step 2: Run it, expect FAIL** (returns 200 today).
- [ ] **Step 3: Implement** — in `POST`, after the rate-limit slot and before `provisionHostedWorkspace`:
```js
import { provisionHostedWorkspace, countActiveTrials } from '../../../lib/repositories/hosted-workspace.repository.js';
// ...
const active = await countActiveTrials(getSql());
if (active >= cfg.maxActiveTrials) {
  return NextResponse.json({ error: 'Trials are full', full: true }, { status: 503 });
}
```
- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `feat(hosted): fail-closed global trial cap on provision route`

### Phase 1 verification (read the output)
`npm run lint` · `npm run typecheck` · `npx vitest run` (full) · `npm run route-sql:check` — all green.

---

## Phase 2 — Sign-in auto-provisions the trial

### Task 4: Stamp trial (or inert at cap) on new personal-org sign-in

**Files:** Modify `app/lib/auth.ts`; Test `__tests__/unit/auth-hosted-signin.test.js`

- [ ] **Step 1: Write the failing test** — with a mock `getSql` and `isHostedMode()=true`: a brand-new (non-first) Google user → `applyHostedTrial` called for the new org when under cap; → `markTrialFull` when `countActiveTrials >= maxActiveTrials`; a returning user (existing row) → neither called (idempotent); `isHostedMode()=false` → neither called.
- [ ] **Step 2: Run it, expect FAIL.**
- [ ] **Step 3: Implement** — in `auth.ts`, import:
```js
import { isHostedMode, hostedConfig } from './hosted/flag';
import { applyHostedTrial, markTrialFull, countActiveTrials } from './repositories/hosted-workspace.repository';
```
Inside the `!isFirstUser` branch, immediately after `targetOrgId = personalOrgId;` (auth.ts:143):
```js
            if (isHostedMode()) {
              const cfg = hostedConfig();
              const active = await countActiveTrials(sql, { now: new Date() });
              if (active < cfg.maxActiveTrials) {
                await applyHostedTrial(sql, personalOrgId, { trialDays: cfg.trialDays, trialActionCap: cfg.trialActionCap });
              } else {
                // Fail-closed: capacity full → inert org (cap 0, expired) so enforceHostedTrial 403s
                // every write. Zero cost. The landing pre-check normally prevents reaching here.
                await markTrialFull(sql, personalOrgId);
              }
            }
```
(Founder/`org_default` path is untouched — the operator's own instance is never a trial.)
- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `feat(hosted): auto-provision trial workspace on Google sign-in`

### Phase 2 verification
`npm run lint` · `npm run typecheck` · `npx vitest run` (full — confirms no auth regressions) · `npm run route-sql:check`.

---

## Phase 3 — Public capacity endpoint + landing CTA

### Task 5: `GET /api/hosted/capacity`

**Files:** Create `app/api/hosted/capacity/route.ts`; Test `__tests__/integration/hosted/capacity.route.test.js`

- [ ] **Step 1: Write the failing test** — hosted mode off → 404; hosted on, under cap → `{ full:false, active, max }`; at cap → `{ full:true }`.
- [ ] **Step 2: Run it, expect FAIL.**
- [ ] **Step 3: Implement**
```ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { NextResponse } from 'next/server';
import { isHostedMode, hostedConfig } from '../../../lib/hosted/flag.js';
import { countActiveTrials } from '../../../lib/repositories/hosted-workspace.repository.js';
import { getSql } from '../../../lib/db.js';
export async function GET() {
  if (!isHostedMode()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const max = hostedConfig().maxActiveTrials;
  const active = await countActiveTrials(getSql());
  return NextResponse.json({ full: active >= max, active, max });
}
```
- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `feat(hosted): public capacity endpoint`

### Task 6: Landing CTA "Govern your Claude — free"

**Files:** Modify `app/page.js` and/or `app/landingData.js`; Test `__tests__/unit/landing-hosted-cta.test.jsx` (render assertion)

> **Design:** READ `.impeccable.md` first. Direct declarative voice; lucide-react icons; CSS tokens (no hex); calm, developer-reader-first; orange as signal only; never crypto/web3 framing.

- [ ] **Step 1: Write the failing test** — landing renders a primary CTA with text matching `/Govern your Claude/i` linking to the Google sign-in entry (`/api/auth/signin/google` or the `/login` page); when a `full` capacity state is passed/mocked, the CTA renders the "Trials are full" copy instead.
- [ ] **Step 2: Run it, expect FAIL.**
- [ ] **Step 3: Implement** — add the hero CTA. It fetches `GET /api/hosted/capacity` (client-side, best-effort) on mount; `full:false` → button "Govern your Claude — free" → sign-in; `full:true` → disabled "Trials are full — check back soon" + a waitlist link. Keep it a small focused component; follow existing landing component patterns in `app/landingData.js`.
- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `feat(hosted): landing CTA with capacity pre-check`

### Phase 3 verification
`npm run lint` · `npx vitest run` · `npm run build` (webpack — landing + new route are under app/**) · `npm run api:inventory:check` (regenerate via `npm run api:inventory:generate` if the new capacity route shifts counts) · `npm run route-sql:check`.

---

## Phase 4 — Hosted "Add to Claude" connect screen

### Task 7: `?hosted=` stripped variant of `/connect`

**Files:** Modify `app/connect/page.tsx`; Test `__tests__/unit/connect-hosted.test.jsx`

> **Design:** READ `.impeccable.md` first. The hero is the OAuth connector (paste `https://<instance>/api/mcp` → Authorize, NO key). The full 5-surface content collapses under an "Advanced (SDK / CLI)" disclosure; the SDK/CLI path links to `/api-keys` to mint a key (keys are shown once at creation — never rendered here).

- [ ] **Step 1: Write the failing test** — when rendered with `?hosted=org_x`: the OAuth-connector card is the hero and appears before the SDK/MCP cards; no `oc_live_` placeholder is shown in the hero; an "Advanced" disclosure exists; a link to `/mission-control` is present. Without `?hosted=`, the page renders unchanged (existing tests still pass).
- [ ] **Step 2: Run it, expect FAIL.**
- [ ] **Step 3: Implement** — read `searchParams.hosted`; when present, render the stripped layout (reuse the existing OAuth-connector content as the hero, wrap the rest in the Advanced disclosure). Do not delete the existing full content — gate it behind the disclosure in hosted mode. Follow the existing component/styling patterns in `app/connect/page.tsx`.
- [ ] **Step 4: Run it, expect PASS** (+ existing connect tests).
- [ ] **Step 5: Commit** — `feat(hosted): stripped Add-to-Claude connect screen for trials`

### Phase 4 verification
`npm run lint` · `npx vitest run` · `npm run build`.

---

## Phase 5 — Demo→hosted coexistence + cleanup cron (ops)

### Task 8: Authenticated sessions bypass demo mode

**Files:** Modify `middleware.js` (demo block ~lines 528-1145); Test `__tests__/unit/demo-auth-bypass.test.js`

> READ the current demo block in `middleware.js` before editing — implement against the real code, not this summary.

- [ ] **Step 1: Write the failing test** — a request carrying a valid authenticated session (NextAuth JWT / local-admin) does NOT get the demo short-circuit even if the `dashclaw_demo` cookie is present; an anonymous request with the `dashclaw_demo` cookie still gets demo fixtures. (Note: `DASHCLAW_MODE=demo` as an env still forces demo for everyone — that env must NOT be set in hosted prod; this task only changes cookie-driven demo.)
- [ ] **Step 2: Run it, expect FAIL.**
- [ ] **Step 3: Implement** — in the cookie-driven demo branch, short-circuit to demo only when there is no resolved auth principal (no valid session/key). When an authenticated principal is present, clear the `dashclaw_demo` cookie on the response and fall through to the real runtime. Leave the `DASHCLAW_MODE` env path unchanged.
- [ ] **Step 4: Run it, expect PASS** (+ existing demo/middleware tests).
- [ ] **Step 5: Commit** — `feat(hosted): authenticated sessions bypass cookie-driven demo`

### Task 9: Free cleanup cron (GitHub Actions)

**Files:** Create `.github/workflows/hosted-cleanup.yml`

- [ ] **Step 1: Implement** (no test — CI workflow)
```yaml
name: hosted-cleanup
on:
  schedule:
    - cron: '0 * * * *'   # hourly; expiry is already enforced at request time, this only reclaims rows
  workflow_dispatch:
jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Sweep expired trial workspaces
        run: |
          curl -fsS -X POST "$DASHCLAW_URL/api/hosted/cleanup" \
            -H "x-cleanup-secret: $HOSTED_CLEANUP_SECRET" \
            -w "\nstatus=%{http_code}\n"
        env:
          DASHCLAW_URL: ${{ secrets.DASHCLAW_PROD_URL }}
          HOSTED_CLEANUP_SECRET: ${{ secrets.HOSTED_CLEANUP_SECRET }}
```
- [ ] **Step 2: Commit** — `ci(hosted): hourly free cleanup cron for expired trials`

### Task 10: Operator config (documented, not code)

**Files:** Modify `.env.example` (document the new vars) + a short note in `docs/hosted-deployment-runbook.md`.

- [ ] **Step 1: Add to `.env.example`** (with placeholders + comments): `HOSTED_MAX_ACTIVE_TRIALS=500`, confirm `DASHCLAW_HOSTED`, `HOSTED_TRIAL_DAYS`, `HOSTED_TRIAL_ACTION_CAP`, `HOSTED_CLEANUP_SECRET`, Google OAuth + Turnstile vars are present.
- [ ] **Step 2: Runbook note** — the prod flip: set `DASHCLAW_HOSTED=true`, do NOT set `DASHCLAW_MODE=demo` (demo stays cookie-driven), set the trial/cap/cleanup env + Google OAuth creds, add the GitHub Actions secrets. **Operator action (not automatable here): set the prod env on Vercel + the repo secrets.**
- [ ] **Step 3: Commit** — `docs(hosted): document instant-trial env + prod flip`

### Phase 5 verification
`npm run lint` · `npx vitest run` (full) · `npm run build` · `npm run route-sql:check` · `npm run version:check`.

---

## Final (whole-feature) verification + ship
- Full gate green: `npm run lint`, `npm run typecheck`, `npx vitest run` (3,225+ passing), `npm run build`, `npm run route-sql:check`, `npm run version:check`, `npm run api:inventory:check`.
- Manual smoke against a hosted-mode dev instance: sign in with Google → trial org created + capped → `/connect?hosted=` shows the OAuth connector → add connector in Claude → action appears in that org's Mission Control; confirm a second Google account is isolated.
- Ship via `/dashclaw-ship` (this adds one route → minor bump; reconcile the route count + the spec's key-mint line) and surface the `release:sdks` reminder.

## Self-review notes
- Spec coverage: signIn trial-stamp (T4), global cap (T2/T3/T4), capacity (T5), landing CTA (T6), hosted connect (T7), demo flip (T8), cleanup cron (T9), env/runbook (T10). Cost-safety (free tiers + cap + cleanup + fail-closed) covered by T1–T5 + T9.
- Isolation: existing s18 regression covers spoofing; T4 test covers the new-org path; final smoke confirms a second account is isolated.
- Type consistency: `applyHostedTrial`/`markTrialFull`/`countActiveTrials`/`mintOrgApiKey` signatures are defined once in Task 2 and used as-is in Tasks 3–5.
