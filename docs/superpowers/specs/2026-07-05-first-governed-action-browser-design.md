# v5.2 — First governed action in the browser (spec)

The activation step itself: a guided "send your first governed action" on
`/connect` that needs no install. The browser exercises guard + record
against the trial's own org using the v5.1 session, renders the decision,
and deep-links to the row in `/decisions` — the product demonstrates
itself on the user's own data. Zero installs, zero terminal steps, zero
new backend surface.

## What the evidence says

- **The plumbing already exists; v5.2 is the surface.** A trial-session
  same-origin `fetch` to `POST /api/guard?record=true` is a fully
  governed action today: `handleSessionAuth` (middleware.js) accepts the
  trial cookie for same-origin API calls (`sec-fetch-site: same-origin`
  required), stamps the trial org headers, and gates writes through
  `enforceHostedTrial` (cap + expiry 403s). Neither `/api/guard` nor
  `/api/actions` knows anything about API keys — they consume
  `x-org-id`/`x-org-role` from middleware. No proxy route, no new auth
  surface, no schema change.
- **`?record=true` is the single-call path** (`recordRunningAction`,
  `app/api/guard/route.ts`): guard → record in one HTTP round trip, with
  the same idempotency, quota, and DLP behavior as the two-call flow;
  `guard_decision_id` is stamped server-side. It returns `recorded` +
  `action_id` on success. It never records on a `block` decision — the
  guided default must therefore be a low-risk action that reaches the
  ledger.
- **The funnel counts it with no change.** `getTrialFunnel`'s
  `firstAction` = earliest non-synthetic row in
  `guard_decisions ∪ action_records` for the org
  (`app/lib/repositories/hosted-workspace.repository.ts`). The exclusion
  is the shared predicate in `app/lib/calibration-mining.js`
  (`smoke-*`, `ci-smoke`, `test`/`test-*`, `loadtest-*`,
  `sdk-live-test-agent*`, `demo-e2e-verifier` agent ids; `smoke.%`,
  `loadtest.%`, `liveproof.%` action types). A browser-guided action with
  a non-synthetic agent id advances `firstAction` honestly — it IS the
  product working. Maintainer verification runs tag themselves synthetic
  (`liveproof.*` action type) and stay out of the funnel.
- **The deep link exists**: `/decisions/[actionId]` is the canonical
  single-decision view, keyed by `action_records.action_id` — exactly
  what `?record=true` returns.
- **The v5.1 states to build on**: `/connect` already resolves
  `getTrialWorkspaceForViewer()` and renders `TrialWorkspaceCard` for a
  live trial session — the only place the page knows "this is a trial org
  I can exercise guard against." The v5.1 empty states (`/decisions`
  `EmptyState` → `/connect`; `/mission-control` `QuickStart` →
  `/connect`) are the inbound paths the roadmap names.
- **A blind spot to state honestly**: a browser-guided action advances
  `firstAction` without advancing `firstKeyUse` (the session, not the
  key, authenticates it). "Acted in the browser, never used the key" is a
  real and now-reachable state; the funnel's steps are independent EXISTS
  checks so nothing breaks, and distinguishing browser-activation from
  agent-activation is precisely v5.3's job — the recognizable agent id
  below preserves that distinction with no schema change.

## Design decisions

**One new client component, no new backend.**
`app/connect/FirstGovernedActionCard.jsx` (client island, same pattern as
`HostedProvisionClient`), rendered by `app/connect/page.tsx` inside the
existing `trialWorkspace` branch, directly under `TrialWorkspaceCard`,
with `id="first-action"` so empty states can anchor to it. It renders
only for a live trial session — anonymous visitors, operators, and
self-host instances never see it (mechanically: the branch requires
`getTrialWorkspaceForViewer()` ≠ null, which requires hosted mode).

**The guided action is a real, visible request** (developer-reader
first): the card shows the actual JSON payload being sent with two
editable fields (`declared_goal` text, `action_type` from a small list of
honest examples), and a read-only `agent_id`. Send = one same-origin
`fetch('/api/guard?record=true', { method: 'POST', ... })` riding the
session cookie. No SDK shim, no fake terminal, no simulated output — the
response rendered is the response received.

**Defaults (pinned by test against the synthetic exclusion):**

- `agent_id: 'browser-first-action'` — truthful (the browser performed
  it), non-synthetic (funnel counts it), and recognizable so v5.3 can
  annotate browser-activation vs agent-activation later with no schema
  change.
- `action_type: 'connect.first_action'` default (editable among e.g.
  `send_email`, `deploy`, `db_write` so the user can see risk move) —
  non-synthetic.
- `declared_goal: 'Send my first governed action from the browser'`.
- No client `risk_score` — the server scores it (risk = max(server,
  client); sending none shows the server's own judgment).

**Rendering the decision (the product's own vocabulary):** decision badge
(`allow`/`warn`/`block`/`require_approval` with the standard status
tokens), server `risk_score`, `reason`, matched policies when present.
On `recorded: true` → the primary follow-through: "View it in your
ledger" → `/decisions/<action_id>`. A `block` renders the truthful
explanation that blocked actions don't reach the action ledger (that is
the product working, not a failure). `require_approval` renders the
truthful "an operator must approve this" state and still links to the
pending row when recorded. 403 from the trial envelope renders the
honest cap/expiry message (the same vocabulary `TrialWorkspaceCard`
uses), never a dead retry loop.

**Empty states point at it**: the `/decisions` `EmptyState` action and
`QuickStart`'s connect link change their target to
`/connect#first-action`. For non-trial viewers the anchor is inert (the
panel isn't rendered) and the link degrades to today's behavior exactly.
The post-mint success state (`HostedProvisionClient`, session branch)
also links to it — as a plain `<a>`, not a client-side `<Link>`, because
the card is rendered server-side from the session cookie the mint just
set, so only a full page load picks it up.

**Copy posture** (.impeccable.md): slightly-warm marketing tone is
allowed on `/connect`, but the card itself is instrument-grade —
declarative, no exclamation marks, brand orange only on the primary CTA
and the decision that needs attention. The card must read as "the
governance loop, exercised," not a demo toy.

**No schema change. No new routes. No SDK change.** The funnel, guard,
record, and session code paths are all shipped surface; v5.2 composes
them.

## Human surface (HUMAN-EXPERIENCE gate)

1. **Where does a human SEE it?** `/connect`, in the trial branch, right
   under the workspace card the trial user already returns to (v5.1).
   Click path: mint → success state → the card is on the same page;
   return visit → `/connect` → card; or `/decisions` empty state →
   "Send your first governed action" → anchored card.
2. **Is it discoverable?** It sits on the page every trial user starts
   on and returns to, and both v5.1 empty states link to it. No deep URL
   to know.
3. **Is every human step a CLICK?** Edit two text fields (optional),
   click "Send governed action", click "View it in your ledger". Zero
   terminal steps, zero installs — that is the item's entire thesis.
4. **Was it verified rendered?** Local rendered proof with
   `DASHCLAW_HOSTED=true` (next build + next start per the dev-server
   workaround): mint → card renders → send → decision renders →
   ledger deep link shows the row. Live proof on hosted.dashclaw.io
   after deploy: one manual mint (Turnstile needs a human), guided action
   run with `action_type: liveproof.browser` so the maintainer run is
   synthetic-excluded from the funnel; then one funnel read confirming
   the counter did NOT move for the synthetic run.

**Marketing**: hosted-trial copy (landing + QUICK-START) gains the
zero-install claim in the same ship: the trial now reaches a real
governed action entirely in the browser.

## Acceptance (from the roadmap, made concrete)

- A fresh trial reaches `firstAction` in one sitting with zero installs:
  live-proven end-to-end on hosted, synthetic-tagged (see gate 4).
- Defaults are funnel-visible — pinned by vitest: `agent_id` and every
  offered `action_type` tested against `SYNTHETIC_AGENT_RE` /
  `SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS` so a rename can never silently
  vanish browser activations from the funnel.
- Component contract pinned by vitest: renders for a trial workspace;
  sends exactly one same-origin `POST /api/guard?record=true` with the
  shown payload; renders `allow`+`recorded` with the
  `/decisions/<action_id>` link; renders `block` (no ledger link,
  truthful copy), `require_approval`, and the 403 cap/expiry state.
- Page contract pinned by vitest: `/connect` renders the card only in
  the trial branch (`id="first-action"`); anonymous/hosted-off renders
  no card.
- Empty-state links pinned: `/decisions` `EmptyState` and `QuickStart`
  point at `/connect#first-action`.
- Smoke (section AC in `scripts/policy-smoke.mjs`): hosted-off inert —
  `/connect` HTML contains no `first-action` panel marker. The hosted-on
  browser flow is not locally smokeable (same env-flip restart limit as
  AA/AB, recorded here) — pinned by vitest instead.
- No change to non-hosted instances (mechanical: the card lives behind
  `getTrialWorkspaceForViewer`, which short-circuits off-hosted).
- Security review of the diff before ship (house preship sweep). No new
  auth surface is claimed — the review's job is to confirm that claim.

**Security review (in-ship, recorded per v4.6 convention).** Verdict:
**SHIP — zero findings** (Critical/High/Medium/Low all 0). The "no new
auth surface" claim was confirmed against the actual diff: every API
response field renders as a React text child (no `dangerouslySetInnerHTML`;
`action_id` is interpolated only after a fixed `/decisions/` path prefix);
the fetch adds no credentials override, token, or proxy, so the
middleware's `sec-fetch-site` CSRF gate is inherited untouched; the render
gate fails closed on every path (hosted flag, `authType === 'trial'`,
org lookup, catch → null); nothing in the diff touches middleware, the
guard/actions routes, or the trial envelope; the payload carries no
tenant field — org identity derives server-side from the session cookie.

**Rendered proof (local, recorded).** Production build + `next start
-p 3001` with `DASHCLAW_HOSTED=true`; a proof trial org provisioned
directly (Turnstile fail-closes under production NODE_ENV, so the session
JWT was minted with the local `NEXTAUTH_SECRET` — same shape the mint
route signs). Two layers, both green:

- HTTP contract (6/6): anonymous `/connect` has no `first-action`
  marker; the trial session renders it; the session-authenticated
  `POST /api/guard?record=true` returned `allow` (risk 20),
  `recorded: true` + `action_id`; `/decisions/<action_id>` renders for
  the session; the same-origin call without a session is refused (401).
- Browser click-through (chrome-devtools, isolated context): card renders
  at `#first-action` with the live payload preview → "Send governed
  action" → ALLOWED badge, risk 20, ledger CTA → Decision Replay page for
  the action (GUARD → ACTION STARTED timeline). Zero console errors on
  both pages. Screenshots archived with the session (proof-1/2/3.png).
  Test-rig gotcha worth keeping: `getViewerContextFromCookieHeader`
  resolves NextAuth → local → trial in order, so a leftover local-admin
  cookie in a shared browser profile masks the trial branch — proof runs
  need a clean cookie jar (product behavior, not a bug).

Live proof on hosted.dashclaw.io happens post-deploy (Turnstile requires
a human mint); the maintainer run uses `action_type: liveproof.browser`
so it stays synthetic-excluded from the funnel.

## Non-goals (recorded, with revival triggers)

- **No new guard/record capabilities and no proxy route** — the browser
  uses the same governed path an agent does; if the trial envelope ever
  stops covering session writes, that is a v5.1 regression, not a v5.2
  feature gap.
- **No multi-step tutorial / tour machinery** — one action, one decision,
  one ledger row. QuickStart on mission-control already handles the
  broader onboarding arc.
- **No funnel changes** — v5.3 sharpens the instrument (visits,
  first_used_at, browser-vs-agent annotation). This item only makes sure
  the raw material (a recognizable browser agent id) exists.
- **No policy authoring in the card** — showing risk move via
  `action_type` choice is enough; policy tuning stays on `/policies`.
- **No self-host / operator variant** — `ConnectNextStepPanel` (settings)
  already serves the key-based "test your connection" case. Revive if
  self-host onboarding evidence ever shows the same void.
