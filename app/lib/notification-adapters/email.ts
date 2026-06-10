import type {
  AdapterCreds,
  AdapterResult,
  GovernanceSignal,
  NotificationAdapter,
} from './index';

export const emailAdapter: NotificationAdapter = {
  name: 'email',
  requiredKeys: ['RESEND_API_KEY', 'SENDGRID_API_KEY'],

  async send(
    signals: GovernanceSignal[],
    creds: AdapterCreds,
    orgId?: string,
  ): Promise<AdapterResult> {
    if (creds.RESEND_API_KEY) {
      return sendViaResend(signals, creds, orgId);
    }
    if (creds.SENDGRID_API_KEY) {
      return sendViaSendGrid(signals, creds);
    }
    return { success: false, message: 'No email provider configured' };
  },
};

async function sendViaResend(
  signals: GovernanceSignal[],
  creds: AdapterCreds,
  orgId?: string,
): Promise<AdapterResult> {
  const { sendSignalAlertEmail } = await import('../notifications');
  const to = creds.DASHCLAW_ALERT_EMAIL || creds.RESEND_DEFAULT_TO;
  if (!to) return { success: false, message: 'No alert email configured' };

  const sent = await sendSignalAlertEmail(to, orgId, signals);
  return sent
    ? { success: true, message: `Sent to ${to}` }
    : { success: false, message: 'Email send failed' };
}

async function sendViaSendGrid(
  signals: GovernanceSignal[],
  creds: AdapterCreds,
): Promise<AdapterResult> {
  const to = creds.DASHCLAW_ALERT_EMAIL || creds.SENDGRID_DEFAULT_TO;
  if (!to) return { success: false, message: 'No alert email configured' };

  const redCount = signals.filter((s) => s.severity === 'red').length;
  const amberCount = signals.filter((s) => s.severity === 'amber').length;

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: creds.SENDGRID_FROM_EMAIL || 'alerts@dashclaw.io' },
      subject: `[DashClaw] ${signals.length} signal${signals.length > 1 ? 's' : ''} — ${redCount} critical, ${amberCount} amber`,
      content: [{
        type: 'text/plain',
        value: signals.map((s) => `[${s.severity.toUpperCase()}] ${s.label}: ${s.detail}`).join('\n'),
      }],
    }),
  });

  return res.status === 202
    ? { success: true, message: `Sent to ${to}` }
    : { success: false, message: `SendGrid returned ${res.status}` };
}
