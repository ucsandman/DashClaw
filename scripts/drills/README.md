# Fresh-machine entry-path drills (roadmap v8.3)

Three consecutive pre-launch sweeps found the flagship path — `npx dashclaw up`
on a factory-fresh machine — broken, and each time it was a one-off manual
effort (a human sitting inside a Windows Sandbox or a fresh VM, clicking
through it by hand) that caught it. These scripts are the repeatable
instruments that replace that manual effort.

They are **maintainer instruments, not product code**: no UI, fully
automated, machine-readable verdict, exit 0 = green / exit 1 = broken. They
test the **DISTRIBUTION path** — `npx dashclaw up` resolving the published npm
CLI package and the platform tarball from GitHub releases — not
`--source-dir` (which is what `.github/workflows/up-smoke.yml` tests, from a
checked-out repo on dev-imaged CI runners; that catches source regressions,
not distribution/packaging breaks).

## One-command invocations

```bash
npm run drill:fresh-windows   # Windows Sandbox — factory-fresh Windows 11
npm run drill:fresh-linux     # Docker container — factory-fresh Linux
npm run drill:hosted          # hosted-trial equivalent (built separately)
npm run drill:claim           # claim-your-workspace path (v5.13): mint →
                              # preview → claim → ownership/rebind/discard →
                              # trial-cookie revocation. Needs a hosted-mode
                              # instance + HOSTED_DRILL_TOKEN + NEXTAUTH_SECRET
                              # + DATABASE_URL of the target. Off-Neon DBs run
                              # the two trial-cookie steps as LIMITED (the
                              # middleware resolves trial sessions via the
                              # Neon driver only).
```

Each accepts flags (see each script's header comment for the full list):

```bash
npm run drill:fresh-windows -- --cli @dashclaw/cli@latest --timeout-min 25
npm run drill:fresh-linux   -- --cli @dashclaw/cli@latest --image node:20-bookworm --timeout-min 20
```

## Seeded-break form (verify the drill actually catches regressions)

Point `--cli` at a version known to be broken, and confirm the drill fails
for the *right* reason before trusting it to catch new breaks:

```bash
npm run drill:fresh-windows -- --cli @dashclaw/cli@0.7.2   # historic VC++ runtime break class
npm run drill:fresh-windows -- --cli @dashclaw/cli@0.7.1   # frozen-version / import-route break class
```

## What each drill proves

- **fresh-windows** (`fresh-windows.mjs` + `windows-sandbox/drill.ps1` +
  `windows-sandbox/drill.wsb.template`): launches Windows Sandbox (a
  disposable, factory-fresh Windows image), installs Node LTS from scratch,
  runs `npm exec --package=<cli> -- dashclaw up --yes --db embedded
  --no-browser`, polls `/api/health` for up to 10 minutes, reads the minted
  instance key, and records the first governed action. Every exit path writes
  `drill-result.json`; the host launcher polls for that file and treats its
  absence after the timeout as a fail.
- **fresh-linux** (`fresh-linux.mjs`): the same proof inside a disposable
  `docker run --rm` container (default `node:20-bookworm`) instead of a VM —
  cheaper and faster to run than the sandbox, useful as a first check before
  burning sandbox time.
- **hosted** (`drill:hosted`, built separately): the equivalent proof for a
  stranger hitting the hosted trial cold, with no local machine involved.

## Cadence

Run before any release that touches `cli/**`, `scripts/setup.mjs`, or the
`up` path, and at least once during any open measurement window (a roadmap
phase where the entry path is under active scrutiny). These are not part of
CI — they require Windows Sandbox / Docker on the maintainer's own machine and
take several minutes each.

## Known gap: no macOS equivalent

**macOS has no maintainer-executable fresh-machine drill.** There is no macOS
VM infrastructure on the maintainer host, and GitHub's `macos-latest` runner
in `up-smoke.yml` is dev-imaged (Xcode, Homebrew, Node, etc. preinstalled),
not factory-fresh — it cannot catch the class of bug these drills exist to
catch. This is a known, deliberate gap, not an oversight: closing it would
require macOS VM infrastructure (e.g. a colocated Mac mini or a paid
cloud-macOS provider) that hasn't been justified yet.
