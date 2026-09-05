# DashClaw Governance Patterns

Concrete tool call sequences for common governance scenarios. Load this reference when
you need implementation examples.

## Governed Capability Pattern

`dashclaw_invoke` owns the current policy evaluation, action record, approval,
execution claim, external effect, and outcome:

```
Step 1: Invoke the registered capability directly
  result = dashclaw_invoke(
    capability_id="cap_slack_notify",
    declared_goal="Send deployment notification to #ops",
    payload={"channel": "#ops", "message": "Deployed v2.3.1"})

Step 2: Handle the result
  success == true → the server evaluated current policy, claimed one attempt,
                    performed the call, and recorded completion
  error == "pending_approval" → wait on result.action_id, then repeat the exact invoke
  error == "blocked_by_policy" → stop and report the reason
  execution_state == "unknown" → reconcile Slack before any retry

Step 3: dashclaw_invoke records automatically. Do NOT call dashclaw_record again
  for the same operation — that would create a second audit row for one action.
  Only emit a separate dashclaw_record when summarizing a multi-call workflow as
  one parent action.
```

## Approval Wait Pattern

For a registered capability whose invocation returns `pending_approval`:

```
Step 1: Invoke returns pending_approval
  result = dashclaw_invoke(capability_id="cap_deploy",
                           declared_goal="Deploy v2.3.1 to production",
                           payload={"environment": "production"})
  result.error == "pending_approval"

Step 2: Inform the user
  "This deployment requires human approval. An operator can approve or deny
   this action in DashClaw Approvals."

Step 3: Wait for the decision
  approval = dashclaw_wait_for_approval(action_id=result.action_id)

Step 4: Handle the result. The response shape is { approved, denied, expired?, action, timed_out }.
  - approved == true → repeat the exact dashclaw_invoke. Its atomic execution
                       claim consumes the approval before the external effect.
  - timed_out == true → operator never responded inside the configured timeout
                        (default 300s; override with timeout_seconds).
                        Re-request or stop with an explicit log.
  - denied == true → operator denied. Read denial_reason, then stop.
  - expired == true → the server expired the approval (your wait window +
                       retry grace passed). It can no longer be approved —
                       re-request if the action is still wanted.
  - approved == false otherwise → action moved to a non-completed terminal
                                   state. Read action.error_message, then stop.

For an ordinary MCP action, `dashclaw_guard` + `dashclaw_record` + approval wait
is cooperative policy state. It does not claim execution authority. Put a
consequential effect behind a host interception hook or SDK
`runGoverned` / `run_governed` callback.
```

## Token + Cost Reporting Pattern

For any action driven by an LLM call, attach token usage so the dashboard can
compute spend. Cost is derived server-side from the configured pricing table —
omit cost_estimate unless you have an authoritative number from the provider.

```
Step 1: Run the LLM call
  response = anthropic.messages.create(model="claude-opus-4-6", ...)

Step 2: Record (or PATCH) with token usage
  dashclaw_record(
    action_type="research",
    declared_goal="Summarize Q3 incident report",
    status="completed",
    output_summary=response.content[0].text[:500],
    tokens_in=response.usage.input_tokens,
    tokens_out=response.usage.output_tokens,
    model="claude-opus-4-6",
    # cost_estimate intentionally omitted — server derives from billing.js
  )

  # If you only learn token counts after the action was already recorded
  # (e.g. a Stop hook, or streaming response), PATCH instead:
  PATCH /api/actions/<action_id>
    { "tokens_in": ..., "tokens_out": ..., "model": "..." }
```


## Session Lifecycle Pattern

Clean session boundaries for long-running tasks:

```
Step 1: Start session
  dashclaw_session_start(agent_id="research-agent", workspace="market-analysis")
  → session_id = "sess_xxx"

Step 2: Execute governed work
  ... (claimed effect boundary; record separate cooperative decisions) ...

Step 3: End session
  dashclaw_session_end(session_id="sess_xxx", status="completed",
                       summary="Analyzed 5 market segments, produced comparison report")
```

Optional: call `dashclaw_session_retro` before Step 3 (or with `session_id` afterward — ending
a session clears the active default) to read the session's own defensibility report: a
clean/review/flagged posture composed from injection flags, goal drift, spend anomalies, and
invalidated assumptions across every action in the session.

## Multi-Step Task Pattern

Governing a sequence of dependent actions:

```
Step 1: Start session
  dashclaw_session_start(agent_id="deploy-agent", workspace="release-v2.3.1")

Step 2: Guard the overall plan (low risk — just planning)
  dashclaw_guard(action_type="planning", declared_goal="Plan v2.3.1 release",
                 risk_score=10)

Step 3: Run tests (moderate risk)
  dashclaw_guard(action_type="test_execution", declared_goal="Run full test suite",
                 risk_score=35, systems_touched=["ci"])
  ... run tests ...
  dashclaw_record(action_type="test_execution", status="completed",
                  output_summary="847/847 tests passed")

Step 4: Deploy to staging (high risk)
  dashclaw_invoke(capability_id="cap_deploy", payload={"env": "staging"})

Step 5: Deploy to production (very high risk — expect approval)
  result = dashclaw_invoke(capability_id="cap_deploy", payload={"env": "production"})
  → pending_approval → wait → approved → repeat the exact dashclaw_invoke

Step 6: End session
  dashclaw_session_end(session_id="sess_xxx", status="completed",
                       summary="Released v2.3.1: tests passed, staged, deployed to production")
```

## Error/Failure Recording Pattern

`dashclaw_invoke` owns its action record and outcome. Do not add a second
`dashclaw_record` for the same invocation:

```
Step 1: Attempt the action
  result = dashclaw_invoke(capability_id="cap_api", payload={...})

Step 2: Interpret the returned state
  success == true
    → the server recorded completion; use the returned action_id

  error == "execution_outcome_unknown" or execution_state == "unknown"
    → the capability call may have completed, but DashClaw could not confirm
      its outcome; reconcile the downstream system before any retry

  timeout, network, or transport error
    → downstream effect is ambiguous even if DashClaw recorded the attempt as
      failed; reconcile the downstream system before any retry

  an unambiguous pre-execution rejection such as blocked_by_policy,
  pending_approval, access_denied, or execution_claim_unavailable
    → no external effect ran; follow the returned guidance

Step 3: Retry only after reconciliation proves another effect is appropriate
  Call dashclaw_invoke again with the exact capability and payload. It creates
  and governs the new attempt; do not pre-guard or create a duplicate record.
```

## Discovery Pattern

Finding and using capabilities you haven't used before:

```
Step 1: List available capabilities
  dashclaw_capabilities_list(search="slack")
  → [{id: "cap_slack_notify", name: "Slack Notifications", health: "healthy", risk: "medium"}]

Step 2: Check the capability's health
  If health == "degraded" or "failing" → inform user, consider alternatives

Step 3: Invoke through the registered effect seam
  dashclaw_invoke(capability_id="cap_slack_notify",
                  declared_goal="Notify team of completed analysis",
                  payload={"channel": "#team", "message": "Analysis complete"})
```
