# Approval calibration — the measured defect

Captured 2026-08-11. Reproduced locally against the shipped hook classifier and a
faithful replication of the server formula. No network, no DB, no speculation.

Owner context (confirmed 2026-08-11): live pack is **claude-code-starter, hand-edited**,
and the **100 is literal** — read off the card.

> **Revision note.** An earlier version of this document claimed two defects: that
> `max()` discards the classifier's earned downgrade, and that "destructive" is
> triple-counted into an automatic 100. Both were artifacts of a probe that omitted the
> `cleanup` remap at `hooks/dashclaw_pretool.py:474-480`. With the remap applied, the
> ordinary regenerable-delete path **already works correctly**. There is exactly one live
> defect, below. The corrected numbers are what follow.

## Status: FIXED (commit `1526b85`)

Both mirrors widened to accept a proper subtree of an allowlisted root, with the
traversal / absolute / home rejections made explicit and pinned. After the fix, the same
23-command probe puts **1** command in the >=80 interruption band, down from 4, and the
survivor is `git push --force-with-lease`. Gates: lint 0, typecheck 0,
vitest 451 files / 4364 tests / 0 fail, `next build` 0.

The rest of this document is the diagnosis that led there; the numbers below are the
BEFORE state.

## The finding in one line

`isRegenerableArtifactTarget` matches by **bare directory name**, so deleting a
*subdirectory* of a regenerable folder is graded more dangerous than deleting the
**whole** folder — a monotonicity violation that lands routine cache cleanup on 100.

## The evidence

Real `hooks/dashclaw_agent_intel/bash_classifier.py`, real action-type mapping including
the `cleanup` remap (`dashclaw_pretool.py:474-480`), server formula per
`app/lib/guard/risk.ts:63-71`:

| Command | action_type | client | server | **effective** | |
|---|---|---:|---:|---:|---|
| `npm run lint` | build | 30 | 25 | 30 | ok |
| `npx vitest run` | build | 35 | 25 | 35 | ok |
| `npx next build` | build | 35 | 25 | 35 | ok |
| `npm run db:migrate` | build | 30 | 35 | 35 | ok |
| `git status` | review | 5 | 10 | 10 | ok |
| `git show --format=%H` | review | 5 | 10 | 10 | ok |
| `cd /c/Projects/DashClaw && npm run lint` | build | 30 | 25 | 30 | ok |
| `gh pr create --fill` | other | 20 | 20 | 20 | ok |
| `git push origin main` | apply | 35 | 70 | 70 | ok |
| `rm -rf .next` | **cleanup** | 35 | 65 | 65 | ok — remap works |
| `rm -rf node_modules` | **cleanup** | 35 | 65 | 65 | ok — remap works |
| `rm -rf node_modules dist` | **cleanup** | 35 | 65 | 65 | ok — multi-target works |
| `rm -rf node_modules/.cache` | **security** | 100 | 100 | **100** | **BUG** |
| `rm -rf .next/cache` | **security** | 100 | 100 | **100** | **BUG** |
| `rm -rf ./dist ./node_modules/.cache` | **security** | 100 | 100 | **100** | **BUG** |
| `git push --force-with-lease origin main` | security | 100 | 100 | **100** | by design |

## The defect

Direct probe of the predicate:

```
_is_regenerable_dir_name('node_modules')        = True
_is_regenerable_dir_name('node_modules/.cache') = False    <-- the bug
_is_regenerable_dir_name('.next')               = True
_is_regenerable_dir_name('.next/cache')         = False    <-- the bug
_is_regenerable_dir_name('dist')                = True
_is_regenerable_dir_name('build')               = False    (deliberate, 2026-08-05 F5)
```

The allowlist is tested against the **bare name**, so any target containing a path
separator misses it. `is_regenerable_artifact_rm` then returns False, the `cleanup` remap
at `dashclaw_pretool.py:474-480` does not fire, and the command falls through to
`_INTENT_TO_ACTION["destructive"] = "security"` (base **80**) plus irreversible **+15**
plus the `rm\s+-rf` goal regex **+20** = 115, clamped **100**.

**Deleting `node_modules/.cache` is scored three times more dangerous than deleting all of
`node_modules`.** A strict subset cannot be more dangerous than its superset. That is the
whole bug.

Both mirrors carry it — `app/lib/guard/evidence.ts:107-112` (server) and
`bash_classifier.py:310-314` (client). Because the `max()` fold takes the **worse** of the
two labels (`risk.ts:193-198`), fixing one side changes nothing. Any fix lands in both, in
one commit, with paired golden vectors.

## What is NOT broken (do not "fix" these)

- **The `cleanup` remap.** Live and correct. Its comment already cites the 2026-07-03
  `rm -rf .next` hard-block incident it was written to fix.
- **Multi-target deletes.** `rm -rf node_modules dist` correctly caps at 65.
- **The blunt "unknown → 70" fallback** the recon flagged. Not reproduced —
  `gh pr create` and `docker compose up -d` score 20. Appears already fixed by the
  chain-splitting work at `bash_classifier.py:877-885`.
- **The 100 → block rail.** Working as designed; blocks are absolute by constitution.
- **`git push --force-with-lease` at 100.** Debatable (a lease is far safer than a bare
  `--force`) but out of scope; the synthesis rejected splitting it on arithmetic grounds.
- **"Missing human-intent input."** Real as a structural gap for unattended 3am runs, and
  the reason the tournament is still worth reading — but it is *not* what is interrupting
  the owner, and it costs vastly more than this fix.

## Dead code found in passing (separate change, not this fix)

- `systems_touched` is `['execution']` for Bash and `['file_io']` for file tools; neither
  matches `HIGH_RISK_SYSTEMS`/`MODERATE_RISK_SYSTEMS` (`risk.ts:20-21`), so the +10/+5
  system bumps never fire on the two commonest tool types.
- `_enrich_file` hardcodes `reversible: True`, so the +15 irreversible modifier can never
  apply to any Write/Edit/MultiEdit — including a write to a secret file.
- `docs/rfcs/2026-07-06-preflight-plan-authorization.md:3` says "Status: PROPOSED" though
  the feature is fully live.
- `hooks/README.md` documents a `session_tracker.py` intel dict that `dashclaw_pretool.py`
  never imports or emits.

## Still unverified — needs the owner's live policy rows

The owner reports **approving** at 100. Under an unedited pack a 100 is a **block**, which
is unappealable by constitution. He confirms the pack is hand-edited, which would explain
it, but nobody has read the actual `guard_policies` rows. Settle this before shipping any
policy-side change; it does not block the classifier fix, which is correct either way.

## Reproducing this

Probe: `<scratchpad>/calibration_probe.py`. Imports the real classifier, mirrors the real
action-type map **including the cleanup remap**, and replicates the server formula. It
should be promoted into `scripts/` if this work proceeds — any fix must be verified by
re-running it and diffing the table.
