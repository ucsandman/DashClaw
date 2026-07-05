# Reach-readiness verdict — Roadmap v5.5 (2026-07-05)

The era's exit instrument, mirroring v4.6's funnel: after v5.1–v5.4, re-read
the funnel and hand Wes a reach decision he can make on evidence. Outward
acts are Wes's alone (MAINTAINER.md §4); this document performs none and
schedules none. It is deliberately a document, not a product surface: its
audience is the owner making a strategy call, and the live instrument it
cites already renders on `/setup` (the activation funnel card).

## The funnel, re-read (live)

`GET https://hosted.dashclaw.io/api/hosted/funnel`, computed
2026-07-05T10:21:19Z, truthful since 2026-06-10:

| minted | key used | first action | returned | retained wk-1 |
|--------|----------|--------------|----------|----------------|
| 4 | 0 | 0 | 0 | 0 (1 eligible, 3 pending) |

Cohorts: week of 2026-06-08 — 1 mint (week-1 eligible, gone); week of
2026-06-29 — 3 mints (two of them 17 seconds apart, likely one person).
No trial API key has ever authenticated a request.

Two additional mints made 2026-07-05 were the maintainer's own — the human
live proof still owed from v5.2 — and were removed under the funnel-truth
protocol (cap zeroed first so the snapshot-before-delete declines the
placeholder; residue verified zero). What that proof established before it
was cleaned: **a human Turnstile mint reached a governed action through the
guided browser flow 29 minutes after minting**, the decision landing in the
trial's own ledger. The zero-install activation path works live, end to end.

## The decisive fact

Every standing mint predates the fixed first mile. The last genuine mint is
2026-07-04; the entire v5 era — trial sessions (v4.55.0), the guided browser
first action (v4.56.0), the sharpened instrument (v4.57.0), the outsider-run
fixes (v4.58.0) — deployed 2026-07-05, and `@dashclaw/cli@0.6.0`, the first
version a stranger can install cold without knowing an unanswerable URL,
reached npm 2026-07-05T10:13Z. The funnel's zeros are evidence about the
*old* first mile, the one this era was drafted to kill. The post-fix
observation window opens today, with zero observations in it.

## Why the bar cannot be an organic conversion rate

At the observed organic rate (4 genuine mints in 25 days, ≈1/week, with
double-mints inflating even that), a bar of the form "organic mints activate
at X% before reach is warranted" could not be meaningfully tested for
months. Requiring it would be indefinite deferral disguised as rigor. The
honest structure is a mechanism bar (can the first mile convert attention at
all?) plus a measurement contract (how will we know whether it did?).

## The bar

Reach is worth Wes's outward acts when all three hold — and as of this
verdict, all three do:

1. **Mechanism — met 2026-07-05.** A stranger can go mint → governed action
   with zero installs in one sitting: proven by a live human run (29
   minutes, browser path) and by the recorded cold CLI run
   ([outsider run](2026-07-05-outsider-run-v54.md); machine time under ten
   seconds, the 3-minute claim stands on the recording). The "credential
   into a void" mechanism the era was drafted against no longer exists.
2. **Instrument — met since v4.57.0.** If reach happens, the funnel measures
   what it produced: mint→return, mint→first key use, browser-vs-agent
   first actions, week-1 retention, weekly cohorts — with maintainer runs
   synthetic-excluded or cleaned by protocol.
3. **Window — met at publish.** The first mile the public actually gets is
   the fixed one: hosted deploy on v4.58.0, CLI 0.6.0 on npm. Both verified
   live today.

**Verdict: READY.** From today, reach is no longer blocked by the product.
Whether, where, and when to spend the outward acts is positioning — strategy
— and §4 places it with Wes.

## The measurement contract for the first reach act

Written now so the next verdict can be arithmetic instead of narrative:

- **Cohort**: all mints in the 14 days following the act.
- **Success**: ≥1 stranger reaches `firstAction` in that cohort — the
  mechanism converted attention. Directional target if the cohort reaches
  n≥8: ≥25% first-action rate.
- **Counter-verdict trigger**: **n≥10 mints with firstAction = 0.** The
  friction diagnosis is then falsified (the human proof shows the path
  works), and the diagnosis moves to value-prop/positioning — strategy,
  Wes's — where more friction engineering is explicitly not the answer.
- **Independent confirmation**: a single organic `firstAction` at any time
  before a reach act confirms the mechanism on its own.

## Still open, not blocking

The week-of-06-29 cohort becomes week-1-eligible 2026-07-06–07-11; all
three predate the fixes and are expected to stay zero. The funnel's
`keyUsed` step has never fired — the first stranger to wire the CLI or MCP
will exercise `first_used_at` for real (the instrument itself was proven on
the cold run). Neither fact gates reach; both are what the next funnel read
will check first.
