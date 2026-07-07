# Proposed MAINTAINER.md amendment — align the thesis paragraph with THESIS.md (v5.0.0)

**Status: PROPOSAL. Not applied.** Per MAINTAINER.md constitution **§5**
("This file changes only by Wes's explicit direction. The maintainer may
propose amendments in a commit that touches nothing else."), the maintainer
does **not** edit `MAINTAINER.md` unilaterally. This document is the prepared
amendment; it travels with the v5.0.0 release notes and awaits Wes's
ratification. If ratified, it lands as a commit that touches only
`MAINTAINER.md`.

## Why

`THESIS.md` (adopted 2026-07-06, canonical) narrowed the product to the
enforcement loop — **intercept → decide → approve → prove**. Its
§"Relationship to MAINTAINER.md" records the exact reconciliation:

> MAINTAINER.md's introductory thesis paragraph ("protects agents … from being
> weaponized, blamed unfairly, or bankrupted") is broader than this product:
> the "blamed unfairly" direction survives here as the signed audit/evidence
> layer; the "bankrupted" direction (spend governance) is out of scope per this
> thesis.

So the charter's thesis paragraph is now broader than the product it governs on
one axis only: **"bankrupted" / spend governance**. The v5 cull removed every
x402 / FinOps / billing surface (Wave 12) and moved spend governance to a
separate, gated thesis (RFC 0002). "Weaponized" and "blamed unfairly" both
survive — the latter as the signed, replayable Ed25519 audit trail (the Prove
pillar), which the cull strengthened (compliance signing folded into
`/api/artifacts/evidence-bundle`).

The rest of MAINTAINER.md is unaffected: the five constitutional invariants
(§1–§5), the precision-of-interruption metric, the mandate, and the operating
protocol all bind v5 unchanged. Only the opening thesis paragraph is proposed
for amendment.

## The exact proposed change

Unified diff against `MAINTAINER.md` (only the `## Thesis` opening paragraph;
the "precision of interruption" paragraph below it is untouched):

```diff
 ## Thesis

-DashClaw is an **evolving, living codebase that protects agents and prevents
-them from doing harm** — in both directions: it protects the world from
-agents, and it protects agents from being weaponized, blamed unfairly, or
-bankrupted.
+DashClaw is a **fail-closed approval layer that catches an AI coding agent's
+destructive tool calls before they run and asks a human first** — even when
+that human is not at the keyboard. It protects the world from agents, and it
+protects agents from being weaponized or blamed unfairly: every governed
+decision writes a durable, signed, replayable audit row, so "the agent did
+it" is answerable with evidence rather than assumption. (The third original
+direction — protecting agents from being *bankrupted*, i.e. spend governance —
+is a separate product and is out of scope for this codebase as of the v5.0.0
+thesis; see `THESIS.md`.)

 The core product metric is **precision of interruption**. Every false block
```

### Rendered result (the amended paragraph, for review)

> DashClaw is a **fail-closed approval layer that catches an AI coding agent's
> destructive tool calls before they run and asks a human first** — even when
> that human is not at the keyboard. It protects the world from agents, and it
> protects agents from being weaponized or blamed unfairly: every governed
> decision writes a durable, signed, replayable audit row, so "the agent did
> it" is answerable with evidence rather than assumption. (The third original
> direction — protecting agents from being *bankrupted*, i.e. spend governance —
> is a separate product and is out of scope for this codebase as of the v5.0.0
> thesis; see `THESIS.md`.)

## What this amendment does NOT change

- The five constitutional invariants (§1 blocks absolute, §2 no self-approval,
  §3 humans ratify policy changes, §4 credential-gated acts stay human, §5 this
  file changes only by Wes's direction).
- The precision-of-interruption metric and the 18-day-fatigue lesson.
- The mandate, the outward-acts clause, and the operating protocol.

## Ratification

Per §5, only Wes ratifies. To adopt: apply the diff above as a commit that
touches nothing but `MAINTAINER.md`. To decline: leave MAINTAINER.md as-is —
THESIS.md already records the reconciliation, so the charter and the product
remain consistent either way; this proposal simply makes the charter's opening
sentence match the shipped product.
