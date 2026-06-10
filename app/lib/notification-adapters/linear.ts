import type {
  AdapterCreds,
  AdapterResult,
  GovernanceSignal,
  NotificationAdapter,
} from './index';

export const linearAdapter: NotificationAdapter = {
  name: 'linear',
  requiredKeys: ['LINEAR_API_KEY'],

  async send(signals: GovernanceSignal[], creds: AdapterCreds): Promise<AdapterResult> {
    // Only create issues for critical signals to avoid noise
    const critical = signals.filter((s) => s.severity === 'red');
    if (critical.length === 0) return { success: true, message: 'No critical signals, skipped' };

    const teamQuery = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { Authorization: creds.LINEAR_API_KEY as string, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ teams { nodes { id name } } }' }),
    });
    const teamData = await teamQuery.json();
    const teamId = teamData?.data?.teams?.nodes?.[0]?.id;
    if (!teamId) return { success: false, message: 'No Linear team found' };

    const title = `[DashClaw] ${critical.length} critical governance signal${critical.length > 1 ? 's' : ''}`;
    const description = critical.map((s) =>
      `### ${s.label}\n${s.detail}${s.agent_id ? `\n**Agent:** ${s.agent_id}` : ''}${s.help ? `\n**Action:** ${s.help}` : ''}`
    ).join('\n\n---\n\n');

    const mutation = `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }`;
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { Authorization: creds.LINEAR_API_KEY as string, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: mutation,
        variables: { input: { teamId, title, description, priority: 1 } },
      }),
    });
    const result = await res.json();
    const issue = result?.data?.issueCreate?.issue;
    if (issue) return { success: true, message: `Created ${issue.identifier}` };
    return { success: false, message: 'Failed to create issue' };
  },
};
