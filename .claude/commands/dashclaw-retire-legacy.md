---
description: Officially retire the published dashclaw/legacy Node SDK the safe way — deprecate now, delete at v5 — without breaking external npm consumers. Drives the legacy-sdk-deprecation-sweep workflow.
argument-hint: "[deprecate (default) | remove]  — 'remove' is the v5 breaking milestone"
---

# Goal: retire the legacy SDK without breaking anyone

`dashclaw/legacy` is a **published npm subpath** (`./legacy` in `sdk/package.json` exports + files; it ships in the tarball). External integrations can `import 'dashclaw/legacy'` today, so it **cannot be silently deleted** — every release republishes the npm package at the unified version, so a delete would land in the next patch and break those users with no major signal. Retirement is therefore two milestones:

- **`deprecate`** (now, default) — announce the retirement, keep it working.
- **`remove`** (later, at the v5 major) — delete it as a breaking change.

`$ARGUMENTS` selects the phase (default `deprecate`). This command authorizes the **Workflow** tool (`legacy-sdk-deprecation-sweep`, mode = the phase).

---

## Phase: `deprecate` (run this now)

1. **Run the workflow** in deprecate mode: `Workflow({ name: "legacy-sdk-deprecation-sweep", args: { mode: "deprecate", removalVersion: "5.0.0" } })`. It audits every live `dashclaw/legacy` reference, then in parallel: adds a one-time runtime deprecation `console.warn` (opt-out via `DASHCLAW_SUPPRESS_LEGACY_WARNING=1`) + `@deprecated`, marks every doc/parity surface "removed in v5.0.0", reconciles the drifting method counts (178/187/224), repoints the doc example onto canonical, edits the reference **sources** (not mirrors), closes the `.organism` split-the-file backlog, and adds a CHANGELOG `### Deprecated` entry.

2. **Trust nothing — re-read the diffs.** Confirm the deprecation markers landed AND, critically, that **`sdk/legacy/` and the `./legacy` export + `files` entry are UNTOUCHED** — deprecate must not remove the published contract. A `console.warn` is the only behavior change to the legacy code itself.

3. **Prove the export still works:** `npm pack --dry-run` (inside `sdk/`) must still list `legacy/dashclaw-v1.js` + `legacy/index-v1.cjs`, and the two legacy regression tests must still pass (a `console.warn` doesn't fail them).

4. **Mirror the reference sources:** `npm run bundles:refresh` (the deprecation edits touched `public/downloads/dashclaw-governance/references/*.md`), then `git status` to see what propagated.

5. **Full gate, read the output:** `npm run lint` · `npx vitest run` (full) · `npm run build` (webpack) · `npm run version:sync:check` · `npm run version:check` · `npm run openapi:check` · `npm run api:inventory:check`.

6. **Ship** unless `$ARGUMENTS` says `no-ship`: hand to **`/dashclaw-ship`**. This is **non-breaking** — a deprecation notice, no public surface removed → a **patch** bump. (Don't bump to a major here; the major is the removal.)

7. **Record the removal as a tracked follow-up — NOT a scheduled date.** Removal is gated on the **v5 major**, an event, not a calendar date, so don't `/schedule` it to a guessed day. Instead leave the trigger in the code+docs (the CHANGELOG `Deprecated` line and the runtime warning both name v5.0.0), and tell the operator: *"when you cut v5, run `/dashclaw-retire-legacy remove`."*

---

## Phase: `remove` (run this at the v5 major — breaking)

1. **Run the workflow** in remove mode: `Workflow({ name: "legacy-sdk-deprecation-sweep", args: { mode: "remove", removalVersion: "5.0.0" } })`. It deletes `sdk/legacy/`, removes the `./legacy` export + `files` entry, deletes the two legacy tests, scrubs every doc/parity surface, and adds a CHANGELOG `### Removed` (BREAKING) entry.

2. **Trust nothing — re-read the diffs.** Confirm `sdk/legacy/` is gone, the export + `files` entry are removed, both tests are deleted, and no live importer remains (`grep -r dashclaw/legacy` comes back clean except historical CHANGELOG).

3. **Major-bump self-dep trap.** The repo root depends on its own published SDK (`"dashclaw": "^4.x"`). For a **major**, the new 5.0.0 SDK isn't on npm yet — leave the self-dep in the `^4.x` range until `release:sdks` has published 5.0.0, or CI `npm ci` fails on an unresolvable lockfile. Grep for any removed legacy method used outside the deleted tests before raising it.

4. **Full gate** (as in deprecate step 5) + confirm `grep` is clean.

5. **Version: major bump to 5.0.0** — `npm run version:set -- 5.0.0` then `npm install`; CHANGELOG `## [5.0.0]` with the `### Removed (BREAKING)` note; `contracts/sdk/release-plan.json` updated (reason = legacy removal).

6. **Ship** via **`/dashclaw-ship`** (major), then the owner runs `npm run release:sdks`.

---

## Guardrails (both phases)

- **The published contract is the binding constraint.** In `deprecate`, never remove the export or the code. In `remove`, the breaking change rides a **major** only.
- **Edit reference SOURCES, never mirrors** — `public/downloads/dashclaw-governance/references/*.md`; `bundles:refresh` mirrors them.
- **Never rewrite historical CHANGELOG entries** — add a new one.
- **No PRs** — commit to `main` (that's the ship path here).
- **Git is the archive.** Don't copy the code to a backup folder; deletion is fully recoverable from history.

## Report at the end

One compact summary: mode, references audited, what **landed** (one line each), what was **deferred** and why, whether the published export is intact (deprecate) or cleanly gone (remove), and the next milestone (`remove` at v5) or the `release:sdks` reminder (after remove). No log walls.
