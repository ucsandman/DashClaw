/**
 * Bundles the four hook artefacts the Optimal Files surface emits:
 *   - Repeated tool-run guard
 *   - Cost/budget guard
 *   - Dangerous-command guard
 *   - Secret-output guard
 *
 * Ported from AgentLens (`src/optimal-files/hooks-bundle.js`). Pure.
 */

import { generateHook } from '../hooks-gen';

interface InstallInfo {
  hookEvent?: string;
  settingsFile?: string;
  snippetJson?: string;
  steps?: string[];
  snippet?: unknown;
}

/** Loose shape of the analyzer output consumed here; fields stay dynamic. */
interface Analysis {
  session?: { session_uuid?: string } | null;
  project?: { slug?: string } | null;
  projectCwd?: string;
  repeatedRunSummary: { high: number; medium: number };
  confidence: {
    repeatedRunGuard: string;
    costGuard: string;
    dangerousCommandGuard: string;
    [key: string]: unknown;
  };
  projectMedianCost?: number | null;
  cost: { usd: number };
  dangerousCommands: unknown[];
  [key: string]: unknown;
}

export interface HookBundleItem {
  path: string;
  kind: string;
  title: string;
  content: string;
  reason: string;
  confidence: string;
  commitRecommendation: string;
  group: string;
  install: InstallInfo;
}

export function generateHooksBundle(analysis: Analysis): HookBundleItem[] {
  const a = analysis;
  const sid = (a.session && a.session.session_uuid) || '?';
  const slug = (a.project && a.project.slug) || null;

  const out: HookBundleItem[] = [];

  // 1. Repeated tool-run guard — fires only when there's actual evidence.
  const showRepeat = a.repeatedRunSummary.high >= 1 || a.repeatedRunSummary.medium >= 2;
  if (showRepeat) {
    const hook = generateHook({
      kind: 'stuck-loop',
      threshold: 5,
      sessionId: sid,
      projectSlug: slug,
      projectCwd: a.projectCwd,
    });
    out.push({
      path: '.claude/hooks/agentlens-repeated-tool-run-guard.py',
      kind: 'hook-repeated-tool-run',
      title: 'Repeated tool-run guard',
      content: hook.content + '\n# Install snippet (settings.json):\n# ' +
        hook.install.snippetJson.split('\n').join('\n# ') + '\n',
      reason: a.confidence.repeatedRunGuard === 'high'
        ? `Session had ${a.repeatedRunSummary.high} high-confidence repeated-run signal(s) — guard will block at threshold 5.`
        : `Session had ${a.repeatedRunSummary.medium} medium-confidence repeated runs — guard available, not silently activated.`,
      confidence: a.confidence.repeatedRunGuard,
      commitRecommendation: 'review',
      group: 'optional',
      install: hook.install,
    });
  }

  // 2. Cost/budget guard — fires when session cost exceeds threshold OR
  // project median is comfortably available.
  const costSignal = a.confidence.costGuard !== 'low' || (a.projectMedianCost && a.projectMedianCost > 0);
  if (costSignal) {
    const hook = generateHook({
      kind: 'cost-limit',
      sessionId: sid,
      projectSlug: slug,
      projectCwd: a.projectCwd,
      projectMedianUsd: a.projectMedianCost || undefined,
    });
    const limitNote = a.projectMedianCost
      ? `Default limit ~ $${(a.projectMedianCost * 3).toFixed(2)} (3x project median, an estimate — adjust before strict mode).`
      : `No project median available — limit defaults to $6.00; please tune.`;
    out.push({
      path: '.claude/hooks/agentlens-cost-budget-guard.py',
      kind: 'hook-cost-budget',
      title: 'Cost / budget guard',
      content: hook.content + '\n# ' + limitNote + '\n# Install snippet:\n# ' +
        hook.install.snippetJson.split('\n').join('\n# ') + '\n',
      reason: a.confidence.costGuard === 'high'
        ? `Session cost $${a.cost.usd.toFixed(2)} exceeded 1.5x project median — guard recommended.`
        : `Session cost $${a.cost.usd.toFixed(2)} — guard available, default warns rather than blocks.`,
      confidence: a.confidence.costGuard,
      commitRecommendation: 'review',
      group: 'optional',
      install: hook.install,
    });
  }

  // 3. Dangerous-command guard — generated only if dangerous patterns appeared.
  if (a.dangerousCommands.length) {
    const content = renderDangerousCommandGuard({ projectSlug: slug, sessionId: sid });
    out.push({
      path: '.claude/hooks/agentlens-dangerous-command-guard.py',
      kind: 'hook-dangerous-command',
      title: 'Dangerous-command guard',
      content,
      reason: `Session attempted ${a.dangerousCommands.length} dangerous command pattern(s). Guard blocks them by default and shows the reason; never hides the command.`,
      confidence: a.confidence.dangerousCommandGuard,
      commitRecommendation: 'review',
      group: 'recommended_now',
      install: {
        hookEvent: 'PreToolUse',
        settingsFile: '.claude/settings.json (inside this project)',
      },
    });
  }

  // 4. Secret-output guard — always offered; pure preventive layer.
  out.push({
    path: '.claude/hooks/agentlens-secret-output-guard.py',
    kind: 'hook-secret-output',
    title: 'Secret-output guard',
    content: renderSecretOutputGuard({ projectSlug: slug, sessionId: sid }),
    reason: 'Pre-emptive: scans Write/Bash tool output for secret patterns and blocks if matches. Never auto-activates — must be wired into settings.json.',
    confidence: 'medium',
    commitRecommendation: 'review',
    group: 'optional',
    install: {
      hookEvent: 'PreToolUse',
      settingsFile: '.claude/settings.json (inside this project)',
    },
  });

  return out;
}

interface GuardRenderArgs {
  projectSlug: string | null;
  sessionId: string;
}

export function renderDangerousCommandGuard({ projectSlug, sessionId }: GuardRenderArgs): string {
  return [
    `#!/usr/bin/env python3`,
    `"""Auto-generated by DashClaw Code Sessions. Dangerous-command guard hook for Claude Code.`,
    ``,
    `Project: ${projectSlug || '(unknown)'}`,
    `Source session: ${sessionId || '(none)'}`,
    ``,
    `Wire this into .claude/settings.json under hooks.PreToolUse with matcher 'Bash'.`,
    `The guard NEVER hides the command — it always prints what was blocked and why.`,
    `"""`,
    `import json, re, sys, traceback`,
    ``,
    `BLOCKED = [`,
    `    # Trailing \\b dropped intentionally: at end-of-string after a non-word`,
    `    # char like / the regex word boundary does not match, so "rm -rf /" would slip through.`,
    `    (re.compile(r"\\brm\\s+-rf\\s+(/|~|\\$HOME|\\*|\\.)"), "rm -rf at filesystem root or home"),`,
    `    (re.compile(r"\\bgit\\s+push\\s+.*--force\\b"), "git push --force"),`,
    `    (re.compile(r"\\bgit\\s+reset\\s+--hard\\b"), "git reset --hard"),`,
    `    (re.compile(r"\\bDROP\\s+(?:TABLE|DATABASE)\\b", re.IGNORECASE), "destructive SQL"),`,
    `    (re.compile(r"\\bsudo\\s+rm\\b"), "sudo rm"),`,
    `]`,
    ``,
    `def main():`,
    `    raw = sys.stdin.read() or "{}"`,
    `    try: event = json.loads(raw)`,
    `    except Exception: return 0`,
    `    if event.get("tool_name") != "Bash": return 0`,
    `    cmd = (event.get("tool_input") or {}).get("command") or ""`,
    `    if not cmd: return 0`,
    `    for pattern, reason in BLOCKED:`,
    `        if pattern.search(cmd):`,
    `            sys.stderr.write(`,
    `                f"dashclaw dangerous-command guard blocked this command:\\n"`,
    `                f"  command: {cmd}\\n"`,
    `                f"  reason : {reason}\\n"`,
    `                f"Edit BLOCKED in the hook script if this is a false positive.\\n"`,
    `            )`,
    `            return 2`,
    `    return 0`,
    ``,
    `if __name__ == "__main__":`,
    `    try: sys.exit(main())`,
    `    except Exception:`,
    `        traceback.print_exc(file=sys.stderr); sys.exit(0)`,
    ``,
  ].join('\n');
}

export function renderSecretOutputGuard({ projectSlug, sessionId }: GuardRenderArgs): string {
  return [
    `#!/usr/bin/env python3`,
    `"""Auto-generated by DashClaw Code Sessions. Secret-output guard hook for Claude Code.`,
    ``,
    `Project: ${projectSlug || '(unknown)'}`,
    `Source session: ${sessionId || '(none)'}`,
    ``,
    `Scans the proposed content of a Write/Edit tool call for obvious secret`,
    `patterns. If any match, the hook exits 2 with stderr explaining what was`,
    `flagged. Patterns mirror DashClaw's redaction layer.`,
    `"""`,
    `import json, re, sys, traceback`,
    ``,
    `PATTERNS = [`,
    `    (re.compile(r"sk_test_[A-Za-z0-9]{8,}"), "stripe_test"),`,
    `    (re.compile(r"sk_live_[A-Za-z0-9]{8,}"), "stripe_live"),`,
    `    (re.compile(r"whsec_[A-Za-z0-9]{8,}"), "stripe_webhook"),`,
    `    (re.compile(r"sk-ant-[A-Za-z0-9_\\-]{20,}"), "anthropic_key"),`,
    `    (re.compile(r"(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}"), "github_pat"),`,
    `    (re.compile(r"AKIA[0-9A-Z]{16}"), "aws_access"),`,
    `    (re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----"), "private_key"),`,
    `]`,
    ``,
    `def main():`,
    `    raw = sys.stdin.read() or "{}"`,
    `    try: event = json.loads(raw)`,
    `    except Exception: return 0`,
    `    if event.get("tool_name") not in ("Write", "Edit", "MultiEdit", "Bash"): return 0`,
    `    inp = event.get("tool_input") or {}`,
    `    haystack = ""`,
    `    for k in ("content", "new_string", "command", "stdin"):`,
    `        v = inp.get(k)`,
    `        if isinstance(v, str): haystack += "\\n" + v`,
    `    hits = []`,
    `    for pat, name in PATTERNS:`,
    `        if pat.search(haystack): hits.append(name)`,
    `    if hits:`,
    `        sys.stderr.write(`,
    `            "dashclaw secret-output guard blocked this tool call.\\n"`,
    `            f"  matched: {sorted(set(hits))}\\n"`,
    `            "  rewrite the content to redact the secret, or read it from a local env file instead.\\n"`,
    `        )`,
    `        return 2`,
    `    return 0`,
    ``,
    `if __name__ == "__main__":`,
    `    try: sys.exit(main())`,
    `    except Exception:`,
    `        traceback.print_exc(file=sys.stderr); sys.exit(0)`,
    ``,
  ].join('\n');
}
