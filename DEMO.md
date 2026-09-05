# DashClaw demo guide

Use the [interactive demo](https://www.dashclaw.io/demo) to explore the approval inbox, decisions, and policies with sample data. The demo illustrates the operator workflow; it does not install hooks or prove enforcement on your machine.

## Explore the operator workflow

1. Open **Approvals** and inspect a pending action's declared intent, target, risk, and available evidence.
2. Choose **Allow** or **Deny** on a sample item.
3. Open **Decisions** and inspect the recorded decision and outcome.
4. Open **Policies** to see which rules can interrupt a run.

Sample outcomes are demonstrations. A signed receipt, where present on a real instance, verifies recorded content. It does not prove that an external system changed exactly as reported.

## Exercise a real integration safely

Follow [Quick Start](./QUICK-START.md) to run an instance and connect a supported runtime. The `examples/openai-governed-agent` starter uses the governed SDK helper around a simulated deployment. No real deployment occurs. The current helper requires a server with execution claim protocol 1.

Configure a temporary Short List approval rule for that simulation in **Policies**, run the starter, and use **Approvals** to resolve the hold. Then inspect the corresponding record in **Decisions**. A denied run must not enter the simulation callback. This checks the configured SDK path; it does not test unrelated tools or a runtime hook.

For hook enforcement, follow the integration's liveness procedure and review its reported result in **Setup**. A stale, unavailable, or broken probe is not a successful enforcement check.

## Docker demonstration

```bash
npx dashclaw-demo
```

With Docker running, this starts the packaged demo and a simulated deployment governed by its demo policy. The example honors the server's block decision before its simulated effect. See [the enforcement boundary](./docs/architecture/enforcement-boundary.md) for how cooperative SDK calls differ from installed tool hooks.

The former Market Intelligence workflow walkthrough described routes removed from the product. It is superseded by this guide; DashClaw's current purpose is [governance for unattended agents](./THESIS.md).
