import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from '@/api/behavior/samples/route';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dc-samples-'));
  process.env.DASHCLAW_BEHAVIOR_SAMPLES_DIR = dir;
});
afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('GET /api/behavior/samples', () => {
  it('?list=N returns recent records with secrets redacted', async () => {
    const secret = 'sk_test_0123456789abcdefghij';
    writeFileSync(
      join(dir, '2026-06-01.jsonl'),
      JSON.stringify({
        event_id: 'e1', agent_id: 'a', ts: '2026-06-01T00:00:01.000Z',
        tool: 'Bash', command_shape: `curl ${secret}`, risk_score: 40,
        guard_decision: 'allow', outcome_status: 'completed',
      }) + '\n',
      'utf8',
    );
    const res = await GET(new Request('http://localhost/api/behavior/samples?list=10'));
    const json = await res.json();
    expect(json.count).toBe(1);
    expect(json.samples[0].event_id).toBe('e1');
    expect(json.samples[0].tool).toBe('Bash');
    // The raw secret must never reach the response.
    expect(JSON.stringify(json)).not.toContain(secret);
  });

  it('without ?list returns status, not records', async () => {
    const res = await GET(new Request('http://localhost/api/behavior/samples'));
    const json = await res.json();
    expect(json).toHaveProperty('recorder_enabled');
    expect(json).not.toHaveProperty('samples');
  });
});
