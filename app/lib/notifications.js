/**
 * Email notification helpers using Resend.
 * No-op if RESEND_API_KEY is not set.
 */

/**
 * Send a signal alert email to a user.
 *
 * @param {string} to - recipient email
 * @param {string} orgName - organization name
 * @param {Array} signals - array of signal objects
 * @returns {Promise<boolean>} true if sent
 */
export async function sendSignalAlertEmail(to, orgName, signals) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;

  const fromEmail = process.env.ALERT_FROM_EMAIL || 'practicalsystems.io@gmail.com';
  const redCount = signals.filter(s => s.severity === 'red').length;
  const amberCount = signals.filter(s => s.severity === 'amber').length;

  const severityLabel = redCount > 0 ? 'critical' : 'warning';
  const subject = `[DashClaw] ${signals.length} ${severityLabel} signal(s) detected — ${orgName}`;

  const signalRows = signals.map(s => {
    const icon = s.severity === 'red' ? '🔴' : '🟡';
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #333;">${icon} ${s.severity.toUpperCase()}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #333;">${escapeHtml(s.type)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #333;">${escapeHtml(s.label)}</td>
    </tr>`;
  }).join('\n');

  const html = `
    <div style="font-family:Inter,system-ui,sans-serif;max-width:600px;margin:0 auto;background:#1a1a1a;color:#e4e4e7;padding:24px;border-radius:8px;">
      <h2 style="color:#f97316;margin:0 0 8px;">DashClaw Signal Alert</h2>
      <p style="color:#a1a1aa;margin:0 0 20px;">${signals.length} new signal(s) detected for <strong>${escapeHtml(orgName)}</strong></p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="border-bottom:2px solid #333;">
            <th style="padding:8px 12px;text-align:left;color:#a1a1aa;">Severity</th>
            <th style="padding:8px 12px;text-align:left;color:#a1a1aa;">Type</th>
            <th style="padding:8px 12px;text-align:left;color:#a1a1aa;">Signal</th>
          </tr>
        </thead>
        <tbody>
          ${signalRows}
        </tbody>
      </table>
      <p style="margin:20px 0 0;"><a href="${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/security" style="color:#f97316;text-decoration:underline;">View in Security Dashboard →</a></p>
      <p style="color:#52525b;font-size:12px;margin:20px 0 0;">You are receiving this because you have email alerts enabled in DashClaw. Manage preferences in Settings → Notifications.</p>
    </div>
  `;

  const text = `DashClaw Signal Alert\n\n${signals.length} new signal(s) detected for ${orgName}:\n\n${signals.map(s => `[${s.severity.toUpperCase()}] ${s.type}: ${s.label}`).join('\n')}\n\nView: ${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/security`;

  try {
    const { Resend } = require('resend');
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: `DashClaw Alerts <${fromEmail}>`,
      to,
      subject,
      html,
      text,
    });
    return true;
  } catch (err) {
    console.error('[EMAIL] Failed to send alert:', err.message);
    return false;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
