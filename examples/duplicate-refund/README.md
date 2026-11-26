# Duplicate refund demo

An agent asks to refund the same $42 order twice. The first request writes to
a fake ledger. The second is evaluated again, matches DashClaw's
`block_action_type` rule for already-refunded orders, and never writes a refund.

From the repository root, using Node 22 or newer:

```sh
npm ci --ignore-scripts
node --import tsx examples/duplicate-refund/demo.ts
```

Add `--json` to print the two receipts and fake ledger as JSON, for example to
save a local audit artifact with shell redirection.

### Two-minute walkthrough

1. **0:00 — Start at the fake order.** The order has no refund. Explain that the
   adapter looks up the state in the store instead of trusting the agent.
2. **0:25 — Run the command.** The first decision is `ALLOW`. Follow its
   decision ID to the one entry written to the fake refund ledger.
3. **0:50 — Read the retry.** The target is now under `/demo-store/refunded`.
   The retry has a new guard decision ID. It is `BLOCK` and the engine reports
   policy `demo_no_second_refund` with the reason “Order already refunded.”
4. **1:20 — Count effects.** Two decisions, one fake refund. No API keys,
   hosted service, payment processor, or customer data were involved.

The demo uses DashClaw's platform guard evaluator and captures the actual
decision-row writes in memory. It prints audit evidence in the terminal; it
does not send records to the hosted dashboard or test production execution
claims. Requests run serially. The stable refund key is separate from the two
fresh decision-attempt keys; the fake endpoint also refuses a second write
for the same refund key. For a real shop, use the payment provider's
idempotency guarantees and reconcile uncertain results; a preflight decision
alone is not a distributed lock.
