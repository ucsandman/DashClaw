import { describe, expect, it } from 'vitest';
import { deriveCwdFromLines } from '../../cli/lib/code/ingest.js';

// The encoded Claude Code project dir (c--projects-dashclaw) is not reversible
// to a real path, so the CLI recovers cwd from the transcript records instead
// of always sending null.
describe('deriveCwdFromLines — CLI client-side cwd recovery', () => {
  it('returns the first cwd found in the JSONL records', () => {
    const lines = [
      JSON.stringify({ type: 'summary', summary: 'x' }),
      JSON.stringify({ type: 'user', cwd: 'C:\\Projects\\DashClaw', message: {} }),
      JSON.stringify({ type: 'assistant', cwd: 'C:\\Projects\\Other', message: {} }),
    ];
    expect(deriveCwdFromLines(lines)).toBe('C:\\Projects\\DashClaw');
  });

  it('tolerates malformed lines and returns null when no cwd exists', () => {
    expect(deriveCwdFromLines(['{not json', JSON.stringify({ type: 'user' })])).toBeNull();
    expect(deriveCwdFromLines([])).toBeNull();
  });

  it('bounds the scan so giant transcripts stay cheap', () => {
    const filler = Array.from({ length: 60 }, () => JSON.stringify({ type: 'progress' }));
    const lines = [...filler, JSON.stringify({ type: 'user', cwd: '/late/cwd' })];
    // cwd appears after the 50-line scan window — intentionally not found.
    expect(deriveCwdFromLines(lines)).toBeNull();
    expect(deriveCwdFromLines(lines, 100)).toBe('/late/cwd');
  });
});
