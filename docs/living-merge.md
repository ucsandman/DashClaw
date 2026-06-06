# living-merge

Run multiple Claude Code sessions in parallel worktrees, all pushing to `main`,
without ever conflicting on generated files. Generated files are **projections of
source** — they are never hand-merged, they are **regenerated**. living-merge
makes git treat them as non-conflicting and re-derive them on every landing, so
`main` is always self-consistent regardless of merge order. Your hand-written
files stay protected: if two sessions edit the same authored file, you get a
factual heads-up.

## One-time setup (per clone or worktree)

`npm install` runs this automatically via the `prepare` script. To run it
explicitly (or after `npm ci --omit=dev`, which skips devDeps):

```bash
npm run living-merge:install     # node --import tsx scripts/living-merge/install.ts
```

> ⚠️ **Until install has run on a clone/worktree, the merge driver is not
> registered.** A merge or pull touching a generated path would then fall back
> to git's built-in 3-way merge and CAN write conflict markers into a generated
> file — the exact failure this feature prevents. Run `npm install` (or the
> command above) before your first merge. `npm run living-merge:check` verifies
> it's active (exit 1 = not installed yet).

Idempotent (a second run reports `0 changed`). It configures the things git and
Claude can't carry in committed files:

1. **`merge.regenerate.driver`** — registers the no-op merge driver.
2. **`core.hooksPath` → `.husky`** — normalizes the repo's hooks path to a
   *relative* value so **each worktree runs its own committed hooks** (the repo
   otherwise pins an absolute path to the main checkout).
3. **`.gitattributes` managed block** — regenerated from `manifest.ts` (this part
   is committed and travels with the repo; the driver above makes it take effect).
4. **SessionStart hook** — in the gitignored `.claude/settings.json`, runs the
   cross-worktree overlap signal.

`--check` reports drift without writing (exit 1 if anything would change).

## Daily flow

```bash
# start of work: get onto the latest main, regenerate projections
node --import tsx scripts/living-merge/rebase-onto-main.ts

# ... do your work in this worktree ...

# right before landing: rebase onto main again, regenerate, then commit + push
node --import tsx scripts/living-merge/rebase-onto-main.ts
git commit -am "..."   # generated files are already staged & correct
git push
```

You never hand-merge a generated file. If a rebase/merge touches one, the
`merge=regenerate` driver keeps one side (no conflict markers) and the
post-merge / post-rewrite hook immediately re-derives it from the merged source.

## The pieces

| File | Role |
| --- | --- |
| `scripts/living-merge/manifest.ts` | **Single source of truth** — the exact set of generated paths + `isGenerated()`. Everything else reads this. |
| `scripts/living-merge/regenerate-all.mjs` | The "regenerate everything from source" entry point = `generate-api-inventory` + `generate-openapi` + `livingcode:refresh`. Idempotent. |
| `scripts/living-merge/merge-driver.mjs` | The `merge=regenerate` driver: keeps the target side, exit 0 → never writes conflict markers. |
| `.husky/post-merge`, `.husky/post-rewrite` | Re-derive projections after any merge (incl. fast-forward / `pull`) or rebase / amend. |
| `scripts/living-merge/rebase-onto-main.ts` | Rebase the current branch onto main + regenerate + stage (start-of-work and pre-landing). |
| `scripts/living-merge/overlap-signal.ts` | SessionStart hook: surfaces AUTHORED-file overlap with other active worktrees as factual context (generated files filtered out). |
| `scripts/living-merge/install.ts` + `prepare.mjs` | Idempotent setup (above); `prepare.mjs` auto-runs install on `npm install`. |
| `scripts/living-merge/selftest-merge.ts` | Automated proof: divergent generated-file merge → no conflict markers → self-heals. |
| `scripts/living-merge/selftest-overlap.ts` | Automated proof: overlap signal fires for an authored co-edit, silent for a generated one. |

## Generated vs authored (the boundary)

The merge=regenerate set is **only** true projections (doctor shape, MCP
inventory, living dashboard, the platform-intelligence `SKILL.md` + bundle zips +
plugin skill/hook **mirrors**, and the `docs/` api-inventory + openapi). It
deliberately **excludes** everything hand-written — SDKs, the CLI, plugin
manifests, the canonical `hooks/` source, the authored `references/`+`scripts/`
under each skill, lockfiles, and `.claude/CODEBASE_MAP.md`. Marking any of those
`merge=regenerate` would silently discard hand edits, so they stay protected and
a co-edit raises the overlap signal instead. See `manifest.ts` for the exact
list; `__tests__/unit/living-merge-manifest.test.ts` guards the boundary.

## Limitations (known, by design)

- **Fast-forward merges / `git pull` (FF)** don't create a merge commit and so
  don't fire `post-merge` — generated files aren't auto-regenerated. Landing
  goes through `rebase-onto-main.ts` (which regenerates), and a FF pull of an
  already-consistent main needs none, so this is safe in the intended flow.
- **`git cherry-pick`** doesn't fire `post-merge`/`post-rewrite`. The driver
  still prevents conflict markers, but run
  `node scripts/living-merge/regenerate-all.mjs` afterward if the cherry-pick
  touched source.
- **modify/delete conflicts** on a generated path (one side deletes it, the
  other modifies it) resolve at git's tree level *before* the merge driver runs,
  so they surface as a normal conflict needing human resolution. This is rare
  (it means a generator was removed on one side) and is intentionally left to you.
- If a regenerate **fails** inside a hook (e.g. Python/livingcode not on PATH),
  the hook exits non-zero and prints the error. The merge already happened, so
  fix the toolchain and re-run `regenerate-all` to refresh the projections.

## Reverting

```bash
git config --unset merge.regenerate.driver
git config --unset merge.regenerate.name
# restore the previous hooks path if you want the pre-living-merge behavior:
git config core.hooksPath <previous-value>   # e.g. an absolute path, or --unset
```

The `.gitattributes` block and `.husky/post-*` hooks are committed; remove them
with a normal commit if you want to fully back the feature out.
