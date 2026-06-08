import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSamples } from '@/lib/behavior/sample-store';

let dir: string;

function writeDay(day: string, records: Array<Record<string, unknown>>) {
  writeFileSync(join(dir, `${day}.jsonl`), records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dc-samples-'));
  process.env.DASHCLAW_BEHAVIOR_SAMPLES_DIR = dir;
});
afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('readSamples — merge-on-read by event_id', () => {
  it('pre+post collapses to one finalized record', async () => {
    writeDay('2026-06-01', [
      { event_id: 'e1', agent_id: 'a', ts: '2026-06-01T00:00:01.000Z', outcome_status: 'running' },
      { event_id: 'e1', agent_id: 'a', ts: '2026-06-01T00:00:02.000Z', outcome_status: 'completed' },
    ]);
    const s = await readSamples({});
    expect(s).toHaveLength(1);
    expect(s[0]!.outcome_status).toBe('completed');
  });

  it('pre-only yields a single running record', async () => {
    writeDay('2026-06-01', [
      { event_id: 'e2', agent_id: 'a', ts: '2026-06-01T00:00:01.000Z', outcome_status: 'running' },
    ]);
    const s = await readSamples({});
    expect(s).toHaveLength(1);
    expect(s[0]!.outcome_status).toBe('running');
  });

  it('interrupted supersedes running (early-stop flush)', async () => {
    writeDay('2026-06-01', [
      { event_id: 'e3', agent_id: 'a', ts: '2026-06-01T00:00:01.000Z', outcome_status: 'running' },
      { event_id: 'e3', agent_id: 'a', ts: '2026-06-01T00:00:03.000Z', outcome_status: 'interrupted' },
    ]);
    const s = await readSamples({});
    expect(s).toHaveLength(1);
    expect(s[0]!.outcome_status).toBe('interrupted');
  });

  it('counts are correct across mixed events even when PostToolUse missed', async () => {
    writeDay('2026-06-01', [
      { event_id: 'e1', agent_id: 'a', ts: '2026-06-01T00:00:01.000Z', outcome_status: 'running' },
      { event_id: 'e1', agent_id: 'a', ts: '2026-06-01T00:00:02.000Z', outcome_status: 'completed' },
      { event_id: 'e2', agent_id: 'a', ts: '2026-06-01T00:00:03.000Z', outcome_status: 'running' },
      { event_id: 'e3', agent_id: 'a', ts: '2026-06-01T00:00:04.000Z', outcome_status: 'running' },
      { event_id: 'e3', agent_id: 'a', ts: '2026-06-01T00:00:05.000Z', outcome_status: 'interrupted' },
    ]);
    const s = await readSamples({});
    expect(s).toHaveLength(3);
    const byId = Object.fromEntries(s.map((x) => [x.event_id, x.outcome_status]));
    expect(byId).toEqual({ e1: 'completed', e2: 'running', e3: 'interrupted' });
  });
});
