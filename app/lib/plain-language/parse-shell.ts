/**
 * A deliberately dumb shell tokeniser.
 *
 * It extracts nouns for a sentence — binary, subcommand, flags, operands —
 * and nothing else. It NEVER decides whether a command is dangerous;
 * hooks/dashclaw_agent_intel/bash_classifier.py owns that judgement and its
 * verdict arrives on intel.bash. Two parsers exist here on purpose, answering
 * different questions, so they cannot drift on anything that matters.
 *
 * Shell grammar is hostile. Returning fewer stages, or none, is a correct
 * outcome — the caller degrades confidence rather than guessing.
 */

export interface ShellStage {
  binary: string;
  subcommand?: string;
  flags: string[];
  operands: string[];
  raw: string;
}

/** Binaries whose first bare word is a meaningful subcommand. */
const SUBCOMMAND_BINARIES = new Set(['git', 'npm', 'npx', 'docker', 'kubectl', 'pnpm', 'yarn', 'cargo', 'pip']);

/** Split on |, && , || and ; while respecting single and double quotes. */
function splitStages(command: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: string | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];

    if (quote) {
      if (ch === quote) quote = null;
      buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '&') {
      // Consume a doubled operator (&& or ||) as one separator.
      if ((ch === '&' || ch === '|') && command[i + 1] === ch) i += 1;
      // A single & is backgrounding, not a separator we care about.
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Split a stage into words, keeping quoted runs together and unquoting them. */
function tokenise(stage: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: string | null = null;
  let quoted = false;

  const flush = () => {
    if (buf || quoted) out.push(buf);
    buf = '';
    quoted = false;
  };

  for (const ch of stage) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        buf += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      quoted = true;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      flush();
      continue;
    }
    buf += ch;
  }
  flush();
  return out;
}

export function parseShell(command: string): ShellStage[] {
  return splitStages(command).map((raw) => {
    const tokens = tokenise(raw);
    const binary = tokens[0] || '';
    const rest = tokens.slice(1);

    const flags = rest.filter((t) => t.startsWith('-'));
    const bare = rest.filter((t) => !t.startsWith('-'));

    let subcommand: string | undefined;
    let operands = bare;
    if (SUBCOMMAND_BINARIES.has(binary) && bare.length > 0) {
      subcommand = bare[0];
      operands = bare.slice(1);
    }

    return { binary, subcommand, flags, operands, raw };
  }).filter((s) => s.binary !== '');
}
