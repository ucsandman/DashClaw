# Owner roadmap ARCHIVE — Roadmap v5 (complete)

Frozen 2026-07-05 when v5.5 shipped (v4.59.0) and the era completed with
the reach-readiness verdict
([`../../superpowers/specs/2026-07-05-reach-readiness-verdict-v55.md`](../../superpowers/specs/2026-07-05-reach-readiness-verdict-v55.md)):
**READY**. The living roadmap is
[`docs/plans/owner-roadmap.md`](../owner-roadmap.md); v1–v3 live at
[`owner-roadmap-v1-v3.md`](owner-roadmap-v1-v3.md); v4 at
[`owner-roadmap-v4.md`](owner-roadmap-v4.md).

## Roadmap v5 — the first mile: a stranger reaches a governed action (drafted 2026-07-05)

v2 made each interruption earn its cost. v3 made the product's testimony
true. v4 made the record complete — and its last item built the instrument
this era is drafted from. v5 is about the first mile: today a stranger can
mint a trial workspace and the product never appears in front of them.
Every prior era deepened the product for someone already inside it; the
funnel says nobody new is getting inside.

Drafting evidence (2026-07-05 sweep: the live funnel it was built to
produce, a mechanism recon of the post-mint UX, live posture, memory open
threads):

- **The funnel's first reading (hosted.dashclaw.io, live)**: 4 mints since
  2026-06-10 (1 in the June 8 week, 3 in the June 29 week) → **0 first key
  uses, 0 first governed actions, 0 retained** (1 eligible, 3 too young).
  No trial API key has ever authenticated a single request. n=4 is thin
  evidence and some mints may be our own manual checks — but 0/4 with a
  25-day-old eligible cohort is the only activation evidence that exists,
  and it all points one way.
- **The mechanism (recon of the mint path)**: a Turnstile-mint user gets a
  key + a config block on `/connect` — and *nothing else*. No session, no
  dashboard access, no way back in: the key is shown once, and closing the
  tab orphans the workspace permanently. The product's actual surfaces
  (mission-control, the decisions ledger — the things that would make
  governance legible) are unreachable for a trial user until they've
  installed a CLI or wired MCP config *on faith*. The trial hands a
  stranger a credential into a void. The Google sign-in path that would
  grant a session exists in code but no provider is configured on the
  hosted deployment (the A2 flip, Wes's switch), and even that path lands
  on `/mission-control` with zero trial guidance and no visible API key.
- **The instrument's own blind spot** (recorded in the v4.6 spec's
  non-goals): with no trial sessions, "minted and never returned" and
  "returned, browsed, never connected an agent" are indistinguishable —
  there is no table that could tell them apart. Sharpening this becomes
  possible only after trials have sessions.
- **Live posture (the operator's own instance), secondary signal**: 34/100
  `at_risk` — six open incident-class findings ("ungoverned high/critical
  risk reached allow", ~100 observations) each already carrying a minted
  tightening proposal in the spine, coverage-drop findings on 2 agents,
  74 accepted-risk units from a June 10 bulk sweep. The instrument works;
  the judgments are queued and rendered with one-click fixes. Working that
  queue is operator judgment (constitution §3) — it needs no new build,
  and building nag machinery would violate the v2 thesis. Not a v5 item.
- Memory open threads re-checked: multi-agent attribution (done, v4.3),
  Codex transcript-coverage gap (recorded in PLUGIN_PARITY.md as an
  explicit decision), `dashclaw/legacy` removal (pinned to the next semver
  major, not to a roadmap era), FinOps Phase C (gated on Wes, unchanged).

Alternatives weighed and declined this round:

- **Reach-first** — declined by the funnel itself: pouring attention into a
  path that converts 0/4 wastes the one non-renewable asset, and outward
  acts are Wes's per constitution §4. v5.5 defines the reach-readiness bar
  so the *next* decision is evidence-based too.
- **Team/RBAC** — still zero external orgs with more than one human.
  Watch-list trigger unchanged.
- **Repo-wide TypeScript migration** — XL, mechanical, blocks nothing here.
  Third consecutive decline; it stays declined until it blocks something.
- **Judgment-queue automation/nagging** — see posture bullet: the spine
  already renders every queued judgment with a prefilled fix; §3 makes the
  clicking human. Nothing to build.

**Status ledger v5** (update in place):

| # | Item | Status |
|---|------|--------|
| v5.1 | A way back in: trial workspaces get a session and a visible product | SHIPPED v4.55.0 |
| v5.2 | First governed action in the browser (zero-install activation) | SHIPPED v4.56.0 |
| v5.3 | Activation instrument sharpened: returned-vs-gone, first key use | SHIPPED v4.57.0 |
| v5.4 | The outsider run: the CLI trial path walked cold, frictions fixed | SHIPPED v4.58.0 |
| v5.5 | Reach-readiness verdict: re-read the funnel, write the bar | SHIPPED v4.59.0 |
| — | FinOps Phase C / CostClaw paid add-on | GATED on Wes (RFC 0002 §8) |

## v5.1 A way back in

A minted trial must survive a closed tab and show the product.

- Spec first — this is auth surface on the hosted instance and it must not
  weaken anything (fail-closed norms from v3.6/v3.7 apply). Candidate
  shapes for the spec to decide between: mint-time session issuance,
  a workspace recovery link bound to the mint, or browser-held key with
  explicit re-entry UX. Whatever shape, scope is exactly one org: the
  trial's own.
- Once inside, the trial user sees *their* mission-control and decisions
  ledger — empty states included (truthful zeros are v4's house style; an
  empty ledger with a "connect your first agent" path is honest and
  useful).
- Acceptance: mint → close tab → return and reach your workspace; rendered
  proof of a trial-scoped dashboard; security review of the new auth
  surface; smoke pins the session/recovery contract; no change to
  non-hosted instances.

## v5.2 First governed action in the browser

The activation step itself: a guided "send your first governed action"
that needs no install — the browser exercises guard + record against the
trial's own org and shows the decision landing in the ledger, live.

- Lives on `/connect` (and reachable from v5.1's empty states). Uses the
  trial's real key/session; renders the guard decision, then deep-links to
  the row in `/decisions` — the product demonstrates itself on the user's
  own data.
- The funnel counts it honestly: a browser-guided action is a real
  governed action (it IS the product working). Our own verification runs
  use synthetic agent ids so the shared exclusion keeps maintainer testing
  out of the funnel.
- Acceptance: a fresh trial reaches `firstAction` in one sitting with zero
  installs, live-proven end-to-end on the hosted instance (synthetic-
  tagged); rendered proof; smoke pins the flow.

## v5.3 Activation instrument sharpened

v4.6's known blind spots, closed now that they're closable:

- With sessions (v5.1), stamp trial-workspace *visits* (first/last seen at
  org grain — a timestamp, not page-view analytics) so the funnel can
  distinguish "never returned" from "returned, never connected". Renders
  as a funnel annotation, not a new step.
- `api_keys.last_used_at` is a last-stamp; add a `first_used_at` (or
  equivalent evidence) so time-from-mint-to-first-key-use becomes
  measurable — today the funnel can only say *whether*, not *when*.
- Snapshot the new facts in `hosted_trial_snapshots` too (same
  fail-closed freeze; drizzle migration extends the table).
- Acceptance: the funnel (route + /setup card) renders the sharpened
  distinctions with truthful zeros; snapshots carry them; tests pin the
  math.

## v5.4 The outsider run

The CLI/MCP path is the trial's power path (`dashclaw install claude
--trial`, QUICK-START's "3-Minute Hosted Trial") — and no one has ever
walked it as a genuine outsider on a cold machine.

- Run it cold: fresh environment, no repo checkout, no ambient env vars,
  following only what the screen says. Every stumble is a defect: wrong
  copy, missing link, a preflight that assumes maintainer state, a claim
  that isn't true ("3 minutes").
- Fix what's found in the same item; correct any claim that can't be made
  true.
- Acceptance: a recorded cold run reaching a governed action, timed; the
  QUICK-START claim matches the recording or has been corrected; frictions
  fixed with tests where they were code, copy where they were copy.

## v5.5 Reach-readiness verdict

The era's exit instrument, mirroring v4.6's role: after v5.1–v5.4, re-read
the funnel and write the verdict that hands Wes a decision he can make on
evidence.

- Define the bar in writing: what the funnel must show (e.g. new organic
  mints activating at a nonzero rate over a stated window) for reach to be
  worth Wes's outward acts — and the counter-verdict: if activation stays
  0% *after* the friction is gone, the diagnosis moves from friction to
  value-prop/positioning, which is strategy, which is Wes's.
- No outreach in this item (§4). It produces a one-page verdict citing the
  funnel, appended to the maintainer log and linked from the roadmap.
- Acceptance: the verdict exists, cites live numbers, and states the bar
  and the counter-verdict explicitly; v6 drafting can cite it the way v5's
  drafting cites the funnel.
- **Shipped v4.59.0** — the verdict is
  [`../superpowers/specs/2026-07-05-reach-readiness-verdict-v55.md`](../superpowers/specs/2026-07-05-reach-readiness-verdict-v55.md):
  **READY**. The v5.2 human live proof landed the same session (a human
  Turnstile mint reached a governed browser action in 29 minutes; the
  maintainer run was then removed under the funnel-truth protocol), so the
  era closes with no open loops. Roadmap v5 is complete.

## Gated (needs Wes before any build)

- **FinOps Phase C / CostClaw paid add-on** — RFC 0002 §8 billing
  decision. Money. The prepared analysis exists; nothing builds until the
  explicit go.

## Watch list (revival triggers)

Carried from v3.7/v4, plus this era's additions:

- Guard degradation recurrence → revive load-CI wiring + the LLM
  slow-path scenario.
- A consumer surface ships a hook contract → revisit the enforcing-proxy
  KILL (`docs/architecture/enforcement-boundary.md`).
- Hosted multi-tenant future → per-org JWKS issuer binding.
- More than one human governs an org → team/RBAC.
- The funnel shows organic activation *before* v5.1–v5.2 ship → re-weigh
  the era's order (the friction diagnosis would be wrong).
- Next semver major → `dashclaw/legacy` subpath removal rides it
  (deprecation plan in `docs/sdk-parity.md`); the major is cut when a
  breaking change earns it, not by roadmap era.
- Google OAuth on the hosted instance (the A2 flip) remains Wes's switch;
  v5.1 must not depend on it.

## v5 order rationale

v5.1 first: it is the mechanism fix for the funnel's zero (a credential
into a void), and both v5.2's render surface and v5.3's returned-vs-gone
signal depend on trial sessions existing. v5.2 second: it is the
activation step itself. v5.3 third: sharpen the instrument once the new
facts exist to measure. v5.4 fourth: the parallel power path, independent
but cheaper to verify after the browser path proves the trial plumbing
live. v5.5 last: the era exists to produce that verdict, the way v4
existed to produce the funnel. Order changes only with a written reason
in the commit (v1 rule, kept).

## Standing chores (no status; every session touches them as needed)

- Registry truth: `npm view` the four packages vs manifests when releasing.
- Dependabot: keep at zero open alerts; per-lockfile fixes.
- Corpus: add vectors per MAINTAINER.md protocol as incidents occur.
- Keep `/explain`, README, and docs truthful when any of the above ships.
