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

/**
 * Split on |, && , || and ; while respecting single and double quotes and
 * backslash escapes.
 */
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
    if (ch === '\\') {
      // Outside quotes, a backslash escapes the next character so it
      // cannot act as a separator or start a quote — e.g. `foo\; bar` is
      // one command, not two. The escaped character is kept as-is here;
      // only tokenise() resolves it to its final, unescaped form.
      buf += ch;
      if (i + 1 < command.length) {
        buf += command[i + 1];
        i += 1;
      }
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
      // A single & backgrounds the preceding command, which ends it, so
      // it is treated as a stage separator too.
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * Split a stage into words, keeping quoted runs together, unquoting them,
 * and resolving backslash escapes.
 */
function tokenise(stage: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: string | null = null;
  let quoted = false;
  let escaped = false;

  const flush = () => {
    if (buf || quoted) out.push(buf);
    buf = '';
    quoted = false;
  };

  for (const ch of stage) {
    if (escaped) {
      buf += ch;
      escaped = false;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        buf += ch;
      }
      continue;
    }
    if (ch === '\\') {
      // Outside quotes, a backslash escapes the next character so it
      // cannot act as a separator, a quote, or whitespace; the backslash
      // itself is dropped, the same way a quote character is dropped.
      escaped = true;
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

/**
 * Whether a bare word has subcommand shape: lowercase alphanumeric groups
 * joined by single dashes. A value-taking global flag donates its value to
 * the bare-word list ahead of the real subcommand (`npm --prefix ./x
 * install`, `git -C /repo status`) — this parser has no notion of flag
 * arity, so positionally it cannot tell that value apart from a subcommand.
 * Naming that value as the subcommand would be an actively wrong noun, and
 * this module would rather answer "no subcommand" than answer wrong. A path
 * (containing '/', '\' or starting with '.') never matches.
 */
function looksLikeSubcommand(word: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(word);
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
    const candidate = bare[0];
    if (SUBCOMMAND_BINARIES.has(binary) && candidate !== undefined && looksLikeSubcommand(candidate)) {
      subcommand = candidate;
      operands = bare.slice(1);
    }

    return { binary, subcommand, flags, operands, raw };
  }).filter((s) => s.binary !== '');
}
