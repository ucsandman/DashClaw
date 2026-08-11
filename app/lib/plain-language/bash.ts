import { parseShell, type ShellStage } from './parse-shell';
import { type PlainDescription, unknownDescription } from './types';

export interface BashIntel {
  intent?: string;
  risk_score?: number;
  reversible?: boolean;
  validations?: Array<{ check?: string; reason?: string }>;
}

interface Clause {
  text: string;
  warnings: string[];
  ruleId: string;
}

const MAX_OPERAND = 80;

/** Extracted values are bounded; the card renders them as data, not as prose. */
function noun(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_OPERAND ? `${flat.slice(0, MAX_OPERAND)}…` : flat;
}

function firstOperand(stage: ShellStage, fallback: string): string {
  const first = stage.operands[0];
  return first !== undefined ? noun(first) : fallback;
}

function hasFlag(stage: ShellStage, ...names: string[]): boolean {
  return stage.flags.some((f) => names.includes(f) || (f.startsWith('-') && !f.startsWith('--') && names.some((n) => {
    const ch = n[1];
    return n.length === 2 && ch !== undefined && f.includes(ch);
  })));
}

/** Returns null when the stage is not recognised. Null is a valid outcome. */
function describeStage(stage: ShellStage): Clause | null {
  const { binary, subcommand } = stage;

  if (binary === 'git' && subcommand === 'push') {
    if (hasFlag(stage, '--force', '--force-with-lease', '-f')) {
      return {
        text: 'Overwrites the shared code history on GitHub',
        warnings: ['Work other people pushed can be lost.'],
        ruleId: 'bash.git.push.force',
      };
    }
    return { text: 'Sends your code changes to GitHub', warnings: [], ruleId: 'bash.git.push' };
  }

  if (binary === 'rm') {
    const target = firstOperand(stage, 'a file');
    const recursive = hasFlag(stage, '-r', '-R', '--recursive');
    return {
      text: recursive
        ? `Deletes ${target} and everything inside it`
        : `Deletes ${target}`,
      warnings: ['Deleted files do not go to the Recycle Bin.'],
      ruleId: 'bash.rm',
    };
  }

  if (binary === 'curl' || binary === 'wget') {
    const url = firstOperand(stage, 'a website');
    return { text: `Downloads a file from ${url}`, warnings: [], ruleId: 'bash.download' };
  }

  if (binary === 'bash' || binary === 'sh' || binary === 'zsh') {
    return { text: 'Runs a script', warnings: [], ruleId: 'bash.interpreter' };
  }

  if ((binary === 'npm' || binary === 'pnpm' || binary === 'yarn') && (subcommand === 'install' || subcommand === 'i' || subcommand === 'add')) {
    const pkgOperand = stage.operands[0];
    const pkg = pkgOperand !== undefined ? noun(pkgOperand) : null;
    return {
      text: pkg
        ? `Adds a third-party package, ${pkg}, to your project`
        : "Installs the project's third-party packages",
      warnings: [],
      ruleId: 'bash.package.install',
    };
  }

  if (binary === 'psql' || binary === 'mysql') {
    const sql = stage.operands.join(' ').toUpperCase();
    if (sql.includes('DROP TABLE')) {
      return { text: 'Permanently deletes a table from your database', warnings: ['This cannot be undone.'], ruleId: 'bash.sql.drop' };
    }
    if (sql.includes('DELETE FROM')) {
      return { text: 'Deletes rows from your database', warnings: ['This cannot be undone.'], ruleId: 'bash.sql.delete' };
    }
    return { text: 'Runs a command against your database', warnings: [], ruleId: 'bash.sql' };
  }

  if (['ls', 'cat', 'pwd', 'head', 'tail', 'wc', 'which', 'echo', 'find', 'grep'].includes(binary)) {
    return { text: 'Reads information from your computer', warnings: ['Reads only, changes nothing.'], ruleId: 'bash.read' };
  }

  return null;
}

/**
 * curl|bash is materially different from either half: the operator never sees
 * the code that runs. Detected across stages, so it must be checked on the
 * pipeline rather than on any single stage.
 */
function isPipeToShell(stages: ShellStage[]): boolean {
  return stages.some((s, i) => {
    const next = stages[i + 1];
    return (s.binary === 'curl' || s.binary === 'wget') && !!next && ['bash', 'sh', 'zsh'].includes(next.binary);
  });
}

export function describeBash(command: string, bashIntel?: BashIntel): PlainDescription {
  const stages = parseShell(command);
  if (stages.length === 0) return unknownDescription('bash.empty');

  // The classifier is the only source of reversibility. Absent means unknown,
  // never true — a missing signal must not read as reassurance.
  const reversible: boolean | 'unknown' =
    typeof bashIntel?.reversible === 'boolean' ? bashIntel.reversible : 'unknown';

  if (isPipeToShell(stages)) {
    const firstStageOperand = stages[0]?.operands[0];
    const source = firstStageOperand !== undefined ? noun(firstStageOperand) : 'a website';
    return {
      headline: `Downloads a script from ${source} and runs it straight away, without showing it to you.`,
      warnings: ['Whoever controls that website chooses what runs.'],
      confidence: 'high',
      reversible,
      ruleId: 'bash.pipe-to-shell',
    };
  }

  const clauses = stages.map(describeStage);
  const known = clauses.filter((c): c is Clause => c !== null);
  if (known.length === 0) return unknownDescription('bash.unrecognised');

  const complete = known.length === stages.length;
  const text = known.map((c) => c.text).join(', then ');
  const warnings = [...new Set(known.flatMap((c) => c.warnings))];

  if (!complete) {
    warnings.unshift("There is more in this command that I can't read. Check it below before approving.");
  }

  // A mixed pipeline is not calm even if its first stage is; only a
  // single fully-recognised read stays on the calm rule id.
  const soleClause = known.length === 1 ? known[0] : undefined;
  const ruleId = complete && soleClause ? soleClause.ruleId : complete ? 'bash.sequence' : 'bash.partial';

  return {
    headline: complete ? `${text}.` : `${text}. There is more here I can't read.`,
    warnings,
    confidence: complete ? 'high' : 'partial',
    reversible,
    ruleId,
  };
}
