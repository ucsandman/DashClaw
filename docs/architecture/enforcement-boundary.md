# Enforcement Boundary (ADR)

**Status:** Accepted 2026-07-04 · **Decided by:** Claude (maintainer), under the
MAINTAINER.md delegation · **Context:** roadmap item v3.6 ("enforcement over
assertion") required either a concrete design for a guard-enforcing gateway in
front of tool execution on non-cooperating harnesses, or a written kill with
the honest boundary documented. This ADR is the kill, and it is also the
canonical statement of where DashClaw's blocks are mechanical versus
cooperative. Change these decisions by superseding this file, not by drifting
from it. Spec: `docs/superpowers/specs/2026-07-04-enforcement-over-assertion.md`.

## The invariant, stated exactly

**Blocks are absolute at the decision layer** (MAINTAINER.md constitution §1):
no approval, grant, or maintainer action ever downgrades a `block` decision,
on any surface. What varies per surface is whether that block decision is
mechanically *executed* or cooperatively *honored*. Every surface where
DashClaw achieves mechanical enforcement follows one pattern: **something
DashClaw controls — or a host runtime that cooperates at the infrastructure
level — sits between "the model decides to call a tool" and "the tool
executes."** Where nothing sits there, governance is cooperative, and the
product must say so.

## The per-surface table (canonical — link here, don't restate)

| Surface | Enforcement | Mechanism |
|---|---|---|
| Claude Code / Codex hooks, `enforce` mode | **Mechanical** | `PreToolUse` exit-2 halts the tool before it runs; unreachable instance fails closed (`docs/guard-enforcement-contract.md`) |
| Claude Code / Codex hooks, `observe` mode | Cooperative (by explicit operator choice) | Decisions logged, nothing blocked — `DASHCLAW_HOOK_MODE=enforce` flips it |
| Hermes Agent plugin | **Mechanical** | `pre_tool_call` lifecycle veto |
| OpenClaw gateway plugin | **Mechanical** | `before_tool_call` hard veto, fail-closed by default; tools the gateway never proxies fall back to self-report (cooperative) |
| `dashclaw_invoke` / `POST /api/capabilities/:id/invoke` | **Mechanical** | DashClaw is the executor: guard runs server-side, `block` → 403 and the call never happens, `require_approval` → execution withheld until an operator approves. Applies to capabilities registered as `http_api` |
| SDK (`claw.guard()`) / direct API / bare MCP tools | Cooperative | Guard returns the decision; the calling code must honor it. The server records a blocked action and returns 403 on `record`, but cannot stop an out-of-band act. Since v4.63.0 these callers can attach the actual act (`act: {kind, …}`) so the server classifies from evidence instead of trusting the declaration — see "Evidence-graded intent" below |
| Claude Desktop / consumer web chat (OAuth connector, `/api/mcp`) | Cooperative | The governance skill guides the model to call `dashclaw_guard` first; consumer chat exposes no tool-interception layer, so there is no mechanical backstop |
| Org emergency halt | Decision-layer absolute | Every guard evaluation returns `block` within ~3s across instances; execution stops mechanically only on the mechanical rows above |

## Decision: the universal enforcing proxy is killed

A guard-enforcing gateway that hard-blocks tool execution for
**non-cooperating harnesses** — the Desktop governance ceiling — is not
buildable by DashClaw, and we stop carrying it as an unwritten possibility:

1. **The interception point does not exist.** Enforcement requires a
   pre-execution veto inside the harness process. Claude Code, Codex, Hermes,
   and OpenClaw expose one (hooks); consumer Claude Desktop and web chat do
   not, and Cowork hard-gating remains unverified. MCP is structurally
   incapable of providing it: an MCP server can *offer* tools, it can never
   *wrap* tools it doesn't own (the model's native web search, code execution,
   or another connector's tools).
2. **The one real alternative changes what DashClaw is.** Re-registering every
   connector as a DashClaw `http_api` capability so `dashclaw_invoke` becomes
   the only tool surface would make enforcement real — because DashClaw would
   be the executor — but it turns DashClaw into a connector broker. That
   contradicts the governance boundary ("a minimal governance runtime, not an
   agent platform") and still leaves Anthropic-native tools ungoverned.
   Rejected.
3. **The honest boundary is more valuable than the pretense.** The trust model
   (`docs/architecture/trust-and-failure-model.md`, D1) already treats guard
   inputs as attestations, not server-verified fact. This ADR applies the same
   honesty to execution: where DashClaw cannot sit in the execution path, the
   product says "cooperative," never "blocked."

**What exists instead, today:** any harness — including Desktop — gets
mechanical enforcement for side-effects the org routes through the capability
registry (`dashclaw_invoke`), because DashClaw executes those itself. That is
the supported answer for "enforce on a surface without hooks," and its scope
(registered `http_api` capabilities only) is a feature, not a gap to paper
over.

**Supersession trigger:** revisit this decision if a consumer surface ships a
third-party pre-execution hook contract (e.g. Cowork hooks are verified to
fire, or Desktop adds a tool-middleware API). Until then, proposals to "force
Desktop through DashClaw" resolve to the two shipped paths: the cooperative
connector + governance skill, or capability registration.

## Evidence-graded intent (added v4.63.0, extends — does not supersede — the table)

The table above is about the *execution* channel: can DashClaw stop the act.
There is a second, orthogonal channel: the *intent* channel — is what guard
evaluated true? Before v4.63.0 every cooperative caller self-declared
`action_type`, `risk_score`, and `declared_goal`, so a prompt-injected model
could author its own declaration. Evidence-first guard narrows this:

- Callers may attach the actual act to `POST /api/guard` — the shell command,
  HTTP request, SQL statement, or file write (`act: {kind, …}`, capped,
  redacted before persistence). The server classifies it deterministically and
  folds the derived risk in via `max()` — evidence can only raise a score,
  never lower it (trust-model D1 preserved).
- A declared/derived mismatch swaps the derived `action_type` in for policy
  matching, adds a modifier, and is flagged on the decision.
- Every decision records `intent_source: 'evidence' | 'declared'`; the
  `require_evidence` policy type escalates declared-only calls; posture grades
  the mix.

**The honest threat model:** evidence grading defeats a lying *model* — the
developer-controlled wrapper, not the LLM, authors the payload. It does not
defeat a lying *developer or process*, which can fabricate the payload
wholesale; only credential custody (the capability-registry row above) is
mechanical against that adversary. Copy must not claim otherwise.

## Containment: the productive use of the mechanical seam (added v5.6)

`allow_contained` (`docs/rfcs/2026-07-06-containment-verdicts.md`) does not
widen this ADR's boundary — it is the constructive use of the same seam the
table above already describes. The hook redirects an eligible tool call into
a staged git worktree instead of letting it hit the working tree, which is
only possible on the rows already marked **Mechanical**: something DashClaw
controls sits between "the model decides" and "the tool executes." A
harness that does not cooperate at that seam cannot stage anything, so it
simply never advertises `client_capabilities: ['allow_contained']` — the
server's negotiation rule then emits `require_approval` in its place, the
same decision that surface would have received before containment existed.
Nothing here reaches past the boundary this ADR draws: containment converts
a mechanical block-or-proceed choice into a mechanical stage-or-proceed one,
on hook-cooperating harnesses only.

**Second-person-gate caveat:** the `operator` identity is exempt from
separation-of-duties on the containment resolve route (mirrors the accepted
approvals precedent), since containment's threat model cares precisely about
who can promote staged work. A hook that authenticates with the bootstrap
`DASHCLAW_API_KEY` acts as `operator`, so it can self-promote its own
contained actions and `SELF_APPROVAL_FORBIDDEN` never fires. For containment
to have a real second-person gate, hooks should authenticate with a
database-backed `api_keys` credential instead of the bootstrap operator key.

## Hardening defaults (graduated with this ADR, v3.6)

- `DASHCLAW_JTI_REPLAY_PROTECTION` defaults **`required`** (was
  `best_effort`): flipped while the verified-JWT fleet was measurably empty
  (176,149 ledger decisions, zero verified), so no existing traffic changed
  behavior. Verified traffic only; API-key callers resolve `not_applicable`.
- `DASHCLAW_ACT_BINDING` defaults **`best_effort`** (was `off`): blocks only a
  positive `mismatch`, which requires a present claim — zero change for
  issuers that don't mint it. `required` stays opt-in because it would make
  minting the claim a precondition for JWKS adoption.
- Both keep one-env-var rollbacks, the `DASHCLAW_SUBAGENT_IDENTITY` /
  `DASHCLAW_GUARD_FALLBACK` flip precedent.

## Copy rule (the truth pass, enforced going forward)

Product copy may say "blocks" or "enforces" without qualification only where
the mechanism is mechanical per the table above. Everywhere else the claim
carries the boundary ("cooperative — the agent honors the decision; pair with
hooks for the mechanical backstop") or links here. `PLUGIN_PARITY.md` and
`app/docs/page.tsx`'s connector paragraph are the models this generalizes.
