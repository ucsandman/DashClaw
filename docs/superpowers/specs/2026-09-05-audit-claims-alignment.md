# Audit documentation and marketing alignment

Status: source alignment and local release gates verified; publication tracked by the release checks. Scope: source alignment and the user-authorized release of the complete remediation batch.

The September 5 remediation changed the execution, approval, identity, failure,
and operational contracts. Existing copy must describe those contracts without
claiming that the unreleased server, clients, or schema are already deployed.

## Required outcomes

- Match root descriptions, READMEs, guides, marketing pages, search metadata,
  machine-readable discovery, plugin documentation, and active architecture docs.
- Describe mechanical enforcement at supported execution seams and cooperative
  enforcement in caller-controlled SDK/API integrations.
- Explain protocol-1 claims, current-policy reevaluation, atomic authority
  consumption, legacy hook compatibility, and strict governed SDK helpers.
- Separate recorded outcomes, signed receipts, verified identity, and actual
  external execution. Never equate a claim with exactly-once external effects.
- Describe unavailable/stale evidence honestly, including probe-reported
  runtime versions and hook fingerprints.
- Keep historical release records intact. Mark obsolete active guidance or
  replace it with links to the current contract.
- Preserve the product thesis and human-held constitutional invariants.

## Ownership

Root owns root documents, package descriptions, the release note, and integration
verification. The marketing worker owns public page copy and metadata. The SDK
worker owns package READMEs and runtime guides. The documentation worker owns
active reference, architecture, and operations documents. Existing audit source
changes remain intact.

## Verification

Search old claims from multiple angles; trace examples against source signatures;
run docs/counts/guide/contracts/version/inventory checks, lint, typecheck, the full
root suite, and the production build. Inspect the rendered affected marketing
pages, metadata, links, and machine-readable discovery. Regenerate managed
bundles and artifacts from canonical sources. Deploy the matching server and schema before publishing clients that require execution claim protocol 1; verify deployment and registry results separately.
