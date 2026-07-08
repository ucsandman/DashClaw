# Prove the cull — design (2026-07-07)

**Approved by Wes 2026-07-07.** One night, the day after v5.0.0 ("the cull",
337→117 routes) shipped. Not a feature build: an execution night that ships the
pending first-run fix and demonstrates the three thesis-critical claims on the
post-cull build. Companion: THESIS.md (canonical), MAINTAINER.md §claims-proven-live.

## Goal

By end of night: v5 first-run fix shipped and live, and evidence exists that
(a) the entry door works on a factory-fresh machine, (b) every surviving
surface renders, (c) the hero loop (intercept → decide → approve → prove)
fires end-to-end with a real remote phone approval.

## Phase 0 — Ship the first-run fix

The uncommitted working tree is one coherent feature: `dashclaw up` prints the
admin password (previously swallowed — `runSetupScript` pipes and discards
setup.mjs's stderr, so the "printed once" password was never seen) and mints a
one-time sign-in token (`DASHCLAW_LOGIN_OTT`, 15-min expiry, single-use) so the
opened browser lands signed in. Files: `cli/lib/up/index.js` (+tests, CLI
0.8.0→0.8.1), `app/api/auth/local/route.ts`, `app/login/LoginClient.tsx`
(+`__tests__/unit/auth-local-ott.test.js`), `.env.example`, `README.md`.

Gates: lint / full vitest (3329 pass, 5 skip) / next build / typecheck — all
green 2026-07-07. Pre-release precondition: `drill:fresh-windows` (baseline,
distribution path) green. Then dashclaw-ship: commit, unified version bump,
CHANGELOG, maintainer log, push to main (Vercel deploys), GitHub Release (the
release tarball is what `dashclaw up` fetches — the platform half of the OTT
flow ships this way). **Credential-gated human step: `cd cli && npm publish`
(0.8.1).**

Degradation note: new CLI + old platform release = password prints, OTT link
falls back to the normal login form. Both halves ship tonight so the sandbox
proof exercises the full flow.

## Phase 1 — Entry doors

- Post-publish `drill:fresh-windows` re-run (`@dashclaw/cli@latest` now 0.8.1
  + new GitHub release) — automated distribution proof.
- `drill:hosted` against the deployed hosted trial.
- Wes's manual Windows Sandbox run: `npx dashclaw up` must print the admin
  password and open a browser that lands **already signed in**. This is the
  rendered human proof for the OTT feature (HUMAN-EXPERIENCE clause 6).

## Phase 2 — Rendered sweep

`frontend-verify` across every surviving page on a local production build
(`next start -p 3001`; dev server has the known spawn panic). Target class:
cull orphans — pages calling deleted routes, dead nav links, broken tiles,
console errors. Fix-on-find the same night; fixes fold into the ship.

## Phase 3 — Live hero loop

Venue: **my-dashclaw** (Wes's prod Vercel instance) — the real
"not at the keyboard" story on the deployed post-cull build. A local governed
agent attempts a destructive action → guard returns `require_approval` and
freezes → notification → Wes approves **from his phone** via the Approvals
inbox → action proceeds → signed (Ed25519) receipt visible in `/decisions`.
Evidence: receipt id + screenshots in the maintainer log; the run itself
recorded through DashClaw (self-governance).

## Sequencing

Pipelined: Phase 2 runs locally in parallel with Phase 0's drill/ship (sweep
owns :3001; drill owns Windows Sandbox; no shared resources). Phases 1 and 3
gate on the ship (publish + Vercel deploy respectively).

## Error handling

Any gate/drill failure stops the ship and is fixed on the spot (a drill
failure is a broken ship). If the hero loop is blocked by a cull casualty,
that is the night's highest-value find: fix → re-ship → re-run.

## Success criteria (verified, not asserted)

1. Sandbox run shows the password and a signed-in browser.
2. `drill:fresh-windows` (post-publish) and `drill:hosted` green.
3. Every surviving page renders clean (no console errors, no dead links).
4. Hero receipt exists in `/decisions` on my-dashclaw, approved from the
   phone, logged in the maintainer log.
