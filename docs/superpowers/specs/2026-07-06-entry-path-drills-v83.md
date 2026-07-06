# Entry-path drills: both doors proven on repeat (roadmap v8.3)

Shipped 2026-07-06. Owner item: `docs/plans/owner-roadmap.md` §v8.3.

## Why

Three consecutive pre-launch sweeps found a flagship entry path broken — the
embedded-Postgres VC++ gap, the pg_ctl elevated-token refusal, the WIN1252
half-schema, the frozen-version missing import route. Each was found by a
one-off manual effort (a hand-built Windows Sandbox run, a post-ship pass
that happened to probe the hosted instance). If a stranger arrives during the
measurement window and a door is broken, the v8.1 cohort read records a false
negative about the product. This item turns the one-off efforts into
repeatable, one-command, machine-readable drills.

The drills test the **distribution path** — `npx dashclaw up` resolving the
published npm CLI and the GitHub release tarball — on factory-fresh machines.
CI's `up-smoke.yml` runs from-source on dev-imaged runners; it structurally
cannot catch a fresh-machine or distribution-path break. These drills are the
maintainer-run counterpart. Explicit HUMAN-EXPERIENCE decision: the drills are
maintainer instruments with **no product UI** — their findings ship as fixes
with surfaces of their own. What is human-visible is the claim they protect,
which /proof and /setup already render.

## The three drills (`scripts/drills/`)

**`npm run drill:fresh-linux`** — the owned-instance door on a disposable
Linux container. `docker run --rm node:20-bookworm` →
`npm exec --package=@dashclaw/cli@latest -- dashclaw up --yes --db embedded
--no-browser` → poll `/api/health` → read the minted key → POST the first
governed action. Default persona is the QUICK-START stranger (unprivileged
user); `--as-root` models a fresh root VPS. Emits `DRILL_STEP`/`DRILL_VERDICT`
lines; exits 0 on PASS.

**`npm run drill:fresh-windows`** — the owned-instance door on a factory-fresh
Windows image via Windows Sandbox. `fresh-windows.mjs` stages a `.wsb` +
`drill.ps1` + config, launches the sandbox, and polls a shared-folder
`drill-result.json`. `drill.ps1` runs fully automated at logon: silent Node
LTS install → `dashclaw up` → health poll → first governed action → writes the
result on every exit path. The kept, documented successor to the interactive
`SandboxShared\` harness that found the 0.7.2–0.7.4 fixes.

**`npm run drill:hosted`** — the stranger door against the LIVE hosted
instance: `hosted-stranger.mjs` mint → key works → first governed action →
export workspace → import into an owned instance → teardown. This is the drill
that would have caught the missing hosted import route (v7.2) the day it
lagged. Mint rides the operator-held drill token (below) because Turnstile
correctly blocks scripts; everything downstream is the untouched stranger
path.

`--cli @dashclaw/cli@<old>` on either fresh-machine drill reproduces a historic
break class (`@0.7.2` = VC++ runtime on Windows; `@0.7.1` = frozen-version
missing import route). macOS has **no maintainer-executable fresh-machine
equivalent** — no macOS VM on the maintainer host, and GitHub's macos runner is
dev-imaged, not factory-fresh. Recorded as a deliberate gap, not silently
skipped.

## The drill-mint token (the one new production seam)

The hosted drill needs to mint scriptably, and Turnstile (correctly) blocks
scripts. `app/lib/hosted/drill-mint.ts` `isDrillMint()` is the narrow,
operator-held alternative: the `x-hosted-drill-token` header is compared
timing-safe against `HOSTED_DRILL_TOKEN` (env). Containment:

- **Unset = no bypass exists** (the default everywhere).
- Values shorter than 24 chars are refused, so no placeholder can arm it.
- A drill mint is **force-labeled `source='drill'`** server-side (the caller's
  self-reported attribution is ignored), so drill traffic is
  visible-and-excludable in the funnel and dropped from the v8.1 cohort read —
  while the workspace stays a real capped trial, because exercising the real
  path is the point.
- The `'drill'` label is **reserved**: `resolveMintSource` remaps any
  client-derived `'drill'` to `'drill-claimed'`, so a normal mint cannot
  self-select into the excluded bucket to suppress the counter-verdict (v8.3
  security review, MEDIUM — fixed before ship).
- The per-IP provisioning rate limit still applies to drill mints.
- Operational precondition (security review): set `HOSTED_DRILL_TOKEN` on the
  hosted instance only for the duration of a drill run and rotate after — a
  standing token is a standing Turnstile-off minting path (availability/cost
  only; all such mints are drill-labeled and trials auto-expire).

## The CLI fix this drill caught (v8.3, live)

The first-ever `drill:fresh-linux --as-root` run failed at DB provisioning:
embedded Postgres refuses to run as root, and CLI ≤0.7.4 didn't set
embedded-postgres's `createPostgresUser` escape hatch — so a fresh root VPS
(a common self-host shape) could never `up` with the embedded DB. Fixed:
`rootPostgresOptions()` in `cli/lib/up/db.js` sets `createPostgresUser: true`
when running as root on POSIX (no-op on Windows, where the elevated-token case
is already handled by the pg_ctl lifecycle). `@dashclaw/cli` 0.7.5.

## Acceptance evidence (roadmap §v8.3)

- **Both drills runnable by one command each**: `npm run drill:fresh-linux`,
  `npm run drill:fresh-windows`, `npm run drill:hosted` — all wired in
  package.json.
- **A green run of each recorded against the live surfaces**:
  - Linux drill: **PASS** live this session — `@dashclaw/cli@latest` → up →
    embedded Postgres → `/api/health` 200 → `POST /api/actions` 201 (guard
    `allow`, risk 20) in a fresh `node:20-bookworm` container.
  - Hosted drill: **6/6 PASS** live against a local hosted-mode prod build
    (mint→key→action→export→import→teardown). The live-hosted.dashclaw.io run
    is gated on `HOSTED_DRILL_TOKEN` being set on the hosted deploy env (an
    operator step, same shape as live-canary's secret-gated reporting).
  - Windows Sandbox drill: instrument built + staged; the cold fresh-boot run
    is the slow one (Node install + full `up` download chain).
- **One seeded break per drill demonstrably caught**:
  - Linux: `--as-root` surfaced the embedded-Postgres-refuses-root failure
    live (now fixed + unit-tested).
  - Hosted: a wrong `HOSTED_DRILL_TOKEN` → mint FAIL (Turnstile fail-closed),
    `DRILL_VERDICT FAIL` at the first step.
  - Windows: `--cli @dashclaw/cli@0.7.2` reproduces the VC++ break class.
- **Drill commands documented where the release ritual lives**: `scripts/
  drills/README.md`, the CLAUDE.md "Verify before you commit" section, and the
  `dashclaw-preship-sweep` workflow's `whenToUse`.

## Boundaries (stated, not hidden)

- The live-hosted stranger drill needs an operator to set (and rotate)
  `HOSTED_DRILL_TOKEN` on the hosted instance; until then the drill runs
  against a local hosted-mode build.
- macOS fresh-machine coverage is a recorded gap (no maintainer VM).
- Windows Sandbox availability (`WindowsSandbox.exe`) and Docker are drill
  preconditions; each drill exits 2 with enablement guidance when its host
  facility is absent.
