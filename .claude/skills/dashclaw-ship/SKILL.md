---
name: dashclaw-ship
description: >-
  The single command that gets a DashClaw change ON MAIN AND LIVE — it resolves
  everything blocking production, never defers, and never hands back a checklist.
  Lands feature branches on main (rebase, gate, merge, push so Vercel deploys),
  bumps the unified platform+SDK version, and realigns every *description* of the
  system with the live code: README, PROJECT_DETAILS, SDK READMEs, /docs,
  generated artifacts (API inventory, OpenAPI, livingcode, the platform skill),
  plugins/skills/hooks/MCP, marketing/landing pages, the drift-prone hardcoded
  counts (routes, SDK methods, MCP tools/resources, guard policies) and stale
  freshness date-stamps. The one step it can't finish itself is the
  credential-gated SDK publish (`npm run release:sdks`). Use whenever the user
  wants to ship, land, or finish a change — get it on main, make it live, cut a
  release, bump the version, refresh all the docs, make everything accurate, fix
  wrong counts or old dates. Not for building or debugging the feature itself.
---

# dashclaw-ship — full accuracy sweep

After a feature lands in DashClaw, many *descriptions* of the system go stale:
generated artifacts, hand-authored docs, SDK READMEs, plugin/skill reference
narratives, and the marketing site. This skill brings all of them back in line
with the live code in one disciplined pass.

## The mission: GET TO MAIN AND LIVE — never defer

dashclaw-ship is the single command that resolves **everything** that could keep
a change off production, and then **lands it on main and ships it live**. It does
not stop at "the docs are accurate," it does not hand back a checklist, and it
never says "leave it for you to land." If something blocks main — a failing gate,
a stale count, an unbumped version, or a feature stranded on a branch — the job
is to *resolve that blocker and drive the code to main*, then confirm the deploy.
The accuracy sweep below is the *means*, not the end; stale docs are just one
blocker. The end state is: **our code is on main and the deploy is live.**

The one thing the skill genuinely cannot finish itself is the credential-gated
SDK publish (`npm run release:sdks` needs the owner's `npm login` + a PyPI token).
Everything else — gates, version bump, doc accuracy, **merging a feature branch
into main, and pushing** so Vercel deploys — the skill does end to end. Reduce
that one handoff to a single copy-paste line; defer nothing else.

**If the work is on a feature branch (not `main`), landing it is part of the
job** — rebase the branch onto the latest main, resolve any conflict (generated
files won't conflict once living-merge is installed), run the gates, then
fast-forward/merge into main and push. "I committed it to a branch" is *not
done*; "it's on main and the deploy is live" is done. (The only exception is an
explicit, still-in-force user instruction this session to hold a specific branch
back — honor that, but say so out loud; absent that, ship it.)

The whole job rests on one distinction:

- **Derived artifacts** are produced from the code by a generator. You **regenerate** them, never hand-edit. They usually self-heal via the pre-commit hook — your job is mostly to *verify* they're current.
- **Hand-authored surfaces** are prose, copy, and curated narratives a generator can't write. You **edit** these to add the new feature and fix stale facts.

Getting these backwards is the classic mistake (hand-editing a generated file that the next refresh overwrites, or expecting a generator to write marketing copy). The map below and `references/surfaces.md` keep them straight.

## First: what shipped, and what is true now

Before touching anything, pin down two things:

1. **What changed** — the feature(s) to propagate. Ask the user, or read recent `git log`/diffs. The sweep closes the gap between that code and its descriptions.
2. **The canonical facts** — every number *and date* you write into docs must come from its single source of truth, *read live this run*. Counts and freshness stamps rot, and **nothing in CI catches them** (`docs:check` validates only links + the Next.js version; `version:check` only the unified version literal). So the audit below is the *only* guard — **never hardcode a count, never trust a number this skill or your memory quotes, derive each one fresh**:
   - Route count + stable/beta/experimental breakdown → the summary header of `docs/api-inventory.md` (the generated truth).
   - SDK method counts (Node / Python) → `npm run sdk:count`.
   - MCP tool count + group count → `mcp-server/lib/tools.js` (count the `name: 'dashclaw_*'` entries and the distinct groups; they are hand-curated, so adding routes adds none).
   - MCP resource count → `mcp-server/lib/resources.js`.
   - Pre-built guard policies (the "N safety switches") → count the entries in `app/policies/lib/shields.js` (this one drifts silently — verify, don't copy the prose).
   - Unified platform+SDK version → the manifests (`package.json`, `sdk/package.json`, `sdk-python/pyproject.toml` share one number); `npm run version:check` confirms no drift.
   - Live API / table / MCP-tool shape → `python -m livingcode query ...` or `app/lib/doctor/generated/shape.json`.
   - **Today's date** (for the freshness stamps in Phase 3) → `Get-Date -Format yyyy-MM-dd` (PowerShell), or take it from the session's current-date context. You need a *real* current date so stamps advance to today, never to a guessed or remembered one.

## The workflow

### Phase 1 — Verify the generated pipeline (regenerate only if stale)

Most derived artifacts self-heal: the pre-commit hook runs `npm run livingcode:refresh` whenever `app/api/`, `app/lib/`, `schema/schema.js`, `middleware.js`, or `livingcode/` change, and `openapi`/`api-inventory` regenerate alongside. So after a normal feature merge they're usually already current. Verify with the read-only checks; regenerate only what fails:

| Check (read-only) | If it fails, regenerate with |
|---|---|
| `npm run openapi:check` | `npm run openapi:generate` |
| `npm run api:inventory:check` | `npm run api:inventory:generate` |
| `npm run version:check` | fix the hardcoded version (don't regenerate) |
| livingcode currency | `npm run livingcode:refresh`, then `git status` — staged generated diffs = it needed it; "unchanged" = already current |

**Generated set — never hand-edit** (regenerate instead): `app/lib/doctor/generated/*`, `public/livingcode/index.html`, the platform-intelligence `SKILL.md`, `mcp-server/lib/routes-inventory.generated.json`, the Python hook mirror under `plugins/dashclaw/hooks/`, and the `.zip`/`.manifest` bundles under `public/downloads/`.

### Phase 2 — Audit hand-authored surfaces for gaps

Generated artifacts cover the route/tool *shape*; they don't write prose, SDK READMEs, curated reference narratives, or marketing copy. Every hand-authored surface (`references/surfaces.md` has the full list) can drift in **three** ways — check all three, because none of them is machine-checked:

1. **Missing feature** — the shipped thing isn't described where it should be. Grep each surface for the feature; absent = a gap.
2. **Stale count** — a hardcoded number no longer matches its source of truth (Phase-1 "canonical facts").
3. **Old date** — a freshness stamp that should say "today" still says a past date.

For a large sweep, **fan out subagents** — one per surface domain — to map gaps in parallel and return a concrete work-list. Partition by **non-overlapping file groups** so parallel edits never collide.

#### Sweep the counts repo-wide (the #1 source of "I had to fix it by hand")

The same number is duplicated across README, both SDK READMEs, both reference narratives, `PROJECT_DETAILS.md`, and the landing/downloads pages — so a single feature can stale a dozen strings. After you read each fresh count in Phase 1, **grep the OLD number repo-wide** and reconcile every hit; assume you missed one until the grep comes back clean.

**Shortcut (if present): `node scripts/check-doc-counts.mjs`** reconciles the high-traffic counts (routes, SDK methods, MCP tools/resources, pre-built policies) and flags freshness stamps that predate their file's last commit — run it to catch the gated subset fast, then still hand-sweep the surfaces it lists as `UNCOVERED` (MCP "N groups", skill section counts, landing-page prose). CI runs it with `--strict`.

The counts that recur (and where they hide) live in `references/surfaces.md`; the dense offender is `README.md`, which alone hardcodes:

- route total + stable/beta/experimental (the "REST API" path),
- MCP tool count + group count + resource count (the "MCP server" path),
- Node + Python SDK method counts (the SDK path),
- the pre-built guard-policy / "N safety switches" count (the safety-model section),
- the governance-skill section count ("six new sections …").

#### UI discoverability gate — no feature ships invisible OR inoperable (an explicit step, every run)

The full contract is **`HUMAN-EXPERIENCE.md`** at the repo root — this gate enforces
it. The known agent failure mode: the schema, route, repository, and tests all ship,
but no human-facing surface renders the feature — it lands and *disappears* — or the
human's role in it is a copy-paste command instead of a button (the v4.33.0
calibration-mine incident: proposal review lived in a GitHub Actions summary with
copy-paste terminal commands; the operator rejected it). Docs mentioning it do not
count; a deep URL nobody links to does not count. For **each capability being
shipped this run**, answer four questions and treat a missing answer as a blocker to
resolve (add the surface/link/control), not a note:

1. **Render surface** — which page shows it? If the feature enriches an API response,
   name the component that renders the new data. "The API returns it" is not a surface.
2. **Click path** — how does a human get there from somewhere they already are (nav,
   sidebar, an existing detail view, a dashboard card)? If the answer starts with
   "paste this URL", add the link.
3. **Zero-terminal test** — walk the human's entire role for the feature end to end.
   Wherever their part is judgment (review/approve/ratify/tune/dismiss), it must be a
   button, toggle, or form in the product. Terminal commands + GitHub visits required
   of the human: **zero**, or the ship is incomplete. (CLI/API/MCP stay legitimate as
   secondary interfaces for agents and automation.)
4. **Rendered proof** — drive the page headless (frontend-verify) and confirm the new
   element actually appears with real data and its controls work. Unit/API tests prove
   data exists, not that anyone can see or use it.

An API/SDK-only capability is legitimate **only as an explicit recorded decision**
("no UI surface because X" in the spec or ship summary) — never as a silent default,
and even then the capability's existence must still be visible to humans somewhere
(docs page, marketing, /setup). The root `CLAUDE.md` carries the build-time twin of
this rule ("Definition of done includes a human-visible, human-operable surface");
this gate is the last net when that was missed.

#### Sweep the marketing site — an explicit step, every run (it's the one that gets skipped)

The marketing site is in-app (no separate repo) and it is **part of every ship**, not an
optional extra. It drifts in a way the count checker can't see: a shipped feature simply
*absent* from pages that claim completeness. Run this check explicitly:

1. **Grep the feature name across every marketing surface** — `app/page.tsx` (landing),
   `app/self-host/page.tsx`, `app/downloads/page.tsx`, `app/connect/page.tsx`,
   `app/guides/*` — and judge each zero-hit: a page that enumerates capabilities and
   omits a shipped major subsystem is a gap; a page where the feature is genuinely
   out of scope (e.g. a framework guide) is fine.
2. **The dead-array trap (burned us once; arrays removed in v2.6d):** `app/landingData.js`
   now exports ONLY the two rendered arrays (`frameworkQuickstarts` via
   `app/components/StackQuickstarts.tsx`, `signals` via `app/page.tsx`;
   `corePrimitives` was removed in the v4.57.1 landing redesign). All other landing
   feature lists are **inline arrays inside `app/page.tsx` itself** (e.g. the
   OPERATE_SURFACES control-room index) — put new capability copy there, never in a
   new landingData export. After any landing edit, verify with a grep that the
   feature name now appears in `app/page.tsx`.
3. **`/self-host` is NOT optional:** its "What you just deployed" grid says "the full
   governance API surface — every feature works out of the box," so a missing category
   card there is a false completeness claim. Add a card for any major new subsystem.
4. **Accuracy of every actionable string** (the operator's standing requirement —
   install paths and integration methods must be 100% right): each install command,
   package name + version pin, env var name, SDK method, MCP tool, and endpoint shown
   on these pages must match the code *on this branch*. Never write "(currently X)"
   published-registry version pins into prose — they stale at every publish.

#### Audit the dates — advance the living ones, never touch the historical ones

The user's standing rule is *no old dates anywhere* — but that means the dates that are **supposed to track now**, not the ones that anchor history. Get this backwards and you corrupt the record.

- **Advance to today** (only if you actually touched the doc this sweep): freshness stamps that assert "current as of." These are `last-verified:` front-matter (`PROJECT_DETAILS.md`, `docs/sdk-reference.md`, `docs/sdk-parity.md`), the `**N active routes** (verified <date>)` line in `references/api-surface.md`, and any "Last updated …" footer on a living doc (`.impeccable.md`, brand files). Pull the date from Phase 1 — a real current date, not a remembered one.
- **Never touch — these are historical anchors:** `CHANGELOG.md` release dates (`## [x.y.z] — <date>`), "shipped/landed on <date>" notes, git-history references, dates inside `.supergoal/`, `.organism/`, `docs/archive/AUDIT_FINDINGS.md`, memory, and other scratch/working files. A past date here is *correct*; rewriting it is the bug.
- **Code-level frozen clocks are a real bug, not a doc stamp:** a hardcoded `new Date('2026-..')` in app code (instead of `new Date()`) freezes countdowns/filters to that day. If your feature touched such a file, flag it — but it's a code fix, not part of the doc sweep.

When in doubt, ask: *does this date claim to describe the present, or to record the past?* Present → advance it. Past → leave it.

#### Two boundary gotchas to check explicitly

- **MCP tools are hand-curated** (`mcp-server/lib/tools.js` / `resources.js`), not route-derived — adding routes adds *zero* MCP tools. Verify rather than assume a new tool is needed.
- **Some "spend"/cost endpoints are repository functions, not SDK methods** (e.g. FinOps `/api/finops/spend` → `getFleetSpend`/`getClaudeCodeSpend`). They don't change SDK counts and must not be listed as SDK methods.

### Phase 3 — Update the hand-authored surfaces

Edit the gaps from Phase 2. `references/surfaces.md` is the file-by-file checklist. Three things that bite if missed:

- **Reference narratives are SOURCES, not generated.** `public/downloads/dashclaw-platform-intelligence/references/{api-surface,platform-knowledge,troubleshooting}.md` are hand-authored. Edit *these* — `livingcode:refresh` mirrors them into the plugin / `.claude` / `~/.claude` skill trees and rebuilds the zips. Editing the mirror copies is pointless (they get overwritten).
- **Marketing/landing copy obeys `.impeccable.md`** (read it first): direct, declarative voice; lucide-react icons; CSS tokens, never hardcoded hex; and the four anti-references. In particular, frame x402 / payments as **governed capability spend**, never crypto / web3 / wallet.
- **Keep counts sourced.** Write the numbers you read in "First", not numbers you remember.
- **Advance the stamp when you touch the doc.** If you edit a surface that carries a `last-verified:` / "verified `<date>`" / "Last updated" stamp (`PROJECT_DETAILS.md`, `docs/sdk-reference.md`, `docs/sdk-parity.md`, `references/api-surface.md`), bump that date to today's date from Phase 1 in the same edit — an unchanged stamp on a changed doc is itself a stale-date bug. Leave historical/CHANGELOG dates alone.

### Phase 4 — Mirror + rebuild bundles

After editing any reference source (or any generated-source path), run `npm run livingcode:refresh` to mirror the references into the plugin/project/global skill trees and rebuild the `.zip`/`.manifest` bundles. Then `git status` to see exactly what propagated.

### Phase 5 — Bump the unified version (check first, then do it)

DashClaw ships **one version** across the platform and both SDKs: `package.json`, `sdk/package.json`, and `sdk-python/pyproject.toml` must share the same number, enforced by `npm run version:sync:check` (CI + pre-commit) — and `contracts/sdk/release-plan.json` must carry that same number too (`npm run contracts:check` fails on drift, lines `node_release_plan_version_mismatch` / `python_release_plan_version_mismatch`). So the **version number itself still advances on every ship**, even a platform-only fix: you cannot bump the platform and leave the SDK manifests (or the release plan) behind. A bump is the norm.

**What is conditional is the *publish*, not the number.** Republishing both SDKs to npm + PyPI at every version — even when no SDK code changed — just burns a version number with no code delta. So an **SDK release is only cut when the SDK *source* actually changed this run.** Decide that here; you act on it in Phase 6.

Run this *before* the bump below, so the version-string churn from this run doesn't pollute the diff:

```bash
# Feature branch — diff the SDK source for the work being shipped:
git diff --name-only origin/main...HEAD -- sdk sdk-python
# Shipping accumulated commits straight on main — diff since the previous release
# commit (find it in `git log --oneline`: the last `release:` / version-stamped commit):
git diff --name-only <last-release-commit>..HEAD -- sdk sdk-python
```
(Tags are **not** a reliable anchor here — release tagging stopped at `v2.1.0` while the repo is on 4.x, so diff against the branch base / last release commit, not a tag.)

- **Real SDK source changed** (anything under `sdk/` or `sdk-python/` beyond the version line in the two manifests) → this release **republishes** the SDKs; the Phase 6 reminder applies.
- **Only platform / docs / generated artifacts changed** → the version advances but the SDKs are **not** republished. npm + PyPI stay at the last SDK release (non-contiguous versions are fine; the root self-dep `^4.x` still resolves to the last published 4.x). Record this in `release-plan.json` (below).

**Then check whether a bump is actually owed**, so you don't double-bump: the feature you just swept for may already have bumped the version in its own commit. Compare the working tree against what's published:

```bash
node -p "require('./package.json').version"   # current unified version (the three manifests)
npm view dashclaw version                       # last version published to npm
```

- **Manifest === published** → the new work is unreleased at the already-published number, so it owes its own bump. Do it.
- **Manifest > published** → a bump is already staged for this release; just confirm `contracts/sdk/release-plan.json` and the CHANGELOG agree with it, then skip to the release reminder in Phase 6.

When a bump is owed, pick the increment from what shipped, and say which you chose and why:

| What shipped | Increment |
|---|---|
| Breaking SDK API change (renamed/removed method, changed signature) | **major** `x+1.0.0` |
| New SDK method / route / subsystem (additive) | **minor** `x.y+1.0` |
| Platform-only fix, hardening, or a docs/accuracy sweep with no new public surface | **patch** `x.y.z+1` |

Apply it across all three manifests at once — never hand-edit one — then re-lock:

```bash
npm run version:set -- <x.y.z>   # rewrites the three manifests together
npm install                       # re-syncs package-lock.json at the new number
```

Then bring the two hand-authored version carriers in line:
- **`contracts/sdk/release-plan.json`** — set `current_version` for *both* `node` and `python` to the new number (this is **required even when the SDK didn't change** — `contracts:check` fails if it ever drifts from the manifests), leave `next_bump: "none"`, and write a one-line `reason` that **states whether the SDK actually changed**: for a platform-only ship say so explicitly (e.g. "no Node/Python SDK source change — version advances per the unified model but the SDKs are NOT republished; registry stays at `<last published>`"), and set `domains: ["platform"]`. When SDK code did ship, describe it and include the SDK domains. (A recurring "bump SDK release plan to match manifests" commit exists precisely because the version field here is easy to forget.)
- **`CHANGELOG.md`** — rename the `## [Unreleased]` block to `## [<x.y.z>] — <date>` (with `### Added/Fixed/Security` as fit), and open a fresh empty `## [Unreleased]` above it.

Verify the bump is clean and **read the output** — both gate the build:
```bash
npm run version:sync:check   # the three manifests agree
npm run version:check        # no version hardcoded into docs/CLAUDE.md (UI strings derive from the manifests via next.config.js)
```

**Major-bump trap:** the repo root depends on its own published SDK (`"dashclaw": "^4.0.0"`). A patch/minor stays inside that caret range, so `npm install` is enough. For a **major** bump the new SDK isn't on npm yet — leave the self-dep pointing at the OLD major until `release:sdks` has actually published, or `npm ci` in CI fails on a lockfile it can't resolve. Grep the repo for any removed methods before raising the self-dep across a major.

The **plugin bundle and CLI version independently** (`plugins/dashclaw/.claude-plugin/plugin.json` and the CLI manifest) and are deliberately outside the sync check — bump those only if the plugin or CLI itself changed.

### Phase 6 — Gate, land on main + live, then hand off the SDK publish

A push is its own step — run and **read the output**, don't assert success:

- `npm run lint`
- `npx vitest run` — the **full** suite (targeted runs miss regressions in unrelated files; a transient flake in the approval-flow CLI test is known — re-run to confirm)
- `npx next build` — for any change under `app/**`
- `npm run route-sql:check` — if any route changed

Then commit + push to `main` with an **explicit pathspec — never `git add -A`**. Include the bumped manifests, `package-lock.json`, `contracts/sdk/release-plan.json`, and `CHANGELOG.md` in the same commit as the doc updates. Long-standing other-session files live uncommitted in the working tree (`.impeccable.md`, `DESIGN.md`, `PRODUCT.md`, stray `docs/` specs); sweeping them in is a hygiene violation. The pre-commit hook will re-run `livingcode:refresh` and stage generated artifacts — that's expected; let it ride.

**Then land it on main — this is the point, not a follow-up.** If the commit went onto a feature branch, get it to `main` now: rebase the branch onto the latest `origin/main` (generated files won't conflict once living-merge is installed; resolve any *authored* conflict), re-run the gates if the rebase pulled in new commits, then fast-forward/merge the branch into `main` and `git push origin main`. A push to `main` is what fires the Vercel production build (`vercel.json` buildCommand), so **confirm the deploy goes green** rather than assuming — watch it, or ask the user to — and only then is it live. Never end with a "here's how to land it" checklist; stopping at the branch is the exact failure mode this skill exists to kill.

**Then cut the GitHub Release — every ship, no exceptions (v6.1 rule, 2026-07-05).** Releases silently stopped between v4.20.1 and v4.59.0 and the public repo looked dormant through the project's fastest era; this step exists so that can't recur. After the push lands: `git tag -a v<x.y.z> <release-commit-sha> -m "v<x.y.z> — <title>"`, `git push origin v<x.y.z>`, then `gh release create v<x.y.z> --title "v<x.y.z> — <title>" --notes-file <notes> --latest`. Notes come from the CHANGELOG entry for the version (plus links to the maintainer log / spec when the ship warrants), and per the charter's outward-acts clause they identify the AI maintainer honestly. Use the real SHA from `git rev-parse` — never reconstruct one from a short hash.

**Finally, the SDK publish — conditional on the Phase 5 diff.** `npm run release:sdks` builds and uploads both packages to npm + PyPI and needs the owner's `npm login` + a PyPI token, so it's outside this skill's reach either way. Whether you prompt it depends on whether the SDK source changed this release:

- **SDK source changed** → after the push lands, surface a clear one-liner so the owner publishes:

  > Bumped to `<x.y.z>` and pushed. The SDK changed this release — run `npm run release:sdks` to publish the Node + Python SDKs to npm + PyPI (owner-only — needs `npm login` + a PyPI token). It's idempotent: any version already on the registry is skipped, so a re-run is safe.

- **No SDK source change** (platform / docs only) → do **not** nudge a publish. Say so instead, because holding the SDKs at their last release is the correct outcome — republishing identical code at a new number is exactly the churn this avoids:

  > Bumped to `<x.y.z>` and pushed (platform/docs only — no SDK source change, so the Node + Python SDKs are intentionally **not** republished; npm + PyPI stay at `<last published>`).

This conditional also governs the case where Phase 5 found the bump was already staged: surface the publish reminder only if that staged release actually carried SDK source changes. (`release:sdks` is idempotent, so running it when nothing changed is harmless — but don't reflexively prompt it; the point is to stop cutting empty SDK releases.)

## Running it at scale (recommended for a full sweep)

Drive Phases 2–3 with parallel subagents, the way the reference sweep did:

1. **Audit workflow** — N read-only agents, one per surface domain (generated-pipeline, plugin/MCP/hooks, docs/SDK, marketing/landing), each returning a structured `{auto_generated[], hand_authored_gaps[]}` work-list.
2. **Update workflow** — one implementer per **non-overlapping file group**, each handed the canonical facts + the `.impeccable` framing + its exact file list, followed by an adversarial reviewer that re-checks the facts (counts, no-crypto framing, no hardcoded hex) and that nothing unrelated changed.
3. Then Phases 4–6 in the main session — mirror the bundles, decide and apply the version bump, read the gate output yourself before pushing, and surface the `release:sdks` reminder.

## What "all of it" maps to

| User says | Reality |
|---|---|
| plugins / skills / hooks / livingcode / MCP server | **Mostly generated** — verify current (Phase 1); the only hand-authored pieces are the `references/*.md` sources (Phase 3) and the curated MCP tool/resource list (rarely changes) |
| connectors | Plugin manifests / `.mcp.json` / `hooks.json` enumerate no per-feature routes — usually no change; verify |
| docs | Hand-authored: `PROJECT_DETAILS.md`, `README.md`, `app/docs/page.js`, `docs/sdk-reference.md`, `docs/sdk-parity.md`, `sdk/README.md`, `sdk-python/README.md`. `README.md` is the densest — it hardcodes route, MCP-tool/group/resource, SDK-method, and guard-policy counts; sweep all of them |
| "no old dates" / "nothing stale" / "make everything accurate" | The two classes CI doesn't catch (Phase 2): every hardcoded **count** (grep the old number repo-wide, reconcile every hit) and every **freshness date-stamp** (advance the living ones to today, never touch CHANGELOG / history dates) |
| marketing site | In-app, no separate repo: `app/page.tsx`, `app/landingData.js`, `app/downloads/page.tsx`, `app/self-host/page.tsx`, `app/connect/page.tsx`, `app/guides/*` — an **explicit Phase-2 step every run** (see "Sweep the marketing site"), checking feature *presence*, the landingData dead-array trap, the `/self-host` completeness grid, and install-path accuracy |
| API inventory / OpenAPI | **Generated** — verify with the `*:check` commands |
| cut a release / bump the version | Unified platform+SDK number via `npm run version:set` + `contracts/sdk/release-plan.json` + `CHANGELOG.md` (Phase 5). The version number always advances; the SDK **publish** (`npm run release:sdks`, Phase 6) is reminded **only when the SDK source actually changed** this release — a platform-only ship bumps the number but does not republish the SDKs |

Full per-file detail, the SDK-doc checklist, and the canonical-fact sources are in **`references/surfaces.md`** — read it during Phase 2/3.
