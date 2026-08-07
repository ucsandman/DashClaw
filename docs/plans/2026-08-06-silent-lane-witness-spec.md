# Silent-lane witness posture — spec

Status: **proposed** (roadmap open item, qualified under the (a) bar 2026-08-06)
Origin: v5.9.1 incident (maintainer log 2026-08-06, "a field agent files the first bug report")

## Incident and class

MoltFire (an OpenClaw agent under the DashClaw gateway plugin) ran a full
Codex work loop that produced **zero** ledger rows. The lane bypassed every
hook layer at once — OpenClaw's plugin bus and the vendored codex's inert
hook system — and the only detector was the operator eyeballing the ledger
and noticing silence. Silence was indistinguishable from idleness on every
existing surface.

The class: **an execution lane whose activity is visible to DashClaw in one
form, while no governance witness (guard evaluation or hook-stamped action)
arrives from it.** v8.2 answered "did the block actually stop execution?"
(verdicts by witness). This answers the prior question: "did governance see
the activity at all?"

## What is detectable — and what is not

A lane that never contacts the server in any form is undetectable
server-side; that residual is accepted and documented (seatbelt, not cage —
same privilege-boundary posture as script-then-execute §7). What IS
detectable is the **partially dark** shape, which is what the incident was
after the notify bridge landed and remains the common real-world shape:

- **Activity evidence** (witness-independent): action rows whose
  `metadata.source` is a self-report channel (`codex-notify`, SDK
  self-report), session lifecycle rows, heartbeats.
- **Governance witness**: `guard_decisions` rows for the agent;
  hook-attributed action rows (pretool/posttool provenance); enforcement-
  liveness probe runs on the agent's instance.

## Derivation (pure, mirrors `deriveEnforcementLivenessState`)

Per agent, over a trailing window `W` (default 60 min, env-tunable):

| Activity | Witness | State |
|---|---|---|
| present | present | `governed` |
| present | absent | **`recorded-ungoverned`** — the alarm state |
| absent | absent | `quiet` (no claim either way) |
| absent | present | `governed` (witness implies activity) |

`recorded-ungoverned` is a **posture, not a transient alert**: MoltFire's
embedded-codex lane is *correctly* in this state today and stays there until
OpenClaw vendors codex ≥ 0.142 and hooks arrive. The surface must say
"recorded but ungoverned," not cry wolf.

## Surfaces (HUMAN-EXPERIENCE contract)

1. **`/setup` enforcement-liveness panel** — one row per agent in
   `recorded-ungoverned` or `governed` state over the window: agent id,
   state, last activity source, last witness time. Render surface + click
   path: the existing liveness panel humans already read.
2. **Risk signal** — `lane_without_witness` joins the posture signal queue
   (`app/lib/posture/signals.ts`) the same way the v8.2 liveness signal
   does, so it reaches the signals feed and any wired notification
   destinations.

## Guardrails (F5)

- Informational posture only: never escalates the risk score of the agent's
  own actions, never blocks, never gates approvals.
- No new hook or agent-side work — derivation is entirely server-side from
  rows that already exist (`action_records.metadata.source`,
  `guard_decisions`, `enforcement_liveness_runs`).
- Windowing must tolerate clock skew and sparse traffic: one witness row
  inside `W` clears the state; absence of BOTH reads `quiet`, never alarm.

## Acceptance

- Unit tests on the pure derivation covering all four table rows plus
  boundary (witness exactly at window edge, activity with mixed sources).
- Fixture reproducing the MoltFire shape (notify-sourced `agent_turn` rows,
  zero guard rows) derives `recorded-ungoverned`.
- `/setup` renders the row with real data (frontend-verify, rendered proof —
  not just API tests).
- Docs: enforcement-boundary table gains a pointer from the embedded-codex
  row to this posture; CHANGELOG + maintainer log per ship discipline.

## Non-goals

- Detecting fully dark lanes (no server contact of any kind).
- Enforcement in the OpenClaw embedded-codex lane (tracked separately:
  upstream codex ≥ 0.142 vendoring).
- Historical backfill — the posture reads the trailing window only.
