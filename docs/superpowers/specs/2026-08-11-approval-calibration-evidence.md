# Approval calibration — the measured defect

Captured 2026-08-11. Reproduced locally against the shipped hook classifier and a
faithful replication of the server formula. No network, no DB, no speculation.

Owner context (confirmed 2026-08-11): live pack is **claude-code-starter, hand-edited**,
and the **100 is literal** — read off the approvals card.

## The finding in one line

The hook classifier already scores routine destructive commands correctly and low.
**The server throws that answer away**, because `max()` can only take the higher number —
and then it counts "this is destructive" three separate times, guaranteeing a clamp to 100.

## The evidence

Realistic DashClaw dev commands, run through the real
`hooks/dashclaw_agent_intel/bash_classifier.py`, mapped to action_type by the real
`hooks/dashclaw_pretool.py:211-221`, then scored by the server formula in
`app/lib/guard/risk.ts:63-71`:

| Command | intent | action_type | client | server | **effective** | modifiers |
|---|---|---|---:|---:|---:|---|
| `npm run lint` | package_management | build | 30 | 25 | 30 | – |
| `npx vitest run` | interpreter | build | 35 | 25 | 35 | – |
| `npx next build` | interpreter | build | 35 | 25 | 35 | – |
| `npm run db:migrate` | package_management | build | 30 | 35 | 35 | goal:deployment+10 |
| `git status` | readonly | review | 5 | 10 | 10 | – |
| `git show --format=%H` | readonly | review | 5 | 10 | 10 | – |
| `cd /c/Projects/DashClaw && npm run lint` | package_management | build | 30 | 25 | 30 | – |
| `git push origin main` | write | apply | 35 | 70 | 70 | goal:deployment+10 |
| `git push --force-with-lease origin main` | destructive | **security** | 100 | 100 | **100** | irreversible+15, goal:deployment+10 |
| `rm -rf .next` | destructive | **security** | **35** | 100 | **100** | irreversible+15, goal:destructive+20 |
| `rm -rf node_modules` | destructive | **security** | **35** | 100 | **100** | irreversible+15, goal:destructive+20 |
| `rm -rf ./dist ./node_modules/.cache` | destructive | **security** | 100 | 100 | **100** | irreversible+15, goal:destructive+20 |
| `cat .env.example` | readonly | review | 5 | 25 | 25 | goal:secret+15 |

4 of 20 routine commands land in the interruption band. Three of them are deleting
build artifacts.

## Two distinct defects

### Defect 1 — the classifier's earned downgrade cannot reach the server

`rm -rf .next` is the proof. The client classifier does the right thing: it recognises
`.next` as a regenerable build artifact and applies `_REGENERABLE_RM_BASE`, scoring it
**35** (`bash_classifier.py:844-853`, a deliberate, commented, tested cap).

The server then computes 100 and `max(35, 100) = 100`
(`app/lib/guard/risk.ts:193-198`). The careful answer is discarded because it is the
*lower* one.

Trust rule D1 — "client input may only RAISE risk" — is correct for **unverifiable
claims**. But this is not a claim; it is a *classification of the literal command
string the server also has*. The rule is being applied to the one input that has
actually earned the right to lower a score. `rm -rf .next` and `rm -rf /` are
indistinguishable at the decision point.

### Defect 2 — one fact is counted three times

For any destructive command, "this is destructive" is scored three separate times:

| Term | Value | Source |
|---|---:|---|
| action_type `security` base | 80 | `_INTENT_TO_ACTION["destructive"] = "security"` (`dashclaw_pretool.py:214`) → `risk.ts:12` |
| `reversible: false` | +15 | `risk.ts:66` |
| `declared_goal` regex `rm\s+-rf` | +20 | `risk.ts:28,54` |
| | **115 → clamped 100** | |

The `declared_goal` the regex matches is `"Bash: <command>"` — the same command the
classifier already read. The server is re-deriving a conclusion it was handed, then
adding it to itself. **Every** destructive command clamps to 100, so the score carries
no information: `rm -rf .next` and `DROP TABLE users` are equal.

That is why the number on the card is always 100, and why it feels arbitrary.

## Why the earlier hypotheses were wrong or second-order

- **"Missing human-intent input"** (my first diagnosis) — structurally real for the
  unattended case, but it is not what is interrupting the owner. Fixing triple-counting
  costs a fraction of any intent-provenance subsystem.
- **"Blunt unknown → 70 fallback"** (recon hypothesis) — NOT reproduced on this command
  set. `gh pr create` and `docker compose up -d` classify `unknown` → `other` → 20, which
  is harmless. The golden-vector corpus records it firing historically; it appears already
  fixed by the chain-splitting work at `bash_classifier.py:877-885`. **Do not re-fix it
  without re-measuring.**
- **"The local DB proves there is no problem"** — the DB is an auto-provisioned demo org
  with zero recorded approvals. It is not evidence either way.

## Dead code found in passing (unrelated to the fix, worth a separate change)

- `systems_touched` is `['execution']` for Bash and `['file_io']` for file tools; neither
  matches `HIGH_RISK_SYSTEMS`/`MODERATE_RISK_SYSTEMS` (`risk.ts:20-21`), so the +10/+5
  system bumps never fire on the two commonest tool types.
- `_enrich_file` hardcodes `reversible: True`, so the +15 irreversible modifier can never
  apply to any Write/Edit/MultiEdit — including a write to a secret file.
- `docs/rfcs/2026-07-06-preflight-plan-authorization.md:3` says "Status: PROPOSED" though
  the feature is fully live.
- `hooks/README.md` documents a `session_tracker.py` intel dict that `dashclaw_pretool.py`
  never imports or emits.

## Reproducing this

The probe lives at
`<scratchpad>/calibration_probe.py`. It imports the real classifier, mirrors the real
action-type map and the real server formula, and prints the table above. It should be
promoted into `scripts/` as a permanent calibration probe if this work proceeds — any fix
must be verified by re-running it and diffing the table.

## Not yet decided

Nothing here is a fix. The four tournament designs (`2026-08-11-approval-calibration-tournament.md`)
were written before this measurement and all assume the problem is a missing signal rather
than a double-counted one. The judges' verdicts should be read against this evidence, and
the cheap fix should be evaluated first.
