# Enforcement liveness: the governor proves itself awake (roadmap v8.2)

Shipped 2026-07-06. Owner item: `docs/plans/owner-roadmap.md` §v8.2.

## Why

v4.72.1's shape, recorded plainly: every DashClaw installer wrote the pretool
hook `"timeout": 3600000` — milliseconds in a field Claude Code reads as
seconds. The harness timer overflowed int32, fired immediately, and cancelled
the hook on every tool call; cancellation is fail-open, so **every block and
approval-wait silently stopped enforcing for a week** while the killed hook
process lived just long enough to keep landing guard rows. The decisions page
looked perfect. The only detector that fired was the owner asking "how were
you able to write to those files?". This feature turns that question into an
instrument the system runs against itself.

## What ships

**The probe** — `hooks/enforcement_liveness_probe.py` (stdlib-only Python,
travels with the hooks it exercises; also `npm run liveness:probe`):

1. Discovers every installed DashClaw PreToolUse entry in
   `.claude/settings.json` (project + global, or `--settings`).
2. Reproduces the harness's hook contract around the real, unmodified hook —
   each clause verified against the actual harness during the v4.72.1
   incident: `timeout` is SECONDS (default 600); seconds×1000 past 2^31−1
   overflows the timer and cancels the hook instantly; exit 2 blocks; any
   other outcome (exit 0, other codes, cancellation) lets the tool proceed.
3. Drives a synthetic held action through the seam: a `Write` to a
   probe-owned `<witness-dir>/<run>/.env` path — sensitive-path +
   outside-workspace risk boosts, and a shape protected-path / risk-threshold
   policies match — as agent `smoke-liveness-probe` (the established
   synthetic marker; the probe rewrites the installed `--agent-id` flag,
   which otherwise beats env by design).
4. **Verdicts by the witness, never the ledger** (the ledger is exactly what
   lied in v4.72.1): exit 2 → the action is not executed → `held`. Anything
   else → the probe executes the Write exactly as the harness would have; the
   file's existence is the witness → `executed`. Runs the guard never held
   (no policy matches, observe mode, hook missing, hook hung) are
   `unprovable` — rendered broken, because enforcement you cannot prove is
   not enforcement. Ledger reads are used only to *label* a non-held verdict
   (allow vs seam-broke-above-guard), never to declare `held`.
5. Files the verdict to `POST /api/enforcement-liveness` →
   `enforcement_liveness_runs` — its own table, never
   `action_records`/`guard_decisions` (live-canary precedent), 30-day
   retention pruned on insert.

**Cadence** — the SessionStart digest hook spawns the probe detached at most
once per 12h (marker throttle, `DASHCLAW_LIVENESS_PROBE_DISABLED=1` kill
switch), so a governing instance proves its own seam every working day with
no new infrastructure. Also wired into installs: `scripts/install-hooks.mjs`
manages the probe file; the CLI ships it as an optional bundle file.

**The surfaces** — state is derived in one place
(`app/lib/enforcement-liveness.ts`): `holding` (latest verdict held, fresh),
`stale` (no run in 24h — a probe that silently stopped running is itself the
v4.72.1 failure shape and never renders green), `broken` (executed or
unprovable).

## HUMAN-EXPERIENCE answers

1. **Where does a human SEE it?** `/setup` — "Enforcement liveness" card
   (anchor `#enforcement-liveness`), directly under the live-canary card;
   and Mission Control → Posture Scorecard row "Enforcement Liveness". A
   broken/stale state also lands in `/api/posture` findings via
   `deriveEnforcementLivenessFinding` (broken = critical, capping-severity).
2. **Is it discoverable?** Both surfaces are places the operator already
   looks; the Mission Control row links to `/setup#enforcement-liveness`.
3. **Is every human step a CLICK?** The human's role is reading the state and
   following the named fix; the one command (`npm run liveness:probe`) is a
   maintainer-instrument invocation shown only in the never-run/stale empty
   state, consistent with the live-canary card. Routine cadence needs no
   human step at all (session-start auto-run).
4. **Was it verified rendered?** All three states driven on a local prod
   build (`next start -p 3001`) on 2026-07-06: stale/never-run rendered
   (warn, run-it action); seeded v4.72.1 config rendered broken/red with the
   overflow diagnosis; fresh held run rendered holding ("moments ago").
   Mission Control tile browser-verified the same day.

## Acceptance evidence (roadmap §v8.2)

- **Probe live on the governing instance**: run against the real installed
  hook (`C:\Users\...\.claude\settings.json`, timeout 3660) with the real
  guard — verdict `held` in ~1s: blocked by three real policies
  (extreme-risk ≥100 + protected-paths matched the `.env` target), witness
  absent, filed as `elr_0042af5e…` and `elr_b09e094a…`.
- **Seeded v4.72.1 break detected and rendered red**: the exact overflowed
  config (`timeout: 3600000`) seeded via `--settings` → verdict `executed`,
  witness file existed, `/setup` card flipped to fail-red with "Hook
  cancelled by the harness timer (overflowed timeout — v4.72.1 class)" and
  the fix instruction. Pinned forever by
  `hooks/tests/test_enforcement_liveness_probe.py::test_seeded_v4721_timeout_yields_executed`.
- **Real decision streams and /proof aggregates provably unpolluted**: probe
  verdicts live in `enforcement_liveness_runs` only. The one guard/action
  row each seam exercise necessarily creates is recorded under
  `smoke-liveness-probe`, which every aggregate already excludes via the
  shared synthetic patterns (posture, self-governance proof, calibration
  mining, funnel, coverage, tightening/loosening evidence). Blocks create no
  approval rows; a require_approval probe cancels its pending approval in
  teardown. Boundary stated honestly: the raw ledger keeps the
  smoke-labeled row as an audit trail — the same residue class the
  policy-smoke harness has always left (v7.3 precedent).
- **Docs + platform guide updated in the same ship**: this spec, the guide
  dataset (GET/POST /api/enforcement-liveness), route counts 336→337.

## Boundaries (stated, not hidden)

- The probe emulates the harness contract around the real hook; it does not
  drive a live Claude session (that would need an LLM key, which DashClaw
  setup never requires). Every emulated clause was verified against the real
  harness's observed v4.72.1 behavior, and the seeded regression test pins
  the arithmetic.
- Plugin-based hook installs (hooks.json inside a plugin, not settings.json)
  are not discovered; `--settings` covers nonstandard layouts.
- Settings are snapshotted at session start; the probe validates the on-disk
  config, which is what the *next* session arms.
- macOS/Linux: probe is plain Python + shell spawn; exercised on Windows
  (the governing instance). The v8.3 entry-path drills own cross-OS proof.
