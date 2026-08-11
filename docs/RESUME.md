# RESUME — approval calibration work (paused 2026-08-11, power outage guard)

**Status: nothing was built. No file in this repo was edited.** This session was
analysis plus one background tournament that was still running when work stopped.

Git: branch `main`, clean, up to date with `origin/main`, HEAD `38d7c2d9`.
The requested `wip: power outage guard` commit was run and exited 1 —
"nothing to commit, working tree clean". There is no lost work in the tree.

---

## What I was doing

Wes: *"Too often I'm approving commands I asked the agent to run that are risk
score 100."* The ask was to perfectly calibrate allow / require_approval / block
using the agent's intent, and to run a subagent tournament to solve it.

I read the guard engine, found the root cause, and launched a 13-agent
tournament to design the fix. The tournament had not reported back yet.

## The root cause (verified in source — this is the real work product)

The guard scores the **shape of a command** and has **no input for who wanted it**.

| Fact | Evidence |
|---|---|
| Risk = action-type base score + regex hits on the goal string | `app/lib/guard/risk.ts:11-69` |
| Base scores: `security` 80, `deploy` 75, `migrate` 70, `apply` 60, `cleanup` 30 | `risk.ts:11-16` |
| Modifiers: irreversible +15, prod/db systems +10, destructive regex +20, secret regex +15, deployment regex +10 | `risk.ts:39-58` |
| Client, org template, and evidence scores fold in with `max()` — risk can only go **up**, never down (trust rule D1) | `risk.ts:87-94`, `risk.ts:193-198` |
| `GuardEvalContext` has **no field** for human intent, request provenance, or operator presence | `app/lib/guard/types.ts:12-68` |
| Default pack: `risk_threshold: 100 -> block`, `protected_path -> require_approval` on `.env`/secrets/`*.pem`/`*.key`, rate limit warn-only | `app/lib/guardrails/packs/catastrophe-only/policies.yml` |
| Downgrade seams already exist and are tested — `applyAllowGrants` (~297), operator-approval post-pass (~379, exact `declared_goal` + 15 min), plan-grant consumption (~439-531) | `app/lib/guard/evaluate.ts` |

**Consequence:** `rm -rf ./dist` that Wes asked for ten seconds ago and
`rm -rf ~/.config` invented by a runaway agent at 3am both compute to
`security` 80 + irreversible 15 + destructive 20 = clamped **100**. Identical
inputs, identical decision. That is the miscalibration.

**The hard constraint any fix must beat:** the signal "the human asked for this"
is normally carried by the very agent being governed. Rule D1 says client input
may only raise risk. So a naive "agent, tell us the user approved" field is a
prompt-injection escape hatch. The fix must capture provenance out-of-band,
bind it cryptographically, or bound the blast radius — see
`docs/architecture/trust-and-failure-model.md` (D1).

## Files touched

**None.** Reads only: `app/lib/guard/risk.ts`, `app/lib/guard/types.ts`,
`app/lib/setup/catastrophe-pack.mjs`,
`app/lib/guardrails/packs/catastrophe-only/policies.yml`, `THESIS.md`,
plus greps over `app/lib/guard/evaluate.ts`.

This file (`docs/RESUME.md`) is the only new file, and it was written after the
commit above, so it is **uncommitted**.

## The tournament that was in flight

- Run ID: `wf_e470067d-b7b`
- Script (persisted, re-runnable): `C:\Users\sandm\.claude\projects\C--Projects-DashClaw\5fd17525-d630-4d91-bbfa-a9951fe451cc\workflows\scripts\approval-calibration-tournament-wf_e470067d-b7b.js`
- Transcripts + results: `C:\Users\sandm\.claude\projects\C--Projects-DashClaw\5fd17525-d630-4d91-bbfa-a9951fe451cc\subagents\workflows\wf_e470067d-b7b\`
- At pause: 8 agent transcripts on disk, `journal.jsonl` at ~90 KB. The journal
  records each agent's actual return value, so recon and design output is
  recoverable even though the run did not finish.

Shape: 4 recon (sonnet) → 4 competing designs (opus: intent provenance /
attendance x blast radius / closed-loop learning / task envelope) → 4
adversarial judges (opus: efficacy, security, thesis + anti-sprawl,
shipability) → 1 architecture synthesis (fable).

`resumeFromRunId` is same-session only, so after a restart the run cannot be
resumed — re-run it fresh from the script path. Read the journal first; it may
already hold everything the designs phase produced.

## Next step

1. Read `journal.jsonl` in the transcript dir above. If the recon and design
   phases completed, harvest them and skip straight to judging.
2. Otherwise re-run the tournament from the persisted script.
3. Output should be a decision doc, not code: new decision function, trust
   argument vs D1, admitted false negatives, five-scenario table, slice-1 plan.
   Nothing gets built until Wes approves the design.

## Exact command to continue

```bash
# 1. recover whatever the tournament already produced
cat "C:/Users/sandm/.claude/projects/C--Projects-DashClaw/5fd17525-d630-4d91-bbfa-a9951fe451cc/subagents/workflows/wf_e470067d-b7b/journal.jsonl"
```

Then in Claude Code, to re-run the tournament unchanged:

```
Workflow({scriptPath: "C:\\Users\\sandm\\.claude\\projects\\C--Projects-DashClaw\\5fd17525-d630-4d91-bbfa-a9951fe451cc\\workflows\\scripts\\approval-calibration-tournament-wf_e470067d-b7b.js"})
```

To commit this handoff:

```bash
git add docs/RESUME.md && git commit -m "docs: resume note for approval calibration work" --no-verify
```

## Risks / notes

- Nothing is half-built. There is no broken state to clean up.
- The tournament burned tokens across ~8 agents with no synthesis delivered.
  Harvest the journal before re-running so that spend is not repeated.
- ~4 Claude Code sessions were active on the shared rate limit at pause time.
