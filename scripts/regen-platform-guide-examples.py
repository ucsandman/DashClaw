#!/usr/bin/env python3
"""Captures the platform guide's 3 Python SDK liveExamples against a local instance.

Invoked by regen-platform-guide-examples.mjs; prints the JSON array to stdout.
Uses the repo's sdk-python source directly (no install needed).
"""
import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "sdk-python"))
from dashclaw import DashClaw  # noqa: E402

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://localhost:3001")
args = parser.parse_args()

env = {}
with open(os.path.join(ROOT, ".env.local"), encoding="utf-8") as f:
    for line in f:
        m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
        if m:
            env[m.group(1)] = m.group(2).strip('"')

claw = DashClaw(base_url=args.base_url, api_key=env["DASHCLAW_API_KEY"], agent_id="guide-capture-agent")


def trim(obj):
    # list responses keep only 2 items — full get_signals captures once shipped at 68KB each
    for k in ("signals", "actions", "decisions"):
        if isinstance(obj, dict) and isinstance(obj.get(k), list) and len(obj[k]) > 2:
            obj[k] = obj[k][:2]
    return obj


def show(obj):
    return json.dumps(trim(obj), indent=2)


import datetime  # noqa: E402

TODAY = datetime.date.today().isoformat()
VERIFIED = f"live (localhost:3001, {TODAY})"
out = []

decision = claw.guard({
    "action_type": "send_email",
    "declared_goal": "Send the weekly digest to subscribers",
    "risk_score": 40,
})
out.append({
    "id": "py-guard",
    "code": 'decision = claw.guard({\n    "action_type": "send_email",\n    "declared_goal": "Send the weekly digest to subscribers",\n    "risk_score": 40,\n})\n# decision["decision"] -> "allow" | "warn" | "block" | "require_approval"',
    "response": show(decision),
    "verified": VERIFIED,
})

action = claw.create_action(
    action_type="research",
    declared_goal="Summarize competitor pricing pages",
    status="completed",
    output_summary="3 competitors summarized",
    risk_score=10,
)
out.append({
    "id": "py-create-action",
    "code": 'action = claw.create_action(\n    action_type="research",\n    declared_goal="Summarize competitor pricing pages",\n    status="completed",\n    output_summary="3 competitors summarized",\n    risk_score=10,\n)',
    "response": show(action),
    "verified": VERIFIED,
})

signals = claw.get_signals()
out.append({
    "id": "py-get-signals",
    "code": "signals = claw.get_signals()",
    "response": show(signals),
    "verified": VERIFIED,
})

json.dump(out, sys.stdout, indent=2)
