# Reach attribution — mint source capture + per-channel funnel (roadmap v6.4)

**Date:** 2026-07-05 · **Item:** roadmap v6.4, pulled forward per the watch-list
trigger (channels started moving 2026-07-05: awesome-mcp-servers PR #9313 live,
Glama listing approved). Mints carry no source today; a successful reach act
would be indistinguishable from organic arrival, wasting the v6.5 read.

## What ships

One write at mint, no analytics platform, nothing beyond the referrer/UTM
strings — then the funnel gains channel resolution.

1. **Capture (client):** `HostedProvisionClient` sends
   `source: { referrer, utm_source, utm_medium, utm_campaign }` with the mint
   POST — `document.referrer` plus the UTM params already on the `/connect`
   URL. Nothing else; no cookies, no fingerprinting, no page-view analytics.
2. **Resolve + store (server):** `app/lib/hosted/mint-source.ts` sanitizes
   (strings only, trimmed, 300-char cap per field, allowlisted keys) and
   resolves one label:
   - `utm_source` (normalized: lowercase, `[a-z0-9._-]`, 64-char cap) when
     present;
   - else the referrer's host (www-stripped) for parseable http(s) referrers,
     **except the instance's own host** (a self-referral is not a channel) —
     that reads as no referrer;
   - else `direct`.
   `provisionHostedWorkspace` writes `organizations.trial_mint_source` (label)
   and `trial_mint_source_raw` (the sanitized input, jsonb) in the mint INSERT.
   One write, never updated.
3. **Freeze (snapshot):** drizzle/0054 extends `hosted_trial_snapshots` with
   `mint_source` + `mint_source_raw`; `snapshotTrialFunnelFacts` freezes both
   at deletion time (same fail-closed protocol as 0052). Pre-v6.4 rows keep
   NULL = unknown, never guessed.
4. **Aggregate (annotation, not a step):** `computeFunnelAggregates` adds
   `annotations.bySource`: `[{ source, minted, firstAction }]`, minted-desc,
   **top 10 + 'other' rollup** (labels are attacker-mintable strings on a
   public route — the cap keeps junk labels from spamming the surface), with
   NULL-source facts in an explicit `unknown` bucket (distinct from `direct`,
   which means "captured, no referrer/UTM"). Truthful zeros: a source with
   mints and zero first actions renders as exactly that.
5. **Render:** the `/setup` "Trial activation funnel" card gains a per-source
   table under the v5.3 annotations. `GET /api/hosted/funnel` carries the same
   `annotations.bySource`.

## Decisions

- **Spoofable by design.** The strings come from the minting client;
  attribution is measurement, not security. Only normalized labels leave the
  repository (aggregate-only, same rule as the rest of the funnel); raw
  referrer strings stay in the DB.
- **Org grain, on `organizations`** — the v5.3 precedent
  (`trial_first_seen_at`) for trial facts at org grain.
- **`utm_medium`/`utm_campaign` are stored raw but not aggregated** — the
  measurement contract needs channel (source) resolution; finer grains can be
  read ad hoc from raw if a question ever demands it.
- **Maintainer exclusion** rides the existing protocol (synthetic tags at
  action grain; cap-0 delete at mint grain) — no new mechanism.

## Acceptance (from the roadmap, unchanged)

A mint from a tagged link shows its source in the funnel route and the /setup
card; smoke pins it; maintainer runs stay excluded by the existing protocol.
