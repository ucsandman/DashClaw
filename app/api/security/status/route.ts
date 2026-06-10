export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getOrgRole } from '../../../lib/org';

interface SecurityCheck {
  id: string;
  status: string;
  label: string;
  detail?: string;
}

// GET /api/security/status - Get security health status (admin only)
export async function GET(request: Request) {
  try {
    const role = getOrgRole(request);
    if (role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden - admin role required', score: 0, checks: [], timestamp: new Date().toISOString() },
        { status: 403 }
      );
    }

    const orgId = getOrgId(request);
    const sql = getSql();
    const hasDbUrl = Boolean(process.env.DATABASE_URL);

    const report: { score: number; checks: SecurityCheck[]; timestamp: string } = {
      score: 100,
      checks: [],
      timestamp: new Date().toISOString(),
    };

    // 1. Check Encryption Key
    const encKey = process.env.ENCRYPTION_KEY;
    if (!encKey) {
      report.checks.push({ id: 'enc_key_missing', status: 'critical', label: 'Encryption Key Missing', detail: 'ENCRYPTION_KEY env var is not set. Settings cannot be securely stored.' });
      report.score -= 40;
    } else if (encKey.length !== 32) {
      report.checks.push({ id: 'enc_key_invalid', status: 'warning', label: 'Encryption Key Invalid', detail: 'ENCRYPTION_KEY should be exactly 32 characters for AES-256.' });
      report.score -= 10;
    } else {
      report.checks.push({ id: 'enc_key_ok', status: 'ok', label: 'Encryption Key OK', detail: 'ENCRYPTION_KEY is configured correctly.' });
    }

    // 2. Check Database URL
    if (!hasDbUrl) {
      report.checks.push({ id: 'db_url_missing', status: 'critical', label: 'Database URL Missing', detail: 'DATABASE_URL env var is not set.' });
      report.score -= 40;
    } else {
      report.checks.push({ id: 'db_url_ok', status: 'ok', label: 'Database URL OK' });
    }

    // 3. Check for unencrypted sensitive settings
    if (hasDbUrl) {
      const sensitiveKeys = ['%_KEY', '%_TOKEN', '%_SECRET', '%_URL', '%_URI', '%_DSN', '%_PASSWORD'];
      try {
        const unencryptedCount = await sql`
          SELECT COUNT(*) as count FROM settings
          WHERE org_id = ${orgId}
          AND encrypted = false
          AND value IS NOT NULL
          AND (
            key LIKE ANY (${sensitiveKeys})
          )
          AND key NOT IN ('TELEGRAM_CHAT_ID', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'VERCEL_PROJECT_ID', 'CLOUDFLARE_ACCOUNT_ID', 'AIRTABLE_BASE_ID', 'ELEVENLABS_VOICE_ID', 'OPENAI_ORG_ID')
        `;

        const count = parseInt((unencryptedCount[0]?.count as string) || '0', 10);
        if (count > 0) {
          report.checks.push({
            id: 'unencrypted_settings',
            status: 'warning',
            label: 'Unencrypted Sensitive Settings',
            detail: `Found ${count} sensitive settings stored in plaintext. Update them to enable encryption.`
          });
          report.score -= (count * 5);
        } else {
          report.checks.push({ id: 'encryption_coverage_ok', status: 'ok', label: 'Settings Encryption Coverage OK' });
        }
      } catch (err) {
        report.checks.push({ id: 'db_query_failed', status: 'warning', label: 'Database Query Failed', detail: 'Could not query settings table to verify encryption coverage.' });
        report.score -= 10;
      }
    }

    // 4. SSRF Config
    const webhookAllowlist = process.env.WEBHOOK_ALLOWED_DOMAINS;
    if (!webhookAllowlist) {
      report.checks.push({
        id: 'webhook_allowlist_unset',
        status: 'info',
        label: 'Webhook Allowlist Unset',
        detail: 'WEBHOOK_ALLOWED_DOMAINS is not set. All external HTTPS URLs are allowed.'
      });
    } else {
      report.checks.push({
        id: 'webhook_allowlist_ok',
        status: 'ok',
        label: 'Webhook Allowlist Configured',
        detail: `Limited to: ${webhookAllowlist}`
      });
    }

    report.score = Math.max(0, report.score);

    return NextResponse.json(report);
  } catch (error) {
    console.error('Security status GET error:', error);
    return NextResponse.json(
      { error: 'Failed to generate security report', score: 0, checks: [], timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
