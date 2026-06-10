import type {
  AdapterCreds,
  AdapterResult,
  GovernanceSignal,
  NotificationAdapter,
} from './index';

export const githubAdapter: NotificationAdapter = {
  name: 'github',
  requiredKeys: ['GITHUB_TOKEN'],

  async send(signals: GovernanceSignal[], creds: AdapterCreds): Promise<AdapterResult> {
    const critical = signals.filter((s) => s.severity === 'red');
    if (critical.length === 0) return { success: true, message: 'No critical signals, skipped' };

    const repo = creds.GITHUB_REPO; // e.g., 'owner/repo'
    if (!repo) return { success: false, message: 'GITHUB_REPO not configured' };

    const title = `[DashClaw] ${critical.length} critical governance signal${critical.length > 1 ? 's' : ''}`;
    const body = critical.map((s) =>
      `### ${s.severity === 'red' ? '🔴' : '🟡'} ${s.label}\n${s.detail}${s.agent_id ? `\n**Agent:** ${s.agent_id}` : ''}${s.help ? `\n**Action:** ${s.help}` : ''}`
    ).join('\n\n---\n\n');

    const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.GITHUB_TOKEN}`,
        'User-Agent': 'DashClaw-Governance',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        body,
        labels: ['dashclaw', 'governance-signal'],
      }),
    });

    if (res.status === 201) {
      const issue = await res.json();
      return { success: true, message: `Created #${issue.number}` };
    }
    return { success: false, message: `GitHub returned ${res.status}` };
  },
};
