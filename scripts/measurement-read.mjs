#!/usr/bin/env node
// v6.5 measurement read — the v5.5 contract, applied as arithmetic.
//
// Contract (docs/superpowers/specs/2026-07-05-reach-readiness-verdict-v55.md):
//   Cohort:  all mints in the 14 days following the reach act (2026-07-05).
//   Success: >=1 stranger reaches firstAction -> the mechanism converted
//            attention ("activation"). Directional if n>=8: >=25% rate.
//   Counter-verdict: n>=10 mints with firstAction = 0 -> friction diagnosis
//            falsified; diagnosis moves to value-prop/positioning (Wes's).
//   Neither threshold reached -> no verdict fires (attention insufficient).
//
// Cohort derivation uses only the public funnel instrument: every pre-act
// mint predates v6.4 and carries mintSource 'unknown'; every mint from the
// act forward carries a real source label. So at window close,
// cohort = all bySource buckets except 'unknown'. This is exact ONLY while
// no post-window mints exist — run the read at/near 2026-07-19, not weeks
// later (the script warns when run late).

export const ACT_DATE = '2026-07-05';
export const READ_DATE = '2026-07-19'; // act + 14 days
export const DEFAULT_FUNNEL_URL = 'https://hosted.dashclaw.io/api/hosted/funnel';

/** Cohort = every sourced bucket; 'unknown' = pre-v6.4 (pre-act) mints. */
export function deriveCohort(bySource) {
  const channels = (bySource ?? []).filter((s) => s.source !== 'unknown');
  return {
    channels,
    n: channels.reduce((sum, s) => sum + s.minted, 0),
    firstAction: channels.reduce((sum, s) => sum + s.firstAction, 0),
  };
}

/** The v5.5 contract arithmetic, unchanged. */
export function applyContract({ n, firstAction }) {
  const directional =
    n >= 8 ? { rate: Math.round((firstAction / n) * 1000) / 10, target: 25 } : null;
  if (firstAction >= 1) return { verdict: 'activation', directional };
  if (n >= 10) return { verdict: 'counter-verdict', directional };
  return { verdict: 'no-verdict', directional };
}

const VERDICT_LINES = {
  activation:
    'ACTIVATION — >=1 cohort firstAction: the mechanism converts attention.',
  'counter-verdict':
    'COUNTER-VERDICT — n>=10 with zero firstActions: friction diagnosis falsified; the diagnosis moves to value-prop/positioning (strategy, Wes\'s).',
  'no-verdict':
    'NO VERDICT FIRES — zero firstActions but n<10: the window produced too little attention to falsify either way.',
};

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : null;
  };
  const url = flag('url') ?? DEFAULT_FUNNEL_URL;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`funnel fetch failed: ${res.status} ${url}`);
  const funnel = await res.json();

  const today = new Date().toISOString().slice(0, 10);
  const mode = today < READ_DATE ? 'PREVIEW (window still open — not the read)' : 'READ';
  const late = today > '2026-07-26';

  const cohort = deriveCohort(funnel.annotations?.bySource);
  const { verdict, directional } = applyContract(cohort);

  const lines = [
    `# v6.5 measurement read — ${mode}`,
    '',
    `Computed ${funnel.computedAt} from ${url}`,
    `Window: ${ACT_DATE} -> ${READ_DATE} (v5.5 contract: all mints in the 14 days following the act)`,
    '',
    '## Cohort (per channel, v6.4 bySource; \'unknown\' = pre-act, excluded)',
    '',
    '| source | minted | firstAction |',
    '|--------|--------|-------------|',
    ...cohort.channels.map((s) => `| ${s.source} | ${s.minted} | ${s.firstAction} |`),
    `| **cohort total** | **${cohort.n}** | **${cohort.firstAction}** |`,
    '',
    '## Contract arithmetic',
    '',
    `- n = ${cohort.n} mints; firstAction = ${cohort.firstAction}`,
    directional
      ? `- Directional (n>=8): first-action rate ${directional.rate}% vs >=${directional.target}% target`
      : `- Directional target not evaluable (n < 8)`,
    `- ${VERDICT_LINES[verdict]}`,
  ];
  if (late) {
    lines.push(
      '',
      'WARNING: read taken well after window close — sourced mints made after ' +
        `${READ_DATE} pollute the source-derived cohort; cross-check the weekly cohorts.`,
    );
  }
  console.log(lines.join('\n'));
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
