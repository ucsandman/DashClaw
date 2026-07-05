# DashClaw surface inventory

The exhaustive map for `dashclaw-ship`. Read during Phase 2 (audit) and Phase 3
(update). Paths are repo-relative to `C:\Projects\DashClaw`.

## Canonical fact sources (read live — never hardcode)

| Fact | Source of truth | How to read |
|---|---|---|
| Route count + stable/beta/experimental split | `docs/api-inventory.md` | summary header (`Total N / X stable / Y beta / Z experimental`) |
| SDK method counts (Node / Python) | the exported `DashClaw` class | `npm run sdk:count` |
| MCP tool count + group count | `mcp-server/lib/tools.js` | count the `name: 'dashclaw_*'` entries + distinct groups (hand-curated; new routes add none) |
| MCP resource count | `mcp-server/lib/resources.js` | count the resource entries |
| Pre-built guard policies ("N safety switches") | `app/policies/lib/shields.js` | count the entries (drifts silently — the README prose is already behind) |
| Platform + SDK version (one shared number) | `package.json`, `sdk/package.json`, `sdk-python/pyproject.toml` | `npm run version:check` |
| Live route / table / MCP-tool shape | livingcode shape | `python -m livingcode query ...` or `app/lib/doctor/generated/shape.json` |
| Today's date (for freshness stamps) | the clock | `Get-Date -Format yyyy-MM-dd`, or the session current-date context |

These numbers appear on MANY surfaces. When one changes, grep the OLD number
repo-wide before assuming you found every copy. **Nothing in CI reconciles them**
— `docs:check` only validates links + the Next.js version, `version:check` only the
unified version literal — so this sweep is the sole guard against count/date drift.

## Generated artifacts (regenerate — never hand-edit)

| Path | Generator | Read-only check |
|---|---|---|
| `docs/openapi/critical-stable.openapi.json` | `npm run openapi:generate` | `npm run openapi:check` |
| `docs/api-inventory.json` + `docs/api-inventory.md` | `npm run api:inventory:generate` | `npm run api:inventory:check` |
| `app/lib/doctor/generated/*` (shape.json, last-snapshot.json, checks-from-shape.mjs) | `npm run livingcode:refresh` | git status after refresh |
| `public/livingcode/index.html` | `npm run livingcode:refresh` | — |
| `mcp-server/lib/routes-inventory.generated.json` | `npm run livingcode:refresh` | — |
| platform-intelligence `SKILL.md` (website + mirrors) | `npm run livingcode:refresh` (`emit skill`) | — |
| `plugins/dashclaw/hooks/*.py` (mirror of repo-root `hooks/`) | `npm run livingcode:refresh` | — |
| `public/downloads/*.zip` + `*.manifest` | `npm run livingcode:refresh` | "zip unchanged (hash …)" |

Note: the **critical-stable OpenAPI spec intentionally omits experimental routes** — new experimental routes being absent there is by design, not a gap.

## Hand-authored surfaces (edit these)

### Architecture + readme
- `PROJECT_DETAILS.md` — canonical system map. Update: the route-count prose line; the domain table (Tier-2 governance-extensions — add a row per new subsystem: route + one-line description + repo file + maturity); the primary-UI-surfaces table (add new pages); remove any hardcoded SDK version (point at `sdk/package.json` instead).
- `README.md` — **the densest count-carrier; sweep every one of these, they all go stale together:**
  - the route total + split — "the full inventory (**N routes**: X stable, Y beta, Z experimental)" in the REST-API path;
  - the MCP line — "**N governance MCP tools** across M groups … plus K read-only resources" in the MCP-server path;
  - the SDK lines — "**N-method canonical Node surface**" and "the Python SDK exposes **M methods**";
  - the safety-model line — "**N pre-built safety switches**" (source: `app/policies/lib/shields.js`);
  - the governance-skill line — "**N new sections** for handoffs, secret hygiene, …".

  Plus: the feature/surface list (the "What DashClaw does" + "Beyond the basics" tables) if a major subsystem shipped, and the lucide/badge links if a path changed. `README.md` carries no freshness date-stamp of its own, but `validate-docs.mjs` *does* check its Next.js version mentions — keep those in step with `package.json`.

### Website developer docs
- `app/docs/page.js` — the `/docs` page; the most user-facing doc surface (its "Copy as Markdown" button serves `sdk/README.md`). Add a `navItems` entry + a `<section>` with `MethodEntry` components for new endpoints, mirroring the existing section structure exactly. Frame operator-only endpoints (no SDK wrapper) with a raw-fetch example, not the SDK client.

### SDK docs (when an SDK method was added/changed)
- `sdk/README.md` — Node SDK README (the canonical method catalogue). Add the new method section.
- `sdk-python/README.md` — Python SDK README (snake_case). Mirror, noting any Node-only methods.
- `docs/sdk-parity.md` — method counts + category status matrix.
- `docs/sdk-reference.md` — a pointer/redirect file; add concise method lists + cross-links, don't duplicate the full catalogue.
- After any SDK method change: `npm run sdk:count` and reconcile every cited count (grep the old number repo-wide first).

### Reference narratives (HAND-AUTHORED SOURCES — mirrored by livingcode:refresh)
Edit ONLY these source copies; `livingcode:refresh` overwrites the plugin / `.claude` / `~/.claude` mirrors from them:
- `public/downloads/dashclaw-platform-intelligence/references/api-surface.md` — route catalogue + guard policy types table + the header route count. Add new route sections; add new guard `policy_type` rows; update the count from `docs/api-inventory.md`; add new sections to the Table of Contents.
- `public/downloads/dashclaw-platform-intelligence/references/platform-knowledge.md` — version, SDK counts, Product Surfaces table, Dashboard Navigation table (keep the "N groups" prose in sync with the table), ID-prefix table.
- `public/downloads/dashclaw-platform-intelligence/references/troubleshooting.md` — if the feature adds a failure mode worth documenting.

### Marketing / landing (in-app — there is NO separate marketing repo; an explicit step EVERY ship)
Honor `.impeccable.md` (read it): declarative voice, lucide icons, CSS tokens (no hardcoded hex), four anti-references (x402/payments = governed capability spend, never crypto/web3/wallet). For each page, check feature *presence* (grep the feature name), not just counts.
- `app/page.tsx` — the landing page (redesigned v4.57.1 as a 9-beat narrative: hero decision record → live demo → vs-tracing → four-call loop → stack tabs → enforcement boundary → use cases → control room → CTA). **The rendered feature lists are the inline arrays in this file** (`LOOP_STEPS`, `OPERATE_SURFACES`, plus `frameworkQuickstarts`/`signals` from landingData). The dead-array trap was removed in v2.6d (2026-07-03): if you're tempted to add a feature array to landingData, put the copy in `app/page.tsx` instead. After editing, grep `app/page.tsx` for the feature name to prove it renders. CAUTION: the `UseCases` tabs document *different* features — don't conflate.
- `app/landingData.js` — keep its gated counts current (the MCP tool/resource strings are drift-gated). Only `frameworkQuickstarts` (rendered by `app/components/StackQuickstarts.tsx`) and `signals` (rendered by `app/page.tsx`) live here; everything else renders inline in `app/page.tsx`. (`corePrimitives` was removed in the v4.57.1 redesign.)
- `app/downloads/page.tsx` — Node + Python SDK blurbs (keep feature lists in parity); SDK counts here must match `npm run sdk:count`.
- `app/self-host/page.tsx` — **NOT optional**: the "What you just deployed" grid claims "the full governance API surface — every feature works out of the box," so a major subsystem missing a category card is a false completeness claim. Add a card (category + 4 feature lines) for any major new capability.
- `app/connect/page.tsx` — integration onboarding: every install command, env var (`DASHCLAW_URL` = MCP server, `DASHCLAW_BASE_URL` = hooks; the SDK takes `baseUrl` as a constructor option, no env read), and package name must match the code. New capabilities only belong here if they add an integration path.
- `app/guides/*` — framework guides: verify install commands and pins still work; never pin the `dashclaw` package to an old version (unpinned beats stale). A new feature rarely needs a new guide — accuracy is the bar here.

## Freshness date-stamps (no old dates — but only the living ones)

The operator's rule is *no stale dates anywhere*, which means the stamps that claim
"current as of" must advance — while the dates that record history must not move.
Pull today's date once (Phase 1) and apply it only to the first list.

### Advance to today — but only on a doc you actually edited this sweep
| Stamp | File | Form |
|---|---|---|
| `last-verified` front-matter | `PROJECT_DETAILS.md` | `last-verified: <date>` |
| `last-verified` front-matter | `docs/sdk-reference.md` | `last-verified: <date>` |
| `last-verified` front-matter | `docs/sdk-parity.md` | `last-verified: <date>` |
| inline "verified" stamp (doubles as the route count) | `public/downloads/dashclaw-platform-intelligence/references/api-surface.md` | `**N active routes** (verified <date> against docs/api-inventory.json)` |
| "Last updated" footer | `.impeccable.md`, `brand/*` | `_Last updated: <date> …_` (only if the doc itself changed) |

Editing the doc but leaving its stamp behind is itself a stale-date bug — bump the two together.

### Never touch — these record history, a past date is correct
- `CHANGELOG.md` release headings (`## [x.y.z] — <date>`) and every dated entry under them.
- "shipped/landed/added on `<date>`" notes, commit-history references, ADR/spec dates.
- Anything under `.supergoal/`, `.organism/`, `docs/superpowers/`, `AUDIT_FINDINGS.md`, `.audit-findings-full.md`, memory files, and other scratch/working artifacts — these are dated logs, not living docs (and most aren't even shipped surfaces).

### A frozen clock in code is a bug, not a stamp
A literal `new Date('YYYY-MM-DD')` in app code (vs `new Date()`) freezes that page's
countdowns/filters to a fixed day. If your feature touched such a file, flag it as a
code fix — it's not part of the doc sweep, but it is exactly the kind of "old date" that
silently rots.

## The SDK-doc checklist (when ANY route or SDK method is added)

All of these must be updated together:
1. `app/docs/page.js` (website docs)
2. `sdk/README.md` (Node — serves `/docs` "Copy as Markdown" via `/api/docs/raw`)
3. `sdk-python/README.md` (Python)
4. `docs/sdk-parity.md` (parity matrix)
5. `docs/api-inventory.md` (auto-regenerated by the pre-commit hook)
6. `PROJECT_DETAILS.md` (route list / domain table)

Then run: `npm run docs:check`, `npm run route-sql:check`, `npm run openapi:generate` + `openapi:check`, `npm run api:inventory:generate` + `api:inventory:check`.

## Version bump + SDK release (Phases 5–6)

DashClaw ships **one unified version** — `package.json`, `sdk/package.json`, and `sdk-python/pyproject.toml` must agree (`npm run version:sync:check`, in CI + pre-commit). That number also lives, by hand, in two more files; keep all of these in step:

| File | Holds the version as | How it updates |
|---|---|---|
| `package.json` / `sdk/package.json` / `sdk-python/pyproject.toml` | the three authoritative manifests | `npm run version:set -- <x.y.z>` (never edit one alone) |
| `package-lock.json` | locked dependency version | `npm install` after `version:set` |
| `contracts/sdk/release-plan.json` | `node.current_version` + `python.current_version` (+ `reason`, `next_bump`) | edit by hand to match |
| `CHANGELOG.md` | the `## [<x.y.z>] — <date>` heading | rename `[Unreleased]` → dated, then add a fresh empty `[Unreleased]` |

All *displayed* version strings (Sidebar build stamp, `/docs`, `/downloads`) derive from the manifests at build time via `next.config.js` — never hardcode a version in `app/**`; `npm run version:check` enforces this.

**Decide bump-or-not first:** compare `node -p "require('./package.json').version"` against `npm view dashclaw version`. Equal → the new work owes a bump. Manifest already ahead → a bump is staged; don't double-bump, just confirm the release-plan + CHANGELOG match.

**Increment:** major = breaking SDK change; minor = additive method/route/subsystem; patch = platform-only / hardening / docs-accuracy sweep. The version *number* bumps on every ship (the unified manifests + `release-plan.json` must agree — both `version:sync:check` and `contracts:check` enforce it). The **publish** is what's conditional: republish the SDKs only when the SDK *source* changed this release (diff `git diff --name-only <base>..HEAD -- sdk sdk-python` before the bump). A platform-only ship advances the number but leaves npm + PyPI at the last SDK release.

**Publishing is owner-only.** `npm run release:sdks` builds + uploads both packages to npm + PyPI (needs `npm login` + a PyPI token) and is idempotent (skips versions already on the registry). This skill **reminds** — and only when the SDK source changed — it never runs it.

**Out of the sync check:** the plugin bundle (`plugins/dashclaw/.claude-plugin/plugin.json`) and the CLI version independently — bump those only if the plugin/CLI itself changed. For a **major** bump, leave the repo-root self-dep (`"dashclaw": "^4.x"`) on the OLD major until `release:sdks` has published, or `npm ci` in CI fails on an unresolvable lockfile.

## Boundary reminders (so docs stay truthful)

- **FinOps / aggregation endpoints are repository functions, not SDK methods** — they don't change SDK counts and don't belong in SDK method lists.
- **MCP tools are hand-curated** — new routes ≠ new tools.
- **govern-not-do**: DashClaw records/polices/aggregates; it never holds a wallet or executes a provider call. Keep copy on the governance side of that line.
- `dist/` is an untracked build output — ignore it.
