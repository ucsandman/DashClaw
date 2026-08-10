# DashClaw Proof Pack

The smallest honest DashClaw integration. Run either script and it creates
inspectable evidence in this order:

```
guard decision -> action record -> optional approval -> outcome -> dashboard link
```

It uses no model provider and makes no external business-side effect. Its only
work is a deterministic connection proof, so a successful run means the SDK,
credentials, action ledger, and outcome path all worked together.

## Setup

Start DashClaw, create a workspace API key, then set the two environment
variables in `.env.example` in your shell or preferred environment manager.

```bash
cp .env.example .env
# Fill in DASHCLAW_API_KEY.
```

## Run with Node

```bash
npm install dashclaw
node --env-file=.env proof-pack.mjs
```

## Run with Python

```bash
pip install dashclaw
# Export variables from .env using your shell, then:
python proof_pack.py
```

Both scripts print a direct `/decisions/<action-id>` link. Open it to inspect
the guard decision, action, assumption, and final outcome. If a policy requires
approval, approve or deny the action at `/approvals`; the script waits and will
never claim success after a denial.

## Make it your agent

Replace the deterministic proof section with your actual tool call. Keep the
four control points intact: guard before risky work, create the action record,
wait when `action.status` is `pending_approval`, and always report a terminal
outcome.
