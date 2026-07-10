import os
from dashclaw import DashClaw

def run():
    # 1. Initialize DashClaw
    # In "demo" mode, it sends telemetry to the public DashClaw demo.
    claw = DashClaw(
        base_url=os.getenv("DASHCLAW_BASE_URL", "https://your-dashclaw.vercel.app"),
        api_key=os.getenv("DASHCLAW_API_KEY", "demo"),
        agent_id=os.getenv("DASHCLAW_AGENT_ID", "first-action-agent"),
    )

    print("🚀 Agent attempting high-risk action...")

    # 2. Intercept before you act
    # This sends the intent to DashClaw for policy evaluation.
    result = claw.guard({
        "action_type": "deploy",
        "risk_score": 92,
        "declared_goal": "Deploy build v2.1.0 to production environment",
        "reasoning": "The build has passed all CI checks and is ready for release.",
    })

    decision = result.get("decision", "unknown")

    print(f"⚖️ DashClaw decision: {decision.upper()}")

    # 3. Follow the decision. On the SDK path the decision is advisory —
    # this `if` is the enforcement, so don't skip it.
    if decision == "block":
        print("🛑 Action BLOCKED by governance policy. Nothing executes.")
        return

    # 4. Record the action — this writes the replayable entry in the
    # decisions ledger (guard() alone evaluates but does not record).
    action = claw.create_action(
        action_type="deploy",
        declared_goal="Deploy build v2.1.0 to production environment",
    )["action"]

    print(f"🔗 View decision replay: {claw.base_url}/decisions/{action['action_id']}")

    if decision == "require_approval" or action.get("status") == "pending_approval":
        print("⏳ Action paused. Awaiting human operator approval in Approvals.")
    else:
        print("✅ Action permitted. Proceeding with deployment.")

if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        print(f"❌ Error running example: {e}")
        print("\nTip: Make sure DashClaw is running locally at http://localhost:3000")
        print("Or run with: DASHCLAW_BASE_URL=https://your-dashclaw.vercel.app python first-governed-action.py")
