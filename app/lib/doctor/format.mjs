// app/lib/doctor/format.mjs

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const BOLD = (s) => `${ESC}1m${s}${RESET}`;
const DIM = (s) => `${ESC}2m${s}${RESET}`;
const GREEN = (s) => `${ESC}32m${s}${RESET}`;
const YELLOW = (s) => `${ESC}33m${s}${RESET}`;
const RED = (s) => `${ESC}31m${s}${RESET}`;

const ICONS = { pass: GREEN('✓'), warn: YELLOW('⚠'), fail: RED('✗'), skipped: DIM('-') };

function getNextAction(check) {
  return check.nextAction || check.fix?.description || '';
}

function getLikelyCause(check) {
  return check.likelyCause || '';
}

const CATEGORY_LABELS = {
  database: 'Database',
  config: 'Configuration',
  auth: 'Auth',
  deployment: 'Deployment',
  sdk: 'SDK',
  governance: 'Governance',
  shape: 'Shape (generated)',
  drift: 'Drift',
  'openclaw-plugin': 'OpenClaw Plugin',
  hosted: 'Hosted',
};

const CATEGORY_ORDER = ['database', 'config', 'auth', 'deployment', 'sdk', 'governance', 'shape', 'drift', 'openclaw-plugin', 'hosted'];

/**
 * Format the full doctor result for terminal or JSON output.
 * @param {object} result
 * @param {{ json?: boolean }} options
 */
export function formatDoctorResult(result, { json = false } = {}) {
  if (json) return JSON.stringify(result, null, 2);

  const lines = ['', ` ${BOLD('DashClaw Doctor')}`, ''];

  const grouped = {};
  for (const check of result.checks) {
    if (!grouped[check.category]) grouped[check.category] = [];
    grouped[check.category].push(check);
  }

  for (const cat of CATEGORY_ORDER) {
    const checks = grouped[cat];
    if (!checks || checks.length === 0) continue;

    lines.push(` ${BOLD(CATEGORY_LABELS[cat] || cat)}`);
    for (const check of checks) {
      const icon = ICONS[check.status] || '?';
      lines.push(`  ${icon} ${check.title}`);
      if (check.status !== 'pass') {
        lines.push(`    ${DIM(check.message)}`);
        const likelyCause = getLikelyCause(check);
        if ((check.status === 'warn' || check.status === 'fail') && likelyCause) {
          lines.push(`    ${DIM(`Likely cause: ${likelyCause}`)}`);
        }
        const nextAction = getNextAction(check);
        if ((check.status === 'warn' || check.status === 'fail') && nextAction) {
          lines.push(`    ${DIM(`NEXT: ${nextAction}`)}`);
        }
      }
    }
    lines.push('');
  }

  const { pass, warn, fail } = result.summary;
  const parts = [];
  if (pass > 0) parts.push(GREEN(`${pass} passed`));
  if (warn > 0) parts.push(YELLOW(`${warn} warning${warn !== 1 ? 's' : ''}`));
  if (fail > 0) parts.push(RED(`${fail} failed`));
  lines.push(` ${BOLD('Summary:')} ${parts.join(', ')}`);

  lines.push('');
  return lines.join('\n');
}

/**
 * Format a fix result for terminal or JSON output.
 * @param {{ applied: boolean, action: string, description: string }} result
 * @param {{ json?: boolean }} options
 */
export function formatFixResult(result, { json = false } = {}) {
  if (json) return JSON.stringify(result, null, 2);
  const icon = result.applied ? GREEN('→') : RED('✗');
  return `  ${icon} ${result.description}`;
}

/**
 * Format the manual-action summary.
 * @param {Array<{ status: string, message: string, likelyCause?: string, nextAction?: string, fix?: object }>} manualChecks
 */
export function formatManualSummary(manualChecks) {
  if (manualChecks.length === 0) return '';
  const lines = ['', ` ${BOLD('Manual action needed:')}`];
  for (const check of manualChecks) {
    lines.push(`  ${YELLOW('•')} ${check.message}`);
    const likelyCause = getLikelyCause(check);
    if (likelyCause) lines.push(`    ${DIM(`Likely cause: ${likelyCause}`)}`);
    const nextAction = getNextAction(check);
    if (nextAction) lines.push(`    ${DIM(`NEXT: ${nextAction}`)}`);
  }
  lines.push('');
  return lines.join('\n');
}
