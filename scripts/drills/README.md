# Fresh-machine entry-path drills (roadmap v8.3)

Three consecutive pre-launch sweeps found the flagship path — `npx dashclaw up`
on a factory-fresh machine — broken, and each time it was a one-off manual
effort (a human sitting inside a Windows Sandbox or a fresh VM, clicking
through it by hand) that caught it. These scripts are the repeatable
instruments that replace that manual effort.

They are **maintainer instruments, not product code**: no UI, fully
automated, machine-readable verdict, exit 0 = green / exit 1 = broken. They
test the **DISTRIBUTION path** — `npx dashclaw up` resolving the published npm
CLI package and the platform tarball from GitHub releases — not
`--source-dir` (which is what `.github/workflows/up-smoke.yml` tests, from a
checked-out repo on dev-imaged CI runners; that catches source regressions,
not distribution/packaging breaks).

## One-command invocations

```bash
npm run drill:fresh-windows   # Windows Sandbox — factory-fresh Windows 11
npm run drill:fresh-linux     # Docker container — factory-fresh Linux
npm run drill:hosted          # hosted-trial equivalent (built separately)
npm run drill:claim           # claim-your-workspace path (v5.13): mint →
                              # preview → claim → ownership/rebind/discard →
                              # trial-cookie revocation. Needs a hosted-mode
                              # instance + HOSTED_DRILL_TOKEN + NEXTAUTH_SECRET
                              # + DATABASE_URL of the target. Off-Neon DBs run
                              # the two trial-cookie steps as LIMITED (the
                              # middleware resolves trial sessions via the
                              # Neon driver only).
```

Each accepts flags (see each script's header comment for the full list):

```bash
npm run drill:fresh-windows -- --cli @dashclaw/cli@latest --timeout-min 25
npm run drill:fresh-linux   -- --cli @dashclaw/cli@latest --image node:20-bookworm --timeout-min 20
```

## Seeded-break form (verify the drill actually catches regressions)

Point `--cli` at a version known to be broken, and confirm the drill fails
for the *right* reason before trusting it to catch new breaks:

```bash
npm run drill:fresh-windows -- --cli @dashclaw/cli@0.7.2   # historic VC++ runtime break class
npm run drill:fresh-windows -- --cli @dashclaw/cli@0.7.1   # frozen-version / import-route break class
```

## What each drill proves

- **fresh-windows** (`fresh-windows.mjs` + `windows-sandbox/drill.ps1` +
  `windows-sandbox/drill.wsb.template`): launches Windows Sandbox (a
  disposable, factory-fresh Windows image), installs Node LTS from scratch,
  runs `npm exec --package=<cli> -- dashclaw up --yes --db embedded
  --no-browser`, polls `/api/health` for up to 10 minutes, reads the minted
  instance key, and records the first governed action. Every exit path writes
  `drill-result.json`; the host launcher polls for that file and treats its
  absence after the timeout as a fail.
- **fresh-linux** (`fresh-linux.mjs`): the same proof inside a disposable
  `docker run --rm` container (default `node:20-bookworm`) instead of a VM —
  cheaper and faster to run than the sandbox, useful as a first check before
  burning sandbox time.
- **hosted** (`drill:hosted`, built separately): the equivalent proof for a
  stranger hitting the hosted trial cold, with no local machine involved.

## Cadence

Run before any release that touches `cli/**`, `scripts/setup.mjs`, or the
`up` path, and at least once during any open measurement window (a roadmap
phase where the entry path is under active scrutiny). These are not part of
CI — they require Windows Sandbox / Docker on the maintainer's own machine and
take several minutes each.

## hosted-buyer — the money path

`hosted-buyer.mjs` is a different kind of drill from the four above: instead
of proving the entry path (`npx dashclaw up`), it proves the **billing and
entitlements path** end to end against a live hosted-mode instance — mint →
key works → first governed action → claim (seeded user + forged NextAuth
session, same substitution as `claim-flow.mjs`) → checkout (a real Stripe
test-mode customer) → signed synthetic `checkout.session.completed` webhook →
idempotency replay → plan flip to indie → seat-cap 409 at 2 seats →
action-ceiling 403 at 50,000 governed actions → billing portal link → signed
synthetic `customer.subscription.deleted` webhook → free-plan restore →
ceiling gone → workspace export. Every step prints a `DRILL_STEP <id>
PASS|FAIL <detail>` line and the run ends with one `DRILL_VERDICT PASS|FAIL
n/n steps green`; exit 0 only when every step passed.

There is no `npm run` alias for this drill — invoke it directly:

```bash
node scripts/drills/hosted-buyer.mjs
node scripts/drills/hosted-buyer.mjs --base-url https://hosted.dashclaw.io
node scripts/drills/hosted-buyer.mjs --sabotage
```

`--base-url` also reads from `HOSTED_DRILL_BASE_URL`; it defaults to
`http://127.0.0.1:3000`.

**Required env** — all five, operator secrets, set only for the run:

```bash
HOSTED_DRILL_TOKEN     # mint bypass held by the operator
DATABASE_URL           # must point at the TARGET instance's database
NEXTAUTH_SECRET        # must match the target instance (forges the claim session JWT)
STRIPE_WEBHOOK_SECRET  # must match the target instance (signs the synthetic webhook events)
STRIPE_SECRET_KEY      # Stripe TEST-MODE secret key
```

The script checks these before doing anything else and prints `DRILL_VERDICT
FAIL missing env: ...` if any are unset. Rotate `HOSTED_DRILL_TOKEN`
afterward, per the drill-mint spec (`app/lib/hosted/drill-mint.ts`) — don't
leave a live mint-bypass token sitting around after the run.

**`HOSTED_ADMIN_API_KEY`** (optional, recommended) — the primary org-cleanup
path is `purgeOrg` via `DATABASE_URL`, registered unconditionally right after
mint, so `hosted-buyer.mjs` itself doesn't read this key. It's still worth
setting: `hosted-stranger.mjs` in this same directory backs its own teardown
with it, and without it there an early-aborted stranger run leaves a trial
workspace to auto-expire instead of being deleted immediately.

**Month-boundary caution.** `period` (`'YYYY-MM'`, UTC) is computed once at
run start and reused for both the ceiling seed and the ceiling-gone re-read.
A run that straddles 00:00 UTC on the 1st seeds `usage_rollups` for the
*previous* month, and the action-ceiling check enforces on the *current*
month's row — the `ceiling-403` step will spuriously fail. Avoid starting a
run in the few minutes around that boundary.

**`--sabotage`**: the same seeded-break idea as above, built into the script
itself. It flips the seat-cap step's expected second-invite status from 409
to 200, which the real route never returns once the cap is hit. Run it once
against a working instance and confirm the drill actually goes red before
trusting a green run to mean anything.

**When to run it**: before any release that touches billing, entitlements,
claim, the hosted middleware, or the Stripe webhook handler.

**Warning — real Stripe side effects.** A run against a live-Stripe-keyed
instance creates a real Stripe customer through the checkout route and drives
real signed webhook events against it. Nothing is ever charged — no live
subscription is created, only synthetic test-mode webhook events — and the
customer is deleted in teardown (verified by re-retrieving it, not just
trusting the delete call's response). Teardown is best-effort in a `finally`:
a failed cleanup prints a `DRILL_TEARDOWN ... FAILED` warning with manual
cleanup instructions instead of silently leaving Stripe or DB state behind.
Even so, this touches a real payment provider account — get explicit
approval before running it against anything other than a disposable or
test-only instance.

## Known gap: no macOS equivalent

**macOS has no maintainer-executable fresh-machine drill.** There is no macOS
VM infrastructure on the maintainer host, and GitHub's `macos-latest` runner
in `up-smoke.yml` is dev-imaged (Xcode, Homebrew, Node, etc. preinstalled),
not factory-fresh — it cannot catch the class of bug these drills exist to
catch. This is a known, deliberate gap, not an oversight: closing it would
require macOS VM infrastructure (e.g. a colocated Mac mini or a paid
cloud-macOS provider) that hasn't been justified yet.
