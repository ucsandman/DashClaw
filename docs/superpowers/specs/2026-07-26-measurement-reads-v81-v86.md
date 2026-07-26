# The measurement reads — v8.1 cohort verdict and v8.6 era-exit baseline (2026-07-26)

The two obligations that outlived the v5.0.0 cull
([`owner-roadmap.md`](../../plans/owner-roadmap.md)), discharged. Both were
demoted by [`THESIS.md`](../../../THESIS.md) from steering gate to honesty
artifact — the thesis is the branch decision — but the instrument ran as
scheduled and the verdicts are written against the **old door** (the pre-cull
hosted funnel), becoming the baseline the thesis's falsifiers are judged
against. Like the [v5.5 verdict](2026-07-05-reach-readiness-verdict-v55.md)
this is deliberately a document, not a product surface: the live instrument
already renders on `/setup`, and the audience is the owner.

Read taken 2026-07-26T15:46:43Z via `node scripts/measurement-read.mjs`
(v5.5 contract arithmetic, unchanged, pinned by unit test) against
`GET https://hosted.dashclaw.io/api/hosted/funnel` (truthful since
2026-06-10). Both reads run past their gates (≥07-19 / ≥07-20) and inside
the script's own staleness bound (warns after 07-26 — this is the last
clean day, and the cross-check below shows the lateness cost nothing).

## v8.1 — the cohort read: ACTIVATION

Cohort = all mints in the 14 days following the reach act (2026-07-05 →
2026-07-19), derived from v6.4 `bySource` ('unknown' = pre-act, excluded;
'drill' = v8.3 synthetic maintainer traffic, excluded):

| source | minted | firstAction |
|--------|--------|-------------|
| direct | 2 | 2 |
| **cohort total** | **2** | **2** |

- n = 2, firstAction = 2 *(corrected same day to firstAction = 1 genuine —
  see CORRECTION at the end of this document)*. **Success clause met: ≥1
  stranger reached `firstAction` — ACTIVATION. The mechanism converted
  attention.**
- Directional target (≥25% at n≥8): not evaluable at n=2. For what a
  two-mint sample is worth, the observed rate is 2/2.
- Counter-verdict clause (n≥10 with zero firstActions): nowhere near firing.

**Cross-checks that make the number trustworthy:**

- *No post-window pollution.* The source-derived cohort is exact only while
  no sourced mints postdate the window. The weekly cohorts show the last
  mint week is 2026-07-13 (inside the window) and nothing after — the
  seven-day lateness of this read polluted nothing.
- *Not maintainer artifacts.* Both mints sit in the week of 2026-07-13; the
  maintainer's last session before this one ended 2026-07-10, and maintainer
  runs are drill-labeled or cleaned by protocol. Nobody was home when these
  minted. They are organic.
- *Both doors exercised.* `firstActionVia`: 1 browser, 1 agent — one
  stranger took the guided browser first action, one wired an actual agent.
  The two paths the v5 era built each converted at least once.
  *(RETRACTED same day: the 'agent' event was the homepage demo widget —
  see CORRECTION.)*

The v5.5 contract's independent-confirmation clause ("a single organic
`firstAction` at any time confirms the mechanism on its own") is thereby
also satisfied — twice, once per door.

## v8.6 — the era-exit read: the chain, stranger-attributable

Full chain over the same instrument, with synthetic traffic separated out.
Instrument-wide totals first (what the funnel shows raw):

| minted | keyUsed | firstAction | returned | retained wk-1 | graduated |
|--------|---------|-------------|----------|----------------|-----------|
| 12 | 2 | 2 | 1 | 0 (12 eligible, 0 pending) | 6 |

Attribution, from `bySource` and the weekly cohorts:

- **6 mints are drill traffic** (week of 2026-07-06, the v8.3/v5.2 drill
  runs): the hosted-stranger drill walks mint → key use → export, so the
  cohort-week's `keyUsed = 2` and **all 6 graduations are drill exports** —
  synthetic by construction, force-labeled at mint.
- **4 mints are pre-act 'unknown'** (weeks of 06-08 and 06-29): the old
  first mile's zeros, unchanged — 0 firstAction, 0 keyUsed.
- **2 mints are the stranger cohort** (week of 2026-07-13, both 'direct').

The stranger chain, then — the honest baseline:

| step | count | note |
|------|-------|------|
| minted | 2 | both 'direct' (no referrer/UTM — consistent with app-stripped links) |
| firstAction | 2 | 1 browser door, 1 agent door; median hours ≈ 0 |
| keyUsed | 0 | the *minted trial key* never authenticated — see below |
| returned | 1 | instrument-wide annotation (`returnedNeverConnected` 0); drills and pre-act mints don't return, so attributable to the cohort |
| retained wk-1 | 0 | all 12 eligible, none retained |
| graduated | 0 | all 6 exports are drill-stamped; no stranger has exported a workspace |

**The `keyUsed = 0` oddity, stated honestly:** one first action came through
the agent door while the cohort's minted-key `first_used_at` never stamped.
The likely benign reading is instrument semantics, not a broken stamp: the
pairing flow gives an agent its own identity, so an agent can reach a
governed action without ever presenting the minted trial key that `keyUsed`
measures. But "likely benign" is a hypothesis, not a verification — the next
session that touches the hosted schema should confirm which credential that
agent-door action authenticated with before trusting `keyUsed` as a chain
step. It is recorded here so the question can't silently evaporate.

*(RESOLVED same day, and the pairing hypothesis was wrong — the answer is
the homepage demo widget writing real rows under the trial cookie. See
CORRECTION at the end of this document.)*

### Exit verdict

The era exits with the mechanism confirmed and everything past activation
unproven. Mint → firstAction now converts organic attention on both doors
(2/2 where every prior era read zeros) *(corrected same day: one genuine
conversion, browser door — see CORRECTION)*. Return (1), retention (0), and
graduation (0) are the un-earned part of the chain — exactly the territory
the thesis assigns to falsifiers #4 (value: blocked → approved → continued)
and #5 (differentiation: blocking vs ledger-only). Nothing in this read
refutes or proves them; **demand remains un-refuted, not proven**, and
attention stays the owner's lever (MAINTAINER.md §4).

This table is the baseline. When the thesis's external-use falsifiers are
next judged, they are judged against these numbers, not against zero.

## What this does NOT decide

The v8.5 "branch selected by the read" mechanism is retired; the thesis is
the branch. No build order changes on this verdict. The forward direction
remains governed autonomy (the three 2026-07-06 RFCs), gated on maintainer
judgment and — where money or outward acts are involved — on Wes.

## CORRECTION (2026-07-26, hours after publication)

The `keyUsed = 0` question this document pinned was chased the same day,
and the answer **changes the headline numbers**. The static case, each step
verified in code:

1. The cohort's `keyUsed` rests on `api_keys.last_used_at`, stamped on
   every key-authenticated request since long before this window. Zero
   means **no API key ever authenticated for either cohort org**.
2. The only keyless write paths into `guard_decisions`/`action_records`
   are session/trial-cookie-authenticated calls: the guided browser first
   action (sentinel agent id, labeled 'browser') and UI components that
   POST the governance API directly. Pairing mints an identity, not a key
   — a paired agent still authenticates with a key. No third path.
3. Exactly one UI component POSTs `/api/guard` with a non-browser agent
   id: the **homepage LiveDemo** (presets `analytics-agent`,
   `openai-deployer-1`, `rogue-agent`). It was built for the demo
   deployment, where demo middleware intercepts it — but the same homepage
   ships on hosted, where a trial-cookie visitor's "Evaluate" click writes
   a real guard row. None of those ids were synthetic-excluded.

**Corrected reading: the 'agent'-door first action was a browser click on
the homepage marketing demo, not a wired agent.** The genuine stranger
first-action count is **1 of 2** (the guided browser flow — that one's
provenance is the sentinel id and is solid). The v8.1 verdict is still
**ACTIVATION** — the contract needs ≥1, and one genuine conversion stands
— but this document's "2/2, one per door" framing was instrument
inflation, and the era-exit chain reads mint 2 → firstAction 1 → returned
≤1 → retained 0 → graduated 0. Whether the demo-click org later performed
a genuine action is unknowable from the public instrument (per-row
confirmation needs hosted DB access, which this machine currently lacks —
`neonctl` unauthenticated, Vercel env sensitive-locked).

The instrument is fixed in the same commit: the three preset ids joined
`SYNTHETIC_AGENT_LIKE_PATTERNS`/`_RE` (exact matches, pinned by the
regex↔patterns drift test), which retroactively excludes the demo row from
every analytics surface — funnel included — without hiding it from the
visitor's own /decisions ledger, whose display intentionally does not
filter synthetic rows.
