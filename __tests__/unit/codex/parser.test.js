// __tests__/unit/codex/parser.test.js
//
// Tests for the Codex JSONL session parser. Uses a small fixture rollout
// that exercises every branch in the parser (session_meta, response_item
// for user/assistant/reasoning/function_call/function_call_output, and
// event_msg for session_configured and token_count).

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseCodexSessionLines,
  parseCodexSessionFile,
  CODEX_PARSER_VERSION,
  CODEX_AGENT_KIND,
} from '../../../app/lib/codex/parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(
  __dirname, '..', '..', '..',
  'cli', 'test', 'fixtures', 'codex-sessions', 'sample-rollout.jsonl',
);

function loadFixtureLines() {
  return fs.readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean);
}

describe('parseCodexSessionLines (in-memory)', () => {
  const lines = loadFixtureLines();
  const session = parseCodexSessionLines(lines, { sourceFile: FIXTURE });

  it('reports agentKind=codex', () => {
    assert.equal(session.agentKind, CODEX_AGENT_KIND);
  });

  it('extracts session metadata from session_meta line', () => {
    assert.equal(session.sessionUuid, '01997d4f-7be5-7df4-bb78-eef99e7e0e9d');
    assert.equal(session.cwd, '/home/u/proj');
    assert.equal(session.cliVersion, '0.74.0');
    assert.equal(session.originator, 'codex_cli_rs');
    assert.equal(session.modelProvider, 'openai');
    assert.equal(session.gitBranch, 'main');
    assert.equal(session.gitCommit, 'abc123');
    assert.equal(session.gitRepoUrl, 'git@github.com:u/proj.git');
  });

  it('picks up primary model from session_configured event', () => {
    assert.equal(session.modelPrimary, 'gpt-5');
  });

  it('counts jsonl records and skipped lines', () => {
    assert.equal(session.jsonlRecords, lines.length);
    assert.equal(session.skippedLines, 0);
  });

  it('aggregates per-turn token counts from token_count events', () => {
    assert.equal(session.turnCount, 2);
    assert.equal(session.turns[0].inputTokens, 1200);
    assert.equal(session.turns[0].cachedInputTokens, 800);
    assert.equal(session.turns[0].outputTokens, 150);
    assert.equal(session.turns[0].reasoningTokens, 300);
    assert.equal(session.turns[1].inputTokens, 1700);
  });

  it('sums token totals across all turns', () => {
    // Two turns: 1200+1700 input; 800+1500 cached; 150+80 output; 300+120 reasoning
    assert.equal(session.totals.input_tokens, 2900);
    assert.equal(session.totals.cache_read_tokens, 2300);
    assert.equal(session.totals.output_tokens, 230);
    assert.equal(session.totals.reasoning_tokens, 420);
    // Codex has no equivalent to Claude's cache_creation_tokens.
    assert.equal(session.totals.cache_creation_tokens, 0);
  });

  it('captures tool calls with safe targets', () => {
    assert.equal(session.toolCallCount, 2);
    assert.equal(session.toolUses[0].name, 'local_shell');
    assert.equal(session.toolUses[0].tool_use_id, 'call_abc');
    // safeToolTarget extracts the executable head.
    assert.equal(session.toolUses[0].target, 'bash');
  });

  it('builds a message timeline including user/assistant/reasoning/tool', () => {
    const roles = session.messages.map((m) => m.role);
    assert.ok(roles.includes('user'));
    assert.ok(roles.includes('assistant'));
    assert.ok(roles.includes('reasoning'));
    assert.ok(roles.includes('tool_call'));
    assert.ok(roles.includes('tool_result'));
  });

  it('tracks startedAt and endedAt timestamps', () => {
    assert.equal(session.startedAt, '2026-05-13T16:00:00.000Z');
    assert.equal(session.endedAt, '2026-05-13T16:00:27.000Z');
  });

  it('reports parser version', () => {
    assert.equal(session.parserVersion, CODEX_PARSER_VERSION);
  });
});

describe('parseCodexSessionLines (robustness)', () => {
  it('returns a session shell when input is empty', () => {
    const s = parseCodexSessionLines([]);
    assert.equal(s.jsonlRecords, 0);
    assert.equal(s.skippedLines, 0);
    assert.equal(s.sessionUuid, null);
  });

  it('counts unparseable lines in skippedLines', () => {
    const s = parseCodexSessionLines(['not json', '{"timestamp":"x","type":"unknown","payload":{}}']);
    assert.equal(s.skippedLines, 1);
    assert.equal(s.jsonlRecords, 1);
  });

  it('tolerates missing payload field', () => {
    const s = parseCodexSessionLines(['{"timestamp":"2026-01-01T00:00:00Z","type":"session_meta"}']);
    assert.equal(s.jsonlRecords, 1);
    assert.equal(s.sessionUuid, null);
  });

  it('throws on non-array input', () => {
    assert.throws(() => parseCodexSessionLines('not an array'), TypeError);
  });
});

describe('parseCodexSessionFile (stream)', () => {
  it('parses a real JSONL file with the same result as parseCodexSessionLines', async () => {
    const fromFile = await parseCodexSessionFile(FIXTURE);
    const fromMem = parseCodexSessionLines(loadFixtureLines(), { sourceFile: FIXTURE });

    // Use a stable comparison key set (mtime varies between stat and the
    // explicit lines version, so we ignore sourceMtime).
    for (const key of [
      'agentKind', 'sessionUuid', 'cwd', 'modelPrimary',
      'jsonlRecords', 'skippedLines', 'turnCount', 'toolCallCount',
    ]) {
      assert.equal(fromFile[key], fromMem[key], `mismatch on ${key}`);
    }
    assert.deepEqual(fromFile.totals, fromMem.totals);
  });
});
