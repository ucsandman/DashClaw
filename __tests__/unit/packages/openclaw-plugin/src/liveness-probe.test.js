/**
 * The OpenClaw enforcement-liveness probe.
 *
 * OpenClaw's seam is an in-process `before_tool_call` handler, so it cannot be
 * spawned the way the python probe spawns a hook command. What must survive
 * that difference is the CONTRACT, and these tests pin it:
 *
 *   - the verdict comes from the WITNESS (did the held action execute?), never
 *     from what the guard decided — the ledger is exactly what lied in v4.72.1
 *   - a veto means the witness is never written
 *   - no veto means the probe performs the write the seam should have stopped,
 *     and its existence is the evidence
 *   - a handler that THROWS is fail-open, because OpenClaw proceeds past a
 *     throwing hook — it must never be scored as a hold
 *   - the run is filed under `runtime: openclaw` so this seam is scored on its
 *     own (drizzle/0072)
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  statSync: vi.fn(() => {
    throw new Error('ENOENT');
  }),
}));
vi.mock('node:fs', () => ({ ...fsMock, default: fsMock }));

const osMock = vi.hoisted(() => ({ homedir: vi.fn(() => '/fakehome') }));
vi.mock('node:os', () => ({ ...osMock, default: osMock }));

const { runLivenessProbe, shouldProbeNow, PROBE_RUNTIME } = await import(
  '../../../../../packages/openclaw-plugin/src/liveness-probe.ts'
);

function baseOptions(overrides = {}) {
  return {
    dashclawUrl: 'https://dash.example',
    dashclawApiKey: 'oc_live_test',
    witnessRoot: '/fakehome/.dashclaw/liveness-probe',
    fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({ id: 'elr_1' }) })),
    ...overrides,
  };
}

describe('runLivenessProbe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.existsSync.mockReturnValue(true);
  });

  it('verdicts held when the seam vetoes, and never writes the witness', async () => {
    const driveSeam = vi.fn(async () => ({ block: true, blockReason: 'Blocked by DashClaw policy' }));
    const run = await runLivenessProbe(baseOptions({ driveSeam }));

    assert.equal(run.verdict, 'held');
    assert.equal(run.runtime, PROBE_RUNTIME);
    assert.equal(run.witness.executed, false);
    assert.equal(fsMock.writeFileSync.mock.calls.length, 0);
  });

  it('drives the seam with the synthetic .env Write the python probe uses', async () => {
    // Same class of action on every seam, or the seams are not comparable: the
    // path shape is what trips sensitive-path / outside-workspace risk.
    const driveSeam = vi.fn(async () => ({ block: true }));
    await runLivenessProbe(baseOptions({ driveSeam }));

    const event = driveSeam.mock.calls[0][0];
    assert.equal(event.toolName, 'Write');
    assert.match(event.params.file_path, /\.env$/);
    assert.match(event.params.content, /if this file exists, an action the policy should have held EXECUTED/);
  });

  it('executes the witness when the seam allows, and says so', async () => {
    const driveSeam = vi.fn(async () => undefined);
    const run = await runLivenessProbe(baseOptions({ driveSeam }));

    assert.equal(run.witness.executed, true);
    assert.equal(run.verdict, 'unprovable');
    assert.match(run.detail, /No policy held the probe action/);
    assert.equal(fsMock.writeFileSync.mock.calls.length, 1);
  });

  it('treats a THROWING handler as fail-open, never as a hold', async () => {
    // OpenClaw proceeds past a hook that throws. Scoring that as `held` would
    // report enforcement the gateway never applied.
    const driveSeam = vi.fn(async () => {
      throw new Error('gateway exploded');
    });
    const run = await runLivenessProbe(baseOptions({ driveSeam }));

    assert.notEqual(run.verdict, 'held');
    assert.equal(run.verdict, 'unprovable');
    assert.match(run.detail, /threw instead of deciding/);
  });

  it('files the verdict to POST /api/enforcement-liveness under runtime openclaw', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'elr_1' }) }));
    await runLivenessProbe(baseOptions({ driveSeam: async () => ({ block: true }), fetchImpl }));

    assert.equal(fetchImpl.mock.calls.length, 1);
    const [url, init] = fetchImpl.mock.calls[0];
    assert.equal(url, 'https://dash.example/api/enforcement-liveness');
    assert.equal(init.headers['x-api-key'], 'oc_live_test');
    assert.equal(JSON.parse(init.body).runtime, 'openclaw');
  });

  it('does not report — and does not throw — without a configured instance', async () => {
    const fetchImpl = vi.fn();
    const run = await runLivenessProbe(
      baseOptions({ driveSeam: async () => ({ block: true }), dashclawUrl: '', fetchImpl })
    );
    assert.equal(fetchImpl.mock.calls.length, 0);
    assert.equal(run.verdict, 'held');
  });

  it('survives a reporting failure — an unfiled verdict never breaks session start', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const run = await runLivenessProbe(
      baseOptions({ driveSeam: async () => ({ block: true }), fetchImpl })
    );
    assert.equal(run.verdict, 'held');
  });
});

describe('shouldProbeNow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('probes on the first run (no marker yet)', () => {
    fsMock.statSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    assert.equal(shouldProbeNow('/root', 1_000_000), true);
  });

  it('stays quiet inside the 12h window', () => {
    const now = 1_000_000_000;
    fsMock.statSync.mockReturnValue({ mtimeMs: now - 60_000 });
    assert.equal(shouldProbeNow('/root', now), false);
  });

  it('probes again once the window has passed', () => {
    const now = 1_000_000_000;
    fsMock.statSync.mockReturnValue({ mtimeMs: now - 13 * 60 * 60 * 1000 });
    assert.equal(shouldProbeNow('/root', now), true);
  });

  it('probes when the marker cannot be written — a lost throttle is not a lost probe', () => {
    fsMock.statSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    fsMock.writeFileSync.mockImplementation(() => {
      throw new Error('EACCES');
    });
    assert.equal(shouldProbeNow('/root', 1_000_000), true);
  });
});
