# v5.1 — A way back in: trial workspaces get a session and a visible product (spec)

A Turnstile-minted trial must survive a closed tab and show the product.
Today the mint hands a stranger a credential into a void: the key renders
once in React state, no session exists, and every product surface redirects
to `/login`. v5.1 mints a **trial session cookie** at provisioning time so
the same browser can always come back, and makes `/connect`,
`/mission-control`, and `/decisions` real destinations for a trial user.
Scope is exactly one org: the trial's own. Must not depend on the Google A2
flip (watch-list), must not weaken anything (v3.6/v3.7 fail-closed norms),
and must be mechanically inert on non-hosted instances.

## What the evidence says

- The mint (`POST /api/hosted/workspaces`,
  `app/api/hosted/workspaces/route.ts`) creates an `organizations` row +
  one `api_keys` row (`provisionHostedWorkspace`,
  `app/lib/repositories/hosted-workspace.repository.ts:70`) and returns the
  plaintext key once. **No user row, no session, no cookie.** The client
  (`app/connect/HostedProvisionClient.jsx`) holds the key in React state
  only; refresh loses it permanently.
- Page routes (`middleware.js` `handlePageRequest`) accept exactly two
  principals: a NextAuth JWT cookie or the local-admin cookie
  (`dashclaw-local-session`, a jose-verified JWT signed with
  `NEXTAUTH_SECRET`, `app/lib/sessionViewer.mjs`). A bare trial API key has
  **zero** routes into any page. Same-origin dashboard fetches ride
  `handleSessionAuth` (requires `sec-fetch-site: same-origin` + a session).
- The local-admin session is the proven scaffold for a third cookie
  principal: signed JWT, `provider` discriminator, verified in middleware,
  org headers stamped by `buildPageOrgHeaders` (which strips inbound
  `x-org-id`/`x-org-role`/`x-user-id` and re-sets them from the session —
  header spoofing is already dead).
- Key recovery needs no new machinery: `POST /api/keys` already mints a new
  org-scoped key for any **admin-role session** and returns the raw value
  once. The OAuth path already makes every personal-org user an admin of
  their own org — a trial user being admin of *their own trial org* is the
  established shape, and `enforceHostedTrial` caps their writes regardless.
- **Latent finding surfaced by this recon:** `GET /api/keys/reveal` returns
  the instance bootstrap key (`process.env.DASHCLAW_API_KEY`) to any
  session with `x-user-id` + `x-org-role: admin` — it never checks *which
  org* the admin belongs to. Today it is unreachable by trial users only
  because trial users have no sessions. Both the A2 flip and this item
  would arm it. v5.1 closes it fail-closed regardless of which path ships
  first.
- Candidate shapes weighed (roadmap listed three):
  - **(a) Mint-time session issuance — chosen.** Smallest new surface;
    reuses the signed-JWT cookie pattern end-to-end; the cookie is
    httpOnly (never readable by page JS), org-scoped, and expires with
    the trial.
  - **(b) Recovery link bound to the mint — declined.** Mint is anonymous
    (no email), so a "link" is just a bearer credential in a URL —
    browser history, logs, and referrers are worse custody than an
    httpOnly cookie, and it adds a token table for a weaker property.
    Revive only if evidence shows device-switch is where returns die
    (needs v5.3's instrument first).
  - **(c) Browser-held key with re-entry UX — declined.** Requires
    teaching page routes to accept API keys and parks a plaintext
    admin-role credential in localStorage where any XSS reads it. The
    key is for agents; the browser gets a session.

## Design decisions

**The cookie — `dashclaw-trial-session`:**

- JWT signed with `NEXTAUTH_SECRET` (jose, same as the local session),
  payload `{ provider: 'trial', orgId, iat, exp }`.
  `exp` = the org's `trial_ends_at` — the session can never outlive the
  trial. No refresh, no sliding window.
- Set on the successful mint response: `httpOnly`, `SameSite=Lax`,
  `Secure` outside dev, `Path=/`, `Max-Age` matched to `trial_ends_at`.
- If `NEXTAUTH_SECRET` is unset, the mint **skips the cookie** and behaves
  exactly as today (key-only response, warn logged once). A misconfigured
  instance degrades to the current behavior; it never mints an unsigned
  session. (The hosted deployment has the secret set — NextAuth requires
  it.)

**Middleware acceptance (the only new auth surface):**

- A third session branch, `getTrialSession()`, checked **after** NextAuth
  and local-admin, and only when `isHostedMode()` — on every non-hosted
  instance the branch is mechanically inert (v3.6: "must be true
  mechanically, not socially"). A forged/stolen trial cookie presented to
  a self-host instance is simply never evaluated.
- Verification, all steps fail-closed to "unauthenticated":
  1. jose-verify signature + expiry; `payload.provider === 'trial'`.
  2. The org must still exist with `hosted_mode = TRUE` — a small cached
     lookup (in-memory, ~60s TTL, same accepted-staleness family as the
     API-key cache). A cleanup-deleted org invalidates its sessions
     within the TTL.
- On success the request carries `x-org-id = <trial org>`,
  `x-org-role = 'admin'`, `x-user-id = 'trial:<orgId>'` — admin **of the
  trial's own org only**, the same scoping every OAuth personal-org user
  already gets. Applies to both `handlePageRequest` (pages render) and
  `handleSessionAuth` (same-origin dashboard fetches work). CSRF posture
  is inherited: session-auth API calls already require
  `sec-fetch-site: same-origin`.
- `enforceHostedTrial` (expiry + action-cap 403s on writes) extends to
  trial-session-authenticated requests, so the session gets exactly the
  write envelope the trial key has — the session grants *visibility*, the
  trial caps keep governing *writes*.
- Expired-or-deleted trial: cookie cleared, redirect to
  `/connect?trial=expired`, which renders an honest "this trial has ended"
  state with the mint path to start a new one. Never a dead-end `/login`
  (which, without the A2 flip, has nothing a stranger can click).

**Operator-route hardening — the newly-armed admin principal (required):**

The trial session sets `x-org-role: admin` (of its own org). Every
role-only "admin" route that is really an INSTANCE OPERATOR surface would
otherwise be reachable by a stranger's same-origin `fetch`. One shared
guard, `denyTrialPrincipal(request)` (`app/lib/hosted/trial-principal.ts`),
draws the line the role no longer can: hosted-only (no-op off-hosted, so
self-host and the maintainer instance are untouched); the caller may
proceed only if its own org is positively confirmed non-trial
(`hosted_mode` false); a trial org or an unverifiable lookup is denied
(fail closed). Applied to:

- `GET /api/keys/reveal` — the bootstrap key (`process.env.DASHCLAW_API_KEY`)
  belongs to the operator; no trial principal may read it. (Guarding this
  behind `isHostedMode()` first also fixes a self-host regression: an
  un-migrated self-host must never be queried for trial columns.)
- `GET`/`DELETE /api/hosted/workspaces/:id` — inspect/delete an arbitrary
  workspace by id is cross-tenant; role alone let trial A read or destroy
  trial B. The operator (non-trial org) still passes.
- `POST /api/orgs` — tenant creation. The org it mints has no cap, no
  expiry, and returns a raw admin key; without the guard a stranger could
  convert one Turnstile-gated trial into unlimited permanent uncapped
  orgs, escaping every trial control.
- `POST /api/hosted/cleanup` — the instance sweep. The admin-role
  convenience path now also passes `denyTrialPrincipal`; the
  cron/operator-secret paths are unchanged.

Reviewed and accepted without change (self-scoped to the caller's own
org — a trial admin acting on its own workspace is legitimate):
`POST /api/doctor/fix` (`orgId` pinned from the verified header,
`allowLocal: false`) and `POST /api/admin/trigger-outcome-sweep` (sweeps
only `getOrgId`).

**`/connect` becomes the way back in:**

- Post-mint (existing `HostedProvisionClient` success state): add "Open
  your dashboard" (→ `/mission-control`) and copy stating the browser now
  holds the session ("your key is shown once; your dashboard is not").
- Returning visit with an active trial session: `/connect` renders a
  trial workspace card — server component reading the org row via the
  existing repository (the `/setup` norm; no new API route, no direct SQL
  in the page): key prefix + label, `trial_ends_at`, actions used / cap,
  buttons to `/mission-control` and `/decisions`, and "Generate a new
  key" driving the **existing** `POST /api/keys` (admin session) with the
  standard shown-once display — lost-key recovery with zero new backend.
- `/connect?trial=expired`: truthful ended state, mint path visible.

**Empty states (the product a trial user now sees):**

- `/mission-control` and `/decisions` for a zero-data org render truthful
  zeros (v4 house style) with a "connect your first agent" path pointing
  at `/connect`. Audit both surfaces; add the path where it is missing.
  v5.2 builds its guided first action on exactly these states.

**No schema change.** No new tables, no migration, no funnel change (a
session visit is not a funnel step — sharpening that is v5.3's whole job,
and it depends on this item shipping sessions first).

## Human surface (HUMAN-EXPERIENCE gate)

1. **Where does a human SEE it?** `/connect` — the page the trial user is
   already on at mint. The success state grows an "Open your dashboard"
   button; a returning visit shows their workspace card; `/mission-control`
   and `/decisions` now actually render for them. Click path: mint →
   "Open your dashboard"; return: open the site → session carries them in.
2. **Is it discoverable?** The way back in starts where the user already
   was (`/connect`), and the return path is the browser itself — no URL to
   remember beyond the site. The expired state lands on `/connect`, not a
   dead `/login`.
3. **Is every human step a CLICK?** Mint (click), open dashboard (click),
   return (navigate), recover a lost key (click "Generate a new key").
   Zero terminal steps in the human role.
4. **Was it verified rendered?** Local rendered proof with
   `DASHCLAW_HOSTED=true` (next build + next start per the dev-server
   workaround): mint → cookie present → new tab/navigation reaches
   `/mission-control` and `/decisions` scoped to the trial org → key
   regeneration works → forged/expired cookie bounces. Live proof on
   hosted.dashclaw.io after deploy: one manual mint (Turnstile requires a
   human click; the +1 mint is accepted, same caveat v4.6 recorded for
   maintainer checks), close tab, return, reach the workspace.

**Marketing site**: QUICK-START / trial copy that says the key is the only
artifact of the mint gets corrected in the same ship ("your browser keeps
you signed in for the length of the trial").

## Acceptance (from the roadmap, made concrete)

- Mint → close tab → return and reach your workspace: pinned by rendered
  proof locally and one manual live run on hosted.
- Trial-session middleware contract pinned by vitest: valid cookie renders
  pages with the trial org headers; tampered signature, expired token,
  wrong `provider`, deleted org, and `DASHCLAW_HOSTED` off each
  fail-closed to unauthenticated (redirect for pages, 401 for fetches).
- `POST /api/hosted/workspaces` sets the cookie in hosted mode with
  `NEXTAUTH_SECRET` present; sets none when the secret is absent; the
  route remains 404 when hosted mode is off — pinned by vitest.
- `/api/keys/reveal` 403s for a hosted trial org, works for the operator,
  and works on self-host without querying trial columns — pinned by vitest.
- The operator routes (`/api/hosted/workspaces/:id` GET+DELETE,
  `/api/orgs` POST, `/api/hosted/cleanup` admin path) 403 a trial
  principal and admit the operator / cron secret — pinned by vitest
  (`operator-routes-trial-guard.test.ts`).
- `enforceHostedTrial` applies to trial-session writes (cap and expiry) —
  pinned by vitest.
- Smoke (next lettered section in `scripts/policy-smoke.mjs`): hosted-off
  behavior — mint route 404, a forged trial cookie on a page request
  redirects to `/login` (branch inert). The hosted-on contract is not
  live-smokeable locally (env flip requires a restart mid-run) — pinned by
  vitest instead, reason recorded here (v4.4/v4.6 precedent).
- Security review (dashclaw-security-reviewer) of the new auth surface
  before ship; verdict recorded in this spec in place (v4.6 convention).

**Security review (in-ship, recorded per v4.6 convention).** First pass:
**BLOCK** — the new `x-org-role: admin` trial principal armed four
operator routes that gated on role alone. Two Critical (cross-tenant
inspect/delete of any workspace; tenant-creation escape from the trial
cap), one High (instance cleanup sweep), one Medium (self-host reveal
regression from the first-pass reveal fix), one Low (self-scoped admin
routes verified safe). Root cause: the reveal hardening shipped as a
one-off instead of auditing the whole set of role-only admin routes the
new principal reaches. Resolution: the shared `denyTrialPrincipal` guard
above, applied to all four, with vitest pinning each denial and each
operator/cron admission; the Low routes re-read and accepted as
self-scoped. Re-review verdict after the fix: **SHIP** (pending the
gate + rendered proof below). The auth plumbing itself (HS256 sign/verify,
`exp` pinned to `trial_ends_at`, headers stamped only from the verified
JWT, `sec-fetch-site` CSRF gate preserved, fail-closed on secret/flag
absence) was found sound in the first pass.
- No change to non-hosted instances: the gate is `isHostedMode()` in the
  middleware branch and the mint route — mechanical, pinned by the vitest
  hosted-off cases.

## Correctness review (high-effort, in-ship — recorded)

After the security passes, a high-effort adversarial correctness review
(parallel finders + independent verification) surfaced nine defects, fixed
in this item:

- **Transient DB error orphaned live trials (most severe).**
  `resolveTrialOrg` returned `null` on a DB error, indistinguishable from
  "org deleted", so a momentary Neon blip made `authenticateTrialPage`
  report expiry and the page path *cleared the re-entry cookie* — one blip
  permanently orphaned a workspace with weeks left. Fixed: `resolveTrialOrg`
  now **throws** on a lookup failure and returns `null` only for a
  positively-confirmed absent/non-trial org; the page path preserves the
  cookie and falls through to `/login` on a transient error (retryable),
  clearing the cookie only when the trial is definitively gone. Pinned by
  test.
- **Post-mint UI promised a session that wasn't minted.** When
  `NEXTAUTH_SECRET` is unset the mint sets no cookie, but the response was
  identical, so the client offered "Open your dashboard" → dead `/login`.
  Fixed: the response carries `session: boolean`; the button renders only
  when true. Pinned by test.
- **Capped-but-unexpired trial was a dead end.** Hiding the mint section for
  any signed-in trial meant a trial at its action cap (which blocks minting
  a replacement key) had no way forward. Fixed: the mint section is always
  rendered; the global/per-IP caps bound abuse, not this page.
- **`/login` ignored `trial.expired`.** A dead trial cookie landing on
  `/login` stayed on the dead page instead of the honest trial-ended
  route. Fixed + pinned by test.
- **Efficiency:** a dedicated `resolveTrialSession` skips the NextAuth/local
  chain re-run on the trial hot path; `handleSessionAuth` gained the
  `hasTrialSessionCookie` presence guard; `getTrialWorkspaceForViewer`
  short-circuits off-hosted and runs after the `?hosted` early return; the
  trial-end date renders as a deterministic UTC `YYYY-MM-DD` (server
  components can't format the viewer's locale).
- **Accepted by design (fail-closed):** `denyTrialPrincipal` 403s an
  operator whose own org row is missing or during a transient DB error
  (where the pre-v5.1 role-only check would have passed). This is the
  fail-closed tradeoff the security review required — on a working hosted
  instance `org_default` exists (or the instance 401s everything anyway), so
  the only effect is a retryable 403 on a rare operator op during a DB blip,
  which is preferable to ever letting a trial principal through an
  operator-power route.

## Non-goals (recorded, with revival triggers)

- **No cross-device / cross-browser recovery** (email capture, magic
  links). Mint stays anonymous; the cookie is single-browser custody, and
  losing it orphans the workspace exactly as today. Revive when v5.3's
  instrument shows returns dying on device switch, or if the A2 flip
  lands (OAuth then *is* the cross-device way back in).
- **No dependence on Google OAuth** — the A2 flip remains Wes's switch
  (watch-list). This item must work with zero providers configured.
- **No org switcher / multi-org UI** — one session, one org, unchanged
  product shape.
- **No visit instrumentation** — "returned vs gone" stamps are v5.3,
  which this item unblocks.
- **No browser-guided first governed action** — that is v5.2; this item
  only guarantees v5.2 has a signed-in somewhere to live.
- **No change to mint abuse guards** (Turnstile ordering, per-IP cap,
  global cap) — the session rides behind the existing gates.
