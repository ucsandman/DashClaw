# External Verdict Provider — Implementer Guide (v1)

This is the wire contract a decision engine implements to become a DashClaw
org's **external decision provider**. The design and its invariants are frozen
in the accepted RFC
([docs/rfcs/2026-08-13-external-policy-verdict-input.md](rfcs/2026-08-13-external-policy-verdict-input.md),
[#219](https://github.com/ucsandman/DashClaw/issues/219)). Contract changes are
raised on that issue in the open — never coded around.

An org configures **one** provider (URL, optional bearer token, timeout,
unavailability posture) in the `/policies` workbench. During every guard
evaluation, DashClaw POSTs the evaluated act to the provider and joins the
verdict with the local result **stricter-wins**:

```text
allow < warn < require_approval < block     (DashClaw's verdict lattice)

allow    -> allow
warn     -> warn
escalate -> require_approval
deny     -> block
```

Your verdict can tighten the effective decision. It can never loosen it, and
no local grant, approval, or calibration state overrides your `deny` for the
evaluated act.

## Request (DashClaw → provider)

`POST <configured URL>` with `content-type: application/json` and, when a
token is configured, `authorization: Bearer <token>`:

```json
{
  "request_id": "evr_5f0c6c3e-9d5a-4d6b-8e0e-2f1a7c9b4d21",
  "org_id": "org_a1b2c3",
  "agent_id": "agt_docs_bot",
  "action_type": "http_request",
  "declared_goal": "Post the release notes to the status page",
  "act": { "kind": "http", "method": "POST", "url": "https://api.example.com/notes" },
  "input_identity": "sha256:Zm9vYmFyYmF6cXV4..."
}
```

- `act` is the same evidence payload the guard evaluates (the evidence-first
  wire shape: shell/http/sql/file). It can be `null` when the caller attached
  no act.
- `input_identity` digests exactly the tuple
  `{org_id, agent_id, action_type, declared_goal, act}`. You do **not** need
  to recompute it (the canonicalization is DashClaw-internal); you MUST echo
  it back verbatim.

## Response (provider → DashClaw)

Answer `200` with:

```json
{
  "decision": "deny",
  "reason": "memory_policy_violation",
  "policy_source": "agent-memory-pama",
  "policy_version": "2026-08-13.3",
  "input_identity": "sha256:Zm9vYmFyYmF6cXV4...",
  "evidence": { "rule": "no_unreviewed_durable_mutation" }
}
```

Rules:

- `decision` MUST be one of `allow | warn | escalate | deny`. Any other value
  (including `transform`) is treated as an **unsupported verdict** — a
  provider failure, never an implicit allow.
- `input_identity` MUST echo the request's value verbatim (E3 identity
  binding). A mismatch discards the verdict and records a posture failure, so
  a verdict can never drift onto a different act.
- `reason` is a stable machine-readable code; it is shown to operators in the
  decision evidence and reasons line.
- `policy_source` / `policy_version` are opaque provenance strings, stored in
  the decision evidence.
- `evidence` is optional and bounded: serialized payloads over 4096 chars are
  dropped (a truncation marker is stored instead).

## Failure posture

The call runs inside the guard hot path under a hard budget
(`min(configured timeout, remaining evaluation budget)`; timeouts clamp to
100–5000 ms). Timeouts, non-2xx, malformed bodies, unsupported verdicts, identity
mismatches — and a saved provider config the server can no longer read (an
undecryptable URL after an `ENCRYPTION_KEY` rotation, recorded as
`config_unreadable`) — all take the org's configured posture:

| Posture | Effect on the decision |
|---|---|
| `fail_closed` (default) | joined as `require_approval` — a human is asked |
| `fail_open` | local rules decide alone |

Either way the outcome is recorded honestly: the decision evidence and the UI
say `external unavailable`, never a fake external approval. Your endpoint must
be `https` on a public host — requests are sent through DashClaw's SSRF-safe
fetch (private IPs and redirects are refused).

## Evidence and visibility

Every decision a provider touched carries a `_external_verdict` block in its
audit evidence (provider id, raw and mapped verdict, reason, versions,
identity, latency, posture, failure kind if any), and operators see the regime
— `External: <verdict>` or `External unavailable` — on the decision detail
page and on `/approvals` cards. Your verdict is **decision evidence, not an
execution witness**: DashClaw's enforcement and witness semantics prove
whether the joined decision was enforced; an external verdict is never itself
proof of enforcement.

## Conformance

The executable specification is the mock-provider suite
`__tests__/unit/guard-external-verdict.test.js` — it implements the ten
adversarial cases from [#220](https://github.com/ucsandman/DashClaw/issues/220)
(join matrix, identity mismatch, fail-closed conservatism, visible
unavailability, unsupported-verdict handling, evidence/witness separation, and
byte-identical behavior when no provider is configured). A provider that
behaves per this document will pass integration against that matrix.

Try it against a local instance:

```bash
curl -X POST http://localhost:3000/api/guard \
  -H "x-api-key: $DASHCLAW_API_KEY" -H "content-type: application/json" \
  -d '{"agent_id":"agt_demo","action_type":"http_request","declared_goal":"post release notes","act":{"kind":"http","method":"POST","url":"https://api.example.com/notes"}}'
```

With a provider configured on `/policies`, the response's `signals` and the
decision's evidence show the external verdict joined into the result.

### Built-in connection test

Before any real action flows, the **Test provider** button on `/policies`
(next to Save in the provider panel) fires one synthetic act at your endpoint
through the exact production wire client and reports which contract stage
fails: reachability, HTTP response, response shape, verdict mapping, or the
`input_identity` echo. The synthetic act is unmistakable — `action_type:
"dashclaw.connection_test"` with `act: {"synthetic": true}` — and nothing is
recorded as a guard decision. Implementers can answer it like any other
request; the echoed identity and a contract verdict are all that is checked.
