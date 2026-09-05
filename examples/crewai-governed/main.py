"""
CrewAI + DashClaw Governance Example

Demonstrates multi-tool governance with:
- Policy checks before each tool execution
- HITL (Human-in-the-Loop) approval for high-risk actions
- Protocol-1 execution claims bound to the persisted action and exact act
- Outcome tracking with explicit uncertainty on lost confirmation

No OPENAI_API_KEY required — runs governance flow directly.
"""

import os
from dotenv import load_dotenv
from dashclaw import (
    ApprovalDeniedError,
    DashClaw,
    ExecutionClaimError,
    GuardBlockedError,
    OutcomeConfirmationError,
)
from crewai.tools import tool

load_dotenv()

claw = DashClaw(
    base_url=os.environ.get("DASHCLAW_BASE_URL", "http://localhost:3000"),
    api_key=os.environ["DASHCLAW_API_KEY"],
    agent_id="crewai-analyst-agent",
)


@tool("Analyze Customer Data")
def analyze_customer_data(query: str) -> str:
    """Analyze customer data based on the query. Governed by DashClaw policies."""

    try:
        return claw.run_governed(
            {"kind": "shell", "command": f"simulate-customer-analysis --query {query}"},
            {
                "action_type": "research",
                "declared_goal": f"Analyze customer data: {query}",
                "risk_score": 40,
                "systems_touched": ["customer_database"],
            },
            lambda: (
                f"Analysis of '{query}': simulated result with no customer data access."
            ),
        )
    except (GuardBlockedError, ApprovalDeniedError) as error:
        return f"Governance stopped the analysis: {error}"
    except (ExecutionClaimError, OutcomeConfirmationError) as error:
        return f"Execution state is uncertain for {error.action_id}; reconcile it before retrying."


@tool("Publish Report")
def publish_report(title: str) -> str:
    """Publish an analysis report externally. Higher risk — may require approval."""

    try:
        return claw.run_governed(
            {
                "kind": "http",
                "request": {
                    "method": "POST",
                    "url": "https://customer-portal.example.test/reports",
                    "body_excerpt": title,
                },
            },
            {
                "action_type": "post",
                "declared_goal": f"Publish report: {title}",
                "risk_score": 65,
                "systems_touched": ["external_api", "customer_portal"],
                "reversible": False,
            },
            lambda: f"Simulated publishing report '{title}'. No external write occurred.",
        )
    except (GuardBlockedError, ApprovalDeniedError) as error:
        return f"Governance stopped publication: {error}"
    except (ExecutionClaimError, OutcomeConfirmationError) as error:
        return f"Execution state is uncertain for {error.action_id}; reconcile it before retrying."


if __name__ == "__main__":
    print("=== CrewAI + DashClaw Governance Example ===\n")

    print("--- Tool 1: Analyze Customer Data (low risk) ---")
    result1 = analyze_customer_data.run("high-value customers in Q4")
    print(f"Result: {result1}\n")

    print("--- Tool 2: Publish Report (higher risk) ---")
    result2 = publish_report.run("Q4 High-Value Customer Analysis")
    print(f"Result: {result2}\n")

    base = os.environ.get("DASHCLAW_BASE_URL", "http://localhost:3000")
    print(f"View governed decisions: {base}/decisions")
