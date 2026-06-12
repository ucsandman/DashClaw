# Fleet digest

A daily digest (decision mix, pending approvals, interruption-budget state,
spend, top signals) delivered through your configured notification adapters
(Slack/Discord/email/...). Cadence: `DASHCLAW_DIGEST_INTERVAL_HOURS` org
setting (default 24, `0` disables). Requires adapter credentials in Settings.

Delivery piggybacks on agent traffic (no cron needed). If your fleet can be
idle for days and you still want a digest on schedule, add a GitHub Actions
kicker that exercises the tick:

```yaml
# .github/workflows/digest-kicker.yml (optional — in YOUR ops repo, not required here)
on:
  schedule: [{ cron: '0 13 * * *' }]
jobs:
  kick:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -s -X POST "$DASHCLAW_URL/api/actions" \
            -H "x-api-key: $DASHCLAW_API_KEY" -H "Content-Type: application/json" \
            -d '{"agent_id":"digest-kicker","action_type":"monitor","declared_goal":"digest tick"}'
        env:
          DASHCLAW_URL: ${{ secrets.DASHCLAW_URL }}
          DASHCLAW_API_KEY: ${{ secrets.DASHCLAW_API_KEY }}
```
